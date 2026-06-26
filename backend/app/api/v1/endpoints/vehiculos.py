"""
Endpoints de Vehículos
"""
import re
import json
import time
import traceback
import uuid
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import OperationalError
from datetime import datetime, date, time as dt_time, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import List, Dict, Any
from decimal import Decimal
from uuid import UUID

from app.core.deps import (
    get_db,
    get_current_user,
    get_cajero_or_admin,
    get_recepcionista_or_admin,
    get_active_sucursal_id,
)
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo, MetodoPago
from app.models.factus import TenantFactusSettings, FacturaElectronica, FacturaCorreccion
from app.models.runt_metrica import RuntConsultaMetrica
from app.models.runt_cache import RuntConsultaCache
from app.services.factus_tenant_settings import (
    creds_complete_for_active_env,
    active_auth_encrypted,
    list_numbering_ranges_for_tenant,
)
from app.core.config import settings
from app.core.factus_crypto import decrypt_secret
from app.integrations.factus_client import (
    FactusAPIError,
    factus_base_url,
    format_factus_error_for_user,
    obtain_token,
    validate_credit_note,
)
from app.integrations.placaapi_runt import PlacaApiRuntError, consultar_placaapi_por_placa
from app.integrations.verifik_runt import VerifikRuntError, consultar_runt_vehiculo_por_placa
from app.integrations.factus_emit import (
    build_validate_body,
    emitir_y_persistir_factura_cobro,
    resolve_numbering_range_id_for_cobro,
    validar_datos_cliente_para_factus,
)
from app.models.tarifa import Tarifa, ComisionSOAT
from app.models.caja import Caja, MovimientoCaja, TipoMovimiento, EstadoCaja
from app.models.sucursal import Sucursal
from app.models.sarlaft_profile import SarlaftProfile
from app.models.sarlaft_case import SarlaftCase
from app.models.sarlaft_case_party import SarlaftCaseParty
from app.integrations.opensanctions import OpenSanctionsError, open_sanctions_match
from app.services.sarlaft_audit import log_sarlaft_event
from app.services.sarlaft_internal_alert_engine import (
    evaluate_unusual_operation_rules,
)
from app.services.sarlaft_intercda_async import enqueue_intercda_job
from app.utils.email import (
    enviar_email,
    enviar_email_con_adjuntos,
    generar_email_bienvenida_recepcion_cliente,
    generar_email_llamado_caja_cliente,
    generar_email_recibo_pago_cliente,
)
from app.utils.quality import create_quality_survey_invite
from app.utils.rtm_reminders import schedule_rtm_renewal_reminder_for_vehicle
from app.utils.comprobantes import generar_recibo_pago_vehiculo_pdf
from app.utils.habeas_autorizacion_pdf import generar_habeas_autorizacion_pdf
from app.utils.recepcion_formato_extra_pdf import generar_recepcion_formato_extra_pdf


def _try_download_factura_pdf_desde_url_publica(url: str, max_bytes: int = 8 * 1024 * 1024) -> bytes | None:
    """Intenta obtener PDF desde la URL pública de Factus/DIAN. Si la URL sirve HTML, devuelve None."""
    u = (url or "").strip()
    if not u.lower().startswith("https://"):
        return None
    try:
        import httpx

        with httpx.Client(timeout=45.0, follow_redirects=True) as client:
            r = client.get(
                u,
                headers={"Accept": "application/pdf,application/octet-stream,*/*"},
            )
            if r.status_code != 200:
                return None
            data = r.content
            if not data or len(data) > max_bytes:
                return None
            ct = (r.headers.get("content-type") or "").lower()
            if "pdf" in ct or data[:4] == b"%PDF":
                return data
    except Exception:
        return None
    return None
from app.schemas.vehiculo import (
    VehiculoRegistro,
    VehiculoEdicion,
    VehiculoCobro,
    VehiculoResponse,
    VehiculoCobradoHoyResponse,
    VehiculosPendientes,
    VehiculoConTarifa,
    TarifaCalculada,
    VentaSOAT,
    VehiculoConsultaRuntResponse,
    ReinspeccionElegibilidadResponse,
)

router = APIRouter()
REINSPECCION_MAX_INTENTOS = 3
REINSPECCION_VENTANA_DIAS = 15
TIPO_VEHICULO_PRUEBAS_AUDITORIA = "pruebas_auditoria"
COLOMBIA_TZ = ZoneInfo("America/Bogota")

ESTADOS_COBRO_EFECTIVO = [
    EstadoVehiculo.PAGADO,
    EstadoVehiculo.EN_PISTA,
    EstadoVehiculo.APROBADO,
    EstadoVehiculo.RECHAZADO,
    EstadoVehiculo.COMPLETADO,
]
MAX_COBRADOS_HOY_RESPONSE = 250
FACTURA_CORRECCION_VENTANA_DIAS = 7


def _co_today_date() -> date:
    return datetime.now(COLOMBIA_TZ).date()


def _co_day_utc_bounds(target_date: date) -> tuple[datetime, datetime]:
    """Devuelve [inicio, fin) en UTC naive para un día calendario de Colombia."""
    start_local = datetime.combine(target_date, dt_time.min, tzinfo=COLOMBIA_TZ)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_local.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


def _utc_naive_to_co_date(dt: datetime | None) -> date | None:
    if not dt:
        return None
    dt_utc = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    return dt_utc.astimezone(COLOMBIA_TZ).date()


def _es_prueba_auditoria(tipo_vehiculo: str | None) -> bool:
    return (tipo_vehiculo or "").strip().lower() == TIPO_VEHICULO_PRUEBAS_AUDITORIA


MOTIVOS_CORRECCION_FACTURA = {"placa", "documento", "nombre", "identificacion", "valor"}


class CorregirFacturaEmitidaRequest(BaseModel):
    motivo: str = Field(min_length=3, max_length=40)
    nueva_placa: str | None = Field(default=None, max_length=10)
    cliente_nombre: str | None = Field(default=None, max_length=180)
    cliente_documento: str | None = Field(default=None, max_length=40)
    cliente_email: str | None = Field(default=None, max_length=255)
    cliente_telefono: str | None = Field(default=None, max_length=40)
    cliente_direccion: str | None = Field(default=None, max_length=255)
    valor_preventiva_nuevo: Decimal | None = Field(default=None, gt=0)
    observacion: str | None = Field(default=None, max_length=250)


class CorregirFacturaEmitidaResponse(BaseModel):
    success: bool
    vehiculo_id: str
    factura_original: str | None = None
    nota_credito: str | None = None
    factura_nueva: str | None = None
    message: str


class FacturaCorreccionHistorialItem(BaseModel):
    id: str
    estado: str
    motivo: str
    error_detalle: str | None = None
    factura_original: str | None = None
    nota_credito: str | None = None
    factura_nueva: str | None = None
    ejecutado_por_usuario_id: str | None = None
    created_at: datetime


class VehiculoFotoResponse(BaseModel):
    vehiculo_id: str
    placa: str
    total_fotos: int
    index: int
    foto: str | None = None


class HistorialClienteSugerenciaResponse(BaseModel):
    encontrado: bool
    fuente: str | None = None
    vehiculo_id: str | None = None
    placa: str | None = None
    cliente_nombre: str | None = None
    cliente_tipo_documento: str | None = None
    cliente_documento: str | None = None
    cliente_telefono: str | None = None
    cliente_email: str | None = None
    cliente_direccion: str | None = None
    cliente_factus_municipality_id: int | None = None
    fecha_ultima_atencion: datetime | None = None


def _map_metodo_pago_factus_credit_note(metodo_pago: str | None) -> str:
    m = (metodo_pago or "efectivo").strip().lower()
    if m == "transferencia":
        return "47"
    if m in {"tarjeta_credito", "credismart", "sistecredito"}:
        return "48"
    if m == "tarjeta_debito":
        return "49"
    return "10"


def _coerce_credit_note_result(data: dict[str, Any]) -> tuple[str | None, int | None]:
    if not isinstance(data, dict):
        return None, None
    candidates: list[dict[str, Any]] = []
    if isinstance(data.get("data"), dict):
        candidates.append(data["data"])
    candidates.append(data)
    for item in candidates:
        for key in ("credit_note", "creditNote", "note", "bill"):
            nested = item.get(key)
            if isinstance(nested, dict):
                candidates.append(nested)
    for item in candidates:
        num = item.get("number") or item.get("document_number")
        rid = item.get("id")
        note_number = str(num).strip() if num is not None else None
        try:
            note_id = int(rid) if rid is not None else None
        except Exception:
            note_id = None
        if note_number or note_id is not None:
            return note_number, note_id
    return None, None


def _select_credit_note_range_id(fs: TenantFactusSettings) -> int | None:
    ranges = list_numbering_ranges_for_tenant(fs)
    for row in ranges:
        document_raw = str(getattr(row, "document", "") or "").strip().lower()
        if not bool(getattr(row, "is_active", True)):
            continue
        if document_raw in {"22", "nota crédito", "nota credito"}:
            return int(row.id)
        if "nota" in document_raw and "cr" in document_raw:
            return int(row.id)
    return None


def _extract_fotos_from_observaciones(observaciones: str | None) -> list[str]:
    if not observaciones:
        return []
    try:
        parsed = json.loads(observaciones)
    except Exception:
        return []
    if not isinstance(parsed, dict):
        return []
    fotos = parsed.get("fotos")
    if not isinstance(fotos, list):
        return []
    out: list[str] = []
    for item in fotos:
        if not isinstance(item, str):
            continue
        val = item.strip()
        if val:
            out.append(val)
    return out


def _latest_factura_correcciones_by_vehiculo(
    db: Session, tenant_id: UUID, vehiculo_ids: list[UUID]
) -> dict[UUID, FacturaCorreccion]:
    ids = [vid for vid in vehiculo_ids if isinstance(vid, UUID)]
    if not ids:
        return {}
    rows = (
        db.query(FacturaCorreccion)
        .filter(
            FacturaCorreccion.tenant_id == tenant_id,
            FacturaCorreccion.vehiculo_proceso_id.in_(ids),
        )
        .order_by(FacturaCorreccion.vehiculo_proceso_id.asc(), FacturaCorreccion.created_at.desc())
        .all()
    )
    out: dict[UUID, FacturaCorreccion] = {}
    for row in rows:
        if row.vehiculo_proceso_id not in out:
            out[row.vehiculo_proceso_id] = row
    return out


def _build_vehiculo_response_with_correccion(
    vehiculo: VehiculoProceso,
    *,
    correccion: FacturaCorreccion | None = None,
    cajero_nombre: str | None = None,
    compact: bool = False,
) -> VehiculoResponse:
    update_data: dict[str, Any] = {}
    if cajero_nombre is not None:
        update_data["cajero_nombre"] = cajero_nombre
    if correccion is not None:
        es_corregida_ok = str(correccion.estado or "").lower() == "completed"
        update_data.update(
            {
                "factura_corregida": es_corregida_ok,
                "factura_correccion_estado": correccion.estado,
                "factura_correccion_motivo": correccion.motivo,
                "factura_correccion_at": correccion.created_at,
                "factura_correccion_factura_original": correccion.factura_original_numero,
                "factura_correccion_nota_credito": correccion.nota_credito_numero,
                "factura_correccion_factura_nueva": correccion.factura_nueva_numero,
            }
        )
    if compact:
        # Evita enviar JSON pesado de recepción en listados rápidos de Caja.
        update_data["recepcion_formato_extra_json"] = None
    out = VehiculoResponse.model_validate(vehiculo)
    return out.model_copy(update=update_data) if update_data else out


def _build_vehiculo_cobrado_hoy_response(
    vehiculo: VehiculoProceso,
    *,
    correccion: FacturaCorreccion | None = None,
) -> VehiculoCobradoHoyResponse:
    es_corregida_ok = bool(correccion and str(correccion.estado or "").lower() == "completed")
    return VehiculoCobradoHoyResponse(
        id=vehiculo.id,
        placa=vehiculo.placa,
        tipo_vehiculo=vehiculo.tipo_vehiculo,
        cliente_nombre=vehiculo.cliente_nombre,
        cliente_documento=vehiculo.cliente_documento,
        cliente_telefono=vehiculo.cliente_telefono,
        cliente_email=vehiculo.cliente_email,
        cliente_direccion=vehiculo.cliente_direccion,
        metodo_pago=str(vehiculo.metodo_pago or "") or None,
        total_cobrado=vehiculo.total_cobrado,
        numero_factura_dian=vehiculo.numero_factura_dian,
        factura_corregida=es_corregida_ok,
        factura_correccion_estado=(correccion.estado if correccion else None),
        factura_correccion_motivo=(correccion.motivo if correccion else None),
        factura_correccion_at=(correccion.created_at if correccion else None),
        factura_correccion_factura_original=(correccion.factura_original_numero if correccion else None),
        factura_correccion_nota_credito=(correccion.nota_credito_numero if correccion else None),
        factura_correccion_factura_nueva=(correccion.factura_nueva_numero if correccion else None),
    )


_RUNT_FX_CACHE: dict[str, Any] = {"rate": None, "expires_at": 0.0}


def _runt_doc_last4(document_number: str | None) -> str | None:
    digits = re.sub(r"\D", "", (document_number or "").strip())
    return digits[-4:] if digits else None


def _resolve_runt_fx_rate_usd_cop() -> Decimal:
    mode = (settings.RUNT_FX_MODE or "auto").strip().lower()
    manual_rate = Decimal(str(settings.RUNT_FX_USD_COP or 0))
    if mode != "auto":
        return manual_rate

    now = time.time()
    cached_rate = _RUNT_FX_CACHE.get("rate")
    expires_at = float(_RUNT_FX_CACHE.get("expires_at") or 0)
    if cached_rate is not None and now < expires_at:
        return Decimal(str(cached_rate))

    try:
        import httpx

        with httpx.Client(timeout=8.0) as client:
            resp = client.get(settings.RUNT_FX_AUTO_URL)
            resp.raise_for_status()
            payload = resp.json()
        rate_val = None
        if isinstance(payload, list) and payload:
            first = payload[0]
            if isinstance(first, dict):
                rate_val = first.get("valor")
        elif isinstance(payload, dict):
            rate_val = payload.get("valor")
        rate = Decimal(str(rate_val or 0))
        if rate > 0:
            _RUNT_FX_CACHE["rate"] = float(rate)
            _RUNT_FX_CACHE["expires_at"] = now + float(settings.RUNT_FX_AUTO_TTL_SECONDS or 21600)
            return rate
    except Exception:
        pass
    return manual_rate


def _runt_provider_cost(provider: str, *, cached: bool) -> tuple[Decimal, Decimal, Decimal]:
    fx = _resolve_runt_fx_rate_usd_cop()
    if cached:
        return Decimal("0"), Decimal("0"), fx
    p = (provider or "").strip().lower()
    if p == "placaapi":
        usd = Decimal(str(settings.RUNT_COST_PLACAAPI_USD or 0))
        cop_fallback = Decimal(str(settings.RUNT_COST_PLACAAPI_COP or 0))
    elif p == "verifik":
        usd = Decimal(str(settings.RUNT_COST_VERIFIK_USD or 0))
        cop_fallback = Decimal(str(settings.RUNT_COST_VERIFIK_COP or 0))
    else:
        usd = Decimal("0")
        cop_fallback = Decimal("0")
    if usd > 0 and fx > 0:
        return (usd * fx).quantize(Decimal("0.01")), usd, fx
    if cop_fallback > 0 and fx > 0:
        return cop_fallback, (cop_fallback / fx).quantize(Decimal("0.000001")), fx
    return cop_fallback, Decimal("0"), fx


def _guardar_metrica_runt(
    db: Session,
    *,
    tenant_id: UUID,
    sucursal_id: UUID | None,
    usuario_id: UUID,
    placa: str,
    document_type: str | None,
    document_number: str | None,
    provider_configured: str,
    provider_resolved: str,
    providers_attempted: list[str],
    fallback_used: bool,
    status: str,
    encontrado: bool,
    cached: bool,
    estimated_cost_cop: Decimal,
    estimated_cost_usd: Decimal = Decimal("0"),
    resolved_cost_cop: Decimal = Decimal("0"),
    resolved_cost_usd: Decimal = Decimal("0"),
    fallback_extra_cost_cop: Decimal = Decimal("0"),
    fallback_extra_cost_usd: Decimal = Decimal("0"),
    fx_rate_usd_cop_applied: Decimal | None = None,
    error_detail: str | None = None,
) -> None:
    try:
        row = RuntConsultaMetrica(
            tenant_id=tenant_id,
            sucursal_id=sucursal_id,
            usuario_id=usuario_id,
            placa_consultada=re.sub(r"[^A-Za-z0-9]", "", (placa or "").upper())[:12],
            document_type=(document_type or "").strip().upper()[:10] or None,
            document_number_last4=_runt_doc_last4(document_number),
            provider_configured=(provider_configured or "verifik")[:30],
            provider_resolved=(provider_resolved or provider_configured or "verifik")[:30],
            providers_attempted=",".join([p for p in providers_attempted if p])[:80] or (provider_configured or "verifik"),
            fallback_used=bool(fallback_used),
            status=(status or "error")[:20],
            encontrado=bool(encontrado),
            cached=bool(cached),
            error_detail=(error_detail or "")[:500] or None,
            estimated_cost_cop=Decimal(str(estimated_cost_cop or 0)),
            estimated_cost_usd=Decimal(str(estimated_cost_usd or 0)),
            resolved_cost_cop=Decimal(str(resolved_cost_cop or 0)),
            resolved_cost_usd=Decimal(str(resolved_cost_usd or 0)),
            fallback_extra_cost_cop=Decimal(str(fallback_extra_cost_cop or 0)),
            fallback_extra_cost_usd=Decimal(str(fallback_extra_cost_usd or 0)),
            fx_rate_usd_cop_applied=Decimal(
                str(
                    fx_rate_usd_cop_applied
                    if fx_rate_usd_cop_applied is not None
                    else (settings.RUNT_FX_USD_COP or 0)
                )
            ),
        )
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()


