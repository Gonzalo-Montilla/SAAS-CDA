"""
Motor interno SARLAFT para detección automática de operación inusual.

Este módulo evalúa patrones por tenant y documento de cliente
sobre los casos SARLAFT generados en cobro.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty
from app.models.sarlaft_intercda_signal import SarlaftIntercdaSignal


@dataclass
class _RuleStats:
    total_ops: int
    cash_ops: int
    distinct_placas: int
    window_days: int


@dataclass
class _IntercdaRuleStats:
    total_ops: int
    cash_ops: int
    distinct_placas: int
    distinct_tenants: int
    window_days: int
    doc_hash: str


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


def _normalize_document_number(raw_doc_number: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", (raw_doc_number or "").strip().upper())
    return cleaned


def _build_doc_hash(normalized_doc_number: str) -> str:
    pepper = (settings.SARLAFT_INTERCDA_DOC_HASH_PEPPER or "").strip()
    payload = f"{pepper}:{normalized_doc_number}" if pepper else normalized_doc_number
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _parse_intercda_windows() -> list[int]:
    raw = (settings.SARLAFT_INTERCDA_WINDOWS_DAYS or "").strip()
    if not raw:
        return [30, 90, 365]
    windows: list[int] = []
    for token in raw.split(","):
        val = token.strip()
        if not val:
            continue
        try:
            parsed = int(val)
        except ValueError:
            continue
        if parsed <= 0:
            continue
        windows.append(parsed)
    if not windows:
        return [30, 90, 365]
    # Ordenadas y únicas para evaluar de menor a mayor ventana.
    return sorted(set(windows))


def _query_intercda_stats_by_document(
    db: Session,
    *,
    doc_number: str,
    window_days: int,
    now_dt: datetime,
) -> _IntercdaRuleStats:
    start_dt = now_dt - timedelta(days=max(1, int(window_days)))
    rows: list[tuple[SarlaftCase, SarlaftCaseParty]] = (
        db.query(SarlaftCase, SarlaftCaseParty)
        .join(
            SarlaftCaseParty,
            (SarlaftCaseParty.case_id == SarlaftCase.id)
            & (SarlaftCaseParty.tenant_id == SarlaftCase.tenant_id),
        )
        .filter(
            SarlaftCase.created_at >= start_dt,
            SarlaftCaseParty.role == "cliente",
            SarlaftCaseParty.doc_number == doc_number,
        )
        .all()
    )
    case_seen: set[UUID] = set()
    tenant_ids: set[UUID] = set()
    cash_ops = 0
    placas: set[str] = set()
    for case_row, party_row in rows:
        if case_row.id in case_seen:
            continue
        case_seen.add(case_row.id)
        tenant_ids.add(case_row.tenant_id)
        if (case_row.payment_method or "").strip().lower() in {"efectivo", "mixto"}:
            cash_ops += 1
        meta = party_row.metadata_json if isinstance(party_row.metadata_json, dict) else {}
        plate = str(meta.get("placa") or "").strip().upper()
        if plate:
            placas.add(plate)
    normalized = _normalize_document_number(doc_number)
    return _IntercdaRuleStats(
        total_ops=len(case_seen),
        cash_ops=cash_ops,
        distinct_placas=len(placas),
        distinct_tenants=len(tenant_ids),
        window_days=window_days,
        doc_hash=_build_doc_hash(normalized),
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


def evaluate_intercda_activity_rules(
    db: Session,
    *,
    cliente_doc_number: str,
    now_dt: datetime | None = None,
) -> list[dict]:
    """
    Evalúa señal inter-CDA con anonimización por hash de documento.
    Retorna solo métricas agregadas, sin datos de identificación en claro.
    """
    if not bool(settings.SARLAFT_INTERCDA_ENABLED):
        return []
    doc_normalized = _normalize_document_number(cliente_doc_number or "")
    if not doc_normalized:
        return []
    when = now_dt or datetime.now(timezone.utc)
    min_tenants = int(settings.SARLAFT_INTERCDA_MIN_DISTINCT_TENANTS or 2)
    min_total_ops = int(settings.SARLAFT_INTERCDA_MIN_TOTAL_OPS or 4)
    min_cash_ratio = float(settings.SARLAFT_INTERCDA_MIN_CASH_RATIO or 0.6)

    alerts: list[dict] = []
    for window_days in _parse_intercda_windows():
        stats = _query_intercda_stats_by_document(
            db,
            doc_number=cliente_doc_number,
            window_days=window_days,
            now_dt=when,
        )
        if stats.total_ops <= 0:
            continue
        cash_ratio = (stats.cash_ops / stats.total_ops) if stats.total_ops > 0 else 0.0
        if (
            stats.distinct_tenants >= min_tenants
            and stats.total_ops >= min_total_ops
            and cash_ratio >= min_cash_ratio
        ):
            critical_by_count = stats.total_ops >= int(settings.SARLAFT_UNUSUAL_CRITICAL_COUNT_THRESHOLD or 10)
            critical_by_tenants = stats.distinct_tenants >= max(min_tenants + 1, 3)
            level = "critica" if (critical_by_count or critical_by_tenants) else "media"
            alerts.append(
                {
                    "operation_classification": "operacion_inusual",
                    "rule_code": "INTERCDA_INUSUAL_ACTIVITY",
                    "alert_level": level,
                    "reason": "actividad_intercda_inusual",
                    "window_days": stats.window_days,
                    "doc_hash": stats.doc_hash,
                    "metrics": {
                        "total_ops": stats.total_ops,
                        "cash_ops": stats.cash_ops,
                        "cash_ratio": round(cash_ratio, 4),
                        "distinct_tenants": stats.distinct_tenants,
                        "distinct_placas": stats.distinct_placas,
                        "min_distinct_tenants": min_tenants,
                        "min_total_ops": min_total_ops,
                        "min_cash_ratio": min_cash_ratio,
                    },
                }
            )
    return alerts


def should_emit_intercda_signal(
    db: Session,
    *,
    tenant_id: UUID,
    doc_hash: str,
    window_days: int,
    now_dt: datetime | None = None,
) -> bool:
    """
    Evita ruido por duplicidad: respeta ventana de cooldown por tenant/hash/regla.
    """
    cooldown_hours = int(settings.SARLAFT_INTERCDA_ALERT_COOLDOWN_HOURS or 72)
    ref_dt = now_dt or datetime.now(timezone.utc)
    threshold_dt = ref_dt - timedelta(hours=max(1, cooldown_hours))
    latest = (
        db.query(SarlaftIntercdaSignal)
        .filter(
            SarlaftIntercdaSignal.tenant_id == tenant_id,
            SarlaftIntercdaSignal.doc_hash == doc_hash,
            SarlaftIntercdaSignal.window_days == int(window_days),
            SarlaftIntercdaSignal.created_at >= threshold_dt,
        )
        .order_by(SarlaftIntercdaSignal.created_at.desc())
        .first()
    )
    return latest is None


def register_intercda_signal(
    db: Session,
    *,
    tenant_id: UUID,
    source_case_id: UUID | None,
    doc_hash: str,
    window_days: int,
    alert_level: str,
    reason: str,
    metrics: dict,
) -> SarlaftIntercdaSignal:
    row = SarlaftIntercdaSignal(
        tenant_id=tenant_id,
        source_case_id=source_case_id,
        doc_hash=doc_hash,
        window_days=int(window_days),
        alert_level=(alert_level or "media").strip().lower() or "media",
        reason=(reason or "actividad_intercda_inusual").strip()[:80],
        metrics_json=metrics or {},
    )
    db.add(row)
    return row
