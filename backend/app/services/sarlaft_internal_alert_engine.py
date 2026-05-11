"""
Motor interno SARLAFT para detección automática de operación inusual.

Este módulo evalúa patrones por tenant y documento de cliente
sobre los casos SARLAFT generados en cobro.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty


@dataclass
class _RuleStats:
    total_ops: int
    cash_ops: int
    distinct_placas: int
    window_days: int


def _query_stats_by_document(
    db: Session,
    *,
    tenant_id: UUID,
    doc_number: str,
    window_days: int,
    now_dt: datetime,
) -> _RuleStats:
    start_dt = now_dt - timedelta(days=max(1, int(window_days)))
    rows: list[tuple[SarlaftCase, SarlaftCaseParty]] = (
        db.query(SarlaftCase, SarlaftCaseParty)
        .join(
            SarlaftCaseParty,
            (SarlaftCaseParty.case_id == SarlaftCase.id)
            & (SarlaftCaseParty.tenant_id == SarlaftCase.tenant_id),
        )
        .filter(
            SarlaftCase.tenant_id == tenant_id,
            SarlaftCase.created_at >= start_dt,
            SarlaftCaseParty.role == "cliente",
            SarlaftCaseParty.doc_number == doc_number,
        )
        .all()
    )
    case_seen: set[UUID] = set()
    cash_ops = 0
    placas: set[str] = set()
    for case_row, party_row in rows:
        if case_row.id in case_seen:
            continue
        case_seen.add(case_row.id)
        if (case_row.payment_method or "").strip().lower() in {"efectivo", "mixto"}:
            cash_ops += 1
        meta = party_row.metadata_json if isinstance(party_row.metadata_json, dict) else {}
        plate = str(meta.get("placa") or "").strip().upper()
        if plate:
            placas.add(plate)
    return _RuleStats(
        total_ops=len(case_seen),
        cash_ops=cash_ops,
        distinct_placas=len(placas),
        window_days=window_days,
    )


def evaluate_unusual_operation_rules(
    db: Session,
    *,
    tenant_id: UUID,
    cliente_doc_number: str,
    now_dt: datetime | None = None,
) -> list[dict]:
    """
    Evalúa reglas automáticas de operación inusual por cliente/documento.
    Retorna una lista de alertas explicables para registrar en auditoría.
    """
    doc = (cliente_doc_number or "").strip()
    if not doc:
        return []
    when = now_dt or datetime.now(timezone.utc)

    alerts: list[dict] = []

    # Regla A: Frecuencia excesiva / fraccionamiento por documento.
    freq_stats = _query_stats_by_document(
        db,
        tenant_id=tenant_id,
        doc_number=doc,
        window_days=int(settings.SARLAFT_UNUSUAL_FREQ_WINDOW_DAYS or 365),
        now_dt=when,
    )
    freq_threshold = int(settings.SARLAFT_UNUSUAL_FREQ_THRESHOLD or 4)
    freq_placas_threshold = int(settings.SARLAFT_UNUSUAL_FREQ_DISTINCT_PLACAS_THRESHOLD or 4)
    if freq_stats.total_ops >= freq_threshold and freq_stats.distinct_placas >= freq_placas_threshold:
        level = (
            "critica"
            if freq_stats.total_ops >= int(settings.SARLAFT_UNUSUAL_CRITICAL_COUNT_THRESHOLD or 10)
            else "media"
        )
        alerts.append(
            {
                "operation_classification": "operacion_inusual",
                "rule_code": "FREQ_EXCESIVA",
                "alert_level": level,
                "reason": "frecuencia_excesiva_fraccionamiento",
                "window_days": freq_stats.window_days,
                "metrics": {
                    "total_ops": freq_stats.total_ops,
                    "distinct_placas": freq_stats.distinct_placas,
                    "freq_threshold": freq_threshold,
                    "placas_threshold": freq_placas_threshold,
                },
            }
        )

    # Regla B: Uso intensivo de efectivo por documento.
    cash_stats = _query_stats_by_document(
        db,
        tenant_id=tenant_id,
        doc_number=doc,
        window_days=int(settings.SARLAFT_UNUSUAL_CASH_WINDOW_DAYS or 365),
        now_dt=when,
    )
    cash_threshold = int(settings.SARLAFT_UNUSUAL_CASH_COUNT_THRESHOLD or 4)
    cash_ratio_threshold = float(settings.SARLAFT_UNUSUAL_CASH_RATIO_THRESHOLD or 0.7)
    cash_ratio = (cash_stats.cash_ops / cash_stats.total_ops) if cash_stats.total_ops > 0 else 0.0
    if cash_stats.cash_ops >= cash_threshold and cash_ratio >= cash_ratio_threshold:
        level = (
            "critica"
            if cash_stats.cash_ops >= int(settings.SARLAFT_UNUSUAL_CRITICAL_COUNT_THRESHOLD or 10)
            else "media"
        )
        alerts.append(
            {
                "operation_classification": "operacion_inusual",
                "rule_code": "USO_INTENSIVO_EFECTIVO",
                "alert_level": level,
                "reason": "uso_intensivo_efectivo",
                "window_days": cash_stats.window_days,
                "metrics": {
                    "total_ops": cash_stats.total_ops,
                    "cash_ops": cash_stats.cash_ops,
                    "cash_ratio": round(cash_ratio, 4),
                    "cash_threshold": cash_threshold,
                    "cash_ratio_threshold": cash_ratio_threshold,
                },
            }
        )

    return alerts
