"""
Lógica compartida de configuración Factus por tenant (lectura/escritura/prueba de conexión).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.factus_crypto import decrypt_secret, encrypt_secret
from app.integrations.factus_client import (
    FactusAPIError,
    factus_base_url,
    format_factus_error_detail,
    get_municipalities,
    get_numbering_ranges,
    obtain_token,
)
from app.utils.factus_validators import email_valido_factus
from app.models.factus import TenantFactusSettings
from app.schemas.factus import (
    FactusEnvCredentialsOut,
    FactusMunicipalityItem,
    FactusNumberingRangeItem,
    FactusSettingsOut,
    FactusSettingsUpdate,
    FactusTestConnectionResult,
)


def hint_client_id(cid: str | None) -> str | None:
    if not cid or len(cid) < 4:
        return None
    return f"…{cid[-4:]}"


def active_auth_encrypted(
    row: TenantFactusSettings,
) -> tuple[str | None, str | None, str | None, str | None]:
    """
    Credenciales del ambiente activo (use_sandbox): client_id, client_secret_encrypted,
    api_username, api_password_encrypted.
    """
    if row.use_sandbox:
        return (
            (row.client_id or "").strip() or None,
            row.client_secret_encrypted,
            (row.api_username or "").strip() or None,
            row.api_password_encrypted,
        )
    return (
        (row.production_client_id or "").strip() or None,
        row.production_client_secret_encrypted,
        (row.production_api_username or "").strip() or None,
        row.production_api_password_encrypted,
    )


def creds_complete_for_active_env(row: TenantFactusSettings) -> bool:
    cid, sec, user, pwd = active_auth_encrypted(row)
    return bool(cid and sec and user and pwd)


def _env_out_sandbox(row: TenantFactusSettings) -> FactusEnvCredentialsOut:
    base = factus_base_url(use_sandbox=True)
    return FactusEnvCredentialsOut(
        client_id_configured=bool(row.client_id and row.client_id.strip()),
        client_id_hint=hint_client_id(row.client_id),
        client_secret_configured=bool(row.client_secret_encrypted),
        api_username=row.api_username,
        api_password_configured=bool(row.api_password_encrypted),
        base_url=base,
    )


def _env_out_production(row: TenantFactusSettings) -> FactusEnvCredentialsOut:
    base = factus_base_url(use_sandbox=False)
    return FactusEnvCredentialsOut(
        client_id_configured=bool(row.production_client_id and row.production_client_id.strip()),
        client_id_hint=hint_client_id(row.production_client_id),
        client_secret_configured=bool(row.production_client_secret_encrypted),
        api_username=row.production_api_username,
        api_password_configured=bool(row.production_api_password_encrypted),
        base_url=base,
    )


def get_or_create_settings_row(db: Session, tenant_id: UUID) -> TenantFactusSettings:
    row = db.query(TenantFactusSettings).filter(TenantFactusSettings.tenant_id == tenant_id).first()
    if row is None:
        row = TenantFactusSettings(tenant_id=tenant_id, modo="manual", use_sandbox=True)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def row_to_out(row: TenantFactusSettings) -> FactusSettingsOut:
    sandbox = _env_out_sandbox(row)
    production = _env_out_production(row)
    active = sandbox if row.use_sandbox else production
    base_eff = factus_base_url(use_sandbox=row.use_sandbox)
    return FactusSettingsOut(
        modo=row.modo if row.modo in ("manual", "factus") else "manual",
        use_sandbox=bool(row.use_sandbox),
        sandbox=sandbox,
        production=production,
        client_id_configured=active.client_id_configured,
        client_id_hint=active.client_id_hint,
        client_secret_configured=active.client_secret_configured,
        api_username=active.api_username,
        api_password_configured=active.api_password_configured,
        default_numbering_range_id=row.default_numbering_range_id,
        documento_soporte_numbering_range_id=row.documento_soporte_numbering_range_id,
        base_url_effective=base_eff,
        documento_soporte_notificar_proveedor_factus=(
            getattr(row, "documento_soporte_notificar_proveedor_factus", None) is not False
        ),
        documento_soporte_correo_notificacion_cda=getattr(
            row, "documento_soporte_correo_notificacion_cda", None
        ),
    )


def apply_settings_update(db: Session, row: TenantFactusSettings, body: FactusSettingsUpdate) -> None:
    data = body.model_dump(exclude_unset=True)
    row.modo = body.modo
    row.use_sandbox = body.use_sandbox
    if "client_id" in data and data["client_id"] is not None:
        row.client_id = (data["client_id"] or "").strip() or None
    if body.client_secret:
        row.client_secret_encrypted = encrypt_secret(body.client_secret)
    if "api_username" in data:
        row.api_username = (data.get("api_username") or "").strip() or None
    if body.api_password:
        row.api_password_encrypted = encrypt_secret(body.api_password)
    if "production_client_id" in data and data["production_client_id"] is not None:
        row.production_client_id = (data["production_client_id"] or "").strip() or None
    if body.production_client_secret:
        row.production_client_secret_encrypted = encrypt_secret(body.production_client_secret)
    if "production_api_username" in data:
        row.production_api_username = (data.get("production_api_username") or "").strip() or None
    if body.production_api_password:
        row.production_api_password_encrypted = encrypt_secret(body.production_api_password)
    if "default_numbering_range_id" in data:
        row.default_numbering_range_id = data.get("default_numbering_range_id")
    if "documento_soporte_numbering_range_id" in data:
        row.documento_soporte_numbering_range_id = data.get("documento_soporte_numbering_range_id")
    if "documento_soporte_notificar_proveedor_factus" in data:
        v = data.get("documento_soporte_notificar_proveedor_factus")
        if v is not None:
            row.documento_soporte_notificar_proveedor_factus = bool(v)
    if "documento_soporte_correo_notificacion_cda" in data:
        raw = data.get("documento_soporte_correo_notificacion_cda")
        if raw is None or (isinstance(raw, str) and not str(raw).strip()):
            row.documento_soporte_correo_notificacion_cda = None
        else:
            ce = str(raw).strip().lower()
            if not email_valido_factus(ce):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El correo de notificación interna (documento soporte) no es válido.",
                )
            row.documento_soporte_correo_notificacion_cda = ce[:255]
    db.commit()
    db.refresh(row)


def _factus_base_and_access_token(row: TenantFactusSettings) -> tuple[str, str]:
    """URL base + bearer del ambiente activo; exige credenciales completas."""
    if not creds_complete_for_active_env(row):
        env = "pruebas" if row.use_sandbox else "producción"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configura credenciales Factus completas para el ambiente activo ({env}).",
        )
    cid, sec_enc, user, pwd_enc = active_auth_encrypted(row)
    secret = decrypt_secret(sec_enc)
    password = decrypt_secret(pwd_enc)
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
        detail = format_factus_error_detail(e)
        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=detail) from e
    access = tok.get("access_token")
    if not access:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Token Factus sin access_token",
        )
    return base, access


def run_test_connection(row: TenantFactusSettings) -> FactusTestConnectionResult:
    if row.modo != "factus":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El modo debe ser 'factus' para probar la conexión.",
        )
    if not creds_complete_for_active_env(row):
        env = "pruebas (sandbox)" if row.use_sandbox else "producción"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Configura Client ID, secret, usuario y contraseña API de Factus para el ambiente activo ({env}).",
        )

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(row)
    secret = decrypt_secret(sec_enc)
    password = decrypt_secret(pwd_enc)
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

    env: str = "sandbox" if row.use_sandbox else "production"
    return FactusTestConnectionResult(
        ok=True,
        message="Conexión exitosa con Factus (token OAuth obtenido).",
        expires_in=tok.get("expires_in"),
        token_type=tok.get("token_type"),
        environment=env,  # type: ignore[arg-type]
    )


def list_numbering_ranges_for_tenant(row: TenantFactusSettings) -> list[FactusNumberingRangeItem]:
    """
    Rangos de numeración disponibles en Factus para el ambiente configurado (sandbox/producción).
    El `id` es el que se guarda por sede (factus_numbering_range_id) o como predeterminado del tenant (documento 01).
    """
    base, access = _factus_base_and_access_token(row)

    try:
        raw = get_numbering_ranges(base_url=base, access_token=access)
    except FactusAPIError as e:
        detail = format_factus_error_detail(e)
        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=detail) from e

    out: list[FactusNumberingRangeItem] = []
    for item in raw:
        try:
            rid = item.get("id")
            if rid is None:
                continue
            out.append(
                FactusNumberingRangeItem(
                    id=int(rid),
                    document=item.get("document"),
                    prefix=item.get("prefix"),
                    resolution_number=item.get("resolution_number"),
                    is_expired=item.get("is_expired"),
                    is_active=item.get("is_active"),
                    current=item.get("current"),
                    start_date=item.get("start_date"),
                    end_date=item.get("end_date"),
                )
            )
        except (TypeError, ValueError):
            continue
    return out


def list_municipalities_for_tenant(row: TenantFactusSettings, *, name: str | None) -> list[FactusMunicipalityItem]:
    """
    Búsqueda de municipios en Factus (GET /v1/municipalities) en el ambiente activo del tenant.
    """
    q = (name or "").strip()
    if len(q) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Indique al menos 2 caracteres del nombre del municipio para buscar.",
        )

    base, access = _factus_base_and_access_token(row)

    try:
        raw = get_municipalities(base_url=base, access_token=access, name=q)
    except FactusAPIError as e:
        detail = format_factus_error_detail(e)
        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=detail) from e

    out: list[FactusMunicipalityItem] = []
    for item in raw:
        try:
            mid = item.get("id")
            if mid is None:
                continue
            out.append(
                FactusMunicipalityItem(
                    id=int(mid),
                    code=str(item.get("code")) if item.get("code") is not None else None,
                    name=str(item.get("name")) if item.get("name") is not None else None,
                    department=str(item.get("department")) if item.get("department") is not None else None,
                )
            )
        except (TypeError, ValueError):
            continue
    return out