def _normalize_runt_doc_type(value: str | None) -> str:
    raw = str(value or "").strip().upper()
    return raw if raw in {"CC", "CE", "PA", "NIT"} else ""


def _normalize_runt_doc_number(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").strip().upper())[:30]


def _normalize_runt_plate(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").strip().upper())[:12]


def _buscar_cache_runt_interno(
    db: Session,
    *,
    tenant_id: UUID,
    placa: str,
    doc_type: str,
    doc_number: str,
) -> dict[str, Any] | None:
    if int(settings.RUNT_INTERNAL_CACHE_TTL_SECONDS or 0) <= 0:
        return None

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    row: RuntConsultaCache | None = None

    if placa and doc_type and doc_number:
        row = (
            db.query(RuntConsultaCache)
            .filter(
                RuntConsultaCache.tenant_id == tenant_id,
                RuntConsultaCache.placa_consultada == placa,
                RuntConsultaCache.document_type == doc_type,
                RuntConsultaCache.document_number_normalized == doc_number,
                RuntConsultaCache.expires_at >= now_utc,
            )
            .order_by(RuntConsultaCache.created_at.desc())
            .first()
        )

    if row is None and placa and not doc_number:
        row = (
            db.query(RuntConsultaCache)
            .filter(
                RuntConsultaCache.tenant_id == tenant_id,
                RuntConsultaCache.placa_consultada == placa,
                RuntConsultaCache.expires_at >= now_utc,
            )
            .order_by(RuntConsultaCache.created_at.desc())
            .first()
        )

    if row is None:
        return None

    payload = row.payload_json if isinstance(row.payload_json, dict) else {}
    out = dict(payload)
    out["cached"] = True
    out.setdefault("observaciones", [])
    if isinstance(out["observaciones"], list):
        out["observaciones"] = [
            *[str(x) for x in out["observaciones"] if str(x).strip()],
            "Resultado obtenido desde caché interno del CDA.",
        ]
    row.cached_hits = int(row.cached_hits or 0) + 1
    row.last_hit_at = now_utc
    db.commit()
    return out


def _guardar_cache_runt_interno(
    db: Session,
    *,
    tenant_id: UUID,
    sucursal_id: UUID | None,
    placa: str,
    doc_type: str,
    doc_number: str,
    provider_resolved: str,
    result: dict[str, Any],
) -> None:
    ttl = int(settings.RUNT_INTERNAL_CACHE_TTL_SECONDS or 0)
    if ttl <= 0:
        return
    if not isinstance(result, dict):
        return
    placa_norm = _normalize_runt_plate(placa or result.get("placa_consultada"))
    if len(placa_norm) < 5:
        return

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_at = now_utc + timedelta(seconds=ttl)
    safe_payload = dict(result)
    safe_payload["cached"] = False
    row = (
        db.query(RuntConsultaCache)
        .filter(
            RuntConsultaCache.tenant_id == tenant_id,
            RuntConsultaCache.placa_consultada == placa_norm,
            RuntConsultaCache.document_type == (doc_type or None),
            RuntConsultaCache.document_number_normalized == (doc_number or None),
        )
        .order_by(RuntConsultaCache.created_at.desc())
        .first()
    )
    if row is None:
        row = RuntConsultaCache(
            tenant_id=tenant_id,
            sucursal_id=sucursal_id,
            placa_consultada=placa_norm,
            document_type=doc_type or None,
            document_number_normalized=doc_number or None,
        )
        db.add(row)
    row.provider_resolved = (provider_resolved or "unknown")[:30]
    row.encontrado = bool(result.get("encontrado"))
    row.payload_json = safe_payload
    row.expires_at = expires_at
    row.last_hit_at = now_utc
    db.commit()


@router.get("/consulta-runt/{placa}", response_model=VehiculoConsultaRuntResponse)
def consultar_runt_por_placa(
    placa: str,
    document_type: str | None = Query(default=None, alias="documentType"),
    document_number: str | None = Query(default=None, alias="documentNumber"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Consulta externa por placa (Verifik o PlacaAPI), normalizada para autocompletado en recepción.
    No registra ni modifica vehículos.
    """
    provider = (settings.RUNT_LOOKUP_PROVIDER or "verifik").strip().lower()
    placa_norm = _normalize_runt_plate(placa)
    doc_type_norm = _normalize_runt_doc_type(document_type)
    doc_number_norm = _normalize_runt_doc_number(document_number)
    cache_hit = _buscar_cache_runt_interno(
        db,
        tenant_id=current_user.tenant_id,
        placa=placa_norm,
        doc_type=doc_type_norm,
        doc_number=doc_number_norm,
    )
    if cache_hit is not None:
        _guardar_metrica_runt(
            db,
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            usuario_id=current_user.id,
            placa=placa,
            document_type=document_type,
            document_number=document_number,
            provider_configured=provider,
            provider_resolved=str(cache_hit.get("proveedor") or "internal_cache"),
            providers_attempted=["internal_cache"],
            fallback_used=False,
            status="success" if bool(cache_hit.get("encontrado")) else "empty",
            encontrado=bool(cache_hit.get("encontrado")),
            cached=True,
            estimated_cost_cop=Decimal("0"),
            estimated_cost_usd=Decimal("0"),
            resolved_cost_cop=Decimal("0"),
            resolved_cost_usd=Decimal("0"),
            fx_rate_usd_cop_applied=Decimal(str(settings.RUNT_FX_USD_COP or 0)),
        )
        return cache_hit

    doc_number_digits = re.sub(r"\D", "", (document_number or "").strip())
    can_try_verifik_fallback = bool(
        settings.RUNT_FALLBACK_TO_VERIFIK_ON_EMPTY and settings.VERIFIK_ENABLED and doc_number_digits
    )
    attempted: list[str] = []
    fallback_used = False
    estimated_cost_cop = Decimal("0")
    estimated_cost_usd = Decimal("0")
    fx_rate_applied = Decimal(str(settings.RUNT_FX_USD_COP or 0))
    placa_cost_cop = Decimal("0")
    placa_cost_usd = Decimal("0")
    verifik_cost_cop = Decimal("0")
    verifik_cost_usd = Decimal("0")
    try:
        if provider == "placaapi":
            attempted.append("placaapi")
            placaapi_result = consultar_placaapi_por_placa(placa)
            placaapi_encontrado = bool(placaapi_result.get("encontrado"))
            # Regla de negocio: PlacaAPI no genera costo si no resuelve.
            if placaapi_encontrado:
                cop, usd, fx = _runt_provider_cost("placaapi", cached=bool(placaapi_result.get("cached")))
                estimated_cost_cop += cop
                estimated_cost_usd += usd
                fx_rate_applied = fx
                placa_cost_cop += cop
                placa_cost_usd += usd
            if placaapi_encontrado:
                _guardar_metrica_runt(
                    db,
                    tenant_id=current_user.tenant_id,
                    sucursal_id=active_sucursal_id,
                    usuario_id=current_user.id,
                    placa=placa,
                    document_type=document_type,
                    document_number=document_number,
                    provider_configured=provider,
                    provider_resolved="placaapi",
                    providers_attempted=attempted,
                    fallback_used=False,
                    status="success",
                    encontrado=True,
                    cached=bool(placaapi_result.get("cached")),
                    estimated_cost_cop=estimated_cost_cop,
                    estimated_cost_usd=estimated_cost_usd,
                    resolved_cost_cop=placa_cost_cop,
                    resolved_cost_usd=placa_cost_usd,
                    fx_rate_usd_cop_applied=fx_rate_applied,
                )
                _guardar_cache_runt_interno(
                    db,
                    tenant_id=current_user.tenant_id,
                    sucursal_id=active_sucursal_id,
                    placa=placa_norm,
                    doc_type=doc_type_norm,
                    doc_number=doc_number_norm,
                    provider_resolved="placaapi",
                    result=placaapi_result,
                )
                return placaapi_result
            if can_try_verifik_fallback:
                fallback_used = True
                attempted.append("verifik")
                try:
                    verifik_result = consultar_runt_vehiculo_por_placa(
                        placa,
                        document_type=document_type,
                        document_number=document_number,
                    )
                    cop, usd, fx = _runt_provider_cost("verifik", cached=bool(verifik_result.get("cached")))
                    estimated_cost_cop += cop
                    estimated_cost_usd += usd
                    fx_rate_applied = fx
                    verifik_cost_cop += cop
                    verifik_cost_usd += usd
                    _guardar_metrica_runt(
                        db,
                        tenant_id=current_user.tenant_id,
                        sucursal_id=active_sucursal_id,
                        usuario_id=current_user.id,
                        placa=placa,
                        document_type=document_type,
                        document_number=document_number,
                        provider_configured=provider,
                        provider_resolved="verifik",
                        providers_attempted=attempted,
                        fallback_used=True,
                        status="success" if bool(verifik_result.get("encontrado")) else "empty",
                        encontrado=bool(verifik_result.get("encontrado")),
                        cached=bool(verifik_result.get("cached")),
                        estimated_cost_cop=estimated_cost_cop,
                        estimated_cost_usd=estimated_cost_usd,
                        resolved_cost_cop=verifik_cost_cop,
                        resolved_cost_usd=verifik_cost_usd,
                        fallback_extra_cost_cop=placa_cost_cop,
                        fallback_extra_cost_usd=placa_cost_usd,
                        fx_rate_usd_cop_applied=fx_rate_applied,
                    )
                    _guardar_cache_runt_interno(
                        db,
                        tenant_id=current_user.tenant_id,
                        sucursal_id=active_sucursal_id,
                        placa=placa_norm,
                        doc_type=doc_type_norm or _normalize_runt_doc_type(str(verifik_result.get("document_type") or "")),
                        doc_number=doc_number_norm or _normalize_runt_doc_number(str(verifik_result.get("document_number") or "")),
                        provider_resolved="verifik",
                        result=verifik_result,
                    )
                    return verifik_result
                except VerifikRuntError:
                    _guardar_metrica_runt(
                        db,
                        tenant_id=current_user.tenant_id,
                        sucursal_id=active_sucursal_id,
                        usuario_id=current_user.id,
                        placa=placa,
                        document_type=document_type,
                        document_number=document_number,
                        provider_configured=provider,
                        provider_resolved="placaapi",
                        providers_attempted=attempted,
                        fallback_used=True,
                        status="empty",
                        encontrado=False,
                        cached=bool(placaapi_result.get("cached")),
                        estimated_cost_cop=estimated_cost_cop,
                        estimated_cost_usd=estimated_cost_usd,
                        resolved_cost_cop=placa_cost_cop,
                        resolved_cost_usd=placa_cost_usd,
                        fallback_extra_cost_cop=verifik_cost_cop,
                        fallback_extra_cost_usd=verifik_cost_usd,
                        fx_rate_usd_cop_applied=fx_rate_applied,
                    )
                    _guardar_cache_runt_interno(
                        db,
                        tenant_id=current_user.tenant_id,
                        sucursal_id=active_sucursal_id,
                        placa=placa_norm,
                        doc_type=doc_type_norm,
                        doc_number=doc_number_norm,
                        provider_resolved="placaapi",
                        result=placaapi_result,
                    )
                    return placaapi_result
            _guardar_metrica_runt(
                db,
                tenant_id=current_user.tenant_id,
                sucursal_id=active_sucursal_id,
                usuario_id=current_user.id,
                placa=placa,
                document_type=document_type,
                document_number=document_number,
                provider_configured=provider,
                provider_resolved="placaapi",
                providers_attempted=attempted,
                fallback_used=fallback_used,
                status="empty",
                encontrado=False,
                cached=bool(placaapi_result.get("cached")),
                estimated_cost_cop=estimated_cost_cop,
                estimated_cost_usd=estimated_cost_usd,
                resolved_cost_cop=placa_cost_cop,
                resolved_cost_usd=placa_cost_usd,
                fx_rate_usd_cop_applied=fx_rate_applied,
            )
            _guardar_cache_runt_interno(
                db,
                tenant_id=current_user.tenant_id,
                sucursal_id=active_sucursal_id,
                placa=placa_norm,
                doc_type=doc_type_norm,
                doc_number=doc_number_norm,
                provider_resolved="placaapi",
                result=placaapi_result,
            )
            return placaapi_result
        attempted.append("verifik")
        verifik_result = consultar_runt_vehiculo_por_placa(
            placa,
            document_type=document_type,
            document_number=document_number,
        )
        cop, usd, fx = _runt_provider_cost("verifik", cached=bool(verifik_result.get("cached")))
        estimated_cost_cop += cop
        estimated_cost_usd += usd
        fx_rate_applied = fx
        verifik_cost_cop += cop
        verifik_cost_usd += usd
        _guardar_metrica_runt(
            db,
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            usuario_id=current_user.id,
            placa=placa,
            document_type=document_type,
            document_number=document_number,
            provider_configured=provider,
            provider_resolved="verifik",
            providers_attempted=attempted,
            fallback_used=False,
            status="success" if bool(verifik_result.get("encontrado")) else "empty",
            encontrado=bool(verifik_result.get("encontrado")),
            cached=bool(verifik_result.get("cached")),
            estimated_cost_cop=estimated_cost_cop,
            estimated_cost_usd=estimated_cost_usd,
            resolved_cost_cop=verifik_cost_cop,
            resolved_cost_usd=verifik_cost_usd,
            fx_rate_usd_cop_applied=fx_rate_applied,
        )
        _guardar_cache_runt_interno(
            db,
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            placa=placa_norm,
            doc_type=doc_type_norm or _normalize_runt_doc_type(str(verifik_result.get("document_type") or "")),
            doc_number=doc_number_norm or _normalize_runt_doc_number(str(verifik_result.get("document_number") or "")),
            provider_resolved="verifik",
            result=verifik_result,
        )
        return verifik_result
    except VerifikRuntError as exc:
        _guardar_metrica_runt(
            db,
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            usuario_id=current_user.id,
            placa=placa,
            document_type=document_type,
            document_number=document_number,
            provider_configured=provider,
            provider_resolved="verifik",
            providers_attempted=attempted or ["verifik"],
            fallback_used=fallback_used,
            status="error",
            encontrado=False,
            cached=False,
            estimated_cost_cop=estimated_cost_cop,
            estimated_cost_usd=estimated_cost_usd,
            resolved_cost_cop=verifik_cost_cop,
            resolved_cost_usd=verifik_cost_usd,
            fallback_extra_cost_cop=placa_cost_cop,
            fallback_extra_cost_usd=placa_cost_usd,
            fx_rate_usd_cop_applied=fx_rate_applied,
            error_detail=str(exc),
        )
        status_code = exc.status_code if exc.status_code and 100 <= exc.status_code < 600 else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except PlacaApiRuntError as exc:
        if provider == "placaapi" and can_try_verifik_fallback:
            try:
                attempted.append("verifik")
                fallback_used = True
                verifik_result = consultar_runt_vehiculo_por_placa(
                    placa,
                    document_type=document_type,
                    document_number=document_number,
                )
                cop, usd, fx = _runt_provider_cost("verifik", cached=bool(verifik_result.get("cached")))
                estimated_cost_cop += cop
                estimated_cost_usd += usd
                fx_rate_applied = fx
                verifik_cost_cop += cop
                verifik_cost_usd += usd
                _guardar_metrica_runt(
                    db,
                    tenant_id=current_user.tenant_id,
                    sucursal_id=active_sucursal_id,
                    usuario_id=current_user.id,
                    placa=placa,
                    document_type=document_type,
                    document_number=document_number,
                    provider_configured=provider,
                    provider_resolved="verifik",
                    providers_attempted=attempted,
                    fallback_used=True,
                    status="success" if bool(verifik_result.get("encontrado")) else "empty",
                    encontrado=bool(verifik_result.get("encontrado")),
                    cached=bool(verifik_result.get("cached")),
                    estimated_cost_cop=estimated_cost_cop,
                    estimated_cost_usd=estimated_cost_usd,
                    resolved_cost_cop=verifik_cost_cop,
                    resolved_cost_usd=verifik_cost_usd,
                    fallback_extra_cost_cop=placa_cost_cop,
                    fallback_extra_cost_usd=placa_cost_usd,
                    fx_rate_usd_cop_applied=fx_rate_applied,
                )
                _guardar_cache_runt_interno(
                    db,
                    tenant_id=current_user.tenant_id,
                    sucursal_id=active_sucursal_id,
                    placa=placa_norm,
                    doc_type=doc_type_norm or _normalize_runt_doc_type(str(verifik_result.get("document_type") or "")),
                    doc_number=doc_number_norm or _normalize_runt_doc_number(str(verifik_result.get("document_number") or "")),
                    provider_resolved="verifik",
                    result=verifik_result,
                )
                return verifik_result
            except VerifikRuntError:
                pass
        _guardar_metrica_runt(
            db,
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            usuario_id=current_user.id,
            placa=placa,
            document_type=document_type,
            document_number=document_number,
            provider_configured=provider,
            provider_resolved="placaapi",
            providers_attempted=attempted or ["placaapi"],
            fallback_used=fallback_used,
            status="error",
            encontrado=False,
            cached=False,
            estimated_cost_cop=estimated_cost_cop,
            estimated_cost_usd=estimated_cost_usd,
            resolved_cost_cop=placa_cost_cop,
            resolved_cost_usd=placa_cost_usd,
            fallback_extra_cost_cop=verifik_cost_cop,
            fallback_extra_cost_usd=verifik_cost_usd,
            fx_rate_usd_cop_applied=fx_rate_applied,
            error_detail=str(exc),
        )
        status_code = exc.status_code if exc.status_code and 100 <= exc.status_code < 600 else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


def _filtro_vehiculo_sede(q, tenant_id, sucursal_id: UUID):
    return q.filter(
        VehiculoProceso.tenant_id == tenant_id,
        VehiculoProceso.sucursal_id == sucursal_id,
    )


@router.get("/historial-cliente-sugerencia", response_model=HistorialClienteSugerenciaResponse)
def obtener_historial_cliente_sugerencia(
    placa: str | None = Query(default=None),
    cliente_tipo_documento: str | None = Query(default=None),
    cliente_documento: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    placa_norm = re.sub(r"[^A-Z0-9]", "", str(placa or "").upper()).strip()
    doc_tipo_norm = str(cliente_tipo_documento or "").strip().upper()
    doc_raw = str(cliente_documento or "").strip().upper()
    doc_norm = re.sub(r"[^A-Z0-9]", "", doc_raw)

    if len(placa_norm) < 5 and len(doc_norm) < 5:
        return HistorialClienteSugerenciaResponse(encontrado=False)

    def _row_to_response(row: VehiculoProceso, fuente: str) -> HistorialClienteSugerenciaResponse:
        return HistorialClienteSugerenciaResponse(
            encontrado=True,
            fuente=fuente,
            vehiculo_id=str(row.id),
            placa=row.placa,
            cliente_nombre=row.cliente_nombre,
            cliente_tipo_documento=row.cliente_tipo_documento,
            cliente_documento=row.cliente_documento,
            cliente_telefono=row.cliente_telefono,
            cliente_email=row.cliente_email,
            cliente_direccion=row.cliente_direccion,
            cliente_factus_municipality_id=row.cliente_factus_municipality_id,
            fecha_ultima_atencion=row.fecha_pago or row.fecha_registro,
        )

    def _buscar_por_placa(solo_sucursal: bool) -> VehiculoProceso | None:
        if len(placa_norm) < 5:
            return None
        q = db.query(VehiculoProceso).filter(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            func.upper(func.coalesce(VehiculoProceso.placa, "")) == placa_norm,
        )
        if solo_sucursal:
            q = q.filter(VehiculoProceso.sucursal_id == active_sucursal_id)
        return (
            q.order_by(
                func.coalesce(VehiculoProceso.fecha_pago, VehiculoProceso.fecha_registro).desc(),
                VehiculoProceso.fecha_registro.desc(),
            )
            .first()
        )

    def _buscar_por_documento(solo_sucursal: bool) -> VehiculoProceso | None:
        if len(doc_norm) < 5:
            return None
        q = db.query(VehiculoProceso).filter(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            func.regexp_replace(
                func.upper(func.coalesce(VehiculoProceso.cliente_documento, "")),
                "[^A-Z0-9]",
                "",
                "g",
            )
            == doc_norm,
        )
        if solo_sucursal:
            q = q.filter(VehiculoProceso.sucursal_id == active_sucursal_id)
        if doc_tipo_norm in {"CC", "CE", "PA", "NIT"}:
            q = q.filter(func.upper(func.coalesce(VehiculoProceso.cliente_tipo_documento, "")) == doc_tipo_norm)
        return (
            q.order_by(
                func.coalesce(VehiculoProceso.fecha_pago, VehiculoProceso.fecha_registro).desc(),
                VehiculoProceso.fecha_registro.desc(),
            )
            .first()
        )

    row = _buscar_por_placa(solo_sucursal=True)
    if row:
        return _row_to_response(row, "placa_sucursal")
    row = _buscar_por_documento(solo_sucursal=True)
    if row:
        return _row_to_response(row, "documento_sucursal")
    row = _buscar_por_placa(solo_sucursal=False)
    if row:
        return _row_to_response(row, "placa_tenant")
    row = _buscar_por_documento(solo_sucursal=False)
    if row:
        return _row_to_response(row, "documento_tenant")
    return HistorialClienteSugerenciaResponse(encontrado=False)


def _build_reinspeccion_context_for_origen(
    db: Session,
    *,
    tenant_id: UUID,
    origen: VehiculoProceso,
) -> dict[str, Any]:
    def _to_naive_utc(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    intentos = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.tenant_id == tenant_id,
            or_(
                VehiculoProceso.id == origen.id,
                VehiculoProceso.reinspeccion_origen_id == origen.id,
            ),
        )
        .order_by(VehiculoProceso.fecha_registro.asc())
        .all()
    )
    if not intentos:
        intentos = [origen]
    primer_intento_at = _to_naive_utc(intentos[0].fecha_registro)
    ultimo_intento_at = _to_naive_utc(intentos[-1].fecha_registro)
    vence_at = primer_intento_at + timedelta(days=REINSPECCION_VENTANA_DIAS)
    intentos_usados = len(intentos)
    intentos_restantes = max(0, REINSPECCION_MAX_INTENTOS - intentos_usados)
    ultimo = intentos[-1]
    ultimo_resultado = (ultimo.revision_cierre_resultado or "").strip().lower()
    if not ultimo_resultado:
        if ultimo.estado == EstadoVehiculo.RECHAZADO:
            ultimo_resultado = "rechazado"
        elif ultimo.estado in (EstadoVehiculo.APROBADO, EstadoVehiculo.COMPLETADO):
            ultimo_resultado = "aprobado"
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    elegible = bool(
        ultimo_resultado == "rechazado"
        and now_naive <= vence_at
        and intentos_restantes > 0
    )
    motivo = None
    if not elegible:
        if ultimo_resultado != "rechazado":
            motivo = "El último intento no quedó rechazado."
        elif now_naive > vence_at:
            motivo = (
                f"Ventana vencida: la reinspección solo aplica por {REINSPECCION_VENTANA_DIAS} días "
                "calendario desde el primer intento."
            )
        elif intentos_restantes <= 0:
            motivo = "Se agotaron los 3 intentos totales permitidos para esta placa."
    return {
        "elegible": elegible,
        "motivo": motivo,
        "origen": origen,
        "primer_intento_at": primer_intento_at,
        "ultimo_intento_at": ultimo_intento_at,
        "intentos_usados": intentos_usados,
        "intentos_restantes": intentos_restantes,
        "vence_at": vence_at,
    }


def _map_sarlaft_hits_count(raw_results: list[dict], threshold: float) -> tuple[int, float]:
    max_score = 0.0
    hit_count = 0
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        score = item.get("score")
        score_val = float(score) if score is not None else 0.0
        if score_val > max_score:
            max_score = score_val
        if score_val >= threshold:
            hit_count += 1
    return hit_count, max_score


def _classify_sarlaft_recepcion(
    dataset: str,
    *,
    max_score: float,
    threshold: float,
    auto_red_threshold: float,
) -> tuple[str, str]:
    ds = (dataset or "").strip().lower()
    if ds == "sanctions":
        has_alert = max_score >= threshold
        return ("rojo" if has_alert else "amarillo", "in_review" if has_alert else "open")

    # Flujo automatico (default): verde para bajo riesgo, amarillo para alerta media
    # y rojo solo para coincidencias extremas (score muy alto).
    effective_auto_red_threshold = max(auto_red_threshold, threshold)
    if max_score >= effective_auto_red_threshold:
        return ("rojo", "in_review")
    if max_score >= threshold:
        return ("amarillo", "open")
    return ("verde", "open")


def _upsert_sarlaft_en_cobro(
    *,
    db: Session,
    current_user: Usuario,
    tenant: Tenant,
    active_sucursal_id: UUID,
    vehiculo: VehiculoProceso,
    payment_method: str,
    transaction_amount_cop: Decimal,
    cash_amount_cop: Decimal,
) -> dict:
    # Solo opera cuando el tenant tiene SARLAFT habilitado.
    if not bool(getattr(tenant, "sarlaft_enabled", False)):
        return {"alerts_generated": 0, "requires_officer_review": False, "alert_messages": []}

    alerts_generated = 0
    alert_messages: list[str] = []

    profile = (
        db.query(SarlaftProfile)
        .filter(SarlaftProfile.tenant_id == current_user.tenant_id)
        .first()
    )
    if not profile:
        # Fallback defensivo: si falta perfil SARLAFT, lo creamos para no perder trazabilidad en cobro.
        profile = SarlaftProfile(
            tenant_id=current_user.tenant_id,
            enabled=True,
            mode=(getattr(tenant, "sarlaft_mode", None) or "manual"),
            cash_threshold_cop=Decimal("0"),
            api_trigger_mode="all",
            api_fallback_to_manual=True,
        )
        db.add(profile)
        db.flush()
    operacion_ref = f"VEH-{vehiculo.id}"
    existing_case = (
        db.query(SarlaftCase)
        .filter(
            SarlaftCase.tenant_id == current_user.tenant_id,
            SarlaftCase.operacion_ref == operacion_ref,
        )
        .first()
    )
    if existing_case:
        case = existing_case
        case.sede_id = active_sucursal_id
        case.transaction_amount_cop = Decimal(str(transaction_amount_cop or 0))
        case.cash_amount_cop = Decimal(str(cash_amount_cop or 0))
        case.payment_method = (payment_method or "otro").strip().lower() or "otro"
    else:
        case = SarlaftCase(
            tenant_id=current_user.tenant_id,
            sede_id=active_sucursal_id,
            operacion_ref=operacion_ref,
            status="open",
            risk_level="verde",
            risk_score=Decimal("0"),
            transaction_amount_cop=Decimal(str(transaction_amount_cop or 0)),
            cash_amount_cop=Decimal(str(cash_amount_cop or 0)),
            payment_method=(payment_method or "otro").strip().lower() or "otro",
            created_by_user_id=current_user.id,
        )
        db.add(case)
        db.flush()

    party = (
        db.query(SarlaftCaseParty)
        .filter(
            SarlaftCaseParty.case_id == case.id,
            SarlaftCaseParty.tenant_id == current_user.tenant_id,
            SarlaftCaseParty.role == "cliente",
        )
        .first()
    )
    if not party:
        party = SarlaftCaseParty(
            case_id=case.id,
            tenant_id=current_user.tenant_id,
            role="cliente",
            doc_type=(vehiculo.cliente_tipo_documento or "").strip() or "CC",
            doc_number=(vehiculo.cliente_documento or "").strip() or "N/D",
            full_name=(vehiculo.cliente_nombre or "").strip() or "N/D",
            phone=(vehiculo.cliente_telefono or "").strip() or None,
            email=(vehiculo.cliente_email or "").strip().lower() or None,
            city=None,
            address=(vehiculo.cliente_direccion or "").strip() or None,
            metadata_json={
                "source": "caja_cobro",
                "vehiculo_id": str(vehiculo.id),
                "placa": vehiculo.placa,
                "tipo_vehiculo": vehiculo.tipo_vehiculo,
            },
        )
        db.add(party)
    else:
        party.doc_type = (vehiculo.cliente_tipo_documento or "").strip() or party.doc_type
        party.doc_number = (vehiculo.cliente_documento or "").strip() or party.doc_number
        party.full_name = (vehiculo.cliente_nombre or "").strip() or party.full_name
        party.phone = (vehiculo.cliente_telefono or "").strip() or party.phone
        party.email = (vehiculo.cliente_email or "").strip().lower() or party.email
        party.address = (vehiculo.cliente_direccion or "").strip() or party.address
        metadata = party.metadata_json if isinstance(party.metadata_json, dict) else {}
        metadata["source"] = "caja_cobro"
        metadata["vehiculo_id"] = str(vehiculo.id)
        metadata["placa"] = vehiculo.placa
        metadata["tipo_vehiculo"] = vehiculo.tipo_vehiculo
        party.metadata_json = metadata

    log_sarlaft_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user=current_user,
        action="case_upsert_from_cobro",
        entity_type="case",
        entity_id=case.id,
        after_json={
            "operacion_ref": operacion_ref,
            "vehiculo_id": str(vehiculo.id),
            "placa": vehiculo.placa,
            "cliente_documento": vehiculo.cliente_documento,
            "payment_method": case.payment_method,
            "transaction_amount_cop": str(case.transaction_amount_cop),
            "cash_amount_cop": str(case.cash_amount_cop),
        },
    )

    # Si el perfil está deshabilitado, conservamos trazabilidad (caso/parte/log) pero no ejecutamos screening.
    if not bool(profile.enabled):
        return {"alerts_generated": 0, "requires_officer_review": False, "alert_messages": []}

    # Motor robusto SIEMPRE activo (independiente de API externa).
    rule_alerts = evaluate_unusual_operation_rules(
        db,
        tenant_id=current_user.tenant_id,
        cliente_doc_number=party.doc_number or "",
    )
    for ra in rule_alerts:
        alerts_generated += 1
        alert_messages.append(str(ra.get("reason") or ra.get("rule_code") or "motor_interno"))
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="internal_alert_generated",
            entity_type="alert",
            entity_id=case.id,
            after_json={
                "alert_level": str(ra.get("alert_level") or "media"),
                "operation_classification": str(ra.get("operation_classification") or "operacion_inusual"),
                "rule_code": str(ra.get("rule_code") or "N/A"),
                "reason": str(ra.get("reason") or "motor_interno"),
                "window_days": int(ra.get("window_days") or 0),
                "metrics": ra.get("metrics") if isinstance(ra.get("metrics"), dict) else {},
                "payment_method": case.payment_method,
                "transaction_amount_cop": str(case.transaction_amount_cop),
                "cash_amount_cop": str(case.cash_amount_cop),
                "cliente_doc_number": party.doc_number,
            },
        )

    if bool(settings.SARLAFT_INTERCDA_ASYNC_ENABLED):
        enqueue_intercda_job(
            db,
            tenant_id=current_user.tenant_id,
            source_case_id=case.id,
        )
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="intercda_signal_enqueued",
            entity_type="intercda_job",
            entity_id=case.id,
            after_json={
                "source_case_id": str(case.id),
                "async_enabled": True,
            },
        )
    else:
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="intercda_signal_skipped_async_disabled",
            entity_type="intercda_job",
            entity_id=case.id,
            after_json={"source_case_id": str(case.id)},
        )

    # Si no está en modo API, dejamos el caso para revisión manual posterior.
    if (profile.mode or "").strip().lower() != "api":
        return {
            "alerts_generated": alerts_generated,
            "requires_officer_review": alerts_generated > 0,
            "alert_messages": alert_messages,
        }

    trigger_mode = (profile.api_trigger_mode or "all").strip().lower()
    if trigger_mode == "on_demand":
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="auto_screening_skipped_on_demand",
            entity_type="case",
            entity_id=case.id,
            after_json={
                "reason": "profile_api_trigger_mode_on_demand",
                "payment_method": case.payment_method,
                "transaction_amount_cop": str(case.transaction_amount_cop),
                "cash_amount_cop": str(case.cash_amount_cop),
            },
        )
        return {
            "alerts_generated": alerts_generated,
            "requires_officer_review": alerts_generated > 0,
            "alert_messages": alert_messages,
        }

    # Política operativa:
    # - Flujo automático de recepción/cobro: lista común (default).
    # - Flujo manual por oficial: lista fuerte (sanctions) desde módulo SARLAFT.
    dataset = (settings.OPENSANCTIONS_MATCH_DATASET or "default").strip() or "default"
    threshold = float(settings.OPENSANCTIONS_ALERT_SCORE_THRESHOLD or 0.75)
    auto_red_threshold = float(settings.OPENSANCTIONS_AUTO_RED_SCORE_THRESHOLD or 0.95)
    try:
        screening = open_sanctions_match(
            schema="Person",
            full_name=party.full_name,
            id_number=party.doc_number,
            dataset=dataset,
            algorithm=(settings.OPENSANCTIONS_MATCH_ALGORITHM or "best"),
            limit=int(settings.OPENSANCTIONS_MATCH_LIMIT or 5),
        )
        raw_results = screening.get("results") if isinstance(screening, dict) else []
        raw_results = raw_results if isinstance(raw_results, list) else []
        hits_count, max_score = _map_sarlaft_hits_count(raw_results, threshold)
        risk_level, status_case = _classify_sarlaft_recepcion(
            dataset,
            max_score=max_score,
            threshold=threshold,
            auto_red_threshold=auto_red_threshold,
        )
        case.risk_level = risk_level
        case.risk_score = Decimal(str(round(max_score * 100, 2)))
        case.status = status_case

        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="auto_screening_from_recepcion",
            entity_type="case",
            entity_id=case.id,
            after_json={
                "provider": "opensanctions",
                "dataset": dataset,
                "hits_count": len(raw_results),
                "hits_alert_count": hits_count,
                "risk_level": risk_level,
                "risk_score_pct": float(case.risk_score),
                "alert_threshold": threshold,
                "auto_red_threshold": auto_red_threshold,
            },
        )
        # Alerta base por screening: solo cuando hay hit alto (riesgo rojo).
        if case.risk_level == "rojo":
            alerts_generated += 1
            alert_messages.append("hit_open_sanctions_alto_riesgo")
            log_sarlaft_event(
                db,
                tenant_id=current_user.tenant_id,
                actor_user=current_user,
                action="internal_alert_generated",
                entity_type="alert",
                entity_id=case.id,
                after_json={
                    "alert_level": "critica",
                    "reason": "hit_open_sanctions_alto_riesgo",
                    "payment_method": case.payment_method,
                    "transaction_amount_cop": str(case.transaction_amount_cop),
                    "cash_amount_cop": str(case.cash_amount_cop),
                },
            )

    except OpenSanctionsError as exc:
        case.status = "open"
        log_sarlaft_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user=current_user,
            action="auto_screening_from_cobro_failed",
            entity_type="case",
            entity_id=case.id,
            after_json={"error": str(exc)},
        )
        if not bool(profile.api_fallback_to_manual):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No fue posible ejecutar screening SARLAFT automático en cobro: {exc}",
            ) from exc
    return {
        "alerts_generated": alerts_generated,
        "requires_officer_review": alerts_generated > 0,
        "alert_messages": alert_messages,
    }


VALID_PAYMENT_METHODS = {
    "efectivo",
    "tarjeta_debito",
    "tarjeta_credito",
    "transferencia",
    "credismart",
    "sistecredito",
    "mixto",
}
MIXED_BREAKDOWN_METHODS = VALID_PAYMENT_METHODS - {"mixto"}


def _normalize_payment_method(method: str) -> str:
    normalized = (method or "").strip().lower()
    if normalized not in VALID_PAYMENT_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Método de pago inválido. Opciones: {', '.join(sorted(VALID_PAYMENT_METHODS))}",
        )
    return normalized


def _validate_mixed_breakdown(
    breakdown: Dict[str, float] | None,
    total_expected: Decimal,
) -> Dict[str, Decimal]:
    if not breakdown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe proporcionar el desglose de pagos para método mixto",
        )

    normalized_amounts: Dict[str, Decimal] = {}
    for raw_method, raw_amount in breakdown.items():
        method = (raw_method or "").strip().lower()
        if method not in MIXED_BREAKDOWN_METHODS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Método '{raw_method}' no permitido en desglose mixto",
            )
        amount = Decimal(str(raw_amount))
        if amount < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El monto del método '{method}' no puede ser negativo",
            )
        if amount == 0:
            continue
        normalized_amounts[method] = normalized_amounts.get(method, Decimal("0")) + amount

    if len(normalized_amounts) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El pago mixto requiere al menos 2 métodos con valor mayor a 0",
        )

    rounded_sum = sum(normalized_amounts.values()).quantize(Decimal("0.01"))
    rounded_expected = Decimal(str(total_expected)).quantize(Decimal("0.01"))
    if rounded_sum != rounded_expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"La suma del desglose ({rounded_sum}) no coincide con el total a cobrar ({rounded_expected})",
        )

    return normalized_amounts


def mapear_tipo_vehiculo_a_comision(tipo_vehiculo: str) -> str:
    """
    Mapear tipo de vehículo RTM a tipo de comisión SOAT.
    - Motos → 'moto' (comisión $30,000)
    - Vehículos livianos y pesados → 'carro' (comisión $50,000)
    """
    if tipo_vehiculo == "moto":
        return "moto"
    elif tipo_vehiculo in ["liviano_particular", "liviano_publico", "pesado_particular", "pesado_publico"]:
        return "carro"
    elif _es_prueba_auditoria(tipo_vehiculo):
        return "carro"
    else:
        # Por defecto, si es un tipo no reconocido, usar 'carro'
        return "carro"


def calcular_tarifa_por_antiguedad(ano_modelo: int, tipo_vehiculo: str, tenant_id, db: Session) -> Tarifa:
    """Calcular tarifa según antigüedad y tipo de vehículo"""
    ano_actual = datetime.now().year
    antiguedad = ano_actual - ano_modelo

    hoy = date.today()

    def _buscar(ant: int) -> Tarifa | None:
        return (
            db.query(Tarifa)
            .filter(
                and_(
                    Tarifa.activa == True,
                    Tarifa.tenant_id == tenant_id,
                    Tarifa.tipo_vehiculo == tipo_vehiculo,
                    Tarifa.vigencia_inicio <= hoy,
                    Tarifa.vigencia_fin >= hoy,
                    Tarifa.antiguedad_min <= ant,
                    (Tarifa.antiguedad_max >= ant) | (Tarifa.antiguedad_max == None),
                )
            )
            .order_by(Tarifa.antiguedad_min.desc(), Tarifa.created_at.desc())
            .first()
        )

    tarifa = _buscar(antiguedad)
    # Rangos suelen empezar en "1 año"; año modelo = año calendario → antigüedad 0 y no cae en ningún tramo.
    if tarifa is None and antiguedad == 0:
        tarifa = _buscar(1)

    if not tarifa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No se encontró tarifa vigente para tipo '{tipo_vehiculo}' "
                f"(antigüedad {antiguedad} años). Revise tarifas en administración."
            ),
        )

    return tarifa


def _calcular_snapshot_iva_servicio(
    *,
    vehiculo: VehiculoProceso,
    tenant_id: UUID,
    db: Session,
    tarifa_referencia: Tarifa | None = None,
) -> tuple[Decimal, Decimal, Decimal]:
    """
    Calcula snapshot contable de servicio para provisión de IVA:
    - base gravable
    - IVA causado
    - valor excluido/no gravado
    """
    monto_servicio = Decimal(str(vehiculo.valor_rtm or 0))
    if monto_servicio <= 0:
        return (Decimal("0.00"), Decimal("0.00"), Decimal("0.00"))

    if (vehiculo.tipo_vehiculo or "").strip().lower() == "preventiva":
        return (Decimal("0.00"), Decimal("0.00"), monto_servicio.quantize(Decimal("0.01")))

    tarifa_base = tarifa_referencia
    if tarifa_base is None:
        try:
            t_row = calcular_tarifa_por_antiguedad(
                vehiculo.ano_modelo,
                vehiculo.tipo_vehiculo,
                tenant_id,
                db,
            )
            suma_t = Decimal(str(t_row.valor_rtm or 0)) + Decimal(str(t_row.valor_terceros or 0))
            if abs(suma_t - monto_servicio) <= Decimal("1"):
                tarifa_base = t_row
        except HTTPException:
            tarifa_base = None

    if tarifa_base is not None:
        gravado = Decimal(str(tarifa_base.valor_rtm or 0))
        excluido = Decimal(str(tarifa_base.valor_terceros or 0))
    else:
        # Fallback seguro: si no hay desglose confiable, tratar todo como gravado.
        gravado = monto_servicio
        excluido = Decimal("0")

    iva_rate = Decimal(str(settings.FACTUS_IVA_PORCENTAJE_GENERAL or 19)) / Decimal("100")
    if gravado <= 0:
        return (Decimal("0.00"), Decimal("0.00"), excluido.quantize(Decimal("0.01")))
    divisor = Decimal("1") + iva_rate
    base = (gravado / divisor).quantize(Decimal("0.01"))
    iva = (gravado - base).quantize(Decimal("0.01"))
    return (base, iva, excluido.quantize(Decimal("0.01")))


@router.get("/reinspeccion/elegibilidad/{placa}", response_model=ReinspeccionElegibilidadResponse)
def consultar_elegibilidad_reinspeccion(
    placa: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin),
):
    placa_upper = (placa or "").strip().upper()
    if len(placa_upper) < 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Placa inválida")

    latest = (
        db.query(VehiculoProceso)
        .filter(
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.placa == placa_upper,
        )
        .order_by(VehiculoProceso.fecha_registro.desc())
        .first()
    )
    if not latest:
        return ReinspeccionElegibilidadResponse(
            placa=placa_upper,
            tiene_historial=False,
            elegible_reingreso=False,
            motivo="Sin historial previo para esta placa en el CDA.",
        )

    origen = latest
    if latest.reinspeccion_origen_id is not None:
        origen = (
            db.query(VehiculoProceso)
            .filter(
                VehiculoProceso.id == latest.reinspeccion_origen_id,
                VehiculoProceso.tenant_id == current_user.tenant_id,
            )
            .first()
            or latest
        )
    ctx = _build_reinspeccion_context_for_origen(
        db,
        tenant_id=current_user.tenant_id,
        origen=origen,
    )
    return ReinspeccionElegibilidadResponse(
        placa=placa_upper,
        tiene_historial=True,
        elegible_reingreso=bool(ctx["elegible"]),
        motivo=ctx["motivo"],
        vehiculo_origen_id=ctx["origen"].id,
        primer_intento_at=ctx["primer_intento_at"],
        ultimo_intento_at=ctx["ultimo_intento_at"],
        intentos_usados=ctx["intentos_usados"],
        intentos_totales_permitidos=REINSPECCION_MAX_INTENTOS,
        intentos_restantes=ctx["intentos_restantes"],
        vence_at=ctx["vence_at"],
    )


@router.post("/registrar", response_model=VehiculoResponse, status_code=status.HTTP_201_CREATED)
def registrar_vehiculo(
    vehiculo_data: VehiculoRegistro,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Registrar vehículo (Recepción)
    """
    # Validar que no exista vehículo con la misma placa en proceso
    placa_upper = (vehiculo_data.placa or "").strip().upper()
    vehiculo_existente = db.query(VehiculoProceso).filter(
        and_(
            VehiculoProceso.placa == placa_upper,
            VehiculoProceso.tenant_id == current_user.tenant_id,
            VehiculoProceso.estado.in_([EstadoVehiculo.REGISTRADO, EstadoVehiculo.PAGADO])
        )
    ).first()
    
    if vehiculo_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe un vehículo con placa {placa_upper} en estado {vehiculo_existente.estado}"
        )

    es_reingreso = bool(vehiculo_data.es_reingreso_rechazo_inicial)
    reinspeccion_ctx: dict[str, Any] | None = None
    if es_reingreso:
        if vehiculo_data.reinspeccion_vehiculo_origen_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes seleccionar el intento original para registrar una reinspección.",
            )
        origen = (
            db.query(VehiculoProceso)
            .filter(
                VehiculoProceso.id == vehiculo_data.reinspeccion_vehiculo_origen_id,
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.placa == placa_upper,
            )
            .first()
        )
        if not origen:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró el intento inicial de reinspección para esta placa.",
            )
        reinspeccion_ctx = _build_reinspeccion_context_for_origen(
            db, tenant_id=current_user.tenant_id, origen=origen
        )
        if not reinspeccion_ctx["elegible"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=reinspeccion_ctx["motivo"] or "Esta placa no es elegible para reinspección sin cobro.",
            )
    else:
        # Si existe caso elegible de reinspección, obligamos a confirmarlo explícitamente.
        # Excepción: para servicios PREVENTIVA no forzamos flujo de reinspección RTM.
        latest = (
            db.query(VehiculoProceso)
            .filter(
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.placa == placa_upper,
            )
            .order_by(VehiculoProceso.fecha_registro.desc())
            .first()
        )
        if latest:
            origen = latest
            if latest.reinspeccion_origen_id is not None:
                origen = (
                    db.query(VehiculoProceso)
                    .filter(
                        VehiculoProceso.id == latest.reinspeccion_origen_id,
                        VehiculoProceso.tenant_id == current_user.tenant_id,
                    )
                    .first()
                    or latest
                )
            preview_ctx = _build_reinspeccion_context_for_origen(
                db, tenant_id=current_user.tenant_id, origen=origen
            )
            if preview_ctx["elegible"] and vehiculo_data.tipo_vehiculo != "preventiva":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Esta placa tiene reinspección elegible (sin cobro). "
                        "Confirma 'reingreso por rechazo inicial' para continuar."
                    ),
                )
    
    tiene_soat_final = vehiculo_data.tiene_soat
    estado_inicial = EstadoVehiculo.REGISTRADO
    # Reingreso por rechazo: sin cobro, conserva trazabilidad de intentos.
    if es_reingreso and reinspeccion_ctx is not None:
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        intento_actual = int(reinspeccion_ctx["intentos_usados"]) + 1
        tiene_soat_final = False
    # Pruebas de auditoría: flujo operativo, sin cobro ni SOAT.
    elif _es_prueba_auditoria(vehiculo_data.tipo_vehiculo):
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        tiene_soat_final = False
    # Si es PREVENTIVA, no calcular tarifa (se define en Caja)
    elif vehiculo_data.tipo_vehiculo == "preventiva":
        # PREVENTIVA: valor se define manualmente en Caja
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        
        # SOAT puede aplicar o no en preventiva
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == "carro",  # Por defecto carro para preventiva
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
                total_cobrado = comision_soat  # Solo SOAT por ahora, preventiva se suma en Caja
    else:
        # Calcular tarifa según tipo y antigüedad (RTM normal)
        tarifa = calcular_tarifa_por_antiguedad(
            vehiculo_data.ano_modelo,
            vehiculo_data.tipo_vehiculo,
            current_user.tenant_id,
            db
        )
        valor_rtm = tarifa.valor_total
        
        # Obtener comisión SOAT si aplica
        comision_soat = Decimal(0)
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo_data.tipo_vehiculo)
            
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == tipo_comision,
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
        
        total_cobrado = valor_rtm + comision_soat
    
    # Crear vehículo en proceso
    cliente_email_normalizado = str(vehiculo_data.cliente_email).strip().lower()
    nuevo_vehiculo = VehiculoProceso(
        tenant_id=current_user.tenant_id,
        sucursal_id=active_sucursal_id,
        placa=placa_upper,
        tipo_vehiculo=vehiculo_data.tipo_vehiculo,
        marca=vehiculo_data.marca,
        modelo=vehiculo_data.modelo,
        ano_modelo=vehiculo_data.ano_modelo,
        cliente_nombre=vehiculo_data.cliente_nombre,
        cliente_tipo_documento=vehiculo_data.cliente_tipo_documento,
        cliente_documento=vehiculo_data.cliente_documento,
        cliente_telefono=vehiculo_data.cliente_telefono,
        cliente_email=cliente_email_normalizado,
        cliente_direccion=vehiculo_data.cliente_direccion,
        cliente_factus_municipality_id=vehiculo_data.cliente_factus_municipality_id,
        valor_rtm=valor_rtm,
        tiene_soat=(
            tiene_soat_final
            if (es_reingreso and reinspeccion_ctx is not None) or _es_prueba_auditoria(vehiculo_data.tipo_vehiculo)
            else vehiculo_data.tiene_soat
        ),
        comision_soat=comision_soat,
        total_cobrado=total_cobrado,
        estado=estado_inicial,
        observaciones=vehiculo_data.observaciones,
        recepcion_formato_extra_json=vehiculo_data.recepcion_formato_extra,
        reinspeccion_origen_id=(reinspeccion_ctx["origen"].id if es_reingreso and reinspeccion_ctx is not None else None),
        reinspeccion_intento=(intento_actual if es_reingreso and reinspeccion_ctx is not None else 1),
        reinspeccion_vence_at=(reinspeccion_ctx["vence_at"] if es_reingreso and reinspeccion_ctx is not None else None),
        reinspeccion_exenta=bool(es_reingreso and reinspeccion_ctx is not None),
        registrado_por=current_user.id,
    )
    
    db.add(nuevo_vehiculo)
    db.commit()
    db.refresh(nuevo_vehiculo)

    # Notificación opcional por email al cliente (no bloquea el flujo de recepción).
    if cliente_email_normalizado:
        try:
            tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
            nombre_cda = (
                tenant.nombre_comercial
                if tenant and tenant.nombre_comercial
                else (tenant.nombre if tenant else "CDASOFT")
            )
            asunto = f"Bienvenido a {nombre_cda}"
            correo_cda = (
                (tenant.correo_electronico or "").strip()
                if tenant
                else ""
            )
            cuerpo_html = generar_email_bienvenida_recepcion_cliente(
                nombre_cda=nombre_cda,
                placa_vehiculo=placa_upper,
                correo_contacto_cda=correo_cda or None,
            )
            adjuntos: list[tuple[str, bytes, str]] = []
            try:
                ahora_utc = datetime.now(timezone.utc)
                pdf_bytes = generar_habeas_autorizacion_pdf(
                    nombre_cda=nombre_cda,
                    nit_cda=tenant.nit_cda if tenant else None,
                    correo_cda=correo_cda or None,
                    celular_cda=(tenant.celular or "").strip() if tenant else None,
                    direccion_cda=(tenant.direccion_facturacion or "").strip() if tenant else None,
                    tenant_logo_url=(tenant.logo_url or "").strip() if tenant else None,
                    cliente_nombre=nuevo_vehiculo.cliente_nombre or "",
                    cliente_documento=nuevo_vehiculo.cliente_documento or "",
                    placa=placa_upper,
                    cliente_email=cliente_email_normalizado,
                    momento_aceptacion_utc=ahora_utc,
                )
                placa_fn = re.sub(r"[^A-Za-z0-9_-]+", "", placa_upper) or "vehiculo"
                adjuntos.append(
                    (
                        f"Autorizacion-datos-personales-{placa_fn}.pdf",
                        pdf_bytes,
                        "application/pdf",
                    )
                )
            except Exception as pdf_err:
                print(
                    f"[WARN] No se pudo generar PDF habeas data (correo se envía sin adjunto): {pdf_err}",
                    flush=True,
                )
                traceback.print_exc()

            enviar_email_con_adjuntos(
                cliente_email_normalizado,
                asunto,
                cuerpo_html,
                adjuntos,
            )
        except Exception as e:
            print(f"[WARN] No se pudo enviar email de recepción al cliente: {e}")
    
    return nuevo_vehiculo


