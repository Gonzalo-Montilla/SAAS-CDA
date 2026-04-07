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
    get_numbering_ranges,
    obtain_token,
)
from app.models.factus import TenantFactusSettings
from app.schemas.factus import (
    FactusNumberingRangeItem,
    FactusSettingsOut,
    FactusSettingsUpdate,
    FactusTestConnectionResult,
)


def hint_client_id(cid: str | None) -> str | None:
    if not cid or len(cid) < 4:
        return None
    return f"…{cid[-4:]}"


def get_or_create_settings_row(db: Session, tenant_id: UUID) -> TenantFactusSettings:
    row = db.query(TenantFactusSettings).filter(TenantFactusSettings.tenant_id == tenant_id).first()
    if row is None:
        row = TenantFactusSettings(tenant_id=tenant_id, modo="manual", use_sandbox=True)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def row_to_out(row: TenantFactusSettings) -> FactusSettingsOut:
    base = factus_base_url(use_sandbox=row.use_sandbox)
    return FactusSettingsOut(
        modo=row.modo if row.modo in ("manual", "factus") else "manual",
        use_sandbox=bool(row.use_sandbox),
        client_id_configured=bool(row.client_id and row.client_id.strip()),
        client_id_hint=hint_client_id(row.client_id),
        client_secret_configured=bool(row.client_secret_encrypted),
        api_username=row.api_username,
        api_password_configured=bool(row.api_password_encrypted),
        default_numbering_range_id=row.default_numbering_range_id,
        base_url_effective=base,
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
    if "default_numbering_range_id" in data:
        row.default_numbering_range_id = data.get("default_numbering_range_id")
    db.commit()
    db.refresh(row)


def run_test_connection(row: TenantFactusSettings) -> FactusTestConnectionResult:
    if row.modo != "factus":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El modo debe ser 'factus' para probar la conexión.",
        )
    if not row.client_id or not row.client_secret_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configura Client ID y Client Secret antes de probar.",
        )
    if not row.api_username or not row.api_password_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configura usuario y contraseña de API Factus antes de probar.",
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
    El `id` es el que debe usarse en default_numbering_range_id (factura electrónica: documento 01).
    """
    if not row.client_id or not row.client_secret_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configura Client ID y Client Secret para consultar rangos.",
        )
    if not row.api_username or not row.api_password_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configura usuario y contraseña API Factus para consultar rangos.",
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
        detail = format_factus_error_detail(e)
        code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=detail) from e

    access = tok.get("access_token")
    if not access:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Token Factus sin access_token",
        )

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
