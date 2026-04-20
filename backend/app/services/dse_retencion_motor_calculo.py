"""Cálculo de retención en la fuente sugerida (documento soporte / motor DSE)."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.dse_retencion_umbral_uvt import umbral_uvt_para_concepto
from app.models.dse_retencion_motor import DseRetencionTasaConcepto, DseUvtPorAnio


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ResultadoRetencionDse:
    """Resultado de una corrida del motor (sin persistir)."""

    retencion_cop: Decimal | None
    aplica: bool
    base_minima_cop: Decimal | None
    umbral_uvt: Decimal
    tasa_porcentaje: Decimal | None
    valor_uvt_cop: Decimal | None
    motivo_sin_calculo: str | None


def base_minima_pesos(valor_uvt_cop: Decimal, concepto: str) -> Decimal:
    u = umbral_uvt_para_concepto(concepto)
    return _q2(u * valor_uvt_cop)


def calcular_retencion_desde_parametros(
    monto_pago_cop: Decimal,
    *,
    concepto: str,
    valor_uvt_cop: Decimal | None,
    tasa_porcentaje: Decimal | None,
) -> ResultadoRetencionDse:
    """
    `monto_pago_cop`: base del pago (valor absoluto del egreso), > 0.
    Si falta UVT y el umbral del concepto es > 0, no se puede evaluar el piso.
    """
    monto = _q2(abs(monto_pago_cop))
    if monto <= 0:
        return ResultadoRetencionDse(
            retencion_cop=_q2(Decimal("0")),
            aplica=False,
            base_minima_cop=None,
            umbral_uvt=umbral_uvt_para_concepto(concepto),
            tasa_porcentaje=tasa_porcentaje,
            valor_uvt_cop=valor_uvt_cop,
            motivo_sin_calculo="monto_cero",
        )

    u_uvt = umbral_uvt_para_concepto(concepto)
    base_min: Decimal | None = None
    if u_uvt > 0:
        if valor_uvt_cop is None or valor_uvt_cop <= 0:
            return ResultadoRetencionDse(
                retencion_cop=None,
                aplica=False,
                base_minima_cop=None,
                umbral_uvt=u_uvt,
                tasa_porcentaje=tasa_porcentaje,
                valor_uvt_cop=valor_uvt_cop,
                motivo_sin_calculo="falta_valor_uvt",
            )
        base_min = base_minima_pesos(valor_uvt_cop, concepto)
        if monto < base_min:
            return ResultadoRetencionDse(
                retencion_cop=_q2(Decimal("0")),
                aplica=False,
                base_minima_cop=base_min,
                umbral_uvt=u_uvt,
                tasa_porcentaje=tasa_porcentaje,
                valor_uvt_cop=valor_uvt_cop,
                motivo_sin_calculo="monto_bajo_base_minima",
            )

    if tasa_porcentaje is None:
        return ResultadoRetencionDse(
            retencion_cop=None,
            aplica=False,
            base_minima_cop=base_min,
            umbral_uvt=u_uvt,
            tasa_porcentaje=None,
            valor_uvt_cop=valor_uvt_cop,
            motivo_sin_calculo="sin_tasa_configurada",
        )

    t = tasa_porcentaje
    if t < 0 or t > 100:
        return ResultadoRetencionDse(
            retencion_cop=None,
            aplica=False,
            base_minima_cop=base_min,
            umbral_uvt=u_uvt,
            tasa_porcentaje=t,
            valor_uvt_cop=valor_uvt_cop,
            motivo_sin_calculo="tasa_invalida",
        )

    ret = _q2(monto * t / Decimal("100"))
    return ResultadoRetencionDse(
        retencion_cop=ret,
        aplica=True,
        base_minima_cop=base_min,
        umbral_uvt=u_uvt,
        tasa_porcentaje=t,
        valor_uvt_cop=valor_uvt_cop,
        motivo_sin_calculo=None,
    )


def cargar_uvt_y_tasa(
    db: Session, tenant_id: UUID, anio: int, concepto: str
) -> tuple[Decimal | None, Decimal | None]:
    uvt_row = (
        db.query(DseUvtPorAnio)
        .filter(DseUvtPorAnio.tenant_id == tenant_id, DseUvtPorAnio.anio == anio)
        .first()
    )
    valor_uvt = uvt_row.valor_uvt_cop if uvt_row else None
    t_row = (
        db.query(DseRetencionTasaConcepto)
        .filter(
            DseRetencionTasaConcepto.tenant_id == tenant_id,
            DseRetencionTasaConcepto.anio == anio,
            DseRetencionTasaConcepto.concepto == concepto,
        )
        .first()
    )
    tasa = t_row.porcentaje if t_row else None
    return valor_uvt, tasa


def resultado_a_dict(r: ResultadoRetencionDse) -> dict[str, Any]:
    return {
        "retencion_cop": str(r.retencion_cop) if r.retencion_cop is not None else None,
        "aplica": r.aplica,
        "base_minima_cop": str(r.base_minima_cop) if r.base_minima_cop is not None else None,
        "umbral_uvt": str(r.umbral_uvt),
        "tasa_porcentaje": str(r.tasa_porcentaje) if r.tasa_porcentaje is not None else None,
        "valor_uvt_cop": str(r.valor_uvt_cop) if r.valor_uvt_cop is not None else None,
        "motivo_sin_calculo": r.motivo_sin_calculo,
    }