@router.put("/{vehiculo_id}", response_model=VehiculoResponse)
def editar_vehiculo(
    vehiculo_id: str,
    vehiculo_data: VehiculoEdicion,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_recepcionista_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Editar vehículo registrado (solo antes de cobrar)
    """
    # Buscar vehículo
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vehiculo_id).first()

    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    # Validar que esté en estado REGISTRADO (no cobrado)
    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede editar un vehículo en estado {vehiculo.estado}. Solo se pueden editar vehículos registrados."
        )
    
    # Si cambió la placa, validar que no exista otra con la misma placa
    placa_upper = (vehiculo_data.placa or "").strip().upper()
    if placa_upper != vehiculo.placa:
        vehiculo_existente = db.query(VehiculoProceso).filter(
            and_(
                VehiculoProceso.placa == placa_upper,
                VehiculoProceso.id != vehiculo_id,
                VehiculoProceso.tenant_id == current_user.tenant_id,
                VehiculoProceso.estado.in_([EstadoVehiculo.REGISTRADO, EstadoVehiculo.PAGADO])
            )
        ).first()
        
        if vehiculo_existente:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ya existe otro vehículo con placa {placa_upper} en estado {vehiculo_existente.estado}"
            )
    
    # Pruebas de auditoría: sin cobro ni SOAT.
    if _es_prueba_auditoria(vehiculo_data.tipo_vehiculo):
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        vehiculo_data.tiene_soat = False
    # Si es PREVENTIVA, no calcular tarifa
    elif vehiculo_data.tipo_vehiculo == "preventiva":
        valor_rtm = Decimal(0)
        comision_soat = Decimal(0)
        total_cobrado = Decimal(0)
        
        # SOAT puede aplicar o no en preventiva
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == "carro",
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
                total_cobrado = comision_soat
    else:
        # REUTILIZAR LÓGICA DE REGISTRO: Calcular tarifa según tipo y antigüedad
        tarifa = calcular_tarifa_por_antiguedad(
            vehiculo_data.ano_modelo,
            vehiculo_data.tipo_vehiculo,
            current_user.tenant_id,
            db
        )
        valor_rtm = tarifa.valor_total
        
        # REUTILIZAR LÓGICA DE REGISTRO: Obtener comisión SOAT si aplica
        comision_soat = Decimal(0)
        if vehiculo_data.tiene_soat:
            hoy = date.today()
            tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo_data.tipo_vehiculo)
            
            comision = db.query(ComisionSOAT).filter(
                and_(
                    ComisionSOAT.tipo_vehiculo == tipo_comision,
                    ComisionSOAT.tenant_id == current_user.tenant_id,
                    ComisionSOAT.activa == True,
                    ComisionSOAT.vigencia_inicio <= hoy,
                    (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                )
            ).first()
            
            if comision:
                comision_soat = comision.valor_comision
        
        total_cobrado = valor_rtm + comision_soat
    
    # Actualizar vehículo
    vehiculo.placa = placa_upper
    vehiculo.tipo_vehiculo = vehiculo_data.tipo_vehiculo
    vehiculo.marca = vehiculo_data.marca
    vehiculo.modelo = vehiculo_data.modelo
    vehiculo.ano_modelo = vehiculo_data.ano_modelo
    vehiculo.cliente_nombre = vehiculo_data.cliente_nombre
    vehiculo.cliente_tipo_documento = vehiculo_data.cliente_tipo_documento
    vehiculo.cliente_documento = vehiculo_data.cliente_documento
    vehiculo.cliente_telefono = vehiculo_data.cliente_telefono
    vehiculo.cliente_email = str(vehiculo_data.cliente_email).strip().lower()
    vehiculo.cliente_direccion = vehiculo_data.cliente_direccion
    vehiculo.cliente_factus_municipality_id = vehiculo_data.cliente_factus_municipality_id
    vehiculo.tiene_soat = False if _es_prueba_auditoria(vehiculo_data.tipo_vehiculo) else vehiculo_data.tiene_soat
    vehiculo.observaciones = vehiculo_data.observaciones
    vehiculo.recepcion_formato_extra_json = vehiculo_data.recepcion_formato_extra
    
    # Actualizar tarifas (RECALCULADAS)
    vehiculo.valor_rtm = valor_rtm
    vehiculo.comision_soat = comision_soat
    vehiculo.total_cobrado = total_cobrado
    
    db.commit()
    db.refresh(vehiculo)
    
    return vehiculo


@router.get("/pendientes", response_model=VehiculosPendientes)
def listar_pendientes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Listar vehículos pendientes de pago (para Caja)
    """
    vehiculos = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.estado == EstadoVehiculo.REGISTRADO).order_by(VehiculoProceso.fecha_registro).all()

    return VehiculosPendientes(
        vehiculos=vehiculos,
        total=len(vehiculos)
    )


