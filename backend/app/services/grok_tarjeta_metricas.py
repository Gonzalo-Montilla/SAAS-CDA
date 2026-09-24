"""Costo estimado y persistencia de lecturas Grok de tarjeta. No guarda la imagen."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.grok_tarjeta_metrica import GrokTarjetaMetrica


def estimar_costo_grok(
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    billed: bool = True,
    origen: str = "tarjeta",
) -> tuple[Decimal, Decimal, Decimal]:
    fx = Decimal(str(getattr(settings, "RUNT_FX_USD_COP", 4000) or 4000))
    if fx <= 0:
        fx = Decimal("4000")
    if not billed:
        return Decimal("0.00"), Decimal("0.000000"), fx
    prompt_n = max(int(prompt_tokens or 0), 0)
    completion_n = max(int(completion_tokens or 0), 0)
    if prompt_n or completion_n:
        in_rate = Decimal(str(getattr(settings, "XAI_INPUT_USD_PER_MILLION", 1.25) or 1.25)) / Decimal(1_000_000)
        out_rate = Decimal(str(getattr(settings, "XAI_OUTPUT_USD_PER_MILLION", 2.50) or 2.50)) / Decimal(1_000_000)
        usd = prompt_n * in_rate + completion_n * out_rate
    elif (origen or "tarjeta") == "whatsapp":
        usd = Decimal(str(getattr(settings, "XAI_WHATSAPP_FALLBACK_USD", 0.0004) or 0.0004))
    else:
        usd = Decimal(str(getattr(settings, "XAI_TARJETA_FALLBACK_USD", 0.008) or 0.008))
    if usd < 0:
        usd = Decimal("0")
    cop = (usd * fx).quantize(Decimal("0.01"))
    return cop, usd.quantize(Decimal("0.000001")), fx


def guardar_metrica_grok_tarjeta(
    db: Session,
    *,
    tenant_id: UUID,
    sucursal_id: UUID | None,
    usuario_id: UUID | None = None,
    status: str = "error",
    encontrado: bool = False,
    billed: bool = True,
    origen: str = "tarjeta",
    placa: str | None = None,
    modelo: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    error_detail: str | None = None,
) -> None:
    origen_n = (origen or "tarjeta").strip().lower() or "tarjeta"
    if origen_n not in {"tarjeta", "whatsapp"}:
        origen_n = "tarjeta"
    cop, usd, fx = estimar_costo_grok(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        billed=billed,
        origen=origen_n,
    )
    placa_n = "".join(ch for ch in (placa or "").upper() if ch.isalnum())[:12] or None
    row = GrokTarjetaMetrica(
        tenant_id=tenant_id,
        sucursal_id=sucursal_id,
        usuario_id=usuario_id,
        origen=origen_n,
        placa_consultada=placa_n,
        modelo=(modelo or "grok-4.3")[:40],
        status=(status or "error")[:20],
        encontrado=bool(encontrado),
        billed=bool(billed),
        prompt_tokens=max(int(prompt_tokens or 0), 0),
        completion_tokens=max(int(completion_tokens or 0), 0),
        estimated_cost_cop=cop,
        estimated_cost_usd=usd,
        fx_rate_usd_cop_applied=fx,
        error_detail=(error_detail or "")[:500] or None,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(row)
    db.commit()
