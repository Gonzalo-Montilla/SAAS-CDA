"""

Configuración y pruebas de integración Factus (facturación electrónica DIAN).

Lectura del modo para usuarios del tenant. La edición completa (credenciales) sigue en backoffice SaaS;
el administrador del CDA puede cambiar solo el modo (manual vs Factus) vía PATCH /settings/modo.

"""

from __future__ import annotations



from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy.orm import Session

from app.core.deps import get_admin, get_current_user, get_db

from app.integrations.factus_client import FactusAPIError, factus_base_url, get_bill_show, obtain_token

from app.models.usuario import Usuario

from app.core.factus_crypto import decrypt_secret

from app.schemas.factus import FactusModoPatch, FactusSettingsOut, FactusTestConnectionResult

from app.services.factus_tenant_settings import (
    get_or_create_settings_row,
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

    if not row.client_id or not row.client_secret_encrypted:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Configure Client ID y Client Secret de Factus.",

        )

    if not row.api_username or not row.api_password_encrypted:

        raise HTTPException(

            status_code=status.HTTP_400_BAD_REQUEST,

            detail="Configure usuario y contraseña API de Factus.",

        )



    secret = decrypt_secret(row.client_secret_encrypted)

    password = decrypt_secret(row.api_password_encrypted)

    if not secret or not password:

        raise HTTPException(

            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail="No se pudieron descifrar las credenciales. Vuelve a guardarlas.",

        )



    base = factus_base_url(use_sandbox=row.use_sandbox)

    try:

        tok = obtain_token(

            base_url=base,

            client_id=row.client_id.strip(),

            client_secret=secret,

            username=row.api_username.strip(),

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


