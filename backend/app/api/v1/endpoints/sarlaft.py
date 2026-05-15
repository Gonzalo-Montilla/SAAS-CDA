"""
Endpoints SARLAFT (Sprint 1).
"""
from datetime import datetime
from decimal import Decimal
import hashlib
import html
import io
import csv
from urllib.parse import quote, urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user, require_sarlaft_enabled_for_tenant
from app.core.config import settings
from app.integrations.opensanctions import OpenSanctionsError, open_sanctions_match
from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty
from app.models.sarlaft_audit_log import SarlaftAuditLog
from app.models.sarlaft_manual_check import SarlaftManualCheck
from app.models.sarlaft_sirel_report import SarlaftSirelReport
from app.models.sarlaft_batch_job import SarlaftBatchJob
from app.models.sarlaft_batch_row import SarlaftBatchRow
from app.models.sarlaft_profile import SarlaftProfile
from app.models.sucursal import Sucursal
from app.models.tenant import Tenant
from app.models.usuario import RolEnum, Usuario
from app.schemas.sarlaft import (
    SarlaftCertificateVerificationResponse,
    SarlaftInternalAlertDecisionRequest,
    SarlaftInternalAlertResponse,
    SarlaftSirelQueueItem,
    SarlaftSirelMarkReportedRequest,
    SarlaftBatchJobResponse,
    SarlaftBatchRowResponse,
    SarlaftCaseCreate,
    SarlaftCaseResponse,
    SarlaftCaseSummaryResponse,
    SarlaftCasePartyResponse,
    SarlaftManualCheckCreate,
    SarlaftManualCheckResponse,
    SarlaftProfilePatch,
    SarlaftProfileResponse,
    SarlaftScreeningRequest,
    SarlaftScreeningResponse,
    SarlaftScreeningHit,
)
from app.utils.archivo_fiscal_pdf import guardar_pdf_archivo_fiscal, leer_pdf_archivo_fiscal
from app.utils.sarlaft_certificate_pdf import build_sarlaft_manual_certificate_pdf
from app.utils.sarlaft_expediente_pdf import build_sarlaft_expediente_template_pdf
from app.services.sarlaft_audit import log_sarlaft_event

router = APIRouter(dependencies=[Depends(require_sarlaft_enabled_for_tenant)])
public_router = APIRouter()


def _ensure_profile(db: Session, tenant_id: UUID) -> SarlaftProfile:
    profile = db.query(SarlaftProfile).filter(SarlaftProfile.tenant_id == tenant_id).first()
    if profile:
        return profile
    profile = SarlaftProfile(
        tenant_id=tenant_id,
        enabled=True,
        mode="manual",
        cash_threshold_cop=Decimal("0"),
        api_trigger_mode="risk_only",
        api_fallback_to_manual=True,
    )
    db.add(profile)
    db.flush()
    return profile


def _assert_sarlaft_editor(current_user: Usuario) -> None:
    # Nota: por política temporal, SARLAFT queda restringido a ADMINISTRADOR
    # hasta crear el rol OFICIAL_CUMPLIMIENTO.
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para configurar SARLAFT.",
        )


def _map_screening_hits(raw_results: list[dict]) -> list[SarlaftScreeningHit]:
    out: list[SarlaftScreeningHit] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        props = item.get("properties")
        source_url = None
        if isinstance(props, dict):
            urls = props.get("sourceUrl") or props.get("website")
            if isinstance(urls, list) and urls:
                source_url = str(urls[0])
        out.append(
            SarlaftScreeningHit(
                entity_id=item.get("id"),
                caption=item.get("caption"),
                schema=item.get("schema"),
                score=float(item.get("score")) if item.get("score") is not None else None,
                topics=item.get("topics") or [],
                first_seen=item.get("first_seen"),
                last_seen=item.get("last_seen"),
                source_url=source_url,
            )
        )
    return out


def _classify_screening(dataset: str, hits: list[SarlaftScreeningHit], threshold: float) -> tuple[str, str, bool]:
    if not hits:
        return ("verde", "Sin coincidencias relevantes. Continuar flujo normal.", False)
    max_score = max((h.score or 0.0) for h in hits)
    has_alert = max_score >= threshold
    ds = (dataset or "").strip().lower()
    if ds == "sanctions":
        return (
            "rojo" if has_alert else "amarillo",
            "Escalar a oficial de cumplimiento y documentar debida diligencia.",
            has_alert,
        )
    return (
        "amarillo" if has_alert else "verde",
        "Revisión manual por oficial antes de cerrar el caso.",
        has_alert,
    )


def _sarlaft_result_label(risk_level: str) -> str:
    lv = (risk_level or "").strip().lower()
    if lv == "rojo":
        return "RECHAZADO"
    if lv == "amarillo":
        return "REQUIERE INFORMACION ADICIONAL"
    return "FAVORABLE"