@router.post("/{vehiculo_id}/notificar-paso-caja")
def notificar_paso_caja(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Notificar por email al cliente para pasar a caja.
    No bloquea la operación de cobro si el envío falla.
    """
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vehiculo_id).first()
    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado",
        )

    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        return {
            "sent": False,
            "has_email": bool(vehiculo.cliente_email),
            "message": "El vehículo ya no está en estado pendiente de cobro.",
        }

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return {
            "sent": False,
            "has_email": False,
            "message": "El cliente no tiene correo electrónico registrado.",
        }

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )

    asunto = f"{nombre_cda} - Te invitamos a pasar a caja"
    cuerpo_html = generar_email_llamado_caja_cliente(
        nombre_cda=nombre_cda,
        nombre_cliente=vehiculo.cliente_nombre,
    )
    sent = enviar_email(cliente_email, asunto, cuerpo_html)

    return {
        "sent": bool(sent),
        "has_email": True,
        "message": "Notificación enviada al cliente." if sent else "No fue posible enviar la notificación.",
    }


@router.post("/{vehiculo_id}/enviar-recibo-email")
async def enviar_recibo_pago_email(
    vehiculo_id: str,
    receipt_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """Envía por email el recibo PDF generado en caja para el vehículo indicado."""
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vehiculo_id).first()
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    cliente_email = (vehiculo.cliente_email or "").strip().lower()
    if not cliente_email:
        return {
            "sent": False,
            "has_email": False,
            "message": "El cliente no tiene correo electrónico registrado.",
        }

    content = await receipt_file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo de recibo está vacío")

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )

    fe = (
        db.query(FacturaElectronica)
        .filter(FacturaElectronica.vehiculo_proceso_id == vehiculo.id)
        .order_by(FacturaElectronica.created_at.desc())
        .first()
    )
    factura_url = (fe.public_url or "").strip() if fe else None
    factura_numero = (fe.numero_documento or vehiculo.numero_factura_dian or "").strip() or None
    factura_pdf: bytes | None = None
    if factura_url:
        factura_pdf = _try_download_factura_pdf_desde_url_publica(factura_url)

    factura_pdf_adjunto = factura_pdf is not None
    email_html = generar_email_recibo_pago_cliente(
        nombre_cda=nombre_cda,
        nombre_cliente=vehiculo.cliente_nombre,
        placa_vehiculo=vehiculo.placa,
        factura_url=factura_url if factura_url else None,
        factura_numero=factura_numero,
        factura_pdf_adjunto=factura_pdf_adjunto,
    )
    filename = receipt_file.filename or f"recibo_pago_{vehiculo.placa}.pdf"
    adjuntos: list[tuple[str, bytes, str]] = [(filename, content, "application/pdf")]
    if factura_pdf is not None:
        fn_fac = f"factura_electronica_{(factura_numero or vehiculo.placa).replace(' ', '_')}.pdf"
        adjuntos.append((fn_fac[:120], factura_pdf, "application/pdf"))

    asunto = f"Recibo de pago - {nombre_cda} - {vehiculo.placa}"
    if factura_url or factura_pdf_adjunto:
        asunto = f"Recibo y factura electrónica - {nombre_cda} - {vehiculo.placa}"

    sent = enviar_email_con_adjuntos(
        destinatario=cliente_email,
        asunto=asunto,
        cuerpo_html=email_html,
        adjuntos=adjuntos,
    )
    return {
        "sent": bool(sent),
        "has_email": True,
        "factura_incluida": bool(factura_url or factura_pdf_adjunto),
        "factura_adjunto_pdf": factura_pdf_adjunto,
        "message": "Recibo enviado al cliente." if sent else "No fue posible enviar el recibo por correo.",
    }


@router.post("/cobrar", response_model=VehiculoResponse)
def cobrar_vehiculo(
    request: Request,
    cobro_data: VehiculoCobro,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Cobrar vehículo (Caja)
    """
    vehiculo_query = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == cobro_data.vehiculo_id)

    # Blindaje de concurrencia:
    # si dos cajas intentan cobrar el mismo vehículo al tiempo, en PostgreSQL
    # usamos lock NOWAIT para que solo una continúe y la otra reciba error controlado.
    try:
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            vehiculo_query = vehiculo_query.with_for_update(nowait=True)
        else:
            vehiculo_query = vehiculo_query.with_for_update()
        vehiculo = vehiculo_query.first()
    except OperationalError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este vehículo está siendo cobrado en otra caja en este momento. "
                "Actualiza la lista e intenta de nuevo en unos segundos."
            ),
        )

    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    if vehiculo.estado != EstadoVehiculo.REGISTRADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Vehículo ya está en estado: {vehiculo.estado}"
        )
    es_reinspeccion_exenta = bool(getattr(vehiculo, "reinspeccion_exenta", False))
    es_prueba_auditoria = _es_prueba_auditoria(getattr(vehiculo, "tipo_vehiculo", None))
    es_cobro_exento = es_reinspeccion_exenta or es_prueba_auditoria
    metodo_pago = (
        "reinspeccion_exenta"
        if es_reinspeccion_exenta
        else (
            "auditoria_exenta"
            if es_prueba_auditoria
            else _normalize_payment_method(cobro_data.metodo_pago)
        )
    )
    
    # Verificar que cajero tenga caja abierta
    caja_abierta = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.sucursal_id == active_sucursal_id,
            Caja.estado == EstadoCaja.ABIERTA,
        )
    ).first()

    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una caja abierta. Debes abrir caja antes de cobrar."
        )

    try:
        if es_cobro_exento:
            vehiculo.valor_rtm = Decimal(0)
            vehiculo.comision_soat = Decimal(0)
            vehiculo.total_cobrado = Decimal(0)
            vehiculo.tiene_soat = False
        # Si es PREVENTIVA y viene valor manual, actualizar
        elif vehiculo.tipo_vehiculo == "preventiva":
            if cobro_data.valor_preventiva is None or cobro_data.valor_preventiva <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Debe ingresar un valor mayor a 0 para el servicio PREVENTIVA"
                )
            if Decimal(str(cobro_data.valor_preventiva)).as_tuple().exponent < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El valor de PREVENTIVA debe ingresarse sin decimales (pesos COP enteros).",
                )
            
            # Actualizar valor RTM con el valor manual
            vehiculo.valor_rtm = cobro_data.valor_preventiva
            
            # Si tiene SOAT, agregar comisión
            comision_soat = Decimal(0)
            if cobro_data.tiene_soat:
                hoy = date.today()
                comision = db.query(ComisionSOAT).filter(
                    and_(
                        ComisionSOAT.tipo_vehiculo == "carro",
                        ComisionSOAT.tenant_id == current_user.tenant_id,
                        ComisionSOAT.activa == True,
                        ComisionSOAT.vigencia_inicio <= hoy,
                        (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                    )
                ).first()
                
                if comision:
                    comision_soat = comision.valor_comision
            
            vehiculo.tiene_soat = cobro_data.tiene_soat
            vehiculo.comision_soat = comision_soat
            vehiculo.total_cobrado = vehiculo.valor_rtm + comision_soat
        
        # Si NO es preventiva y cambió el estado de SOAT, recalcular comisión
        elif cobro_data.tiene_soat != vehiculo.tiene_soat:
            comision_soat = Decimal(0)
            if cobro_data.tiene_soat:
                hoy = date.today()
                tipo_comision = mapear_tipo_vehiculo_a_comision(vehiculo.tipo_vehiculo)
                
                comision = db.query(ComisionSOAT).filter(
                    and_(
                        ComisionSOAT.tipo_vehiculo == tipo_comision,
                        ComisionSOAT.tenant_id == current_user.tenant_id,
                        ComisionSOAT.activa == True,
                        ComisionSOAT.vigencia_inicio <= hoy,
                        (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
                    )
                ).first()
                
                if comision:
                    comision_soat = comision.valor_comision
            
            vehiculo.tiene_soat = cobro_data.tiene_soat
            vehiculo.comision_soat = comision_soat
            vehiculo.total_cobrado = vehiculo.valor_rtm + comision_soat
        
        tenant_row = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
        if tenant_row is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Tenant no encontrado",
            )

        fs = (
            db.query(TenantFactusSettings)
            .filter(TenantFactusSettings.tenant_id == current_user.tenant_id)
            .first()
        )
        modo_factus = (fs is not None and fs.modo == "factus") and not es_cobro_exento
        range_id_cobro: int | None = None
        if fs is not None and not es_cobro_exento:
            range_id_cobro = resolve_numbering_range_id_for_cobro(
                db,
                tenant_id=current_user.tenant_id,
                active_sucursal_id=active_sucursal_id,
                tenant_default_range_id=fs.default_numbering_range_id,
            )
        cred_factus_ok = (
            fs is not None and creds_complete_for_active_env(fs) and range_id_cobro is not None
        )

        tarifa_emit: Tarifa | None = None
        if es_reinspeccion_exenta:
            vehiculo.numero_factura_dian = (
                vehiculo.numero_factura_dian
                or f"REINTENTO-{vehiculo.placa}-{vehiculo.reinspeccion_intento or 2}"
            )
        elif es_prueba_auditoria:
            vehiculo.numero_factura_dian = (
                vehiculo.numero_factura_dian
                or f"AUDITORIA-{vehiculo.placa}-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
            )
        elif modo_factus:
            if not cred_factus_ok:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Modo Factus activo pero faltan credenciales del ambiente activo (pruebas o producción) "
                        "o id de rango de numeración para esta sede (Organización → sedes) o rango predeterminado del tenant en backoffice SaaS."
                    ),
                )
            try:
                validar_datos_cliente_para_factus(vehiculo)
            except ValueError as ve:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(ve),
                ) from ve
            if vehiculo.tipo_vehiculo != "preventiva":
                try:
                    t_row = calcular_tarifa_por_antiguedad(
                        vehiculo.ano_modelo,
                        vehiculo.tipo_vehiculo,
                        current_user.tenant_id,
                        db,
                    )
                    suma_t = Decimal(t_row.valor_rtm) + Decimal(t_row.valor_terceros)
                    if abs(suma_t - Decimal(vehiculo.valor_rtm)) <= Decimal("1"):
                        tarifa_emit = t_row
                except HTTPException:
                    tarifa_emit = None
            try:
                num_fe, _cufe, _url = emitir_y_persistir_factura_cobro(
                    db,
                    vehiculo=vehiculo,
                    tenant=tenant_row,
                    fs=fs,
                    active_sucursal_id=active_sucursal_id,
                    metodo_pago=metodo_pago,
                    tarifa=tarifa_emit,
                    emitido_por_usuario_id=current_user.id,
                )
                vehiculo.numero_factura_dian = num_fe
            except FactusAPIError as e:
                detail_txt = format_factus_error_for_user(e)
                code = e.status_code if e.status_code and 100 <= e.status_code < 600 else status.HTTP_502_BAD_GATEWAY
                raise HTTPException(status_code=code, detail=f"Factus: {detail_txt}") from e
            except ValueError as e:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        else:
            manual = (cobro_data.numero_factura_dian or "").strip()
            if not manual:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Debe ingresar el número de factura DIAN",
                )
            vehiculo.numero_factura_dian = manual

        # Actualizar vehículo - usar setattr para bypass el enum type checking
        vehiculo.registrado_runt = cobro_data.registrado_runt
        vehiculo.registrado_sicov = cobro_data.registrado_sicov
        vehiculo.registrado_indra = cobro_data.registrado_indra
        vehiculo.fecha_pago = datetime.now(timezone.utc)
        vehiculo.estado = EstadoVehiculo.PAGADO
        vehiculo.caja_id = caja_abierta.id
        vehiculo.cobrado_por = current_user.id
        
        # Para metodo_pago, usar UPDATE raw SQL para bypass enum type checking cuando es mixto
        from sqlalchemy import text
        if es_reinspeccion_exenta:
            vehiculo.metodo_pago = "reinspeccion_exenta"
        elif es_prueba_auditoria:
            vehiculo.metodo_pago = "auditoria_exenta"
        elif metodo_pago == "mixto":
            # Usar SQL directo para actualizar con el valor literal
            db.execute(
                text("UPDATE vehiculos_proceso SET metodo_pago = :metodo WHERE id = :vehiculo_id"),
                {"metodo": "mixto", "vehiculo_id": str(vehiculo.id)}
            )
        else:
            vehiculo.metodo_pago = MetodoPago(metodo_pago)

        # Snapshot contable de IVA por venta para reportes de provisión.
        base_iva, valor_iva, valor_excluido = _calcular_snapshot_iva_servicio(
            vehiculo=vehiculo,
            tenant_id=current_user.tenant_id,
            db=db,
            tarifa_referencia=tarifa_emit,
        )
        vehiculo.iva_base_gravable_servicio = base_iva
        vehiculo.iva_valor_servicio = valor_iva
        vehiculo.valor_excluido_servicio = valor_excluido
        
        # Crear movimientos en caja
        # IMPORTANTE: Solo el efectivo ingresa físicamente a caja
        # Tarjetas, transferencias y créditos NO ingresan a caja física
        
        # Si es PAGO MIXTO, crear múltiples movimientos
        if es_cobro_exento:
            # Reintento validado por caja: no genera ingreso ni movimiento contable.
            pass
        elif metodo_pago == "mixto":
            desglose_mixto = _validate_mixed_breakdown(cobro_data.desglose_mixto, vehiculo.total_cobrado)
            
            # Crear movimientos por cada método usado en el desglose
            # Distribuir proporcionalmente entre RTM y SOAT
            for metodo, monto_total_decimal in desglose_mixto.items():
                ingresa_efectivo = (metodo == "efectivo")
                
                # Calcular porcentaje que representa este método del total
                porcentaje = monto_total_decimal / vehiculo.total_cobrado
                
                # Distribuir proporcionalmente entre RTM y SOAT
                monto_rtm = vehiculo.valor_rtm * porcentaje
                monto_soat = vehiculo.comision_soat * porcentaje if vehiculo.comision_soat > 0 else Decimal(0)
                
                # Movimiento RTM parcial
                mov_rtm = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja_abierta.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.RTM,
                    monto=monto_rtm,
                    metodo_pago=metodo,
                    concepto=f"RTM {vehiculo.placa} ({metodo.replace('_', ' ').title()}) - {vehiculo.cliente_nombre}",
                    ingresa_efectivo=ingresa_efectivo,
                    created_by=current_user.id
                )
                db.add(mov_rtm)
                
                # Movimiento SOAT parcial (si aplica)
                if monto_soat > 0:
                    mov_soat = MovimientoCaja(
                        tenant_id=current_user.tenant_id,
                        caja_id=caja_abierta.id,
                        vehiculo_id=vehiculo.id,
                        tipo=TipoMovimiento.COMISION_SOAT,
                        monto=monto_soat,
                        metodo_pago=metodo,
                        concepto=f"Comisión SOAT {vehiculo.placa} ({metodo.replace('_', ' ').title()})",
                        ingresa_efectivo=ingresa_efectivo,
                        created_by=current_user.id
                    )
                    db.add(mov_soat)
        
        # Si NO es mixto, crear movimientos normales
        else:
            ingresa_efectivo_fisico = (metodo_pago == "efectivo")
            
            # 1. RTM
            mov_rtm = MovimientoCaja(
                tenant_id=current_user.tenant_id,
                caja_id=caja_abierta.id,
                vehiculo_id=vehiculo.id,
                tipo=TipoMovimiento.RTM,
                monto=vehiculo.valor_rtm,
                metodo_pago=metodo_pago,
                concepto=f"RTM {vehiculo.placa} - {vehiculo.cliente_nombre}",
                ingresa_efectivo=ingresa_efectivo_fisico,
                created_by=current_user.id
            )
            db.add(mov_rtm)
            
            # 2. Comisión SOAT (si aplica)
            if vehiculo.comision_soat > 0:
                mov_soat = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja_abierta.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.COMISION_SOAT,
                    monto=vehiculo.comision_soat,
                    metodo_pago=metodo_pago,
                    concepto=f"Comisión SOAT {vehiculo.placa}",
                    ingresa_efectivo=ingresa_efectivo_fisico,
                    created_by=current_user.id
                )
                db.add(mov_soat)
        
        db.commit()
        db.refresh(vehiculo)

        sarlaft_eval_result = {
            "alerts_generated": 0,
            "requires_officer_review": False,
            "alert_messages": [],
        }
        tenant_row = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
        if tenant_row and not es_cobro_exento:
            cash_amount_cop = Decimal(str(vehiculo.total_cobrado or 0))
            if metodo_pago not in {"efectivo", "mixto"}:
                cash_amount_cop = Decimal("0")
            sarlaft_eval_result = _upsert_sarlaft_en_cobro(
                db=db,
                current_user=current_user,
                tenant=tenant_row,
                active_sucursal_id=active_sucursal_id,
                vehiculo=vehiculo,
                payment_method=metodo_pago,
                transaction_amount_cop=Decimal(str(vehiculo.total_cobrado or 0)),
                cash_amount_cop=cash_amount_cop,
            )
            db.commit()

        alert_count = int(sarlaft_eval_result.get("alerts_generated") or 0)
        requires_officer = bool(sarlaft_eval_result.get("requires_officer_review"))
        if requires_officer:
            msg_suffix = f" ({alert_count} alerta{'s' if alert_count != 1 else ''})" if alert_count > 0 else ""
            alert_text = (
                "Cliente con alerta SARLAFT: remitir a Oficial de Cumplimiento para DDI obligatoria"
                f"{msg_suffix}."
            )
        else:
            alert_text = None
        setattr(vehiculo, "sarlaft_alert_generated", requires_officer)
        setattr(vehiculo, "sarlaft_alert_count", alert_count)
        setattr(vehiculo, "sarlaft_alert_message", alert_text)

        # Programar encuesta de calidad (envío diferido) sin bloquear el flujo de cobro.
        try:
            recepcionista_nombre = None
            if vehiculo.registrado_por:
                recepcionista = db.query(Usuario).filter(Usuario.id == vehiculo.registrado_por).first()
                if recepcionista:
                    recepcionista_nombre = recepcionista.nombre_completo

            sucursal_nombre_encuesta = None
            if vehiculo.sucursal_id:
                sede_row = db.query(Sucursal).filter(Sucursal.id == vehiculo.sucursal_id).first()
                if sede_row:
                    sucursal_nombre_encuesta = sede_row.nombre

            create_quality_survey_invite(
                db,
                tenant_id=current_user.tenant_id,
                vehiculo_id=vehiculo.id,
                sucursal_id=vehiculo.sucursal_id,
                sucursal_nombre=sucursal_nombre_encuesta,
                cliente_nombre=vehiculo.cliente_nombre,
                cliente_email=vehiculo.cliente_email,
                cliente_celular=vehiculo.cliente_telefono,
                placa=vehiculo.placa,
                tipo_vehiculo=vehiculo.tipo_vehiculo,
                cajero_nombre=current_user.nombre_completo,
                recepcionista_nombre=recepcionista_nombre,
                send_delay_hours=3,
                expires_in_days=7,
            )
            db.commit()
        except Exception as quality_exc:
            db.rollback()
            print(f"[WARN] No se pudo programar encuesta de calidad: {quality_exc}")

        # Programar recordatorio de próxima RTM (no bloquea flujo de cobro).
        try:
            schedule_rtm_renewal_reminder_for_vehicle(db, vehiculo)
            db.commit()
        except Exception as reminder_exc:
            db.rollback()
            print(f"[WARN] No se pudo programar recordatorio de próxima RTM: {reminder_exc}")

        from app.utils.audit import audit_caja_operation
        from app.models.audit_log import AuditAction
        audit_desc = (
            f"Reintento validado en caja: {vehiculo.placa} (sin cobro)"
            if es_reinspeccion_exenta
            else (
                f"Prueba de auditoría validada en caja: {vehiculo.placa} (sin cobro)"
                if es_prueba_auditoria
                else f"Cobro registrado: {vehiculo.placa} por ${vehiculo.total_cobrado} ({metodo_pago})"
            )
        )
        audit_caja_operation(
            db=db,
            action=AuditAction.UPDATE_VEHICLE,
            description=audit_desc,
            usuario=current_user,
            request=request,
            metadata={
                "vehiculo_id": str(vehiculo.id),
                "caja_id": str(caja_abierta.id),
                "metodo_pago": metodo_pago,
                "monto_total": float(vehiculo.total_cobrado),
                "tiene_soat": bool(vehiculo.tiene_soat),
                "comision_soat": float(vehiculo.comision_soat or 0),
                "es_pago_mixto": metodo_pago == "mixto",
                "reinspeccion_exenta": es_reinspeccion_exenta,
                "reinspeccion_intento": int(vehiculo.reinspeccion_intento or 1),
                "auditoria_exenta": es_prueba_auditoria,
            },
        )
        
        return vehiculo
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al procesar el cobro: {str(e)}"
        )


