"""

Configuración y pruebas de integración Factus (facturación electrónica DIAN).

Lectura del modo para usuarios del tenant. La edición completa (credenciales) sigue en backoffice SaaS;
el administrador del CDA puede cambiar solo el modo (manual vs Factus) vía PATCH /settings/modo.

"""

from __future__ import annotations



from fastapi import APIRouter, Depends, HTTPException, Query, status

from sqlalchemy.orm import Session

from app.core.deps import get_admin, get_current_user, get_db

from app.integrations.factus_client import FactusAPIError, factus_base_url, get_bill_show, obtain_token

from app.models.usuario import Usuario

from app.core.factus_crypto import decrypt_secret

from app.schemas.factus import (
    FactusModoPatch,
    FactusMunicipalityItem,
    FactusNumberingRangeItem,
    FactusSettingsOut,
    FactusTestConnectionResult,
)

from app.services.factus_tenant_settings import (
    active_auth_encrypted,
    creds_complete_for_active_env,
    get_or_create_settings_row,
    list_municipalities_for_tenant,
    list_numbering_ranges_for_tenant,
    row_to_out,
    run_test_connection,
)



router = APIRouter()





@router.get("/settings", response_model=FactusSettingsOut)

def get_factus_settings(

    db: Session = Depends(get_db),

    current_user: Usuario = Depends(get_current_user),

):

    """Lectura para cualquier usuario del tenant (p. ej. caja: modo manual vs Factus)."""

    row = get_or_create_settings_row(db, current_user.tenant_id)

    return row_to_out(row)


@router.patch("/settings/modo", response_model=FactusSettingsOut)
def patch_factus_modo(
    body: FactusModoPatch,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Conmutar solo entre facturación manual y Factus (administrador del CDA).

    Útil si Factus rechaza cobros (p. ej. factura pendiente DIAN) y no hay soporte SaaS:
    pasar a manual permite que caja ingrese el número DIAN a mano hasta regularizar Factus.
    Volver a «factus» cuando el servicio esté estable.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    row.modo = body.modo
    db.commit()
    db.refresh(row)
    return row_to_out(row)


@router.get("/municipalities", response_model=list[FactusMunicipalityItem])
def get_factus_municipalities(
    name: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Proxy a GET /v1/municipalities con token del ambiente Factus activo del CDA.
    Guarde el `id` de la fila elegida (no el código DIAN `code`).
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return list_municipalities_for_tenant(row, name=name)


@router.get("/numbering-ranges", response_model=list[FactusNumberingRangeItem])
def get_factus_numbering_ranges(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Rangos de numeración en Factus para el ambiente activo (mismas credenciales que backoffice).
    El `id` es el que se guarda por sede o como predeterminado del tenant.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return list_numbering_ranges_for_tenant(row)


@router.post("/test-connection", response_model=FactusTestConnectionResult)
def post_factus_test_connection(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    """
    Prueba OAuth contra Factus con las credenciales guardadas para este CDA (mismo criterio que backoffice SaaS).
    Requiere modo «factus» y credenciales completas.
    """
    row = get_or_create_settings_row(db, current_user.tenant_id)
    return run_test_connection(row)


@router.get("/bills/{number}")

def consultar_factura_factus(

    number: str,

    db: Session = Depends(get_db),

    current_user: Usuario = Depends(get_current_user),

):

    """

    Cuerpo **real** de la factura en Factus (no el recibo PDF de caja): `data.customer` (nombre,

    identificación, email, teléfono), `data.bill`, `data.items`, CUFE, totales.

    Documentación Factus: GET `/v1/bills/show/:number`.

    """

    row = get_or_create_settings_row(db, current_user.tenant_id)

    if not creds_complete_for_active_env(row):
        env = "pruebas (sandbox)" if row.use_sandbox else "producción"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configure credenciales Factus completas para el ambiente activo ({env}).",
        )

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(row)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    password = decrypt_secret(pwd_enc) if pwd_enc else None
    if not secret or not password or not cid or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudieron descifrar las credenciales. Vuelve a guardarlas.",
        )

    base = factus_base_url(use_sandbox=row.use_sandbox)

    try:

        tok = obtain_token(

            base_url=base,

            client_id=cid,

            client_secret=secret,

            username=user,

            password=password,

        )

    except FactusAPIError as e:

        detail = "Error al conectar con Factus."

        if isinstance(e.body, dict) and e.body.get("message"):

            detail = str(e.body.get("message"))

        elif isinstance(e.body, dict) and e.body.get("error_description"):

            detail = str(e.body.get("error_description"))

        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from e



    access = tok.get("access_token")

    if not access:

        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Token Factus sin access_token")



    num = (number or "").strip()

    if not num:

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Número de factura vacío.")



    try:

        return get_bill_show(base_url=base, access_token=access, number=num)

    except FactusAPIError as e:

        detail = str(e)

        if isinstance(e.body, dict):

            detail = str(

                e.body.get("message")

                or e.body.get("error_description")

                or e.body.get("error")

                or detail

            )

        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY

        raise HTTPException(status_code=code, detail=detail) from e


