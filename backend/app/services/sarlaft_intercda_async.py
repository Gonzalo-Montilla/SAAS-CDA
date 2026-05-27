"""
Procesamiento asíncrono de señal inter-CDA.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty
from app.models.sarlaft_intercda_job import SarlaftIntercdaJob
from app.services.sarlaft_audit import log_sarlaft_event
from app.services.sarlaft_internal_alert_engine import (
    evaluate_intercda_activity_rules,
    register_intercda_signal,
    should_emit_intercda_signal,
)


def enqueue_intercda_job(
    db: Session,
    *,
    tenant_id: UUID,
    source_case_id: UUID,
) -> SarlaftIntercdaJob:
    row = SarlaftIntercdaJob(
        tenant_id=tenant_id,
        source_case_id=source_case_id,
        status="queued",
        attempts=0,
        next_run_at=datetime.utcnow(),
    )
    db.add(row)
    return row


def process_due_intercda_jobs(db: Session, *, limit: int = 200) -> int:
    now = datetime.utcnow()
    jobs = (
        db.query(SarlaftIntercdaJob)
        .filter(
            SarlaftIntercdaJob.status.in_(["queued", "retry"]),
            SarlaftIntercdaJob.next_run_at <= now,
        )
        .order_by(SarlaftIntercdaJob.next_run_at.asc(), SarlaftIntercdaJob.created_at.asc())
        .limit(max(1, int(limit)))
        .all()
    )
    processed = 0
    for job in jobs:
        processed += 1
        job.status = "processing"
        job.started_at = datetime.utcnow()
        job.attempts = int(job.attempts or 0) + 1
        db.flush()
        try:
            case = (
                db.query(SarlaftCase)
                .filter(
                    SarlaftCase.id == job.source_case_id,
                    SarlaftCase.tenant_id == job.tenant_id,
                )
                .first()
            )
            if not case:
                job.status = "discarded"
                job.finished_at = datetime.utcnow()
                job.last_error = "case_not_found"
                db.flush()
                continue
            party = (
                db.query(SarlaftCaseParty)
                .filter(
                    SarlaftCaseParty.case_id == case.id,
                    SarlaftCaseParty.tenant_id == case.tenant_id,
                    SarlaftCaseParty.role == "cliente",
                )
                .first()
            )
            doc_number = (party.doc_number if party else "") or ""
            alerts = evaluate_intercda_activity_rules(
                db,
                cliente_doc_number=doc_number,
            )
            emitted = 0
            for ia in alerts:
                doc_hash = str(ia.get("doc_hash") or "").strip().lower()
                window_days = int(ia.get("window_days") or 0)
                if not doc_hash or window_days <= 0:
                    continue
                if not should_emit_intercda_signal(
                    db,
                    tenant_id=job.tenant_id,
                    doc_hash=doc_hash,
                    window_days=window_days,
                ):
                    continue
                metrics = ia.get("metrics") if isinstance(ia.get("metrics"), dict) else {}
                register_intercda_signal(
                    db,
                    tenant_id=job.tenant_id,
                    source_case_id=case.id,
                    doc_hash=doc_hash,
                    window_days=window_days,
                    alert_level=str(ia.get("alert_level") or "media"),
                    reason=str(ia.get("reason") or "actividad_intercda_inusual"),
                    metrics=metrics,
                )
                log_sarlaft_event(
                    db,
                    tenant_id=job.tenant_id,
                    actor_user=None,
                    action="intercda_signal_generated",
                    entity_type="intercda_signal",
                    entity_id=case.id,
                    after_json={
                        "alert_level": str(ia.get("alert_level") or "media"),
                        "operation_classification": str(ia.get("operation_classification") or "operacion_inusual"),
                        "rule_code": str(ia.get("rule_code") or "INTERCDA_INUSUAL_ACTIVITY"),
                        "reason": str(ia.get("reason") or "actividad_intercda_inusual"),
                        "window_days": window_days,
                        "doc_hash": doc_hash,
                        "metrics": metrics,
                        "anonymized": True,
                        "generated_async": True,
                    },
                )
                emitted += 1

            job.status = "completed"
            job.finished_at = datetime.utcnow()
            job.last_error = None
            if emitted <= 0:
                # Mantiene trazabilidad de procesamiento aunque no dispare señal.
                log_sarlaft_event(
                    db,
                    tenant_id=job.tenant_id,
                    actor_user=None,
                    action="intercda_job_processed_without_signal",
                    entity_type="intercda_job",
                    entity_id=job.id,
                    after_json={"source_case_id": str(case.id)},
                )
            db.flush()
        except Exception as exc:
            if int(job.attempts or 0) >= 3:
                job.status = "failed"
                job.finished_at = datetime.utcnow()
            else:
                job.status = "retry"
                backoff_minutes = 5 * int(job.attempts or 1)
                job.next_run_at = datetime.utcnow() + timedelta(minutes=backoff_minutes)
            job.last_error = str(exc)[:2000]
            db.flush()
    return processed