@router.post("/{vehiculo_id}/corregir-factura-emitida", response_model=CorregirFacturaEmitidaResponse)
def corregir_factura_emitida(
    vehiculo_id: UUID,
    payload: CorregirFacturaEmitidaRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    rol_actual = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    if rol_actual != "administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden corregir facturas emitidas.",
        )

    motivo = (payload.motivo or "").strip().lower()
    if motivo not in MOTIVOS_CORRECCION_FACTURA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Motivo inválido. Opciones: {', '.join(sorted(MOTIVOS_CORRECCION_FACTURA))}.",
        )

    vehiculo = (
        _filtro_vehiculo_sede(
            db.query(VehiculoProceso),
            current_user.tenant_id,
            active_sucursal_id,
        )
        .filter(VehiculoProceso.id == vehiculo_id)
        .first()
    )
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")
    if not vehiculo.fecha_pago or not vehiculo.numero_factura_dian:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo no tiene factura emitida para corregir.",
        )
    fecha_pago_co = _utc_naive_to_co_date(vehiculo.fecha_pago)
    hoy_co = _co_today_date()
    fecha_inicio_permitida = hoy_co - timedelta(days=FACTURA_CORRECCION_VENTANA_DIAS - 1)
    if not fecha_pago_co or fecha_pago_co < fecha_inicio_permitida or fecha_pago_co > hoy_co:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Solo se permiten correcciones de factura para cobros "
                f"dentro de los últimos {FACTURA_CORRECCION_VENTANA_DIAS} días."
            ),
        )
    correccion_exitosa_previa = (
        db.query(FacturaCorreccion)
        .filter(
            FacturaCorreccion.tenant_id == current_user.tenant_id,
            FacturaCorreccion.vehiculo_proceso_id == vehiculo.id,
            FacturaCorreccion.estado == "completed",
        )
        .first()
    )
    if correccion_exitosa_previa is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta factura ya fue corregida anteriormente y no admite una segunda corrección.",
        )
    correccion_fallida_con_nc = (
        db.query(FacturaCorreccion)
        .filter(
            FacturaCorreccion.tenant_id == current_user.tenant_id,
            FacturaCorreccion.vehiculo_proceso_id == vehiculo.id,
            FacturaCorreccion.estado == "failed",
            FacturaCorreccion.nota_credito_numero.isnot(None),
            FacturaCorreccion.factura_nueva_numero.is_(None),
        )
        .order_by(FacturaCorreccion.created_at.desc())
        .first()
    )
    recovery_mode = correccion_fallida_con_nc is not None

    fs = (
        db.query(TenantFactusSettings)
        .filter(TenantFactusSettings.tenant_id == current_user.tenant_id)
        .first()
    )
    if fs is None or not creds_complete_for_active_env(fs):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configure credenciales Factus completas para el ambiente activo.",
        )
    tenant_row = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    if tenant_row is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Tenant no encontrado")

    fe_original = (
        db.query(FacturaElectronica)
        .filter(
            FacturaElectronica.tenant_id == current_user.tenant_id,
            FacturaElectronica.vehiculo_proceso_id == vehiculo.id,
        )
        .order_by(FacturaElectronica.created_at.desc())
        .first()
    )
    if not fe_original:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se encontró traza de Factura Electrónica para este cobro.",
        )

    before_json = {
        "placa": vehiculo.placa,
        "cliente_nombre": vehiculo.cliente_nombre,
        "cliente_documento": vehiculo.cliente_documento,
        "cliente_email": vehiculo.cliente_email,
        "cliente_telefono": vehiculo.cliente_telefono,
        "cliente_direccion": vehiculo.cliente_direccion,
        "valor_rtm": str(Decimal(str(vehiculo.valor_rtm or 0))),
        "comision_soat": str(Decimal(str(vehiculo.comision_soat or 0))),
        "total_cobrado": str(Decimal(str(vehiculo.total_cobrado or 0))),
        "metodo_pago": str(getattr(vehiculo.metodo_pago, "value", vehiculo.metodo_pago) or ""),
        "numero_factura_dian": vehiculo.numero_factura_dian,
    }

    valor_rtm_original = Decimal(str(vehiculo.valor_rtm or 0))
    comision_soat_original = Decimal(str(vehiculo.comision_soat or 0))
    total_original = Decimal(str(vehiculo.total_cobrado or 0))
    metodo_pago_original = str(getattr(vehiculo.metodo_pago, "value", vehiculo.metodo_pago) or "").strip().lower()

    proposed_placa = (payload.nueva_placa or "").strip().upper() or vehiculo.placa
    proposed_nombre = (payload.cliente_nombre or "").strip() or vehiculo.cliente_nombre
    proposed_documento = (payload.cliente_documento or "").strip() or vehiculo.cliente_documento
    proposed_email = (
        (payload.cliente_email or "").strip().lower() if payload.cliente_email is not None else vehiculo.cliente_email
    ) or None
    proposed_telefono = (
        (payload.cliente_telefono or "").strip() if payload.cliente_telefono is not None else vehiculo.cliente_telefono
    ) or None
    proposed_direccion = (
        (payload.cliente_direccion or "").strip() if payload.cliente_direccion is not None else vehiculo.cliente_direccion
    ) or None
    proposed_valor_preventiva = valor_rtm_original
    if motivo == "valor":
        if (vehiculo.tipo_vehiculo or "").strip().lower() != "preventiva":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La corrección por valor solo aplica para servicios PREVENTIVA.",
            )
        if payload.valor_preventiva_nuevo is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes indicar el valor correcto para PREVENTIVA.",
            )
        proposed_valor_preventiva = Decimal(str(payload.valor_preventiva_nuevo))
        if proposed_valor_preventiva.as_tuple().exponent < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El valor corregido de PREVENTIVA debe enviarse sin decimales (pesos COP enteros).",
            )
        if proposed_valor_preventiva <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El valor correcto para PREVENTIVA debe ser mayor a 0.",
            )
    elif payload.valor_preventiva_nuevo is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El campo valor_preventiva_nuevo solo se permite cuando el motivo es 'valor'.",
        )
    did_change = (
        proposed_placa != vehiculo.placa
        or proposed_nombre != vehiculo.cliente_nombre
        or proposed_documento != vehiculo.cliente_documento
        or proposed_email != vehiculo.cliente_email
        or proposed_telefono != vehiculo.cliente_telefono
        or proposed_direccion != vehiculo.cliente_direccion
        or proposed_valor_preventiva != valor_rtm_original
    )
    if not did_change:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Debes ingresar un valor diferente al facturado para reemitir."
                if motivo == "valor"
                else "Debes ajustar al menos placa o datos del cliente para reemitir."
            ),
        )

    cid, sec_enc, user, pwd_enc = active_auth_encrypted(fs)
    secret = decrypt_secret(sec_enc) if sec_enc else None
    pwd = decrypt_secret(pwd_enc) if pwd_enc else None
    if not cid or not secret or not user or not pwd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudieron resolver credenciales Factus del ambiente activo.",
        )
    base = factus_base_url(use_sandbox=fs.use_sandbox)
    try:
        tok = obtain_token(
            base_url=base,
            client_id=cid,
            client_secret=secret,
            username=user,
            password=pwd,
        )
    except FactusAPIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Factus: {format_factus_error_for_user(e)}",
        ) from e
    access = tok.get("access_token")
    if not access:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Factus: token sin access_token")

    range_id_cobro = resolve_numbering_range_id_for_cobro(
        db,
        tenant_id=current_user.tenant_id,
        active_sucursal_id=active_sucursal_id,
        tenant_default_range_id=fs.default_numbering_range_id,
    )
    if not range_id_cobro:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hay rango de facturación válido para sede/tenant; no se puede reemitir.",
        )

    note_number: str | None = None
    note_id: int | None = None
    if recovery_mode:
        note_number = str(correccion_fallida_con_nc.nota_credito_numero or "") or None
        note_id = int(correccion_fallida_con_nc.nota_credito_factus_id) if correccion_fallida_con_nc.nota_credito_factus_id else None
    try:
        body_for_items = build_validate_body(
            vehiculo=vehiculo,
            tenant=tenant_row,
            db=db,
            active_sucursal_id=active_sucursal_id,
            numbering_range_id=range_id_cobro,
            metodo_pago=str(vehiculo.metodo_pago or "efectivo"),
            tarifa=None,
        )
        if not recovery_mode:
            payment_method_code = _map_metodo_pago_factus_credit_note(str(vehiculo.metodo_pago or "efectivo"))
            credit_note_body: dict[str, Any] = {
                "reference_code": f"NC-{vehiculo.id.hex[:8]}-{uuid.uuid4().hex[:8]}",
                "correction_concept_code": "2",
                "customization_id": "20",
                "observation": (payload.observacion or f"Corrección por {motivo} en CDASOFT")[:250],
                "payment_details": [
                    {
                        "payment_form": "1",
                        "payment_method_code": payment_method_code,
                        "reference_code": f"NC-{vehiculo.id.hex[:6]}",
                        "amount": str(Decimal(str(vehiculo.total_cobrado or 0))),
                    }
                ],
                "customer": body_for_items.get("customer"),
                "items": body_for_items.get("items") or [],
            }
            credit_note_range_id = _select_credit_note_range_id(fs)
            if credit_note_range_id is not None:
                credit_note_body["numbering_range_id"] = credit_note_range_id
            if fe_original.factus_bill_id is not None:
                credit_note_body["bill_id"] = int(fe_original.factus_bill_id)
            else:
                credit_note_body["bill_number"] = str(vehiculo.numero_factura_dian or "").strip()

            nc_resp = validate_credit_note(
                base_url=base,
                access_token=str(access),
                body=credit_note_body,
            )
            note_number, note_id = _coerce_credit_note_result(nc_resp if isinstance(nc_resp, dict) else {})
        vehiculo.placa = proposed_placa
        vehiculo.cliente_nombre = proposed_nombre
        vehiculo.cliente_documento = proposed_documento
        vehiculo.cliente_email = proposed_email
        vehiculo.cliente_telefono = proposed_telefono
        vehiculo.cliente_direccion = proposed_direccion
        if motivo == "valor":
            vehiculo.valor_rtm = proposed_valor_preventiva
            vehiculo.total_cobrado = proposed_valor_preventiva + comision_soat_original
        validar_datos_cliente_para_factus(vehiculo)

        nueva_numero, _, _ = emitir_y_persistir_factura_cobro(
            db,
            vehiculo=vehiculo,
            tenant=tenant_row,
            fs=fs,
            active_sucursal_id=active_sucursal_id,
            metodo_pago=str(vehiculo.metodo_pago or "efectivo"),
            tarifa=None,
            emitido_por_usuario_id=current_user.id,
        )
        vehiculo.numero_factura_dian = nueva_numero

        fe_nueva = (
            db.query(FacturaElectronica)
            .filter(
                FacturaElectronica.tenant_id == current_user.tenant_id,
                FacturaElectronica.vehiculo_proceso_id == vehiculo.id,
                FacturaElectronica.numero_documento == nueva_numero,
            )
            .order_by(FacturaElectronica.created_at.desc())
            .first()
        )
        total_nuevo = Decimal(str(vehiculo.total_cobrado or 0))
        ajuste_diferencia = (total_nuevo - total_original).quantize(Decimal("0.01"))
        if motivo == "valor" and ajuste_diferencia != Decimal("0.00"):
            if not vehiculo.caja_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No se encontró caja asociada al cobro original para registrar el ajuste.",
                )
            if metodo_pago_original in {"", "mixto", "reinspeccion_exenta", "auditoria_exenta"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No se puede aplicar ajuste automático para este método de pago original.",
                )
            db.add(
                MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=vehiculo.caja_id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.AJUSTE,
                    monto=ajuste_diferencia,
                    metodo_pago=metodo_pago_original,
                    concepto=(
                        f"Ajuste por corrección de valor PREVENTIVA {vehiculo.placa} "
                        f"(Orig: {total_original.quantize(Decimal('0.01'))} / Nuevo: {total_nuevo.quantize(Decimal('0.01'))})"
                    ),
                    ingresa_efectivo=(metodo_pago_original == "efectivo"),
                    created_by=current_user.id,
                )
            )

        db.add(
            FacturaCorreccion(
                tenant_id=current_user.tenant_id,
                vehiculo_proceso_id=vehiculo.id,
                factura_electronica_original_id=fe_original.id,
                factura_electronica_nueva_id=(fe_nueva.id if fe_nueva else None),
                motivo=motivo,
                estado="completed",
                factura_original_numero=fe_original.numero_documento or before_json.get("numero_factura_dian"),
                factura_original_factus_bill_id=fe_original.factus_bill_id,
                nota_credito_numero=note_number,
                nota_credito_factus_id=note_id,
                factura_nueva_numero=nueva_numero,
                factura_nueva_factus_bill_id=(fe_nueva.factus_bill_id if fe_nueva else None),
                before_json=json.dumps(before_json, ensure_ascii=False),
                after_json=json.dumps(
                    {
                        "placa": vehiculo.placa,
                        "cliente_nombre": vehiculo.cliente_nombre,
                        "cliente_documento": vehiculo.cliente_documento,
                        "cliente_email": vehiculo.cliente_email,
                        "cliente_telefono": vehiculo.cliente_telefono,
                        "cliente_direccion": vehiculo.cliente_direccion,
                        "valor_rtm": str(Decimal(str(vehiculo.valor_rtm or 0))),
                        "comision_soat": str(Decimal(str(vehiculo.comision_soat or 0))),
                        "total_cobrado": str(Decimal(str(vehiculo.total_cobrado or 0))),
                        "metodo_pago_ajuste": metodo_pago_original,
                        "ajuste_diferencia": str(ajuste_diferencia),
                        "numero_factura_dian": vehiculo.numero_factura_dian,
                    },
                    ensure_ascii=False,
                ),
                ejecutado_por_usuario_id=current_user.id,
            )
        )
        db.commit()
        return CorregirFacturaEmitidaResponse(
            success=True,
            vehiculo_id=str(vehiculo.id),
            factura_original=fe_original.numero_documento or before_json.get("numero_factura_dian"),
            nota_credito=note_number,
            factura_nueva=nueva_numero,
            message=(
                "Factura corregida: NC validada y factura reemitida con datos actualizados."
                if motivo != "valor"
                else (
                    "Factura corregida por valor: NC validada, factura reemitida y ajuste registrado en caja."
                    if not recovery_mode
                    else "Recuperación completada: se reutilizó NC existente y se reemitió factura con ajuste en caja."
                )
            ),
        )
    except FactusAPIError as e:
        db.rollback()
        error_text = f"Factus: {format_factus_error_for_user(e)}"
        db.add(
            FacturaCorreccion(
                tenant_id=current_user.tenant_id,
                vehiculo_proceso_id=vehiculo.id,
                factura_electronica_original_id=fe_original.id,
                motivo=motivo,
                estado="failed",
                error_detalle=error_text,
                factura_original_numero=fe_original.numero_documento or before_json.get("numero_factura_dian"),
                factura_original_factus_bill_id=fe_original.factus_bill_id,
                nota_credito_numero=note_number,
                nota_credito_factus_id=note_id,
                before_json=json.dumps(before_json, ensure_ascii=False),
                after_json=json.dumps(
                    {
                        "placa": vehiculo.placa,
                        "cliente_nombre": vehiculo.cliente_nombre,
                        "cliente_documento": vehiculo.cliente_documento,
                        "cliente_email": vehiculo.cliente_email,
                        "cliente_telefono": vehiculo.cliente_telefono,
                        "cliente_direccion": vehiculo.cliente_direccion,
                    },
                    ensure_ascii=False,
                ),
                ejecutado_por_usuario_id=current_user.id,
            )
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=error_text) from e
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No fue posible completar la corrección de factura: {e}",
        ) from e