def _sarlaft_certificate_verification_html(
    *,
    payload: SarlaftCertificateVerificationResponse,
    org_name: str | None,
) -> str:
    e = html.escape
    ok = payload.valido
    badge_bg = "#dcfce7" if ok else "#fee2e2"
    badge_fg = "#166534" if ok else "#991b1b"
    badge_tx = "Certificado verificado" if ok else "No es posible verificar este certificado"
    org = e((org_name or "").strip()) if org_name else e(payload.tenant_slug or "")
    code = e(payload.certificate_code)
    detail_err = e((payload.detail or "").strip()) if (not ok and payload.detail) else ""

    info_html = ""
    if ok:
        generated = payload.generated_at.strftime("%d/%m/%Y %H:%M:%S") if payload.generated_at else "N/D"
        info_html = f"""
        <dl class="grid">
          <dt>Organización</dt><dd>{org}</dd>
          <dt>Código certificado</dt><dd><code>{code}</code></dd>
          <dt>Consulta manual</dt><dd><code>{e(str(payload.manual_check_id or 'N/D'))}</code></dd>
          <dt>Generado</dt><dd>{e(generated)}</dd>
          <dt>Sujeto</dt><dd>{e(payload.full_name or 'N/D')}</dd>
          <dt>Documento</dt><dd>{e(((payload.doc_type or 'N/D') + ' ' + (payload.doc_number or '')).strip())}</dd>
          <dt>Nivel de riesgo</dt><dd>{e((payload.risk_level or 'N/D').upper())}</dd>
          <dt>Resultado</dt><dd>{e(payload.result_label or 'N/D')}</dd>
        </dl>
        """

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CDASOFT · Verificación SARLAFT</title>
  <style>
    body {{
      margin: 0;
      padding: 24px;
      font-family: Inter, Arial, sans-serif;
      background: #f8fbff;
      color: #0f172a;
    }}
    .card {{
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d9e2ef;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 30px -18px rgba(15, 23, 42, 0.35);
    }}
    .badge {{
      display: inline-block;
      background: {badge_bg};
      color: {badge_fg};
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 14px;
    }}
    h1 {{ font-size: 18px; margin: 0 0 14px 0; color: #0a1d3d; }}
    .grid {{
      display: grid;
      grid-template-columns: 190px 1fr;
      gap: 8px 10px;
      font-size: 14px;
    }}
    dt {{ color: #64748b; font-weight: 600; }}
    dd {{ margin: 0; }}
    code {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 1px 6px;
      font-size: 12px;
      word-break: break-all;
    }}
    .err {{ color: #991b1b; font-size: 14px; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">{e(badge_tx)}</div>
    <h1>Verificación pública de certificado SARLAFT</h1>
    {f'<p class="err">{detail_err}</p>' if detail_err else ''}
    {info_html}
  </div>
</body>
</html>"""


def _run_opensanctions_screening(
    *,
    schema: str,
    full_name: str,
    document_number: str | None = None,
    id_number: str | None = None,
    tax_number: str | None = None,
    registration_number: str | None = None,
    birth_date: str | None = None,
    nationality: str | None = None,
    jurisdiction: str | None = None,
    country: str | None = None,
    dataset: str | None = None,
    algorithm: str | None = None,
    limit: int | None = None,
) -> tuple[dict, list[SarlaftScreeningHit], float, str, str, bool]:
    screening = open_sanctions_match(
        schema=schema,
        full_name=full_name,
        document_number=document_number,
        id_number=id_number,
        tax_number=tax_number,
        registration_number=registration_number,
        birth_date=birth_date,
        nationality=nationality,
        jurisdiction=jurisdiction,
        country=country,
        dataset=dataset,
        algorithm=algorithm,
        limit=limit,
    )
    raw_results = screening.get("results") or []
    hits = _map_screening_hits(raw_results if isinstance(raw_results, list) else [])
    threshold = float(settings.OPENSANCTIONS_ALERT_SCORE_THRESHOLD or 0.75)
    risk_level, recommended_action, alert = _classify_screening(
        str(screening.get("dataset") or dataset or "default"),
        hits,
        threshold,
    )
    return screening, hits, threshold, risk_level, recommended_action, alert


def _build_case_response(
    db: Session,
    case: SarlaftCase,
    parties: list[SarlaftCaseParty],
) -> SarlaftCaseResponse:
    cliente = next((p for p in parties if (p.role or "").strip().lower() == "cliente"), None)
    if not cliente and parties:
        cliente = parties[0]
    meta = cliente.metadata_json if (cliente and isinstance(cliente.metadata_json, dict)) else {}
    sede_nombre = None
    if case.sede_id:
        sede = (
            db.query(Sucursal)
            .filter(Sucursal.id == case.sede_id, Sucursal.tenant_id == case.tenant_id)
            .first()
        )
        if sede:
            sede_nombre = sede.nombre
    return SarlaftCaseResponse(
        **{
            "id": case.id,
            "tenant_id": case.tenant_id,
            "sede_id": case.sede_id,
            "sede_nombre": sede_nombre,
            "operacion_ref": case.operacion_ref,
            "status": case.status,
            "risk_level": case.risk_level,
            "risk_score": case.risk_score,
            "transaction_amount_cop": case.transaction_amount_cop,
            "cash_amount_cop": case.cash_amount_cop,
            "payment_method": case.payment_method,
            "vehiculo_id": str(meta.get("vehiculo_id") or "").strip() or None,
            "placa": str(meta.get("placa") or "").strip() or None,
            "tipo_vehiculo": str(meta.get("tipo_vehiculo") or "").strip() or None,
            "cliente_doc_type": cliente.doc_type if cliente else None,
            "cliente_doc_number": cliente.doc_number if cliente else None,
            "cliente_full_name": cliente.full_name if cliente else None,
            "created_by_user_id": case.created_by_user_id,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
            "parties": [SarlaftCasePartyResponse.model_validate(p) for p in parties],
        }
    )


def _latest_alert_for_case(db: Session, tenant_id: UUID, case_id: UUID) -> SarlaftAuditLog | None:
    return (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.tenant_id == tenant_id,
            SarlaftAuditLog.action == "internal_alert_generated",
            SarlaftAuditLog.entity_id == case_id,
        )
        .order_by(SarlaftAuditLog.created_at.desc())
        .first()
    )


def _latest_alert_review(db: Session, tenant_id: UUID, alert_id: UUID | None) -> SarlaftAuditLog | None:
    if not alert_id:
        return None
    return (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.tenant_id == tenant_id,
            SarlaftAuditLog.action == "internal_alert_reviewed",
            SarlaftAuditLog.entity_type == "internal_alert",
            SarlaftAuditLog.entity_id == alert_id,
        )
        .order_by(SarlaftAuditLog.created_at.desc())
        .first()
    )


def _latest_alerts_map_for_cases(db: Session, tenant_id: UUID, case_ids: list[UUID]) -> dict[UUID, SarlaftAuditLog]:
    if not case_ids:
        return {}
    rows = (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.tenant_id == tenant_id,
            SarlaftAuditLog.action == "internal_alert_generated",
            SarlaftAuditLog.entity_id.in_(case_ids),
        )
        .order_by(SarlaftAuditLog.created_at.desc())
        .all()
    )
    out: dict[UUID, SarlaftAuditLog] = {}
    for row in rows:
        if row.entity_id and row.entity_id not in out:
            out[row.entity_id] = row
    return out


def _latest_reviews_map_for_alerts(db: Session, tenant_id: UUID, alert_ids: list[UUID]) -> dict[UUID, SarlaftAuditLog]:
    if not alert_ids:
        return {}
    rows = (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.tenant_id == tenant_id,
            SarlaftAuditLog.action == "internal_alert_reviewed",
            SarlaftAuditLog.entity_type == "internal_alert",
            SarlaftAuditLog.entity_id.in_(alert_ids),
        )
        .order_by(SarlaftAuditLog.created_at.desc())
        .all()
    )
    out: dict[UUID, SarlaftAuditLog] = {}
    for row in rows:
        if row.entity_id and row.entity_id not in out:
            out[row.entity_id] = row
    return out


def _build_pre_ros_text(
    *,
    case: SarlaftCase,
    cliente: SarlaftCaseParty | None,
    alert_row: SarlaftAuditLog | None,
    review_row: SarlaftAuditLog | None,
) -> str:
    alert_meta = alert_row.after_json if (alert_row and isinstance(alert_row.after_json, dict)) else {}
    review_meta = review_row.after_json if (review_row and isinstance(review_row.after_json, dict)) else {}
    metrics = alert_meta.get("metrics") if isinstance(alert_meta.get("metrics"), dict) else {}
    lines: list[str] = [
        "PRE-ROS SARLAFT (Borrador para SIREL/UIAF)",
        f"Caso interno: {case.operacion_ref}",
        f"Fecha caso: {case.created_at.strftime('%Y-%m-%d %H:%M:%S') if case.created_at else 'N/D'}",
        f"Clasificación: {str(alert_meta.get('operation_classification') or '').strip() or 'operacion_sospechosa'}",
        f"Nivel de riesgo: {case.risk_level}",
        f"Score riesgo: {float(case.risk_score or 0):.2f}",
        f"Monto operación (COP): {float(case.transaction_amount_cop or 0):,.2f}",
        f"Monto efectivo (COP): {float(case.cash_amount_cop or 0):,.2f}",
        f"Método de pago: {case.payment_method}",
    ]
    if cliente:
        lines.extend(
            [
                f"Sujeto principal: {cliente.full_name}",
                f"Documento: {(cliente.doc_type or '').strip()} {(cliente.doc_number or '').strip()}".strip(),
                f"Correo: {(cliente.email or '').strip() or 'N/D'}",
                f"Teléfono: {(cliente.phone or '').strip() or 'N/D'}",
            ]
        )
    reason = str(alert_meta.get("reason") or "").strip()
    if reason:
        lines.append(f"Motivo de alerta interna: {reason}")
    rule_code = str(alert_meta.get("rule_code") or "").strip()
    if rule_code:
        lines.append(f"Regla interna: {rule_code}")
    if metrics:
        lines.append("Métricas relevantes:")
        for k, v in metrics.items():
            lines.append(f"- {k}: {v}")
    decision = str(review_meta.get("decision") or "").strip()
    if decision:
        lines.append(f"Decisión oficial: {decision}")
    notes = str(review_meta.get("notes") or "").strip()
    if notes:
        lines.append(f"Notas oficial: {notes}")
    ddi_fields = [
        ("Declaración origen de fondos", str(review_meta.get("funds_source_declaration") or "").strip()),
        ("Soporte actividad económica", str(review_meta.get("economic_activity_support") or "").strip()),
        ("Entrevista cajero", str(review_meta.get("cashier_interview") or "").strip()),
    ]
    for label, value in ddi_fields:
        if value:
            lines.append(f"{label}: {value}")
    refs = review_meta.get("support_refs")
    if isinstance(refs, list) and refs:
        lines.append("Referencias de soporte:")
        for ref in refs:
            r = str(ref or "").strip()
            if r:
                lines.append(f"- {r}")
    return "\n".join(lines)


def _extract_source_urls_from_hits(hits_raw: list[dict] | None) -> list[str]:
    urls: list[str] = []
    rows = hits_raw if isinstance(hits_raw, list) else []
    for hit in rows:
        if not isinstance(hit, dict):
            continue
        props = hit.get("properties")
        if not isinstance(props, dict):
            continue
        source_list = props.get("sourceUrl") or props.get("website")
        if isinstance(source_list, list):
            for item in source_list:
                v = str(item or "").strip()
                if v:
                    urls.append(v)
    return urls


def _source_coverage_from_hits(hits_raw: list[dict] | None) -> tuple[list[str], dict[str, bool]]:
    urls = _extract_source_urls_from_hits(hits_raw)
    labels: list[str] = ["OpenSanctions (API /match)"]
    coverage = {
        "onu": False,
        "ofac": False,
        "europea": False,
        "otras": False,
    }
    european_markers = (
        "europa.eu",
        "eu sanctions",
        "european union",
        "ofsi",
        "gov.uk",
        "hmt-sanctions",
        "fiu.net",
        "consilium.europa.eu",
    )
    for raw in urls:
        low = raw.lower()
        if ("un.org" in low or "unitednations" in low) and "ONU (United Nations)" not in labels:
            labels.append("ONU (United Nations)")
            coverage["onu"] = True
            continue
        if "ofac" in low or "treasury.gov" in low:
            if "OFAC (Sanctions Search)" not in labels:
                labels.append("OFAC (Sanctions Search)")
            coverage["ofac"] = True
            continue
        if any(marker in low for marker in european_markers):
            if "Listas europeas (UE/UK)" not in labels:
                labels.append("Listas europeas (UE/UK)")
            coverage["europea"] = True
            continue
        coverage["otras"] = True
        host = (urlparse(raw).netloc or "").replace("www.", "").strip()
        if host:
            candidate = f"Fuente externa: {host}"
            if candidate not in labels:
                labels.append(candidate)
    return labels, coverage


def _batch_job_response(job: SarlaftBatchJob) -> SarlaftBatchJobResponse:
    return SarlaftBatchJobResponse.model_validate(job)


def _batch_row_response(row: SarlaftBatchRow) -> SarlaftBatchRowResponse:
    payload = SarlaftBatchRowResponse.model_validate(row).model_dump()
    payload["source_labels"] = (
        [str(x) for x in row.source_labels_json if isinstance(x, str)]
        if isinstance(row.source_labels_json, list)
        else []
    )
    payload["source_coverage"] = (
        {str(k): bool(v) for k, v in row.source_coverage_json.items()}
        if isinstance(row.source_coverage_json, dict)
        else {}
    )
    return SarlaftBatchRowResponse(**payload)


def _run_batch_job_sync(db: Session, *, job: SarlaftBatchJob, current_user: Usuario) -> None:
    job.status = "processing"
    job.started_at = datetime.utcnow()
    db.flush()
    rows = (
        db.query(SarlaftBatchRow)
        .filter(
            SarlaftBatchRow.tenant_id == current_user.tenant_id,
            SarlaftBatchRow.batch_job_id == job.id,
        )
        .order_by(SarlaftBatchRow.row_index.asc())
        .all()
    )
    for row in rows:
        try:
            payload = SarlaftManualCheckCreate(
                subject_type=(row.subject_type or "natural"),
                full_name=(row.full_name or "").strip(),
                doc_type=(row.doc_type or "").strip() or None,
                doc_number=(row.doc_number or "").strip() or None,
                email=(row.email or "").strip() or None,
                phone=(row.phone or "").strip() or None,
                dataset=job.dataset if job.dataset in {"default", "sanctions"} else "sanctions",
                algorithm="best",
                limit=5,
            )
            is_juridica = payload.subject_type == "juridica"
            doc_type_norm = (payload.doc_type or "").strip().upper()
            doc_number_norm = (payload.doc_number or "").strip() or None
            id_number = doc_number_norm if not is_juridica else None
            tax_number = doc_number_norm if is_juridica else None
            registration_number = doc_number_norm if is_juridica and doc_type_norm != "NIT" else None
            screening, hits, _, risk_level, _, alert = _run_opensanctions_screening(
                schema="Company" if is_juridica else "Person",
                full_name=payload.full_name,
                document_number=doc_number_norm,
                id_number=id_number,
                tax_number=tax_number,
                registration_number=registration_number,
                dataset=payload.dataset,
                algorithm=payload.algorithm,
                limit=payload.limit,
            )
            max_score = max((h.score or 0.0) for h in hits) if hits else 0.0
            manual_row = SarlaftManualCheck(
                tenant_id=current_user.tenant_id,
                created_by_user_id=current_user.id,
                subject_type=payload.subject_type,
                full_name=payload.full_name.strip(),
                doc_type=doc_type_norm or None,
                doc_number=doc_number_norm,
                email=(payload.email or "").strip().lower() or None,
                phone=(payload.phone or "").strip() or None,
                dataset=payload.dataset,
                algorithm=payload.algorithm,
                risk_level=risk_level,
                risk_score=Decimal(str(round(max_score * 100, 2))),
                alert=bool(alert),
                hits_count=len(hits),
                hits_json=screening.get("results"),
            )
            db.add(manual_row)
            db.flush()
            source_labels, source_coverage = _source_coverage_from_hits(
                manual_row.hits_json if isinstance(manual_row.hits_json, list) else []
            )
            row.status = "ok"
            row.risk_level = risk_level
            row.hits_count = len(hits)
            row.alert = bool(alert)
            row.source_labels_json = source_labels
            row.source_coverage_json = source_coverage
            row.error_detail = None
            row.created_manual_check_id = manual_row.id
            if risk_level in {"amarillo", "rojo"}:
                alert_level = "critica" if risk_level == "rojo" else "media"
                log_sarlaft_event(
                    db,
                    tenant_id=current_user.tenant_id,
                    actor_user=current_user,
                    action="internal_alert_generated",
                    entity_type="batch_row",
                    entity_id=row.id,
                    after_json={
                        "source_origin": "lote",
                        "alert_level": alert_level,
                        "operation_classification": "operacion_inusual",
                        "rule_code": "BATCH_SCREENING",
                        "reason": "resultado_consulta_lote",
                        "risk_level": risk_level,
                        "risk_score": str(manual_row.risk_score),
                        "hits_count": len(hits),
                        "batch_job_id": str(job.id),
                        "batch_row_id": str(row.id),
                        "manual_check_id": str(manual_row.id),
                        "doc_number": row.doc_number,
                    },
                )
            job.success_records += 1
            if risk_level == "rojo":
                job.rojo_records += 1
            elif risk_level == "amarillo":
                job.amarillo_records += 1
            else:
                job.verde_records += 1
        except Exception as exc:
            row.status = "error"
            row.error_detail = str(exc)[:2000]
            job.error_records += 1
        finally:
            job.processed_records += 1
            db.flush()
    job.status = "completed_with_errors" if job.error_records > 0 else "completed"
    job.finished_at = datetime.utcnow()
    db.flush()


@router.get("/profile", response_model=SarlaftProfileResponse)
def get_sarlaft_profile(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    profile = _ensure_profile(db, current_user.tenant_id)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/profile", response_model=SarlaftProfileResponse)
def patch_sarlaft_profile(
    payload: SarlaftProfilePatch,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _assert_sarlaft_editor(current_user)
    profile = _ensure_profile(db, current_user.tenant_id)
    before = {
        "enabled": bool(profile.enabled),
        "mode": str(profile.mode),
        "cash_threshold_cop": str(profile.cash_threshold_cop or 0),
        "api_trigger_mode": str(profile.api_trigger_mode),
        "api_provider": profile.api_provider,
        "api_fallback_to_manual": bool(profile.api_fallback_to_manual),
    }
    data = payload.model_dump(exclude_unset=True)
    if "enabled" in data and data["enabled"] is not None:
        profile.enabled = bool(data["enabled"])
    if "mode" in data and data["mode"] is not None:
        profile.mode = data["mode"]
    if "cash_threshold_cop" in data and data["cash_threshold_cop"] is not None:
        profile.cash_threshold_cop = data["cash_threshold_cop"]
    if "api_trigger_mode" in data and data["api_trigger_mode"] is not None:
        profile.api_trigger_mode = data["api_trigger_mode"]
    if "api_provider" in data:
        profile.api_provider = (data["api_provider"] or "").strip() or None
    if "api_fallback_to_manual" in data and data["api_fallback_to_manual"] is not None:
        profile.api_fallback_to_manual = bool(data["api_fallback_to_manual"])

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="profile_updated",
        entity_type="profile",
        entity_id=profile.id,
        before_json=before,
        after_json={
            "enabled": bool(profile.enabled),
            "mode": str(profile.mode),
            "cash_threshold_cop": str(profile.cash_threshold_cop or 0),
            "api_trigger_mode": str(profile.api_trigger_mode),
            "api_provider": profile.api_provider,
            "api_fallback_to_manual": bool(profile.api_fallback_to_manual),
        },
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/screening/opensanctions", response_model=SarlaftScreeningResponse)
def screening_opensanctions(
    payload: SarlaftScreeningRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para ejecutar screening SARLAFT.",
        )
    try:
        screening, hits, threshold, risk_level, recommended_action, alert = _run_opensanctions_screening(
            schema=payload.schema,
            full_name=payload.full_name,
            document_number=payload.document_number,
            birth_date=payload.birth_date,
            nationality=payload.nationality,
            country=payload.nationality,
            dataset=payload.dataset,
            algorithm=payload.algorithm,
            limit=payload.limit,
        )
    except OpenSanctionsError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error OpenSanctions: {str(exc)}",
        ) from exc

    raw_results = screening.get("results") or []

    case_id = payload.case_id
    if case_id and payload.persist_in_case:
        case = (
            db.query(SarlaftCase)
            .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
            .first()
        )
        if not case:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Caso SARLAFT no encontrado para aplicar clasificación.",
            )
        max_score = max((h.score or 0.0) for h in hits) if hits else 0.0
        case.risk_level = risk_level
        case.risk_score = Decimal(str(round(max_score * 100, 2)))
        if risk_level == "rojo":
            case.status = "in_review"

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="opensanctions_screening",
        entity_type="screening",
        entity_id=None,
        before_json=None,
        after_json={
            "provider": "opensanctions",
            "dataset": screening.get("dataset"),
            "algorithm": screening.get("algorithm"),
            "query_name": payload.full_name,
            "schema": payload.schema,
            "threshold": threshold,
            "hits_count": len(hits),
            "alert": alert,
            "risk_level": risk_level,
            "recommended_action": recommended_action,
            "case_id": str(case_id) if case_id else None,
        },
    )
    db.commit()

    return SarlaftScreeningResponse(
        provider="opensanctions",
        dataset=str(screening.get("dataset") or "default"),
        algorithm=str(screening.get("algorithm") or "best"),
        threshold=threshold,
        hits=hits,
        alert=alert,
        raw_count=len(raw_results) if isinstance(raw_results, list) else 0,
        risk_level=risk_level,  # verde | amarillo | rojo
        recommended_action=recommended_action,
        case_id=case_id,
    )


@router.post("/manual-checks", response_model=SarlaftManualCheckResponse, status_code=status.HTTP_201_CREATED)
def create_sarlaft_manual_check(
    payload: SarlaftManualCheckCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para registrar consultas manuales SARLAFT.",
        )
    is_juridica = payload.subject_type == "juridica"
    schema = "Company" if is_juridica else "Person"
    doc_type_norm = (payload.doc_type or "").strip().upper()
    doc_number_norm = (payload.doc_number or "").strip() or None
    id_number = doc_number_norm if not is_juridica else None
    tax_number = doc_number_norm if is_juridica else None
    registration_number = doc_number_norm if is_juridica and doc_type_norm != "NIT" else None
    try:
        screening, hits, _, risk_level, _, alert = _run_opensanctions_screening(
            schema=schema,
            full_name=payload.full_name,
            document_number=doc_number_norm,
            id_number=id_number,
            tax_number=tax_number,
            registration_number=registration_number,
            birth_date=payload.birth_date,
            nationality=payload.nationality,
            jurisdiction=payload.nationality if is_juridica else None,
            country=payload.nationality,
            dataset=payload.dataset,
            algorithm=payload.algorithm,
            limit=payload.limit,
        )
    except OpenSanctionsError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error OpenSanctions: {str(exc)}",
        ) from exc

    max_score = max((h.score or 0.0) for h in hits) if hits else 0.0
    row = SarlaftManualCheck(
        tenant_id=current_user.tenant_id,
        created_by_user_id=current_user.id,
        subject_type=payload.subject_type,
        full_name=payload.full_name.strip(),
        doc_type=doc_type_norm or None,
        doc_number=doc_number_norm,
        email=(payload.email or "").strip().lower() or None,
        phone=(payload.phone or "").strip() or None,
        economic_activity=(payload.economic_activity or "").strip() or None,
        legal_representative=(payload.legal_representative or "").strip() or None,
        dataset=payload.dataset,
        algorithm=payload.algorithm,
        risk_level=risk_level,
        risk_score=Decimal(str(round(max_score * 100, 2))),
        alert=bool(alert),
        hits_count=len(hits),
        hits_json=screening.get("results"),
        notes=(payload.notes or "").strip() or None,
    )
    db.add(row)
    db.flush()

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="manual_check_created",
        entity_type="manual_check",
        entity_id=row.id,
        after_json={
            "subject_type": row.subject_type,
            "full_name": row.full_name,
            "doc_type": row.doc_type,
            "doc_number": row.doc_number,
            "email": row.email,
            "phone": row.phone,
            "dataset": row.dataset,
            "algorithm": row.algorithm,
            "risk_level": row.risk_level,
            "risk_score": str(row.risk_score),
            "hits_count": row.hits_count,
            "alert": row.alert,
        },
    )
    if row.risk_level in {"amarillo", "rojo"}:
        alert_level = "critica" if row.risk_level == "rojo" else "media"
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="internal_alert_generated",
            entity_type="manual_check",
            entity_id=row.id,
            after_json={
                "source_origin": "manual",
                "alert_level": alert_level,
                "operation_classification": "operacion_inusual",
                "rule_code": "MANUAL_SCREENING",
                "reason": "resultado_consulta_manual",
                "risk_level": row.risk_level,
                "risk_score": str(row.risk_score),
                "hits_count": row.hits_count,
                "manual_check_id": str(row.id),
                "subject_type": row.subject_type,
                "doc_number": row.doc_number,
            },
        )
    db.commit()
    db.refresh(row)
    source_labels, source_coverage = _source_coverage_from_hits(row.hits_json if isinstance(row.hits_json, list) else [])
    payload = SarlaftManualCheckResponse.model_validate(row).model_dump()
    payload["source_labels"] = source_labels
    payload["source_coverage"] = source_coverage
    return SarlaftManualCheckResponse(**payload)


@router.get("/batch/template.csv")
def download_sarlaft_batch_template_csv(
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para descargar plantilla de lote SARLAFT.",
        )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["subject_type", "full_name", "doc_type", "doc_number", "email", "phone"])
    writer.writerow(["natural", "NOMBRE APELLIDO", "CC", "12345678", "correo@ejemplo.com", "3001234567"])
    writer.writerow(["juridica", "EMPRESA SAS", "NIT", "900123456", "cumplimiento@empresa.com", "6011234567"])
    content = output.getvalue().encode("utf-8")
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="sarlaft_lote_template.csv"'},
    )


@router.post("/batch/jobs", response_model=SarlaftBatchJobResponse, status_code=status.HTTP_201_CREATED)
def create_sarlaft_batch_job(
    file: UploadFile = File(...),
    dataset: str = Form(default="sanctions"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para ejecutar lotes SARLAFT.",
        )
    ds = (dataset or "sanctions").strip().lower()
    if ds not in {"default", "sanctions"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dataset inválido para lote.")
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo inválido para lote.")
    file_bytes = file.file.read()
    text_data = file_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text_data))
    required_cols = {"subject_type", "full_name", "doc_type", "doc_number", "email", "phone"}
    if not reader.fieldnames or not required_cols.issubset({(c or "").strip() for c in reader.fieldnames}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo CSV inválido. Usa la plantilla oficial de lote SARLAFT.",
        )
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo CSV está vacío.")
    if len(rows) > 2000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El lote supera el máximo permitido (2000).")
    job = SarlaftBatchJob(
        tenant_id=current_user.tenant_id,
        created_by_user_id=current_user.id,
        filename=(file.filename or "sarlaft_batch.csv")[:255],
        dataset=ds,
        status="queued",
        total_records=len(rows),
    )
    db.add(job)
    db.flush()
    for idx, item in enumerate(rows, start=1):
        row = SarlaftBatchRow(
            tenant_id=current_user.tenant_id,
            batch_job_id=job.id,
            row_index=idx,
            subject_type=(item.get("subject_type") or "").strip().lower() or None,
            full_name=(item.get("full_name") or "").strip() or None,
            doc_type=(item.get("doc_type") or "").strip().upper() or None,
            doc_number=(item.get("doc_number") or "").strip() or None,
            email=(item.get("email") or "").strip().lower() or None,
            phone=(item.get("phone") or "").strip() or None,
            status="pending",
        )
        db.add(row)
    db.flush()
    _run_batch_job_sync(db, job=job, current_user=current_user)
    db.commit()
    db.refresh(job)
    return _batch_job_response(job)


@router.get("/batch/jobs", response_model=list[SarlaftBatchJobResponse])
def list_sarlaft_batch_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para listar lotes SARLAFT.",
        )
    rows = (
        db.query(SarlaftBatchJob)
        .filter(SarlaftBatchJob.tenant_id == current_user.tenant_id)
        .order_by(SarlaftBatchJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_batch_job_response(r) for r in rows]


@router.get("/batch/jobs/{job_id}/rows", response_model=list[SarlaftBatchRowResponse])
def list_sarlaft_batch_job_rows(
    job_id: UUID,
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para consultar detalle de lote SARLAFT.",
        )
    job = (
        db.query(SarlaftBatchJob)
        .filter(SarlaftBatchJob.id == job_id, SarlaftBatchJob.tenant_id == current_user.tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lote SARLAFT no encontrado.")
    rows = (
        db.query(SarlaftBatchRow)
        .filter(
            SarlaftBatchRow.tenant_id == current_user.tenant_id,
            SarlaftBatchRow.batch_job_id == job.id,
        )
        .order_by(SarlaftBatchRow.row_index.asc())
        .limit(limit)
        .all()
    )
    return [_batch_row_response(r) for r in rows]


@router.get("/batch/jobs/{job_id}/rows.csv")
def download_sarlaft_batch_job_rows_csv(
    job_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para exportar lote SARLAFT.",
        )
    job = (
        db.query(SarlaftBatchJob)
        .filter(SarlaftBatchJob.id == job_id, SarlaftBatchJob.tenant_id == current_user.tenant_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lote SARLAFT no encontrado.")
    rows = (
        db.query(SarlaftBatchRow)
        .filter(
            SarlaftBatchRow.tenant_id == current_user.tenant_id,
            SarlaftBatchRow.batch_job_id == job.id,
        )
        .order_by(SarlaftBatchRow.row_index.asc())
        .all()
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "row_index",
            "subject_type",
            "full_name",
            "doc_type",
            "doc_number",
            "email",
            "phone",
            "status",
            "risk_level",
            "hits_count",
            "alert",
            "onu",
            "ofac",
            "europea",
            "error_detail",
            "manual_check_id",
        ]
    )
    for r in rows:
        coverage = r.source_coverage_json if isinstance(r.source_coverage_json, dict) else {}
        writer.writerow(
            [
                r.row_index,
                r.subject_type or "",
                r.full_name or "",
                r.doc_type or "",
                r.doc_number or "",
                r.email or "",
                r.phone or "",
                r.status,
                r.risk_level or "",
                r.hits_count,
                "si" if r.alert else "no",
                "si" if bool(coverage.get("onu")) else "no",
                "si" if bool(coverage.get("ofac")) else "no",
                "si" if bool(coverage.get("europea")) else "no",
                r.error_detail or "",
                str(r.created_manual_check_id) if r.created_manual_check_id else "",
            ]
        )
    filename = f"sarlaft_lote_resultado_{job.id}.csv"
    return Response(
        content=output.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/manual-checks/{manual_check_id}/certificate")
def download_sarlaft_manual_check_certificate(
    manual_check_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para emitir certificados SARLAFT.",
        )
    row = (
        db.query(SarlaftManualCheck)
        .filter(SarlaftManualCheck.id == manual_check_id, SarlaftManualCheck.tenant_id == current_user.tenant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consulta manual SARLAFT no encontrada.")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado.")

    if row.certificate_pdf_relpath:
        stored = leer_pdf_archivo_fiscal(row.certificate_pdf_relpath)
        if stored:
            filename = f"sarlaft_certificado_{(row.certificate_code or str(row.id))}.pdf"
            return Response(
                content=stored,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "X-Sarlaft-Certificate-Code": row.certificate_code or "",
                },
            )

    now = datetime.utcnow()
    cert_code = (row.certificate_code or "").strip()
    if not cert_code:
        cert_code = f"SAR-{str(current_user.tenant_id).split('-')[0].upper()}-{now.strftime('%Y%m%d%H%M%S')}-{str(row.id).split('-')[0].upper()}"
        row.certificate_code = cert_code

    base_url = (settings.BACKEND_PUBLIC_BASE_URL or "").strip().rstrip("/")
    verification_url = (
        f"{base_url}/sarlaft/verificar/"
        f"{quote(tenant.slug, safe='')}/{quote(cert_code, safe='')}"
    )

    source_urls: list[str] = []
    hits_raw = row.hits_json if isinstance(row.hits_json, list) else []
    for hit in hits_raw:
        if not isinstance(hit, dict):
            continue
        props = hit.get("properties")
        if isinstance(props, dict):
            urls = props.get("sourceUrl") or props.get("website")
            if isinstance(urls, list):
                for u in urls:
                    if isinstance(u, str) and u.strip():
                        source_urls.append(u.strip())

    pdf_buffer = build_sarlaft_manual_certificate_pdf(
        tenant_nombre=tenant.nombre_comercial or tenant.nombre,
        tenant_nit=tenant.nit_cda,
        tenant_logo_url=tenant.logo_url,
        certificate_code=cert_code,
        verification_url=verification_url,
        manual_check_id=str(row.id),
        fecha_consulta=row.created_at,
        fecha_emision=now,
        full_name=row.full_name,
        subject_type=row.subject_type,
        doc_type=row.doc_type,
        doc_number=row.doc_number,
        email=row.email,
        phone=row.phone,
        economic_activity=row.economic_activity,
        legal_representative=row.legal_representative,
        dataset=row.dataset,
        algorithm=row.algorithm,
        risk_level=row.risk_level,
        risk_score=float(row.risk_score or 0),
        hits_count=int(row.hits_count or 0),
        source_urls=source_urls,
        performed_by_name=current_user.nombre_completo or current_user.email,
        performed_by_role=str(current_user.rol.value if hasattr(current_user.rol, "value") else current_user.rol),
        notes=row.notes,
    )
    content = pdf_buffer.getvalue()
    sha256_hex = hashlib.sha256(content).hexdigest()

    pdf_buffer_final = build_sarlaft_manual_certificate_pdf(
        tenant_nombre=tenant.nombre_comercial or tenant.nombre,
        tenant_nit=tenant.nit_cda,
        tenant_logo_url=tenant.logo_url,
        certificate_code=cert_code,
        verification_url=verification_url,
        manual_check_id=str(row.id),
        fecha_consulta=row.created_at,
        fecha_emision=now,
        full_name=row.full_name,
        subject_type=row.subject_type,
        doc_type=row.doc_type,
        doc_number=row.doc_number,
        email=row.email,
        phone=row.phone,
        economic_activity=row.economic_activity,
        legal_representative=row.legal_representative,
        dataset=row.dataset,
        algorithm=row.algorithm,
        risk_level=row.risk_level,
        risk_score=float(row.risk_score or 0),
        hits_count=int(row.hits_count or 0),
        source_urls=source_urls,
        performed_by_name=current_user.nombre_completo or current_user.email,
        performed_by_role=str(current_user.rol.value if hasattr(current_user.rol, "value") else current_user.rol),
        pdf_sha256_hex=sha256_hex,
        notes=row.notes,
    )
    final_content = pdf_buffer_final.getvalue()
    final_sha = hashlib.sha256(final_content).hexdigest()

    relpath, _ = guardar_pdf_archivo_fiscal(
        tenant_id=current_user.tenant_id,
        prefijo="sarlaft_cert",
        entity_id=row.id,
        pdf_bytes=final_content,
    )

    row.certificate_pdf_relpath = relpath
    row.certificate_pdf_sha256 = final_sha
    row.certificate_issued_at = now
    row.certificate_issued_by_user_id = current_user.id

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="manual_check_certificate_generated",
        entity_type="manual_check",
        entity_id=row.id,
        after_json={
            "certificate_code": cert_code,
            "certificate_pdf_relpath": relpath,
            "certificate_pdf_sha256": final_sha,
        },
    )
    db.commit()
    db.refresh(row)

    filename = f"sarlaft_certificado_{cert_code}.pdf"
    return Response(
        content=final_content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Sarlaft-Certificate-Code": cert_code,
        },
    )


@router.get("/manual-checks", response_model=list[SarlaftManualCheckResponse])
def list_sarlaft_manual_checks(
    subject_type: str | None = Query(default=None),
    risk_level: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para listar consultas manuales SARLAFT.",
        )
    q = (
        db.query(SarlaftManualCheck)
        .filter(SarlaftManualCheck.tenant_id == current_user.tenant_id)
        .order_by(SarlaftManualCheck.created_at.desc())
    )
    if subject_type:
        q = q.filter(SarlaftManualCheck.subject_type == subject_type.strip().lower())
    if risk_level:
        q = q.filter(SarlaftManualCheck.risk_level == risk_level.strip().lower())
    rows = q.limit(limit).all()
    out: list[SarlaftManualCheckResponse] = []
    for r in rows:
        source_labels, source_coverage = _source_coverage_from_hits(r.hits_json if isinstance(r.hits_json, list) else [])
        payload = SarlaftManualCheckResponse.model_validate(r).model_dump()
        payload["source_labels"] = source_labels
        payload["source_coverage"] = source_coverage
        out.append(SarlaftManualCheckResponse(**payload))
    return out


@public_router.get("/manual-checks/certificate/v/{tenant_slug}/{certificate_code}")
def verify_sarlaft_manual_certificate_by_path(
    request: Request,
    tenant_slug: str,
    certificate_code: str,
    vista: bool = Query(default=False, description="Si es true, devuelve HTML."),
    formato: str | None = Query(default=None, description="json o html.", max_length=12),
    db: Session = Depends(get_db),
):
    slug = (tenant_slug or "").strip()
    code = (certificate_code or "").strip()
    wants_html = bool(vista) or ((formato or "").strip().lower() == "html") or (
        "text/html" in (request.headers.get("accept") or "").lower()
    )

    if not slug or not code:
        payload = SarlaftCertificateVerificationResponse(
            tenant_slug=slug or None,
            certificate_code=code or "",
            valido=False,
            detail="Parámetros inválidos: indique organización y código.",
        )
        return HTMLResponse(content=_sarlaft_certificate_verification_html(payload=payload, org_name=None)) if wants_html else payload

    tenant = db.query(Tenant).filter(Tenant.slug == slug, Tenant.activo.is_(True)).first()
    if not tenant:
        tenant = db.query(Tenant).filter(Tenant.slug.ilike(slug), Tenant.activo.is_(True)).first()
    if not tenant:
        payload = SarlaftCertificateVerificationResponse(
            tenant_slug=slug,
            certificate_code=code,
            valido=False,
            detail="Organización no encontrada o inactiva.",
        )
        return HTMLResponse(content=_sarlaft_certificate_verification_html(payload=payload, org_name=None)) if wants_html else payload

    row = (
        db.query(SarlaftManualCheck)
        .filter(
            SarlaftManualCheck.tenant_id == tenant.id,
            SarlaftManualCheck.certificate_code == code,
        )
        .first()
    )
    if not row:
        payload = SarlaftCertificateVerificationResponse(
            tenant_slug=tenant.slug,
            certificate_code=code,
            valido=False,
            detail="No se encontró certificado SARLAFT para ese código.",
        )
        return HTMLResponse(content=_sarlaft_certificate_verification_html(payload=payload, org_name=tenant.nombre_comercial or tenant.nombre)) if wants_html else payload

    payload = SarlaftCertificateVerificationResponse(
        tenant_slug=tenant.slug,
        certificate_code=code,
        valido=True,
        generated_at=row.certificate_issued_at or row.created_at,
        manual_check_id=row.id,
        full_name=row.full_name,
        doc_type=row.doc_type,
        doc_number=row.doc_number,
        risk_level=row.risk_level,
        risk_score=row.risk_score,
        result_label=_sarlaft_result_label(row.risk_level),
        detail="Certificado válido.",
    )
    if wants_html:
        return HTMLResponse(
            content=_sarlaft_certificate_verification_html(payload=payload, org_name=tenant.nombre_comercial or tenant.nombre)
        )
    return payload


@router.get("/cases", response_model=list[SarlaftCaseSummaryResponse])
def list_sarlaft_cases(
    risk_level: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para listar casos SARLAFT.",
        )
    q = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.tenant_id == current_user.tenant_id)
        .order_by(SarlaftCase.created_at.desc())
    )
    if risk_level:
        q = q.filter(SarlaftCase.risk_level == risk_level.strip().lower())
    if status_filter:
        q = q.filter(SarlaftCase.status == status_filter.strip().lower())
    rows = q.limit(limit).all()
    case_ids = [r.id for r in rows]
    parties = []
    if case_ids:
        parties = (
            db.query(SarlaftCaseParty)
            .filter(
                SarlaftCaseParty.tenant_id == current_user.tenant_id,
                SarlaftCaseParty.case_id.in_(case_ids),
                SarlaftCaseParty.role == "cliente",
            )
            .all()
        )
    party_by_case_id: dict[UUID, SarlaftCaseParty] = {}
    for p in parties:
        # En caso de duplicidad histórica, nos quedamos con la primera coincidencia.
        if p.case_id not in party_by_case_id:
            party_by_case_id[p.case_id] = p

    out: list[SarlaftCaseSummaryResponse] = []
    for r in rows:
        party = party_by_case_id.get(r.id)
        meta = party.metadata_json if (party and isinstance(party.metadata_json, dict)) else {}
        out.append(
            SarlaftCaseSummaryResponse(
                id=r.id,
                operacion_ref=r.operacion_ref,
                status=r.status,
                risk_level=r.risk_level,
                risk_score=r.risk_score,
                payment_method=r.payment_method,
                transaction_amount_cop=r.transaction_amount_cop,
                cash_amount_cop=r.cash_amount_cop,
                placa=str(meta.get("placa") or "").strip() or None,
                tipo_vehiculo=str(meta.get("tipo_vehiculo") or "").strip() or None,
                cliente_doc_type=party.doc_type if party else None,
                cliente_doc_number=party.doc_number if party else None,
                cliente_full_name=party.full_name if party else None,
                created_at=r.created_at,
            )
        )
    return out


@router.get("/alerts/internal", response_model=list[SarlaftInternalAlertResponse])
def list_sarlaft_internal_alerts(
    alert_level: str | None = Query(default=None),
    case_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para listar alertas internas SARLAFT.",
        )

    q = (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.tenant_id == current_user.tenant_id,
            SarlaftAuditLog.action == "internal_alert_generated",
        )
        .order_by(SarlaftAuditLog.created_at.desc())
    )
    if case_id:
        q = q.filter(SarlaftAuditLog.entity_id == case_id)
    rows = q.limit(limit).all()
    alert_ids = [r.id for r in rows]
    reviews = []
    if alert_ids:
        reviews = (
            db.query(SarlaftAuditLog)
            .filter(
                SarlaftAuditLog.tenant_id == current_user.tenant_id,
                SarlaftAuditLog.action == "internal_alert_reviewed",
                SarlaftAuditLog.entity_type == "internal_alert",
                SarlaftAuditLog.entity_id.in_(alert_ids),
            )
            .order_by(SarlaftAuditLog.created_at.desc())
            .all()
        )
    review_by_alert_id: dict[UUID, SarlaftAuditLog] = {}
    for rev in reviews:
        if rev.entity_id and rev.entity_id not in review_by_alert_id:
            review_by_alert_id[rev.entity_id] = rev

    normalized_filter = (alert_level or "").strip().lower()
    if normalized_filter == "alta":
        normalized_filter = "critica"

    items: list[SarlaftInternalAlertResponse] = []
    for row in rows:
        meta = row.after_json if isinstance(row.after_json, dict) else {}
        lv = str(meta.get("alert_level") or "").strip().lower()
        if normalized_filter and lv != normalized_filter:
            continue

        source_origin = str(meta.get("source_origin") or "").strip().lower() or "caso"
        linked_case_id_raw = str(meta.get("linked_case_id") or "").strip() or None
        resolved_case_id: UUID | None = None
        if source_origin == "caso":
            resolved_case_id = row.entity_id
        elif linked_case_id_raw:
            try:
                resolved_case_id = UUID(linked_case_id_raw)
            except ValueError:
                resolved_case_id = None

        case = None
        if resolved_case_id:
            if source_origin == "caso" or linked_case_id_raw:
                case = (
                    db.query(SarlaftCase)
                    .filter(
                        SarlaftCase.id == resolved_case_id,
                        SarlaftCase.tenant_id == current_user.tenant_id,
                    )
                    .first()
                )
        review = review_by_alert_id.get(row.id)
        review_meta = review.after_json if (review and isinstance(review.after_json, dict)) else {}
        decision_status = str(review_meta.get("decision") or "").strip().lower() or None
        operation_classification = str(meta.get("operation_classification") or "").strip() or None
        rule_code = str(meta.get("rule_code") or "").strip() or None
        reason = str(meta.get("reason") or "").strip() or None
        # Higiene de bandeja:
        # ocultar alertas "básicas" históricas sin decisión en casos VERDE
        # (ruido por pago en efectivo/mixto sin inusualidad real por regla).
        is_green_case = bool(case and (case.risk_level or "").strip().lower() == "verde")
        is_base_rule = (rule_code or "").strip().upper() in {"", "BASE"}
        is_legacy_payment_risk = (reason or "").strip().lower() in {
            "riesgo_amarillo_o_metodo_pago_riesgoso",
            "metodo_pago_riesgoso",
        }
        if not decision_status and is_green_case and is_base_rule and is_legacy_payment_risk:
            continue

        if decision_status == "sospechosa":
            operation_classification = "operacion_sospechosa"
        items.append(
            SarlaftInternalAlertResponse(
                id=row.id,
                case_id=resolved_case_id,
                operacion_ref=case.operacion_ref if case else None,
                alert_level=lv or "media",
                source_origin=source_origin,
                operation_classification=operation_classification,
                rule_code=rule_code,
                reason=reason,
                metrics=meta.get("metrics") if isinstance(meta.get("metrics"), dict) else None,
                risk_level=case.risk_level if case else None,
                payment_method=str(meta.get("payment_method") or "").strip() or (case.payment_method if case else None),
                transaction_amount_cop=Decimal(str(meta.get("transaction_amount_cop"))) if meta.get("transaction_amount_cop") is not None else (case.transaction_amount_cop if case else None),
                cash_amount_cop=Decimal(str(meta.get("cash_amount_cop"))) if meta.get("cash_amount_cop") is not None else (case.cash_amount_cop if case else None),
                decision_status=decision_status,
                decision_notes=str(review_meta.get("notes") or "").strip() or None,
                reviewed_at=review.created_at if review else None,
                created_at=row.created_at,
            )
        )
    return items


@router.post("/alerts/internal/{alert_id}/decision", response_model=SarlaftInternalAlertResponse)
def decide_sarlaft_internal_alert(
    alert_id: UUID,
    payload: SarlaftInternalAlertDecisionRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para decidir alertas SARLAFT.",
        )

    alert_row = (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.id == alert_id,
            SarlaftAuditLog.tenant_id == current_user.tenant_id,
            SarlaftAuditLog.action == "internal_alert_generated",
        )
        .first()
    )
    if not alert_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta interna SARLAFT no encontrada.")

    source_origin = ""
    meta = alert_row.after_json if isinstance(alert_row.after_json, dict) else {}
    source_origin = str(meta.get("source_origin") or "").strip().lower() or "caso"
    if source_origin != "caso":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta alerta no usa decision DDI desde esta bandeja (origen no asociado a caso).",
        )

    case = None
    if alert_row.entity_id:
        case = (
            db.query(SarlaftCase)
            .filter(
                SarlaftCase.id == alert_row.entity_id,
                SarlaftCase.tenant_id == current_user.tenant_id,
            )
            .first()
        )
    if case:
        if payload.decision == "justificada":
            case.status = "inusual_justificada"
        else:
            case.status = "sospechosa_ros_pendiente"
            case.risk_level = "rojo"

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="internal_alert_reviewed",
        entity_type="internal_alert",
        entity_id=alert_row.id,
        after_json={
            "decision": payload.decision,
            "notes": (payload.notes or "").strip() or None,
            "funds_source_declaration": payload.funds_source_declaration.strip(),
            "economic_activity_support": payload.economic_activity_support.strip(),
            "cashier_interview": payload.cashier_interview,
            "support_refs": payload.support_refs,
            "alert_log_id": str(alert_row.id),
            "case_id": str(alert_row.entity_id) if alert_row.entity_id else None,
        },
    )
    db.commit()

    # Respuesta compatible con la bandeja.
    operation_classification = str(meta.get("operation_classification") or "").strip() or None
    if payload.decision == "sospechosa":
        operation_classification = "operacion_sospechosa"
    return SarlaftInternalAlertResponse(
        id=alert_row.id,
        case_id=alert_row.entity_id,
        operacion_ref=case.operacion_ref if case else None,
        alert_level=str(meta.get("alert_level") or "media"),
        source_origin=source_origin,
        operation_classification=operation_classification,
        rule_code=str(meta.get("rule_code") or "").strip() or None,
        reason=str(meta.get("reason") or "").strip() or None,
        metrics=meta.get("metrics") if isinstance(meta.get("metrics"), dict) else None,
        risk_level=case.risk_level if case else None,
        payment_method=str(meta.get("payment_method") or "").strip() or (case.payment_method if case else None),
        transaction_amount_cop=Decimal(str(meta.get("transaction_amount_cop"))) if meta.get("transaction_amount_cop") is not None else (case.transaction_amount_cop if case else None),
        cash_amount_cop=Decimal(str(meta.get("cash_amount_cop"))) if meta.get("cash_amount_cop") is not None else (case.cash_amount_cop if case else None),
        decision_status=payload.decision,
        decision_notes=(payload.notes or "").strip() or None,
        reviewed_at=datetime.utcnow(),
        created_at=alert_row.created_at,
    )


@router.post("/alerts/internal/{alert_id}/create-case", response_model=SarlaftCaseResponse)
def create_case_from_internal_alert(
    alert_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para crear caso desde alerta interna.",
        )
    alert_row = (
        db.query(SarlaftAuditLog)
        .filter(
            SarlaftAuditLog.id == alert_id,
            SarlaftAuditLog.tenant_id == current_user.tenant_id,
            SarlaftAuditLog.action == "internal_alert_generated",
        )
        .first()
    )
    if not alert_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta interna no encontrada.")
    meta = alert_row.after_json if isinstance(alert_row.after_json, dict) else {}
    source_origin = str(meta.get("source_origin") or "").strip().lower() or "caso"
    if source_origin == "caso":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La alerta ya corresponde a un caso existente.",
        )
    linked_case_id_raw = str(meta.get("linked_case_id") or "").strip()
    if linked_case_id_raw:
        try:
            linked_case_id = UUID(linked_case_id_raw)
            existing_case = (
                db.query(SarlaftCase)
                .filter(SarlaftCase.id == linked_case_id, SarlaftCase.tenant_id == current_user.tenant_id)
                .first()
            )
            if existing_case:
                parties = (
                    db.query(SarlaftCaseParty)
                    .filter(
                        SarlaftCaseParty.case_id == existing_case.id,
                        SarlaftCaseParty.tenant_id == current_user.tenant_id,
                    )
                    .all()
                )
                return _build_case_response(db, existing_case, parties)
        except ValueError:
            pass

    # Resolver fuente y crear parte cliente básica.
    full_name = "Cliente no identificado"
    doc_number = None
    doc_type = "CC"
    if source_origin == "manual":
        manual_check_id_raw = str(meta.get("manual_check_id") or "").strip()
        if manual_check_id_raw:
            try:
                manual_row = (
                    db.query(SarlaftManualCheck)
                    .filter(
                        SarlaftManualCheck.id == UUID(manual_check_id_raw),
                        SarlaftManualCheck.tenant_id == current_user.tenant_id,
                    )
                    .first()
                )
                if manual_row:
                    full_name = manual_row.full_name or full_name
                    doc_number = manual_row.doc_number
                    doc_type = manual_row.doc_type or doc_type
            except ValueError:
                pass
    elif source_origin == "lote":
        batch_row_id_raw = str(meta.get("batch_row_id") or "").strip()
        if batch_row_id_raw:
            try:
                batch_row = (
                    db.query(SarlaftBatchRow)
                    .filter(
                        SarlaftBatchRow.id == UUID(batch_row_id_raw),
                        SarlaftBatchRow.tenant_id == current_user.tenant_id,
                    )
                    .first()
                )
                if batch_row:
                    full_name = batch_row.full_name or full_name
                    doc_number = batch_row.doc_number
                    doc_type = batch_row.doc_type or doc_type
            except ValueError:
                pass

    normalized_doc = (doc_number or "").strip()
    if not normalized_doc:
        normalized_doc = f"AUTO-{str(alert_id)[:8].upper()}"
        doc_type = "OTRO"

    case = SarlaftCase(
        tenant_id=current_user.tenant_id,
        sede_id=None,
        operacion_ref=f"ALT-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{str(alert_id)[:8].upper()}",
        status="in_review",
        risk_level="rojo" if str(meta.get("risk_level") or "").strip().lower() == "rojo" else "amarillo",
        risk_score=Decimal(str(meta.get("risk_score") or "0")),
        transaction_amount_cop=Decimal("0"),
        cash_amount_cop=Decimal("0"),
        payment_method="otro",
        created_by_user_id=current_user.id,
    )
    db.add(case)
    db.flush()
    party = SarlaftCaseParty(
        case_id=case.id,
        tenant_id=current_user.tenant_id,
        role="cliente",
        doc_type=(doc_type or "CC").strip()[:20],
        doc_number=normalized_doc[:40],
        full_name=(full_name or "Cliente no identificado").strip()[:220],
        metadata_json={"origen_alerta": source_origin, "internal_alert_id": str(alert_id)},
    )
    db.add(party)

    updated_meta = dict(meta)
    updated_meta["linked_case_id"] = str(case.id)
    alert_row.after_json = updated_meta
    alert_row.entity_type = "alert_linked_case"

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="case_created_from_internal_alert",
        entity_type="case",
        entity_id=case.id,
        after_json={
            "source_origin": source_origin,
            "internal_alert_id": str(alert_id),
        },
    )
    db.commit()
    db.refresh(case)
    parties = (
        db.query(SarlaftCaseParty)
        .filter(SarlaftCaseParty.case_id == case.id, SarlaftCaseParty.tenant_id == current_user.tenant_id)
        .all()
    )
    return _build_case_response(db, case, parties)


@router.post("/cases", response_model=SarlaftCaseResponse, status_code=status.HTTP_201_CREATED)
def create_sarlaft_case(
    payload: SarlaftCaseCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para crear casos SARLAFT.",
        )

    operacion_ref = (payload.operacion_ref or "").strip()
    if not operacion_ref:
        operacion_ref = f"MAN-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{str(uuid4())[:8].upper()}"

    case = SarlaftCase(
        tenant_id=current_user.tenant_id,
        sede_id=payload.sede_id,
        operacion_ref=operacion_ref,
        status="open",
        risk_level="verde",
        risk_score=Decimal("0"),
        transaction_amount_cop=payload.transaction_amount_cop,
        cash_amount_cop=payload.cash_amount_cop,
        payment_method=payload.payment_method,
        created_by_user_id=current_user.id,
    )
    db.add(case)
    db.flush()

    parties_out: list[SarlaftCaseParty] = []
    for party in payload.parties:
        row = SarlaftCaseParty(
            case_id=case.id,
            tenant_id=current_user.tenant_id,
            role=party.role,
            doc_type=party.doc_type.strip(),
            doc_number=party.doc_number.strip(),
            full_name=party.full_name.strip(),
            phone=(party.phone or "").strip() or None,
            email=(party.email or "").strip().lower() or None,
            city=(party.city or "").strip() or None,
            address=(party.address or "").strip() or None,
            metadata_json=party.metadata_json,
        )
        db.add(row)
        parties_out.append(row)

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="case_created",
        entity_type="case",
        entity_id=case.id,
        after_json={
            "operacion_ref": case.operacion_ref,
            "status": case.status,
            "risk_level": case.risk_level,
            "risk_score": str(case.risk_score),
            "payment_method": case.payment_method,
            "transaction_amount_cop": str(case.transaction_amount_cop),
            "cash_amount_cop": str(case.cash_amount_cop),
            "parties_count": len(parties_out),
        },
    )
    db.commit()
    db.refresh(case)

    saved_parties = (
        db.query(SarlaftCaseParty)
        .filter(SarlaftCaseParty.case_id == case.id, SarlaftCaseParty.tenant_id == current_user.tenant_id)
        .all()
    )
    return _build_case_response(db, case, saved_parties)


@router.get("/cases/{case_id}", response_model=SarlaftCaseResponse)
def get_sarlaft_case(
    case_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para consultar casos SARLAFT.",
        )

    case = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
        .first()
    )
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caso SARLAFT no encontrado.")

    parties = (
        db.query(SarlaftCaseParty)
        .filter(SarlaftCaseParty.case_id == case.id, SarlaftCaseParty.tenant_id == current_user.tenant_id)
        .all()
    )
    return _build_case_response(db, case, parties)


@router.get("/sirel/queue", response_model=list[SarlaftSirelQueueItem])
def list_sarlaft_sirel_queue(
    status_filter: str = Query(default="pending", alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para listar bandeja SIREL.",
        )

    rows = (
        db.query(SarlaftCase)
        .filter(
            SarlaftCase.tenant_id == current_user.tenant_id,
            SarlaftCase.status.in_(["sospechosa_ros_pendiente", "sospechosa_ros_reportada"]),
        )
        .order_by(SarlaftCase.created_at.desc())
        .limit(limit)
        .all()
    )
    if not rows:
        return []

    case_ids = [c.id for c in rows]
    parties = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.case_id.in_(case_ids),
            SarlaftCaseParty.role == "cliente",
        )
        .all()
    )
    party_by_case_id: dict[UUID, SarlaftCaseParty] = {p.case_id: p for p in parties}
    reports = (
        db.query(SarlaftSirelReport)
        .filter(
            SarlaftSirelReport.tenant_id == current_user.tenant_id,
            SarlaftSirelReport.case_id.in_(case_ids),
        )
        .all()
    )
    report_by_case_id: dict[UUID, SarlaftSirelReport] = {r.case_id: r for r in reports}
    alerts_by_case_id = _latest_alerts_map_for_cases(db, current_user.tenant_id, case_ids)
    alert_ids = [a.id for a in alerts_by_case_id.values() if a and a.id]
    reviews_by_alert_id = _latest_reviews_map_for_alerts(db, current_user.tenant_id, alert_ids)
    sender_user_ids = [r.sent_by_user_id for r in reports if r.sent_by_user_id]
    senders: dict[UUID, str] = {}
    if sender_user_ids:
        sender_rows = (
            db.query(Usuario)
            .filter(
                Usuario.tenant_id == current_user.tenant_id,
                Usuario.id.in_(sender_user_ids),
            )
            .all()
        )
        senders = {
            s.id: (s.nombre_completo or s.email or str(s.id))
            for s in sender_rows
        }

    out: list[SarlaftSirelQueueItem] = []
    for case in rows:
        report = report_by_case_id.get(case.id)
        sirel_status = "reportado" if report and report.status == "reportado" else "pendiente_envio"
        norm_filter = (status_filter or "pending").strip().lower()
        if norm_filter in {"pending", "pendiente"} and sirel_status != "pendiente_envio":
            continue
        if norm_filter in {"reported", "reportado"} and sirel_status != "reportado":
            continue
        cliente = party_by_case_id.get(case.id)
        alert_row = alerts_by_case_id.get(case.id)
        review_row = reviews_by_alert_id.get(alert_row.id) if alert_row else None
        alert_meta = alert_row.after_json if (alert_row and isinstance(alert_row.after_json, dict)) else {}
        review_meta = review_row.after_json if (review_row and isinstance(review_row.after_json, dict)) else {}
        pre_ros_text = (report.pre_ros_text or "").strip() if report else ""
        if not pre_ros_text:
            pre_ros_text = _build_pre_ros_text(
                case=case,
                cliente=cliente,
                alert_row=alert_row,
                review_row=review_row,
            )
        meta = cliente.metadata_json if (cliente and isinstance(cliente.metadata_json, dict)) else {}
        out.append(
            SarlaftSirelQueueItem(
                case_id=case.id,
                operacion_ref=case.operacion_ref,
                status=case.status,
                risk_level=case.risk_level,
                payment_method=case.payment_method,
                transaction_amount_cop=case.transaction_amount_cop,
                cash_amount_cop=case.cash_amount_cop,
                placa=str(meta.get("placa") or "").strip() or None,
                tipo_vehiculo=str(meta.get("tipo_vehiculo") or "").strip() or None,
                cliente_doc_type=cliente.doc_type if cliente else None,
                cliente_doc_number=cliente.doc_number if cliente else None,
                cliente_full_name=cliente.full_name if cliente else None,
                operation_classification=str(alert_meta.get("operation_classification") or "").strip() or None,
                alert_reason=str(alert_meta.get("reason") or "").strip() or None,
                decision_status=str(review_meta.get("decision") or "").strip() or None,
                pre_ros_text=pre_ros_text,
                sirel_status=sirel_status,
                sirel_reference=(report.sirel_reference if report else None),
                sirel_sent_at=(report.sent_at if report else None),
                sirel_sent_by_user_id=(report.sent_by_user_id if report else None),
                sirel_sent_by_name=(senders.get(report.sent_by_user_id) if (report and report.sent_by_user_id) else None),
                sirel_notes=(report.notes if report else None),
                evidence_url=(report.evidence_url if report else None),
                created_at=case.created_at,
            )
        )
    return out


@router.post("/sirel/queue/{case_id}/mark-reported", response_model=SarlaftSirelQueueItem)
def mark_sarlaft_sirel_reported(
    case_id: UUID,
    payload: SarlaftSirelMarkReportedRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para marcar reporte SIREL.",
        )

    case = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
        .first()
    )
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caso SARLAFT no encontrado.")
    if case.status not in {"sospechosa_ros_pendiente", "sospechosa_ros_reportada"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo casos en flujo de revisión SARLAFT pueden registrarse en SIREL.",
        )

    report = (
        db.query(SarlaftSirelReport)
        .filter(
            SarlaftSirelReport.tenant_id == current_user.tenant_id,
            SarlaftSirelReport.case_id == case.id,
        )
        .first()
    )
    alert_row = _latest_alert_for_case(db, current_user.tenant_id, case.id)
    review_row = _latest_alert_review(db, current_user.tenant_id, alert_row.id if alert_row else None)
    cliente = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.case_id == case.id,
            SarlaftCaseParty.role == "cliente",
        )
        .first()
    )
    pre_ros_text = _build_pre_ros_text(
        case=case,
        cliente=cliente,
        alert_row=alert_row,
        review_row=review_row,
    )
    if report is None:
        report = SarlaftSirelReport(
            tenant_id=current_user.tenant_id,
            case_id=case.id,
            status="reportado",
            report_type="ros",
            sirel_reference=payload.sirel_reference.strip(),
            sent_at=payload.sent_at or datetime.utcnow(),
            sent_by_user_id=current_user.id,
            pre_ros_text=pre_ros_text,
            notes=(payload.notes or "").strip() or None,
            evidence_url=payload.evidence_url.strip(),
        )
        db.add(report)
    else:
        before = {
            "status": report.status,
            "sirel_reference": report.sirel_reference,
            "sent_at": report.sent_at.isoformat() if report.sent_at else None,
            "notes": report.notes,
            "evidence_url": report.evidence_url,
        }
        report.status = "reportado"
        report.sirel_reference = payload.sirel_reference.strip()
        report.sent_at = payload.sent_at or datetime.utcnow()
        report.sent_by_user_id = current_user.id
        report.pre_ros_text = pre_ros_text
        report.notes = (payload.notes or "").strip() or None
        report.evidence_url = payload.evidence_url.strip()
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="sirel_report_updated",
            entity_type="sirel_report",
            entity_id=report.id,
            before_json=before,
            after_json={
                "status": report.status,
                "sirel_reference": report.sirel_reference,
                "sent_at": report.sent_at.isoformat() if report.sent_at else None,
                "notes": report.notes,
                "evidence_url": report.evidence_url,
                "case_id": str(case.id),
            },
        )

    if case.status == "sospechosa_ros_pendiente":
        case.status = "sospechosa_ros_reportada"

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="sirel_report_marked",
        entity_type="case",
        entity_id=case.id,
        after_json={
            "case_status": case.status,
            "sirel_reference": payload.sirel_reference.strip(),
            "sent_at": (payload.sent_at or datetime.utcnow()).isoformat(),
            "report_type": "ros",
        },
    )
    db.commit()
    db.refresh(report)
    db.refresh(case)

    meta = cliente.metadata_json if (cliente and isinstance(cliente.metadata_json, dict)) else {}
    alert_meta = alert_row.after_json if (alert_row and isinstance(alert_row.after_json, dict)) else {}
    review_meta = review_row.after_json if (review_row and isinstance(review_row.after_json, dict)) else {}
    return SarlaftSirelQueueItem(
        case_id=case.id,
        operacion_ref=case.operacion_ref,
        status=case.status,
        risk_level=case.risk_level,
        payment_method=case.payment_method,
        transaction_amount_cop=case.transaction_amount_cop,
        cash_amount_cop=case.cash_amount_cop,
        placa=str(meta.get("placa") or "").strip() or None,
        tipo_vehiculo=str(meta.get("tipo_vehiculo") or "").strip() or None,
        cliente_doc_type=cliente.doc_type if cliente else None,
        cliente_doc_number=cliente.doc_number if cliente else None,
        cliente_full_name=cliente.full_name if cliente else None,
        operation_classification=str(alert_meta.get("operation_classification") or "").strip() or None,
        alert_reason=str(alert_meta.get("reason") or "").strip() or None,
        decision_status=str(review_meta.get("decision") or "").strip() or None,
        pre_ros_text=(report.pre_ros_text or "").strip(),
        sirel_status="reportado",
        sirel_reference=report.sirel_reference,
        sirel_sent_at=report.sent_at,
        sirel_sent_by_user_id=report.sent_by_user_id,
        sirel_sent_by_name=current_user.nombre_completo or current_user.email,
        sirel_notes=report.notes,
        evidence_url=report.evidence_url,
        created_at=case.created_at,
    )


@router.get("/sirel/queue/{case_id}/pre-ros.txt")
def download_sarlaft_pre_ros_txt(
    case_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para descargar pre-ROS.",
        )
    case = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
        .first()
    )
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caso SARLAFT no encontrado.")
    if case.status not in {"sospechosa_ros_pendiente", "sospechosa_ros_reportada"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El pre-ROS aplica para casos sospechosos en flujo ROS.",
        )
    cliente = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.case_id == case.id,
            SarlaftCaseParty.role == "cliente",
        )
        .first()
    )
    alert_row = _latest_alert_for_case(db, current_user.tenant_id, case.id)
    review_row = _latest_alert_review(db, current_user.tenant_id, alert_row.id if alert_row else None)
    text_content = _build_pre_ros_text(
        case=case,
        cliente=cliente,
        alert_row=alert_row,
        review_row=review_row,
    )
    filename = f"pre_ros_{case.operacion_ref.replace(' ', '_')}.txt"
    return Response(
        content=text_content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sirel/queue/{case_id}/expediente-template.txt")
def download_sarlaft_expediente_template_txt(
    case_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para descargar plantilla de expediente.",
        )
    case = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
        .first()
    )
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caso SARLAFT no encontrado.")
    if case.status not in {"sospechosa_ros_pendiente", "sospechosa_ros_reportada"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La plantilla aplica para casos sospechosos en flujo ROS.",
        )
    cliente = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.case_id == case.id,
            SarlaftCaseParty.role == "cliente",
        )
        .first()
    )
    alert_row = _latest_alert_for_case(db, current_user.tenant_id, case.id)
    review_row = _latest_alert_review(db, current_user.tenant_id, alert_row.id if alert_row else None)
    alert_meta = alert_row.after_json if (alert_row and isinstance(alert_row.after_json, dict)) else {}
    review_meta = review_row.after_json if (review_row and isinstance(review_row.after_json, dict)) else {}
    template_content = "\n".join(
        [
            "PLANTILLA EXPEDIENTE ROS - SARLAFT",
            "",
            "=== 01_IDENTIFICACION_CASO ===",
            f"ID caso: {case.id}",
            f"Referencia operacion: {case.operacion_ref}",
            f"Estado caso: {case.status}",
            f"Nivel riesgo: {case.risk_level}",
            f"Score riesgo: {float(case.risk_score or 0):.2f}",
            f"Fecha creacion caso: {case.created_at.strftime('%Y-%m-%d %H:%M:%S') if case.created_at else 'N/D'}",
            f"Monto operacion COP: {float(case.transaction_amount_cop or 0):,.2f}",
            f"Monto efectivo COP: {float(case.cash_amount_cop or 0):,.2f}",
            f"Metodo pago: {case.payment_method}",
            f"Cliente: {cliente.full_name if cliente else 'N/D'}",
            f"Documento cliente: {((cliente.doc_type or '') + ' ' + (cliente.doc_number or '')).strip() if cliente else 'N/D'}",
            "",
            "=== 02_MOTIVO_SOSPECHA ===",
            f"Clasificacion operacion: {str(alert_meta.get('operation_classification') or '').strip() or 'N/D'}",
            f"Regla interna: {str(alert_meta.get('rule_code') or '').strip() or 'N/D'}",
            f"Motivo alerta: {str(alert_meta.get('reason') or '').strip() or 'N/D'}",
            "Narrativa oficial (completar): ______________________________________________",
            "",
            "=== 03_DDI ===",
            f"Origen fondos declarado: {str(review_meta.get('funds_source_declaration') or '').strip() or 'N/D'}",
            f"Soporte actividad economica: {str(review_meta.get('economic_activity_support') or '').strip() or 'N/D'}",
            f"Entrevista cajero: {str(review_meta.get('cashier_interview') or '').strip() or 'N/D'}",
            f"Referencias soporte: {', '.join(review_meta.get('support_refs') or []) if isinstance(review_meta.get('support_refs'), list) else 'N/D'}",
            f"Notas oficial: {str(review_meta.get('notes') or '').strip() or 'N/D'}",
            "",
            "=== 04_REPORTE_SIREL ===",
            "Radicado SIREL: ______________________________________________",
            "Fecha/hora envio: ____________________________________________",
            "URL evidencia cargue: ________________________________________",
            "Usuario responsable: _________________________________________",
            "",
            "=== 05_CHECKLIST_CIERRE ===",
            "[ ] DDI completa y coherente",
            "[ ] Soportes anexos cargados",
            "[ ] Pre-ROS adjunto",
            "[ ] ROS radicado en SIREL",
            "[ ] Evidencia de cargue archivada",
            "[ ] Acta de cierre interno firmada",
            "",
            "=== ESTRUCTURA CARPETA RECOMENDADA ===",
            "01_identificacion_caso.pdf",
            "02_ddi_formulario.pdf",
            "03_soportes_cliente/",
            "04_pre_ros.txt",
            "05_ros_sirel_constancia.pdf",
            "06_acta_cierre_interno.pdf",
        ]
    )
    filename = f"expediente_ros_template_{case.operacion_ref.replace(' ', '_')}.txt"
    return Response(
        content=template_content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sirel/queue/{case_id}/expediente-template.pdf")
def download_sarlaft_expediente_template_pdf(
    case_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol != RolEnum.ADMINISTRADOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para descargar plantilla de expediente.",
        )
    case = (
        db.query(SarlaftCase)
        .filter(SarlaftCase.id == case_id, SarlaftCase.tenant_id == current_user.tenant_id)
        .first()
    )
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caso SARLAFT no encontrado.")
    if case.status not in {"sospechosa_ros_pendiente", "sospechosa_ros_reportada"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La plantilla aplica para casos sospechosos en flujo ROS.",
        )
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    cliente = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.case_id == case.id,
            SarlaftCaseParty.role == "cliente",
        )
        .first()
    )
    alert_row = _latest_alert_for_case(db, current_user.tenant_id, case.id)
    review_row = _latest_alert_review(db, current_user.tenant_id, alert_row.id if alert_row else None)
    alert_meta = alert_row.after_json if (alert_row and isinstance(alert_row.after_json, dict)) else {}
    review_meta = review_row.after_json if (review_row and isinstance(review_row.after_json, dict)) else {}
    pre_ros_text = _build_pre_ros_text(
        case=case,
        cliente=cliente,
        alert_row=alert_row,
        review_row=review_row,
    )
    pdf_buffer = build_sarlaft_expediente_template_pdf(
        tenant_nombre=(tenant.nombre_comercial or tenant.nombre) if tenant else "CDASOFT",
        tenant_nit=(tenant.nit_cda if tenant else None),
        tenant_logo_url=(tenant.logo_url if tenant else None),
        case_id=str(case.id),
        operacion_ref=case.operacion_ref,
        case_status=case.status,
        risk_level=case.risk_level,
        risk_score=float(case.risk_score or 0),
        created_at=case.created_at,
        transaction_amount_cop=float(case.transaction_amount_cop or 0),
        cash_amount_cop=float(case.cash_amount_cop or 0),
        payment_method=case.payment_method,
        cliente_nombre=(cliente.full_name if cliente else None),
        cliente_documento=(
            f"{(cliente.doc_type or '').strip()} {(cliente.doc_number or '').strip()}".strip() if cliente else None
        ),
        operation_classification=str(alert_meta.get("operation_classification") or "").strip() or None,
        rule_code=str(alert_meta.get("rule_code") or "").strip() or None,
        alert_reason=str(alert_meta.get("reason") or "").strip() or None,
        funds_source_declaration=str(review_meta.get("funds_source_declaration") or "").strip() or None,
        economic_activity_support=str(review_meta.get("economic_activity_support") or "").strip() or None,
        cashier_interview=str(review_meta.get("cashier_interview") or "").strip() or None,
        support_refs=[str(x).strip() for x in (review_meta.get("support_refs") or []) if str(x).strip()]
        if isinstance(review_meta.get("support_refs"), list)
        else [],
        official_notes=str(review_meta.get("notes") or "").strip() or None,
        pre_ros_text=pre_ros_text,
        generated_by=current_user.nombre_completo or current_user.email,
        generated_at=datetime.utcnow(),
    )
    filename = f"expediente_ros_template_{case.operacion_ref.replace(' ', '_')}.pdf"
    return Response(
        content=pdf_buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
