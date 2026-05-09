"""
Endpoints SARLAFT (Sprint 1).
"""
from datetime import datetime
from decimal import Decimal
import hashlib
import html
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user, require_sarlaft_enabled_for_tenant
from app.core.config import settings
from app.integrations.opensanctions import OpenSanctionsError, open_sanctions_match
from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty
from app.models.sarlaft_manual_check import SarlaftManualCheck
from app.models.sarlaft_profile import SarlaftProfile
from app.models.tenant import Tenant
from app.models.usuario import RolEnum, Usuario
from app.schemas.sarlaft import (
    SarlaftCertificateVerificationResponse,
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
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR]:
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
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    db.commit()
    db.refresh(row)
    return SarlaftManualCheckResponse.model_validate(row)


@router.get("/manual-checks/{manual_check_id}/certificate")
def download_sarlaft_manual_check_certificate(
    manual_check_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    return [SarlaftManualCheckResponse.model_validate(r) for r in rows]


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
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    return [SarlaftCaseSummaryResponse.model_validate(r) for r in rows]


@router.post("/cases", response_model=SarlaftCaseResponse, status_code=status.HTTP_201_CREATED)
def create_sarlaft_case(
    payload: SarlaftCaseCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.RECEPCIONISTA, RolEnum.CAJERO]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para crear casos SARLAFT.",
        )

    case = SarlaftCase(
        tenant_id=current_user.tenant_id,
        sede_id=payload.sede_id,
        operacion_ref=payload.operacion_ref.strip(),
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
    return SarlaftCaseResponse(
        **{
            "id": case.id,
            "tenant_id": case.tenant_id,
            "sede_id": case.sede_id,
            "operacion_ref": case.operacion_ref,
            "status": case.status,
            "risk_level": case.risk_level,
            "risk_score": case.risk_score,
            "transaction_amount_cop": case.transaction_amount_cop,
            "cash_amount_cop": case.cash_amount_cop,
            "payment_method": case.payment_method,
            "created_by_user_id": case.created_by_user_id,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
            "parties": [SarlaftCasePartyResponse.model_validate(p) for p in saved_parties],
        }
    )


@router.get("/cases/{case_id}", response_model=SarlaftCaseResponse)
def get_sarlaft_case(
    case_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.rol not in [RolEnum.ADMINISTRADOR, RolEnum.CONTADOR, RolEnum.RECEPCIONISTA]:
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
    return SarlaftCaseResponse(
        **{
            "id": case.id,
            "tenant_id": case.tenant_id,
            "sede_id": case.sede_id,
            "operacion_ref": case.operacion_ref,
            "status": case.status,
            "risk_level": case.risk_level,
            "risk_score": case.risk_score,
            "transaction_amount_cop": case.transaction_amount_cop,
            "cash_amount_cop": case.cash_amount_cop,
            "payment_method": case.payment_method,
            "created_by_user_id": case.created_by_user_id,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
            "parties": [SarlaftCasePartyResponse.model_validate(p) for p in parties],
        }
    )