@router.get("/{vehiculo_id}/factura-correcciones", response_model=List[FacturaCorreccionHistorialItem])
def listar_correcciones_factura_emitida(
    vehiculo_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    vehiculo = (
        _filtro_vehiculo_sede(
            db.query(VehiculoProceso),
            current_user.tenant_id,
            active_sucursal_id,
        )
        .filter(VehiculoProceso.id == vehiculo_id)
        .first()
    )
    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    rows = (
        db.query(FacturaCorreccion)
        .filter(
            FacturaCorreccion.tenant_id == current_user.tenant_id,
            FacturaCorreccion.vehiculo_proceso_id == vehiculo.id,
        )
        .order_by(FacturaCorreccion.created_at.desc())
        .all()
    )

    return [
        FacturaCorreccionHistorialItem(
            id=str(r.id),
            estado=str(r.estado or ""),
            motivo=str(r.motivo or ""),
            error_detalle=r.error_detalle,
            factura_original=r.factura_original_numero,
            nota_credito=r.nota_credito_numero,
            factura_nueva=r.factura_nueva_numero,
            ejecutado_por_usuario_id=(str(r.ejecutado_por_usuario_id) if r.ejecutado_por_usuario_id else None),
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/venta-soat", response_model=VehiculoResponse, status_code=status.HTTP_201_CREATED)
def venta_solo_soat(
    venta_data: VentaSOAT,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Venta solo de comisión SOAT (sin revisión técnica)
    Cliente compra SOAT pero NO hace revisión. Solo se cobra comisión.
    """
    # Verificar que cajero tenga caja abierta
    caja_abierta = db.query(Caja).filter(
        and_(
            Caja.usuario_id == current_user.id,
            Caja.tenant_id == current_user.tenant_id,
            Caja.sucursal_id == active_sucursal_id,
            Caja.estado == EstadoCaja.ABIERTA,
        )
    ).first()

    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tienes una caja abierta. Debes abrir caja antes de registrar ventas."
        )

    placa_upper = (venta_data.placa or "").strip().upper()
    
    # Obtener comisión SOAT desde la base de datos
    hoy = date.today()
    comision = db.query(ComisionSOAT).filter(
        and_(
            ComisionSOAT.tipo_vehiculo == venta_data.tipo_vehiculo,
            ComisionSOAT.tenant_id == current_user.tenant_id,
            ComisionSOAT.activa == True,
            ComisionSOAT.vigencia_inicio <= hoy,
            (ComisionSOAT.vigencia_fin >= hoy) | (ComisionSOAT.vigencia_fin == None)
        )
    ).first()
    
    if not comision:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró comisión SOAT vigente para tipo '{venta_data.tipo_vehiculo}'"
        )
    
    comision_soat = comision.valor_comision
    
    try:
        # Crear vehículo con estado PAGADO (no pasa por recepción ni inspección)
        vehiculo_soat = VehiculoProceso(
            tenant_id=current_user.tenant_id,
            sucursal_id=active_sucursal_id,
            placa=placa_upper,
            tipo_vehiculo=venta_data.tipo_vehiculo,
            marca=None,
            modelo=None,
            ano_modelo=datetime.now().year,  # Año actual por defecto
            cliente_nombre=venta_data.cliente_nombre,
            cliente_tipo_documento="CC",
            cliente_documento=venta_data.cliente_documento,
            cliente_telefono=None,
            valor_rtm=Decimal(0),  # NO hay revisión
            tiene_soat=True,
            comision_soat=comision_soat,
            total_cobrado=comision_soat,  # Solo se cobra la comisión
            metodo_pago=MetodoPago(venta_data.metodo_pago),
            numero_factura_dian=None,  # Venta de SOAT no requiere factura DIAN
            registrado_runt=False,
            registrado_sicov=False,
            registrado_indra=False,
            fecha_pago=datetime.now(timezone.utc),
            estado=EstadoVehiculo.PAGADO,  # Directo a pagado
            observaciones=f"Venta solo SOAT - Valor comercial: ${venta_data.valor_soat_comercial}",
            caja_id=caja_abierta.id,
            registrado_por=current_user.id,
            cobrado_por=current_user.id
        )
        
        db.add(vehiculo_soat)
        db.flush()  # Para obtener el ID del vehículo
        
        # Crear movimiento en caja
        ingresa_efectivo_fisico = (venta_data.metodo_pago == "efectivo")
        
        mov_soat = MovimientoCaja(
            tenant_id=current_user.tenant_id,
            caja_id=caja_abierta.id,
            vehiculo_id=vehiculo_soat.id,
            tipo=TipoMovimiento.COMISION_SOAT,
            monto=comision_soat,
            metodo_pago=venta_data.metodo_pago,
            concepto=f"Venta SOAT {placa_upper} - Comisión",
            ingresa_efectivo=ingresa_efectivo_fisico,
            created_by=current_user.id
        )
        db.add(mov_soat)
        
        db.commit()
        db.refresh(vehiculo_soat)
        
        return vehiculo_soat
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al registrar venta de SOAT: {str(e)}"
        )


@router.get("/cobrados-hoy", response_model=List[VehiculoCobradoHoyResponse])
def listar_cobrados_hoy(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Listar vehículos cobrados hoy (día Colombia) en la sede activa.
    - Administrador: ve todos los cobros de la sede.
    - Cajero: ve los cobros que él mismo realizó en la sede.
    Esto evita perder visibilidad de cobros de la mañana cuando una caja se cerró
    y se abrió una nueva en el mismo día.
    """
    current_role = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    inicio_hoy_utc, fin_hoy_utc = _co_day_utc_bounds(_co_today_date())

    base_query = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(
        and_(
            VehiculoProceso.estado.in_(ESTADOS_COBRO_EFECTIVO),
            VehiculoProceso.fecha_pago >= inicio_hoy_utc,
            VehiculoProceso.fecha_pago < fin_hoy_utc,
        )
    )

    if current_role == "administrador":
        vehiculos = (
            base_query
            .order_by(VehiculoProceso.fecha_pago.desc())
            .limit(MAX_COBRADOS_HOY_RESPONSE)
            .all()
        )
    else:
        vehiculos = (
            base_query
            .filter(VehiculoProceso.cobrado_por == current_user.id)
            .order_by(VehiculoProceso.fecha_pago.desc())
            .limit(MAX_COBRADOS_HOY_RESPONSE)
            .all()
        )

    corrections = _latest_factura_correcciones_by_vehiculo(
        db,
        current_user.tenant_id,
        [v.id for v in vehiculos],
    )
    return [
        _build_vehiculo_cobrado_hoy_response(
            vehiculo,
            correccion=corrections.get(vehiculo.id),
        )
        for vehiculo in vehiculos
    ]


@router.put("/{vehiculo_id}/cambiar-metodo-pago")
def cambiar_metodo_pago(
    vehiculo_id: str,
    nuevo_metodo: str,
    motivo: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_or_admin),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Cambiar método de pago de un vehículo ya cobrado
    - Solo si el vehículo está PAGADO
    - Solo si la caja está ABIERTA
    - Solo el mismo día del cobro
    - Requiere motivo obligatorio
    """
    # Validar motivo
    if not motivo or len(motivo.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El motivo debe tener al menos 10 caracteres"
        )
    
    # Validar nuevo método de pago
    nuevo_metodo_normalizado = _normalize_payment_method(nuevo_metodo)
    if nuevo_metodo_normalizado == "mixto":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede cambiar a método 'mixto'. El pago mixto solo es válido al momento del cobro inicial."
        )
    
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vehiculo_id).first()

    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )
    
    # Validar que esté en una etapa posterior al cobro
    if vehiculo.estado not in ESTADOS_COBRO_EFECTIVO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo se puede cambiar el método de pago de vehículos cobrados. Estado actual: {vehiculo.estado}"
        )
    
    # Validar que tenga caja asociada
    if not vehiculo.caja_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo no tiene caja asociada"
        )
    
    # Obtener caja
    caja = db.query(Caja).filter(
        Caja.id == vehiculo.caja_id,
        Caja.tenant_id == current_user.tenant_id,
        Caja.sucursal_id == active_sucursal_id,
    ).first()
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caja no encontrada"
        )
    
    # Validar que la caja esté abierta
    if caja.estado != EstadoCaja.ABIERTA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La caja ya está cerrada. No se puede modificar el método de pago"
        )

    # Ownership: cajero solo puede modificar cobros de su caja.
    # Admin del tenant sí puede intervenir.
    current_role = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    if current_role != "administrador" and caja.usuario_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el cajero propietario de la caja puede cambiar el método de pago de este cobro",
        )
    
    # Validar que sea el mismo día
    hoy = _co_today_date()
    fecha_pago = _utc_naive_to_co_date(vehiculo.fecha_pago)
    if fecha_pago != hoy:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede cambiar el método de pago el mismo día del cobro"
        )
    
    # Buscar movimientos de caja de este vehículo
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja_id == caja.id,
            MovimientoCaja.tenant_id == current_user.tenant_id,
            MovimientoCaja.vehiculo_id == vehiculo.id
        )
    ).all()
    
    if not movimientos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontraron movimientos asociados a este vehículo"
        )
    
    # Guardar método anterior para auditoría
    metodo_anterior = vehiculo.metodo_pago
    if (metodo_anterior or "").lower() == nuevo_metodo_normalizado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nuevo método de pago es igual al método actual",
        )
    
    try:
        # Actualizar método de pago en vehículo
        vehiculo.metodo_pago = nuevo_metodo_normalizado
        
        # CASO ESPECIAL: Si el método anterior era MIXTO
        # Consolidar todos los movimientos en uno solo con el nuevo método
        if metodo_anterior == "mixto":
            # 1. ELIMINAR todos los movimientos mixtos
            for movimiento in movimientos:
                db.delete(movimiento)
            
            # 2. CREAR movimientos consolidados con el nuevo método
            ingresa_efectivo = (nuevo_metodo_normalizado == "efectivo")
            
            # Movimiento RTM consolidado
            mov_rtm = MovimientoCaja(
                tenant_id=current_user.tenant_id,
                caja_id=caja.id,
                vehiculo_id=vehiculo.id,
                tipo=TipoMovimiento.RTM,
                monto=vehiculo.valor_rtm,
                metodo_pago=nuevo_metodo_normalizado,
                concepto=f"RTM {vehiculo.placa} (Cambio de mixto a {nuevo_metodo_normalizado}) - {vehiculo.cliente_nombre}",
                ingresa_efectivo=ingresa_efectivo,
                created_by=current_user.id
            )
            db.add(mov_rtm)
            
            # Movimiento SOAT consolidado (si aplica)
            if vehiculo.comision_soat > 0:
                mov_soat = MovimientoCaja(
                    tenant_id=current_user.tenant_id,
                    caja_id=caja.id,
                    vehiculo_id=vehiculo.id,
                    tipo=TipoMovimiento.COMISION_SOAT,
                    monto=vehiculo.comision_soat,
                    metodo_pago=nuevo_metodo_normalizado,
                    concepto=f"Comisión SOAT {vehiculo.placa} (Cambio de mixto a {nuevo_metodo_normalizado})",
                    ingresa_efectivo=ingresa_efectivo,
                    created_by=current_user.id
                )
                db.add(mov_soat)
        
        # CASO NORMAL: Cambio entre métodos simples
        else:
            # Actualizar cada movimiento existente
            for movimiento in movimientos:
                movimiento.metodo_pago = nuevo_metodo_normalizado
                
                # Ajustar ingresa_efectivo según nuevo método
                # SOLO el efectivo ingresa físicamente a caja
                if nuevo_metodo_normalizado == "efectivo":
                    movimiento.ingresa_efectivo = True
                else:
                    movimiento.ingresa_efectivo = False

        db.commit()

        # Registrar en auditoría (fuera de transacción principal)
        from app.utils.audit import audit_caja_operation
        from app.models.audit_log import AuditAction
        audit_caja_operation(
            db=db,
            action=AuditAction.UPDATE_VEHICLE,
            description=f"Cambio de método de pago: {metodo_anterior} → {nuevo_metodo_normalizado}. Motivo: {motivo}",
            usuario=current_user,
            request=request,
            metadata={
                "vehiculo_id": str(vehiculo.id),
                "placa": vehiculo.placa,
                "caja_id": str(caja.id),
                "metodo_anterior": metodo_anterior,
                "metodo_nuevo": nuevo_metodo_normalizado,
                "motivo": motivo.strip(),
                "movimientos_afectados": len(movimientos),
                "era_mixto": metodo_anterior == "mixto",
            },
        )
        
        return {
            "success": True,
            "message": "Método de pago actualizado exitosamente",
            "metodo_anterior": metodo_anterior,
            "metodo_nuevo": nuevo_metodo_normalizado,
            "vehiculo_id": str(vehiculo.id),
            "placa": vehiculo.placa
        }
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al cambiar método de pago: {str(e)}"
        )


@router.get("/calcular-tarifa/{ano_modelo}", response_model=TarifaCalculada)
def calcular_tarifa(
    ano_modelo: int,
    tipo_vehiculo: str = 'moto',  # Por defecto moto para retrocompatibilidad
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Calcular tarifa para un vehículo según su año de modelo y tipo
    """
    if _es_prueba_auditoria(tipo_vehiculo):
        return TarifaCalculada(
            valor_rtm=Decimal("0"),
            valor_terceros=Decimal("0"),
            valor_total=Decimal("0"),
            descripcion_antiguedad="Pruebas de auditoría (sin cobro)",
        )

    tarifa = calcular_tarifa_por_antiguedad(ano_modelo, tipo_vehiculo, current_user.tenant_id, db)
    ano_actual = datetime.now().year
    antiguedad = ano_actual - ano_modelo
    
    # Calcular descripción de antigüedad
    if tarifa.antiguedad_max:
        descripcion = f"{tarifa.antiguedad_min}-{tarifa.antiguedad_max} años"
    else:
        descripcion = f"{tarifa.antiguedad_min}+ años"
    
    return TarifaCalculada(
        valor_rtm=tarifa.valor_rtm,
        valor_terceros=tarifa.valor_terceros,
        valor_total=tarifa.valor_total,
        descripcion_antiguedad=descripcion
    )


@router.get("/{vehiculo_id}/recibo-pdf")
def descargar_recibo_pago_pdf(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    PDF del recibo de pago estándar (mismo criterio que en caja / reportes).
    Solo trámites ya cobrados (estado pagado).
    """
    try:
        vid = UUID(vehiculo_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de vehículo inválido")
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vid).first()

    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    if vehiculo.estado != EstadoVehiculo.PAGADO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se genera recibo PDF para trámites ya cobrados.",
        )

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    nombre_cda = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )
    cajero = db.query(Usuario).filter(Usuario.id == vehiculo.cobrado_por).first() if vehiculo.cobrado_por else None
    nombre_cajero = cajero.nombre_completo if cajero else "—"
    fpago = vehiculo.fecha_pago or datetime.now(timezone.utc)

    mp = vehiculo.metodo_pago
    if hasattr(mp, "value"):
        mp = mp.value
    metodo_str = str(mp or "efectivo")

    pdf_bytes = generar_recibo_pago_vehiculo_pdf(
        nombre_cda=nombre_cda,
        placa=vehiculo.placa,
        tipo_vehiculo=vehiculo.tipo_vehiculo,
        cliente_nombre=vehiculo.cliente_nombre,
        cliente_documento=vehiculo.cliente_documento,
        valor_rtm=vehiculo.valor_rtm,
        comision_soat=vehiculo.comision_soat or Decimal(0),
        total_cobrado=vehiculo.total_cobrado,
        metodo_pago=metodo_str,
        fecha_pago=fpago,
        nombre_cajero=nombre_cajero,
        numero_factura_dian=vehiculo.numero_factura_dian,
        cliente_email=vehiculo.cliente_email,
        cliente_telefono=vehiculo.cliente_telefono,
    )
    filename = f"recibo_pago_{vehiculo.placa}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{vehiculo_id}/foto", response_model=VehiculoFotoResponse)
def obtener_foto_vehiculo(
    vehiculo_id: str,
    index: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Devuelve una sola foto del vehículo por índice (carga bajo demanda).
    """
    try:
        vid = UUID(vehiculo_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de vehículo inválido")

    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vid).first()

    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    fotos = _extract_fotos_from_observaciones(vehiculo.observaciones)
    total = len(fotos)
    foto = fotos[index] if 0 <= index < total else None
    return VehiculoFotoResponse(
        vehiculo_id=str(vehiculo.id),
        placa=vehiculo.placa,
        total_fotos=total,
        index=index,
        foto=foto,
    )


@router.get("/{vehiculo_id}/recepcion-formato-pdf")
def descargar_recepcion_formato_extra_pdf(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    PDF del formato adicional de recepción (opcional), personalizado con marca del tenant.
    """
    try:
        vid = UUID(vehiculo_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID de vehículo inválido")

    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vid).first()

    if not vehiculo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehículo no encontrado")

    formato_extra = vehiculo.recepcion_formato_extra_json
    if not isinstance(formato_extra, dict) or not formato_extra:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El vehículo no tiene formato adicional de recepción diligenciado.",
        )

    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    tenant_nombre = (
        tenant.nombre_comercial
        if tenant and tenant.nombre_comercial
        else (tenant.nombre if tenant else "CDASOFT")
    )

    observaciones_recepcion = ""
    try:
        obs_raw = vehiculo.observaciones
        if isinstance(obs_raw, str) and obs_raw.strip():
            parsed_obs = json.loads(obs_raw)
            if isinstance(parsed_obs, dict):
                observaciones_recepcion = str(parsed_obs.get("texto") or "").strip()
            else:
                observaciones_recepcion = obs_raw.strip()
    except Exception:
        observaciones_recepcion = str(vehiculo.observaciones or "").strip()

    pdf_bytes = generar_recepcion_formato_extra_pdf(
        tenant_nombre=tenant_nombre,
        tenant_nit=tenant.nit_cda if tenant else None,
        tenant_logo_url=(tenant.logo_calidad_url if tenant and tenant.logo_calidad_url else (tenant.logo_url if tenant else None)),
        tenant_color_primario=tenant.color_primario if tenant else None,
        tenant_color_secundario=tenant.color_secundario if tenant else None,
        placa=vehiculo.placa,
        tipo_vehiculo=vehiculo.tipo_vehiculo,
        cliente_nombre=vehiculo.cliente_nombre,
        cliente_documento=vehiculo.cliente_documento,
        cliente_telefono=vehiculo.cliente_telefono,
        cliente_email=vehiculo.cliente_email,
        fecha_registro=vehiculo.fecha_registro,
        formato_extra={
            **formato_extra,
            "observaciones_recepcion": (
                str((formato_extra or {}).get("observaciones_recepcion", "")).strip()
                or observaciones_recepcion
            ),
            "version": (
                (str((formato_extra or {}).get("version", "")).strip())
                or (tenant.formato_prerevision_version.strip() if tenant and tenant.formato_prerevision_version else "")
                or "RTM-01-FR v13"
            ),
        },
    )
    filename = f"recepcion_formato_{vehiculo.placa}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{vehiculo_id}", response_model=VehiculoResponse)
def obtener_vehiculo(
    vehiculo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Obtener detalles de un vehículo
    """
    vehiculo = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    ).filter(VehiculoProceso.id == vehiculo_id).first()

    if not vehiculo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehículo no encontrado"
        )

    correction = _latest_factura_correcciones_by_vehiculo(
        db,
        current_user.tenant_id,
        [vehiculo.id],
    ).get(vehiculo.id)
    cajero_nombre = None
    if vehiculo.cobrado_por:
        cajero = db.query(Usuario).filter(Usuario.id == vehiculo.cobrado_por).first()
        if cajero:
            cajero_nombre = cajero.nombre_completo
    return _build_vehiculo_response_with_correccion(
        vehiculo,
        correccion=correction,
        cajero_nombre=cajero_nombre,
    )


@router.get("/", response_model=List[VehiculoResponse])
def listar_vehiculos(
    buscar: str = None,
    estado: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    include_formato_extra: bool = Query(True, description="Si false, omite JSON pesado de recepción en el listado"),
    include_observaciones: bool = Query(True, description="Si false, omite observaciones en el listado"),
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Listar vehículos con filtros avanzados y paginación
    
    Filtros:
    - buscar: Búsqueda por placa o cédula del cliente
    - estado: Filtrar por estado del vehículo
    - fecha_desde: Fecha inicio (YYYY-MM-DD)
    - fecha_hasta: Fecha fin (YYYY-MM-DD)
    - skip: Saltar registros (paginación)
    - limit: Límite de registros (default 20)
    """
    from sqlalchemy import or_

    query = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    )

    # Filtro de búsqueda (placa o cédula)
    if buscar:
        buscar_term = f"%{buscar.upper()}%"
        query = query.filter(
            or_(
                VehiculoProceso.placa.ilike(buscar_term),
                VehiculoProceso.cliente_documento.ilike(buscar_term),
                VehiculoProceso.cliente_nombre.ilike(buscar_term)
            )
        )
    
    # Filtro por estado
    if estado:
        query = query.filter(VehiculoProceso.estado == estado)
    
    # Filtro por rango de fechas
    if fecha_desde:
        try:
            fecha_inicio = datetime.strptime(fecha_desde, "%Y-%m-%d").date()
            fecha_inicio_utc, _ = _co_day_utc_bounds(fecha_inicio)
            query = query.filter(VehiculoProceso.fecha_registro >= fecha_inicio_utc)
        except ValueError:
            pass
    
    if fecha_hasta:
        try:
            fecha_fin = datetime.strptime(fecha_hasta, "%Y-%m-%d").date()
            _, fecha_fin_utc = _co_day_utc_bounds(fecha_fin)
            query = query.filter(VehiculoProceso.fecha_registro < fecha_fin_utc)
        except ValueError:
            pass
    
    # Ordenar por fecha de registro (más recientes primero)
    query = query.order_by(VehiculoProceso.fecha_registro.desc())
    
    # Paginación
    vehiculos = query.offset(skip).limit(limit).all()

    out: list[VehiculoResponse] = []
    for vehiculo in vehiculos:
        tiene_formato = bool(
            isinstance(vehiculo.recepcion_formato_extra_json, dict)
            and len(vehiculo.recepcion_formato_extra_json) > 0
        )
        row = VehiculoResponse.model_validate(vehiculo).model_copy(
            update={
                "tiene_recepcion_formato_extra": tiene_formato,
                "recepcion_formato_extra_json": (
                    vehiculo.recepcion_formato_extra_json if include_formato_extra else None
                ),
                "observaciones": vehiculo.observaciones if include_observaciones else None,
            }
        )
        out.append(row)

    return out


@router.get("/count/total")
def contar_vehiculos(
    buscar: str = None,
    estado: str = None,
    fecha_desde: str = None,
    fecha_hasta: str = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    active_sucursal_id: UUID = Depends(get_active_sucursal_id),
):
    """
    Contar total de vehículos con los mismos filtros que listar_vehiculos
    Útil para calcular paginación en el frontend
    """
    from sqlalchemy import or_

    query = _filtro_vehiculo_sede(
        db.query(VehiculoProceso),
        current_user.tenant_id,
        active_sucursal_id,
    )

    # Aplicar los mismos filtros
    if buscar:
        buscar_term = f"%{buscar.upper()}%"
        query = query.filter(
            or_(
                VehiculoProceso.placa.ilike(buscar_term),
                VehiculoProceso.cliente_documento.ilike(buscar_term),
                VehiculoProceso.cliente_nombre.ilike(buscar_term)
            )
        )
    
    if estado:
        query = query.filter(VehiculoProceso.estado == estado)
    
    if fecha_desde:
        try:
            fecha_inicio = datetime.strptime(fecha_desde, "%Y-%m-%d").date()
            fecha_inicio_utc, _ = _co_day_utc_bounds(fecha_inicio)
            query = query.filter(VehiculoProceso.fecha_registro >= fecha_inicio_utc)
        except ValueError:
            pass
    
    if fecha_hasta:
        try:
            fecha_fin = datetime.strptime(fecha_hasta, "%Y-%m-%d").date()
            _, fecha_fin_utc = _co_day_utc_bounds(fecha_fin)
            query = query.filter(VehiculoProceso.fecha_registro < fecha_fin_utc)
        except ValueError:
            pass
    
    total = query.count()
    
    return {"total": total}
