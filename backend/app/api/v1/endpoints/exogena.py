"""
Endpoints base del módulo de Exógena (MVP Sprint 1).
"""
import csv
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
import hashlib
import re
from pathlib import Path
from uuid import UUID, uuid4
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    get_contador_or_admin,
    get_db,
    require_exogena_enabled_for_tenant,
)
from app.models.exogena import (
    ExogenaAnualParametro,
    ExogenaEjecucion,
    ExogenaExecutionStatus,
    ExogenaMapeo,
    ExogenaValidacion,
    ExogenaValidationSeverity,
)
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.caja import MovimientoCaja
from app.models.tesoreria import MovimientoTesoreria
from app.models.vehiculo import VehiculoProceso, EstadoVehiculo
from app.schemas.exogena import (
    ExogenaConfigResponse,
    ExogenaConfigUpsertRequest,
    ExogenaExecutionItem,
    ExogenaExportOut,
    ExogenaExportRequest,
    ExogenaMapeoOut,
    ExogenaValidationItem,
    ExogenaValidationRequest,
    ExogenaValidationSummary,
)

router = APIRouter(
    dependencies=[
        Depends(require_exogena_enabled_for_tenant),
        Depends(get_contador_or_admin),
    ]
)

SUPPORTED_FORMATS = {"1001", "1007"}
VALID_DIAN_DOC_CODES = {"11", "12", "13", "21", "22", "31", "41", "42", "43", "47", "48"}
DOC_TYPE_ALIAS_TO_DIAN = {
    "11": "11",
    "RC": "11",
    "REGISTROCIVIL": "11",
    "12": "12",
    "TI": "12",
    "TARJETAIDENTIDAD": "12",
    "13": "13",
    "CC": "13",
    "CEDULA": "13",
    "CEDULADECIUDADANIA": "13",
    "21": "21",
    "TE": "21",
    "TARJETAEXTRANJERIA": "21",
    "22": "22",
    "CE": "22",
    "CEDULADEEXTRANJERIA": "22",
    "31": "31",
    "NIT": "31",
    "41": "41",
    "PA": "41",
    "PAS": "41",
    "PASAPORTE": "41",
    "42": "42",
    "DE": "42",
    "TIPODOCUMENTOEXTRANJERO": "42",
    "43": "43",
    "SINIDENTIFICACIONEXTERIOR": "43",
    "47": "47",
    "PEP": "47",
    "PERMISOESPECIALDEPERMANENCIA": "47",
    "48": "48",
    "PPT": "48",
    "PERMISOPORPROTECCIONTEMPORAL": "48",
}


def _normalizar_formatos(formatos: list[str]) -> list[str]:
    parsed = []
    for f in formatos:
        val = (f or "").strip()
        if val:
            parsed.append(val)
    unique = sorted(set(parsed))
    if not unique:
        return sorted(SUPPORTED_FORMATS)
    invalid = [f for f in unique if f not in SUPPORTED_FORMATS]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Formatos no soportados en MVP: {', '.join(invalid)}",
        )
    return unique


def _crear_validacion(
    *,
    db: Session,
    tenant_id: UUID,
    anio: str,
    formato: str,
    severidad: ExogenaValidationSeverity,
    codigo: str,
    mensaje: str,
    referencia_origen: str | None = None,
    metadata_json: dict | None = None,
    ejecucion_id: UUID | None = None,
) -> ExogenaValidacion:
    row = ExogenaValidacion(
        tenant_id=tenant_id,
        ejecucion_id=ejecucion_id,
        anio=anio,
        formato=formato,
        severidad=severidad,
        codigo=codigo[:60],
        mensaje=mensaje,
        referencia_origen=referencia_origen,
        metadata_json=metadata_json or {},
    )
    db.add(row)
    return row


def _run_validaciones(
    *,
    db: Session,
    tenant_id: UUID,
    anio: str,
    formatos: list[str],
    persist: bool,
    ejecucion_id: UUID | None = None,
) -> list[ExogenaValidacion]:
    results: list[ExogenaValidacion] = []
    mapeos = (
        db.query(ExogenaMapeo)
        .filter(
            ExogenaMapeo.tenant_id == tenant_id,
            ExogenaMapeo.anio == anio,
            ExogenaMapeo.formato.in_(formatos),
        )
        .all()
    )
    params = (
        db.query(ExogenaAnualParametro)
        .filter(
            ExogenaAnualParametro.tenant_id == tenant_id,
            ExogenaAnualParametro.anio == anio,
        )
        .first()
    )

    if not params:
        results.append(
            _crear_validacion(
                db=db,
                tenant_id=tenant_id,
                anio=anio,
                formato="GEN",
                severidad=ExogenaValidationSeverity.ERROR,
                codigo="PARAMS_MISSING",
                mensaje=f"No existe configuración anual para {anio}.",
                referencia_origen=f"anio:{anio}",
                metadata_json={"anio": anio},
                ejecucion_id=ejecucion_id,
            )
        )
    elif int(params.uvt_anual or 0) <= 0:
        results.append(
            _crear_validacion(
                db=db,
                tenant_id=tenant_id,
                anio=anio,
                formato="GEN",
                severidad=ExogenaValidationSeverity.ERROR,
                codigo="UVT_INVALID",
                mensaje="La UVT anual debe ser mayor a 0.",
                referencia_origen=f"anio:{anio}",
                metadata_json={"uvt_anual": int(params.uvt_anual or 0)},
                ejecucion_id=ejecucion_id,
            )
        )

    if not mapeos:
        results.append(
            _crear_validacion(
                db=db,
                tenant_id=tenant_id,
                anio=anio,
                formato="GEN",
                severidad=ExogenaValidationSeverity.ERROR,
                codigo="MAPEO_EMPTY",
                mensaje="No hay mapeos configurados para los formatos solicitados.",
                referencia_origen=f"anio:{anio}",
                metadata_json={"formatos": formatos},
                ejecucion_id=ejecucion_id,
            )
        )
    else:
        seen_keys: set[tuple[str, str, str, str, str]] = set()
        for m in mapeos:
            key = (
                (m.formato or "").strip(),
                (m.cuenta_contable or "").strip(),
                (m.concepto or "").strip(),
                (m.categoria or "").strip(),
                (m.saldo_a_reportar or "").strip(),
            )
            if key in seen_keys:
                results.append(
                    _crear_validacion(
                        db=db,
                        tenant_id=tenant_id,
                        anio=anio,
                        formato=m.formato,
                        severidad=ExogenaValidationSeverity.WARNING,
                        codigo="MAPEO_DUPLICATE",
                        mensaje="Se detecta mapeo duplicado (mismos campos funcionales).",
                        referencia_origen=f"mapeo:{m.id}",
                        metadata_json={
                            "formato": m.formato,
                            "cuenta_contable": m.cuenta_contable,
                            "concepto": m.concepto,
                            "categoria": m.categoria,
                        },
                        ejecucion_id=ejecucion_id,
                    )
                )
            seen_keys.add(key)

            if not (m.cuenta_contable or "").strip():
                results.append(
                    _crear_validacion(
                        db=db,
                        tenant_id=tenant_id,
                        anio=anio,
                        formato=m.formato,
                        severidad=ExogenaValidationSeverity.ERROR,
                        codigo="CUENTA_EMPTY",
                        mensaje="Hay un mapeo sin cuenta contable.",
                        referencia_origen=f"mapeo:{m.id}",
                        metadata_json={},
                        ejecucion_id=ejecucion_id,
                    )
                )

            if not (m.concepto or "").strip():
                results.append(
                    _crear_validacion(
                        db=db,
                        tenant_id=tenant_id,
                        anio=anio,
                        formato=m.formato,
                        severidad=ExogenaValidationSeverity.ERROR,
                        codigo="CONCEPTO_EMPTY",
                        mensaje="Hay un mapeo sin concepto.",
                        referencia_origen=f"mapeo:{m.id}",
                        metadata_json={},
                        ejecucion_id=ejecucion_id,
                    )
                )

            if (m.formato or "").strip() not in SUPPORTED_FORMATS:
                results.append(
                    _crear_validacion(
                        db=db,
                        tenant_id=tenant_id,
                        anio=anio,
                        formato=(m.formato or "").strip() or "GEN",
                        severidad=ExogenaValidationSeverity.ERROR,
                        codigo="FORMATO_UNSUPPORTED",
                        mensaje="Formato no soportado en MVP actual.",
                        referencia_origen=f"mapeo:{m.id}",
                        metadata_json={"formato": m.formato},
                        ejecucion_id=ejecucion_id,
                    )
                )

            if (m.activo or "si").strip().lower() != "si":
                results.append(
                    _crear_validacion(
                        db=db,
                        tenant_id=tenant_id,
                        anio=anio,
                        formato=m.formato,
                        severidad=ExogenaValidationSeverity.WARNING,
                        codigo="MAPEO_INACTIVO",
                        mensaje="Mapeo inactivo; no se incluirá en exportación.",
                        referencia_origen=f"mapeo:{m.id}",
                        metadata_json={},
                        ejecucion_id=ejecucion_id,
                    )
                )

    anio_int = int(anio) if str(anio).isdigit() else None
    if anio_int is not None:
        for f in formatos:
            if f == "1001":
                c1 = (
                    db.query(func.count(MovimientoCaja.id))
                    .filter(
                        MovimientoCaja.tenant_id == tenant_id,
                        or_(MovimientoCaja.anulado == False, MovimientoCaja.anulado.is_(None)),
                        MovimientoCaja.monto < 0,
                        func.extract("year", MovimientoCaja.created_at) == anio_int,
                    )
                    .scalar()
                    or 0
                )
                c2 = (
                    db.query(func.count(MovimientoTesoreria.id))
                    .filter(
                        MovimientoTesoreria.tenant_id == tenant_id,
                        or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None)),
                        MovimientoTesoreria.monto < 0,
                        func.extract("year", MovimientoTesoreria.fecha_movimiento) == anio_int,
                    )
                    .scalar()
                    or 0
                )
                if int(c1) + int(c2) == 0:
                    results.append(
                        _crear_validacion(
                            db=db,
                            tenant_id=tenant_id,
                            anio=anio,
                            formato="1001",
                            severidad=ExogenaValidationSeverity.WARNING,
                            codigo="NO_OPERATIVE_DATA",
                            mensaje="No hay egresos operativos para 1001 en el año seleccionado.",
                            referencia_origen=f"1001:{anio}",
                            metadata_json={"movimientos_caja": int(c1), "movimientos_tesoreria": int(c2)},
                            ejecucion_id=ejecucion_id,
                        )
                    )
                else:
                    quality_rows_caja = (
                        db.query(
                            MovimientoCaja.id,
                            MovimientoCaja.beneficiario_tipo_identificacion,
                            MovimientoCaja.beneficiario_numero_identificacion,
                            MovimientoCaja.beneficiario,
                            MovimientoCaja.beneficiario_direccion,
                            MovimientoCaja.beneficiario_factus_municipality_id,
                        )
                        .filter(
                            MovimientoCaja.tenant_id == tenant_id,
                            or_(MovimientoCaja.anulado == False, MovimientoCaja.anulado.is_(None)),
                            MovimientoCaja.monto < 0,
                            func.extract("year", MovimientoCaja.created_at) == anio_int,
                        )
                        .all()
                    )
                    quality_rows_tes = (
                        db.query(
                            MovimientoTesoreria.id,
                            MovimientoTesoreria.beneficiario_tipo_identificacion,
                            MovimientoTesoreria.beneficiario_numero_identificacion,
                            MovimientoTesoreria.beneficiario,
                            MovimientoTesoreria.beneficiario_direccion,
                            MovimientoTesoreria.beneficiario_factus_municipality_id,
                        )
                        .filter(
                            MovimientoTesoreria.tenant_id == tenant_id,
                            or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None)),
                            MovimientoTesoreria.monto < 0,
                            func.extract("year", MovimientoTesoreria.fecha_movimiento) == anio_int,
                        )
                        .all()
                    )
                    invalid_doc_type = 0
                    invalid_doc_number = 0
                    city_missing = 0
                    address_missing = 0
                    for _, td, nd, nm, direccion, city_id in list(quality_rows_caja) + list(quality_rows_tes):
                        if _is_missing_party_data(td, nd, nm):
                            continue
                        if not _is_valid_doc_type(td):
                            invalid_doc_type += 1
                        if not _is_valid_doc_number(td, nd):
                            invalid_doc_number += 1
                        if city_id is None:
                            city_missing += 1
                        if not (direccion or "").strip():
                            address_missing += 1
                    if invalid_doc_type > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1001",
                                severidad=ExogenaValidationSeverity.ERROR,
                                codigo="DOC_TYPE_INVALID",
                                mensaje="Hay terceros con tipo de documento no permitido para reporte.",
                                referencia_origen=f"1001:{anio}",
                                metadata_json={"invalid_doc_type_rows": int(invalid_doc_type)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if invalid_doc_number > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1001",
                                severidad=ExogenaValidationSeverity.ERROR,
                                codigo="DOC_NUMBER_INVALID",
                                mensaje="Hay terceros con número de documento inválido para reporte.",
                                referencia_origen=f"1001:{anio}",
                                metadata_json={"invalid_doc_number_rows": int(invalid_doc_number)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if city_missing > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1001",
                                severidad=ExogenaValidationSeverity.WARNING,
                                codigo="CITY_MISSING",
                                mensaje="Hay terceros sin ciudad/municipio asociado (id Factus).",
                                referencia_origen=f"1001:{anio}",
                                metadata_json={"city_missing_rows": int(city_missing)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if address_missing > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1001",
                                severidad=ExogenaValidationSeverity.WARNING,
                                codigo="ADDRESS_MISSING",
                                mensaje="Hay terceros sin dirección; complete dato para estructura DIAN final.",
                                referencia_origen=f"1001:{anio}",
                                metadata_json={"address_missing_rows": int(address_missing)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
            if f == "1007":
                c3 = (
                    db.query(func.count(VehiculoProceso.id))
                    .filter(
                        VehiculoProceso.tenant_id == tenant_id,
                        VehiculoProceso.fecha_pago.isnot(None),
                        VehiculoProceso.total_cobrado > 0,
                        VehiculoProceso.estado.in_(
                            [
                                EstadoVehiculo.PAGADO,
                                EstadoVehiculo.EN_PISTA,
                                EstadoVehiculo.APROBADO,
                                EstadoVehiculo.RECHAZADO,
                                EstadoVehiculo.COMPLETADO,
                            ]
                        ),
                        func.extract("year", VehiculoProceso.fecha_pago) == anio_int,
                    )
                    .scalar()
                    or 0
                )
                if int(c3) == 0:
                    results.append(
                        _crear_validacion(
                            db=db,
                            tenant_id=tenant_id,
                            anio=anio,
                            formato="1007",
                            severidad=ExogenaValidationSeverity.WARNING,
                            codigo="NO_OPERATIVE_DATA",
                            mensaje="No hay ingresos cobrados para 1007 en el año seleccionado.",
                            referencia_origen=f"1007:{anio}",
                            metadata_json={"vehiculos_pagados": int(c3)},
                            ejecucion_id=ejecucion_id,
                        )
                    )
                else:
                    quality_rows_veh = (
                        db.query(
                            VehiculoProceso.id,
                            VehiculoProceso.cliente_tipo_documento,
                            VehiculoProceso.cliente_documento,
                            VehiculoProceso.cliente_nombre,
                            VehiculoProceso.cliente_direccion,
                            VehiculoProceso.cliente_factus_municipality_id,
                        )
                        .filter(
                            VehiculoProceso.tenant_id == tenant_id,
                            VehiculoProceso.fecha_pago.isnot(None),
                            VehiculoProceso.total_cobrado > 0,
                            VehiculoProceso.estado.in_(
                                [
                                    EstadoVehiculo.PAGADO,
                                    EstadoVehiculo.EN_PISTA,
                                    EstadoVehiculo.APROBADO,
                                    EstadoVehiculo.RECHAZADO,
                                    EstadoVehiculo.COMPLETADO,
                                ]
                            ),
                            func.extract("year", VehiculoProceso.fecha_pago) == anio_int,
                        )
                        .all()
                    )
                    invalid_doc_type = 0
                    invalid_doc_number = 0
                    city_missing = 0
                    address_missing = 0
                    for _, td, nd, nm, direccion, city_id in quality_rows_veh:
                        if _is_missing_party_data(td, nd, nm):
                            continue
                        if not _is_valid_doc_type(td):
                            invalid_doc_type += 1
                        if not _is_valid_doc_number(td, nd):
                            invalid_doc_number += 1
                        if city_id is None:
                            city_missing += 1
                        if not (direccion or "").strip():
                            address_missing += 1
                    if invalid_doc_type > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1007",
                                severidad=ExogenaValidationSeverity.ERROR,
                                codigo="DOC_TYPE_INVALID",
                                mensaje="Hay terceros con tipo de documento no permitido para reporte.",
                                referencia_origen=f"1007:{anio}",
                                metadata_json={"invalid_doc_type_rows": int(invalid_doc_type)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if invalid_doc_number > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1007",
                                severidad=ExogenaValidationSeverity.ERROR,
                                codigo="DOC_NUMBER_INVALID",
                                mensaje="Hay terceros con número de documento inválido para reporte.",
                                referencia_origen=f"1007:{anio}",
                                metadata_json={"invalid_doc_number_rows": int(invalid_doc_number)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if city_missing > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1007",
                                severidad=ExogenaValidationSeverity.WARNING,
                                codigo="CITY_MISSING",
                                mensaje="Hay terceros sin ciudad/municipio asociado (id Factus).",
                                referencia_origen=f"1007:{anio}",
                                metadata_json={"city_missing_rows": int(city_missing)},
                                ejecucion_id=ejecucion_id,
                            )
                        )
                    if address_missing > 0:
                        results.append(
                            _crear_validacion(
                                db=db,
                                tenant_id=tenant_id,
                                anio=anio,
                                formato="1007",
                                severidad=ExogenaValidationSeverity.WARNING,
                                codigo="ADDRESS_MISSING",
                                mensaje="Hay terceros sin dirección; complete dato para estructura DIAN final.",
                                referencia_origen=f"1007:{anio}",
                                metadata_json={"address_missing_rows": int(address_missing)},
                                ejecucion_id=ejecucion_id,
                            )
                        )

    if persist:
        db.flush()
    return results


def _render_csv_bytes(rows: list[ExogenaMapeo]) -> bytes:
    out = StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "formato",
            "cuenta_contable",
            "concepto",
            "categoria",
            "saldo_a_reportar",
            "activo",
        ]
    )
    for m in rows:
        writer.writerow(
            [
                m.formato,
                m.cuenta_contable,
                m.concepto,
                m.categoria,
                m.saldo_a_reportar,
                m.activo,
            ]
        )
    return out.getvalue().encode("utf-8")


def _render_csv_bytes_from_dicts(rows: list[dict], headers: list[str]) -> bytes:
    out = StringIO()
    writer = csv.DictWriter(out, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return out.getvalue().encode("utf-8")


def _parse_rule_values(raw: str) -> list[str]:
    return [v.strip().lower() for v in raw.replace(",", "|").split("|") if v.strip()]


def _enum_text(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw or "").strip().lower()


def _is_no_deducible_signal(contexto: dict[str, str]) -> bool:
    categoria_egreso = (contexto.get("categoria_egreso") or "").lower()
    concepto = (contexto.get("concepto") or "").lower()
    if categoria_egreso in {"impuestos", "ajuste_correccion"}:
        return True
    tokens = ["multa", "sancion", "interes", "mora", "penalidad", "tributo", "impuesto"]
    return any(t in concepto for t in tokens)


def _select_mapeo_for_context(mapeos: list[ExogenaMapeo], contexto: dict[str, str]) -> ExogenaMapeo | None:
    activos = [m for m in mapeos if (m.activo or "si").strip().lower() == "si"]
    if not activos:
        return None

    best_match: ExogenaMapeo | None = None
    best_score = -1
    for m in activos:
        rule = (m.source_rule or "").strip().lower()
        if not rule:
            continue
        clauses = [c.strip() for c in rule.split(";") if c.strip()]
        if not clauses:
            continue

        matched_all = True
        score = 0
        for clause in clauses:
            if ":" not in clause:
                continue
            key, raw_values = clause.split(":", 1)
            key = key.strip()
            expected = _parse_rule_values(raw_values)
            actual = (contexto.get(key) or "").strip().lower()
            if key == "concepto_contains":
                concepto_text = (contexto.get("concepto") or "").strip().lower()
                if any(token in concepto_text for token in expected):
                    score += 3
                else:
                    matched_all = False
                    break
            elif actual in expected:
                score += 4
            else:
                matched_all = False
                break

        if matched_all and score > best_score:
            best_score = score
            best_match = m

    if best_match is not None:
        return best_match

    wants_no_deducible = _is_no_deducible_signal(contexto)
    if wants_no_deducible:
        for m in activos:
            if "no_deduc" in (m.categoria or "").strip().lower():
                return m
    else:
        for m in activos:
            if "no_deduc" not in (m.categoria or "").strip().lower():
                return m

    return activos[0]


def _aggregate_export_rows(rows: list[dict]) -> list[dict]:
    """
    Consolida por tercero + concepto para acercar estructura DIAN:
    una fila por combinación funcional y valor total acumulado.
    """
    grouped: dict[tuple[str, ...], dict] = {}
    refs: dict[tuple[str, ...], set[str]] = defaultdict(set)
    fuentes: dict[tuple[str, ...], set[str]] = defaultdict(set)

    for row in rows:
        key = (
            str(row.get("formato") or "").strip(),
            str(row.get("anio") or "").strip(),
            str(row.get("tipo_documento") or "").strip(),
            str(row.get("numero_documento") or "").strip(),
            str(row.get("nombre_razon_social") or "").strip(),
            str(row.get("concepto_dian") or "").strip(),
            str(row.get("categoria") or "").strip(),
            str(row.get("ciudad") or "").strip(),
            str(row.get("direccion") or "").strip(),
        )
        amount = Decimal(str(row.get("valor_reportado") or 0))
        if key not in grouped:
            grouped[key] = {
                "formato": key[0],
                "anio": key[1],
                "tipo_documento": key[2],
                "numero_documento": key[3],
                "nombre_razon_social": key[4],
                "concepto_dian": key[5],
                "categoria": key[6],
                "valor_reportado": Decimal("0"),
                "ciudad": key[7],
                "direccion": key[8],
                "fuente": "",
                "referencia": "",
            }
        grouped[key]["valor_reportado"] += amount
        ref = str(row.get("referencia") or "").strip()
        if ref:
            refs[key].add(ref)
        fuente = str(row.get("fuente") or "").strip()
        if fuente:
            fuentes[key].add(fuente)

    out: list[dict] = []
    for key, agg in grouped.items():
        sorted_refs = sorted(refs.get(key, set()))
        agg["valor_reportado"] = f"{Decimal(agg['valor_reportado']):.2f}"
        agg["fuente"] = ",".join(sorted(fuentes.get(key, set())))
        if len(sorted_refs) > 1:
            agg["referencia"] = f"registros:{len(sorted_refs)}"
        elif len(sorted_refs) == 1:
            agg["referencia"] = sorted_refs[0]
        else:
            agg["referencia"] = ""
        out.append(agg)
    return out


def _build_source_summary(rows: list[dict]) -> list[dict]:
    stats: dict[str, dict[str, Decimal | int | str]] = {}
    for row in rows:
        fuente = str(row.get("fuente") or "").strip() or "sin_fuente"
        if fuente not in stats:
            stats[fuente] = {"fuente": fuente, "rows": 0, "total_valor": Decimal("0")}
        stats[fuente]["rows"] = int(stats[fuente]["rows"]) + 1
        stats[fuente]["total_valor"] = Decimal(str(stats[fuente]["total_valor"])) + Decimal(
            str(row.get("valor_reportado") or 0)
        )
    out: list[dict] = []
    for fuente in sorted(stats.keys()):
        item = stats[fuente]
        out.append(
            {
                "fuente": fuente,
                "rows": int(item["rows"]),
                "total_valor": f"{Decimal(str(item['total_valor'])):.2f}",
            }
        )
    return out


def _is_missing_party_data(tipo_documento: str | None, numero_documento: str | None, nombre: str | None) -> bool:
    td = (tipo_documento or "").strip().upper()
    nd = (numero_documento or "").strip().upper()
    nm = (nombre or "").strip().upper()
    invalid_values = {"", "N/A", "NA", "NULL", "NONE", "0"}
    return td in invalid_values or nd in invalid_values or nm in invalid_values


def _doc_type_key(tipo_documento: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (tipo_documento or "").strip().upper())


def _to_dian_doc_code(tipo_documento: str | None) -> str | None:
    key = _doc_type_key(tipo_documento)
    if not key:
        return None
    return DOC_TYPE_ALIAS_TO_DIAN.get(key)


def _normalize_doc_number_for_validation(doc_code: str | None, numero_documento: str | None) -> str:
    raw = (numero_documento or "").strip().upper()
    if not raw:
        return ""
    if (doc_code or "") == "31":
        compact = re.sub(r"[\s\.]", "", raw)
        parts = [p for p in compact.split("-") if p]
        if len(parts) >= 2:
            base = re.sub(r"\D", "", parts[0])
            dv = re.sub(r"\D", "", parts[1])[:1]
            return f"{base}-{dv}" if base and dv else base
        return re.sub(r"\D", "", compact)
    return re.sub(r"[^A-Z0-9]", "", raw)


def _normalize_doc_number_for_export(doc_code: str | None, numero_documento: str | None) -> str:
    return _normalize_doc_number_for_validation(doc_code, numero_documento)


def _is_valid_doc_type(tipo_documento: str | None) -> bool:
    return _to_dian_doc_code(tipo_documento) in VALID_DIAN_DOC_CODES


def _is_valid_doc_number(tipo_documento: str | None, numero_documento: str | None) -> bool:
    td = _to_dian_doc_code(tipo_documento) or _doc_type_key(tipo_documento)
    nd = _normalize_doc_number_for_validation(td, numero_documento)
    if not nd or len(nd) < 5 or len(nd) > 20:
        return False
    if td == "31":
        return bool(re.fullmatch(r"\d{5,15}(-\d)?", nd))
    return bool(re.fullmatch(r"[A-Z0-9]{5,20}", nd))


def _extract_cuantia_minima(params: ExogenaAnualParametro | None, formato: str) -> Decimal | None:
    if not params:
        return None
    raw = dict(params.topes_por_formato_json or {})
    formato_data = raw.get(formato)
    candidates: list[object] = []
    if isinstance(formato_data, dict):
        candidates.extend(
            [
                formato_data.get("cuantia_minima"),
                formato_data.get("tope_cuantias_minimas"),
                formato_data.get("minimo"),
            ]
        )
    elif formato_data is not None:
        candidates.append(formato_data)
    candidates.extend(
        [
            raw.get(f"tope_cuantias_minimas_{formato}"),
            raw.get(f"cuantia_minima_{formato}"),
            raw.get("cuantia_minima"),
            raw.get("tope_cuantias_minimas"),
        ]
    )
    for value in candidates:
        if value in (None, ""):
            continue
        try:
            parsed = Decimal(str(value))
            if parsed > 0:
                return parsed
        except Exception:
            continue
    return None


def _agregar_cuantias_minimas(
    *,
    rows: list[dict],
    formato: str,
    anio: str,
    tenant: Tenant | None,
    params: ExogenaAnualParametro | None,
) -> list[dict]:
    umbral = _extract_cuantia_minima(params, formato)
    if umbral is None:
        return rows

    kept: list[dict] = []
    total_cuantias = Decimal("0")
    referencias = 0
    for row in rows:
        if str(row.get("tipo_documento") or "").strip() == "43":
            kept.append(row)
            continue
        valor = Decimal(str(row.get("valor_reportado") or 0))
        if valor < umbral:
            total_cuantias += valor
            referencias += 1
            continue
        kept.append(row)

    if total_cuantias <= 0:
        return kept

    tenant_nit = re.sub(r"\D", "", str(getattr(tenant, "nit_cda", "") or ""))[:15]
    tenant_city = getattr(tenant, "factus_municipality_id", None)
    tenant_dir = str(getattr(tenant, "direccion_facturacion", "") or "").strip()
    kept.append(
        {
            "formato": formato,
            "anio": anio,
            "tipo_documento": "43",
            "numero_documento": tenant_nit or "222222222",
            "nombre_razon_social": "CUANTIAS MINIMAS",
            "concepto_dian": "5001" if formato == "1001" else "4001",
            "categoria": "cuantias_minimas",
            "valor_reportado": f"{total_cuantias:.2f}",
            "ciudad": str(tenant_city) if tenant_city is not None else "",
            "direccion": tenant_dir,
            "fuente": "cuantias_minimas",
            "referencia": f"registros:{referencias}",
        }
    )
    return kept


def _build_export_rows(
    *,
    db: Session,
    tenant_id: UUID,
    anio: str,
    formato: str,
    mapeos: list[ExogenaMapeo],
    params: ExogenaAnualParametro | None,
    tenant: Tenant | None,
    consolidado: bool = True,
) -> tuple[list[str], list[dict], list[dict], list[dict]]:
    headers = [
        "formato",
        "anio",
        "tipo_documento",
        "numero_documento",
        "nombre_razon_social",
        "concepto_dian",
        "categoria",
        "valor_reportado",
        "ciudad",
        "direccion",
        "fuente",
        "referencia",
    ]
    rows: list[dict] = []
    omitted_rows: list[dict] = []
    anio_int = int(anio)

    if formato == "1001":
        caja_rows = (
            db.query(MovimientoCaja)
            .filter(
                MovimientoCaja.tenant_id == tenant_id,
                or_(MovimientoCaja.anulado == False, MovimientoCaja.anulado.is_(None)),
                MovimientoCaja.monto < 0,
                func.extract("year", MovimientoCaja.created_at) == anio_int,
            )
            .all()
        )
        tes_rows = (
            db.query(MovimientoTesoreria)
            .filter(
                MovimientoTesoreria.tenant_id == tenant_id,
                or_(MovimientoTesoreria.anulado == False, MovimientoTesoreria.anulado.is_(None)),
                MovimientoTesoreria.monto < 0,
                func.extract("year", MovimientoTesoreria.fecha_movimiento) == anio_int,
            )
            .all()
        )
        for mov in caja_rows:
            tipo_doc = (mov.beneficiario_tipo_identificacion or "").strip()
            num_doc = (mov.beneficiario_numero_identificacion or "").strip()
            nombre = (mov.beneficiario or "").strip()
            if _is_missing_party_data(tipo_doc, num_doc, nombre):
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_caja",
                        "referencia": str(mov.id),
                        "motivo": "tercero_documento_incompleto",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            doc_code = _to_dian_doc_code(tipo_doc)
            doc_number = _normalize_doc_number_for_export(doc_code, num_doc)
            if not doc_code:
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_caja",
                        "referencia": str(mov.id),
                        "motivo": "tipo_documento_no_mapeado",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            if not _is_valid_doc_number(doc_code, doc_number):
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_caja",
                        "referencia": str(mov.id),
                        "motivo": "numero_documento_invalido",
                        "tipo_documento": doc_code,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            mapeo_sel = _select_mapeo_for_context(
                mapeos,
                {
                    "fuente": "movimientos_caja",
                    "tipo": _enum_text(getattr(mov, "tipo", "")),
                    "concepto": str(getattr(mov, "concepto", "") or "").strip().lower(),
                    "categoria_egreso": "",
                    "metodo_pago": _enum_text(getattr(mov, "metodo_pago", "")),
                },
            )
            rows.append(
                {
                    "formato": "1001",
                    "anio": anio,
                    "tipo_documento": doc_code,
                    "numero_documento": doc_number,
                    "nombre_razon_social": nombre,
                    "concepto_dian": ((mapeo_sel.concepto if mapeo_sel else "") or "5001").strip(),
                    "categoria": ((mapeo_sel.categoria if mapeo_sel else "") or "deducible").strip(),
                    "valor_reportado": f"{abs(Decimal(str(mov.monto or 0))):.2f}",
                    "ciudad": (
                        str(mov.beneficiario_factus_municipality_id)
                        if mov.beneficiario_factus_municipality_id is not None
                        else ""
                    ),
                    "direccion": (mov.beneficiario_direccion or "").strip(),
                    "fuente": "movimientos_caja",
                    "referencia": str(mov.id),
                }
            )
        for mov in tes_rows:
            tipo_doc = (mov.beneficiario_tipo_identificacion or "").strip()
            num_doc = (mov.beneficiario_numero_identificacion or "").strip()
            nombre = (mov.beneficiario or "").strip()
            if _is_missing_party_data(tipo_doc, num_doc, nombre):
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_tesoreria",
                        "referencia": str(mov.id),
                        "motivo": "tercero_documento_incompleto",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            doc_code = _to_dian_doc_code(tipo_doc)
            doc_number = _normalize_doc_number_for_export(doc_code, num_doc)
            if not doc_code:
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_tesoreria",
                        "referencia": str(mov.id),
                        "motivo": "tipo_documento_no_mapeado",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            if not _is_valid_doc_number(doc_code, doc_number):
                omitted_rows.append(
                    {
                        "formato": "1001",
                        "anio": anio,
                        "fuente": "movimientos_tesoreria",
                        "referencia": str(mov.id),
                        "motivo": "numero_documento_invalido",
                        "tipo_documento": doc_code,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": str(getattr(mov, "concepto", "") or "").strip(),
                        "direccion": (mov.beneficiario_direccion or "").strip(),
                    }
                )
                continue
            mapeo_sel = _select_mapeo_for_context(
                mapeos,
                {
                    "fuente": "movimientos_tesoreria",
                    "tipo": _enum_text(getattr(mov, "tipo", "")),
                    "concepto": str(getattr(mov, "concepto", "") or "").strip().lower(),
                    "categoria_egreso": _enum_text(getattr(mov, "categoria_egreso", "")),
                    "metodo_pago": _enum_text(getattr(mov, "metodo_pago", "")),
                },
            )
            rows.append(
                {
                    "formato": "1001",
                    "anio": anio,
                    "tipo_documento": doc_code,
                    "numero_documento": doc_number,
                    "nombre_razon_social": nombre,
                    "concepto_dian": ((mapeo_sel.concepto if mapeo_sel else "") or "5001").strip(),
                    "categoria": ((mapeo_sel.categoria if mapeo_sel else "") or "deducible").strip(),
                    "valor_reportado": f"{abs(Decimal(str(mov.monto or 0))):.2f}",
                    "ciudad": (
                        str(mov.beneficiario_factus_municipality_id)
                        if mov.beneficiario_factus_municipality_id is not None
                        else ""
                    ),
                    "direccion": (mov.beneficiario_direccion or "").strip(),
                    "fuente": "movimientos_tesoreria",
                    "referencia": str(mov.id),
                }
            )
        output_rows = _aggregate_export_rows(rows) if consolidado else rows
        output_rows = _agregar_cuantias_minimas(
            rows=output_rows,
            formato="1001",
            anio=anio,
            tenant=tenant,
            params=params,
        )
        source_summary = _build_source_summary(output_rows)
        return headers, output_rows, omitted_rows, source_summary

    if formato == "1007":
        veh_rows = (
            db.query(VehiculoProceso)
            .filter(
                VehiculoProceso.tenant_id == tenant_id,
                VehiculoProceso.fecha_pago.isnot(None),
                VehiculoProceso.total_cobrado > 0,
                VehiculoProceso.estado.in_(
                    [
                        EstadoVehiculo.PAGADO,
                        EstadoVehiculo.EN_PISTA,
                        EstadoVehiculo.APROBADO,
                        EstadoVehiculo.RECHAZADO,
                        EstadoVehiculo.COMPLETADO,
                    ]
                ),
                func.extract("year", VehiculoProceso.fecha_pago) == anio_int,
            )
            .all()
        )
        for veh in veh_rows:
            tipo_doc = (veh.cliente_tipo_documento or "").strip()
            num_doc = (veh.cliente_documento or "").strip()
            nombre = (veh.cliente_nombre or "").strip()
            if _is_missing_party_data(tipo_doc, num_doc, nombre):
                omitted_rows.append(
                    {
                        "formato": "1007",
                        "anio": anio,
                        "fuente": "vehiculos_proceso",
                        "referencia": str(veh.id),
                        "motivo": "tercero_documento_incompleto",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": "",
                        "direccion": (veh.cliente_direccion or "").strip(),
                    }
                )
                continue
            doc_code = _to_dian_doc_code(tipo_doc)
            doc_number = _normalize_doc_number_for_export(doc_code, num_doc)
            if not doc_code:
                omitted_rows.append(
                    {
                        "formato": "1007",
                        "anio": anio,
                        "fuente": "vehiculos_proceso",
                        "referencia": str(veh.id),
                        "motivo": "tipo_documento_no_mapeado",
                        "tipo_documento": tipo_doc,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": "",
                        "direccion": (veh.cliente_direccion or "").strip(),
                    }
                )
                continue
            if not _is_valid_doc_number(doc_code, doc_number):
                omitted_rows.append(
                    {
                        "formato": "1007",
                        "anio": anio,
                        "fuente": "vehiculos_proceso",
                        "referencia": str(veh.id),
                        "motivo": "numero_documento_invalido",
                        "tipo_documento": doc_code,
                        "numero_documento": num_doc,
                        "nombre_razon_social": nombre,
                        "concepto_origen": "",
                        "direccion": (veh.cliente_direccion or "").strip(),
                    }
                )
                continue
            mapeo_sel = _select_mapeo_for_context(
                mapeos,
                {
                    "fuente": "vehiculos_proceso",
                    "tipo": "",
                    "concepto": "",
                    "categoria_egreso": "",
                    "metodo_pago": _enum_text(getattr(veh, "metodo_pago", "")),
                    "estado": _enum_text(getattr(veh, "estado", "")),
                },
            )
            rows.append(
                {
                    "formato": "1007",
                    "anio": anio,
                    "tipo_documento": doc_code,
                    "numero_documento": doc_number,
                    "nombre_razon_social": nombre,
                    "concepto_dian": ((mapeo_sel.concepto if mapeo_sel else "") or "4001").strip(),
                    "categoria": ((mapeo_sel.categoria if mapeo_sel else "") or "ingresos").strip(),
                    "valor_reportado": f"{Decimal(str(veh.total_cobrado or 0)):.2f}",
                    "ciudad": (
                        str(veh.cliente_factus_municipality_id)
                        if veh.cliente_factus_municipality_id is not None
                        else ""
                    ),
                    "direccion": (veh.cliente_direccion or "").strip(),
                    "fuente": "vehiculos_proceso",
                    "referencia": str(veh.id),
                }
            )
        output_rows = _aggregate_export_rows(rows) if consolidado else rows
        output_rows = _agregar_cuantias_minimas(
            rows=output_rows,
            formato="1007",
            anio=anio,
            tenant=tenant,
            params=params,
        )
        source_summary = _build_source_summary(output_rows)
        return headers, output_rows, omitted_rows, source_summary

    return headers, rows, omitted_rows, []


def _guardar_csv_exogena(*, tenant_id: UUID, anio: str, formato: str, content: bytes) -> tuple[str, str]:
    root = Path(settings.ARCHIVOS_FISCALES_DIR).resolve()
    tenant_dir = root / str(tenant_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    filename = f"exogena_{anio}_{formato}_{uuid4().hex}.csv"
    full = tenant_dir / filename
    full.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    relpath = f"{tenant_id}/{filename}"
    return relpath, digest


def _abs_csv_path(relpath: str) -> Path:
    raw = (relpath or "").strip().replace("\\", "/")
    if not raw or ".." in raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ruta de archivo inválida.",
        )
    root = Path(settings.ARCHIVOS_FISCALES_DIR).resolve()
    full = (root / raw).resolve()
    if not str(full).startswith(str(root)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ruta de archivo fuera de almacenamiento permitido.",
        )
    return full


@router.get("/health")
def exogena_health(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    # `db` se mantiene para validar dependencia de sesión desde el primer día.
    _ = db
    return {
        "ok": True,
        "module": "exogena",
        "tenant_id": str(current_user.tenant_id),
    }


@router.get("/config", response_model=ExogenaConfigResponse)
def get_exogena_config(
    anio: str = Query(..., min_length=4, max_length=4),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    if not anio.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El año debe ser numérico en formato YYYY.",
        )

    params = (
        db.query(ExogenaAnualParametro)
        .filter(
            ExogenaAnualParametro.tenant_id == current_user.tenant_id,
            ExogenaAnualParametro.anio == anio,
        )
        .first()
    )
    mapeos = (
        db.query(ExogenaMapeo)
        .filter(
            ExogenaMapeo.tenant_id == current_user.tenant_id,
            ExogenaMapeo.anio == anio,
        )
        .order_by(ExogenaMapeo.formato.asc(), ExogenaMapeo.cuenta_contable.asc(), ExogenaMapeo.concepto.asc())
        .all()
    )

    if not params:
        return ExogenaConfigResponse(
            anio=anio,
            uvt_anual=0,
            topes_por_formato_json={},
            version_normativa=None,
            updated_at=None,
            mapeos=[ExogenaMapeoOut.model_validate(row) for row in mapeos],
        )

    return ExogenaConfigResponse(
        anio=params.anio,
        uvt_anual=int(params.uvt_anual or 0),
        topes_por_formato_json=dict(params.topes_por_formato_json or {}),
        version_normativa=params.version_normativa,
        updated_at=params.updated_at,
        mapeos=[ExogenaMapeoOut.model_validate(row) for row in mapeos],
    )


@router.put("/config", response_model=ExogenaConfigResponse)
def upsert_exogena_config(
    body: ExogenaConfigUpsertRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    anio = (body.anio or "").strip()
    if not anio.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El año debe ser numérico en formato YYYY.",
        )

    params = (
        db.query(ExogenaAnualParametro)
        .filter(
            ExogenaAnualParametro.tenant_id == current_user.tenant_id,
            ExogenaAnualParametro.anio == anio,
        )
        .first()
    )
    if not params:
        params = ExogenaAnualParametro(
            tenant_id=current_user.tenant_id,
            anio=anio,
            uvt_anual=body.uvt_anual,
            topes_por_formato_json=body.topes_por_formato_json,
            version_normativa=body.version_normativa,
            updated_by=current_user.id,
        )
        db.add(params)
    else:
        params.uvt_anual = body.uvt_anual
        params.topes_por_formato_json = body.topes_por_formato_json
        params.version_normativa = body.version_normativa
        params.updated_by = current_user.id
        params.updated_at = datetime.now(timezone.utc)

    # Estrategia MVP: replace total de mapeos para tenant+año.
    (
        db.query(ExogenaMapeo)
        .filter(
            ExogenaMapeo.tenant_id == current_user.tenant_id,
            ExogenaMapeo.anio == anio,
        )
        .delete(synchronize_session=False)
    )

    for m in body.mapeos:
        db.add(
            ExogenaMapeo(
                tenant_id=current_user.tenant_id,
                anio=anio,
                formato=(m.formato or "").strip(),
                cuenta_contable=(m.cuenta_contable or "").strip(),
                concepto=(m.concepto or "").strip(),
                categoria=(m.categoria or "").strip(),
                saldo_a_reportar=(m.saldo_a_reportar or "saldo_final").strip(),
                source_rule=(m.source_rule or "").strip() or None,
                activo=(m.activo or "si").strip().lower(),
                updated_by=current_user.id,
            )
        )

    db.commit()

    mapeos = (
        db.query(ExogenaMapeo)
        .filter(
            ExogenaMapeo.tenant_id == current_user.tenant_id,
            ExogenaMapeo.anio == anio,
        )
        .order_by(ExogenaMapeo.formato.asc(), ExogenaMapeo.cuenta_contable.asc(), ExogenaMapeo.concepto.asc())
        .all()
    )

    return ExogenaConfigResponse(
        anio=anio,
        uvt_anual=int(params.uvt_anual or 0),
        topes_por_formato_json=dict(params.topes_por_formato_json or {}),
        version_normativa=params.version_normativa,
        updated_at=params.updated_at,
        mapeos=[ExogenaMapeoOut.model_validate(row) for row in mapeos],
    )


@router.post("/validar", response_model=ExogenaValidationSummary)
def validar_exogena_config(
    body: ExogenaValidationRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    anio = (body.anio or "").strip()
    if not anio.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El año debe ser numérico en formato YYYY.",
        )
    formatos = _normalizar_formatos(body.formatos)

    (
        db.query(ExogenaValidacion)
        .filter(
            ExogenaValidacion.tenant_id == current_user.tenant_id,
            ExogenaValidacion.anio == anio,
            ExogenaValidacion.ejecucion_id.is_(None),
            ExogenaValidacion.formato.in_(formatos + ["GEN"]),
        )
        .delete(synchronize_session=False)
    )
    rows = _run_validaciones(
        db=db,
        tenant_id=current_user.tenant_id,
        anio=anio,
        formatos=formatos,
        persist=True,
        ejecucion_id=None,
    )
    db.commit()

    errors = sum(1 for r in rows if r.severidad == ExogenaValidationSeverity.ERROR)
    warnings = sum(1 for r in rows if r.severidad == ExogenaValidationSeverity.WARNING)
    return ExogenaValidationSummary(
        anio=anio,
        formatos=formatos,
        total=len(rows),
        total_errors=errors,
        total_warnings=warnings,
        items=[ExogenaValidationItem.model_validate(r) for r in rows],
    )


@router.post("/exportar", response_model=ExogenaExportOut)
def exportar_exogena(
    body: ExogenaExportRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    anio = (body.anio or "").strip()
    formato = (body.formato or "").strip()
    modo_exportacion = (body.modo_exportacion or "consolidado").strip().lower()
    is_consolidado = modo_exportacion != "detalle"
    if not anio.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El año debe ser numérico en formato YYYY.",
        )
    if formato not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Formato no soportado en MVP: {formato}",
        )

    ejecucion = ExogenaEjecucion(
        tenant_id=current_user.tenant_id,
        anio=anio,
        formato=formato,
        status=ExogenaExecutionStatus.PENDING,
        created_by=current_user.id,
    )
    db.add(ejecucion)
    db.flush()

    (
        db.query(ExogenaValidacion)
        .filter(ExogenaValidacion.ejecucion_id == ejecucion.id)
        .delete(synchronize_session=False)
    )
    validations = _run_validaciones(
        db=db,
        tenant_id=current_user.tenant_id,
        anio=anio,
        formatos=[formato],
        persist=True,
        ejecucion_id=ejecucion.id,
    )
    total_errors = sum(1 for v in validations if v.severidad == ExogenaValidationSeverity.ERROR)
    total_warnings = sum(1 for v in validations if v.severidad == ExogenaValidationSeverity.WARNING)

    if total_errors > 0:
        ejecucion.status = ExogenaExecutionStatus.ERROR
        ejecucion.total_rows = 0
        ejecucion.total_errors = total_errors
        ejecucion.total_warnings = total_warnings
        ejecucion.error_message = "Exportación bloqueada por errores de validación."
        db.commit()
        return ExogenaExportOut(
            ok=False,
            ejecucion_id=ejecucion.id,
            anio=anio,
            formato=formato,
            status=ejecucion.status.value,
            total_rows=0,
            total_errors=total_errors,
            total_warnings=total_warnings,
            archivo_relpath=None,
            archivo_sha256=None,
            error_message=ejecucion.error_message,
            created_at=ejecucion.created_at,
        )

    if (not body.include_warnings) and total_warnings > 0:
        ejecucion.status = ExogenaExecutionStatus.ERROR
        ejecucion.total_rows = 0
        ejecucion.total_errors = 0
        ejecucion.total_warnings = total_warnings
        ejecucion.error_message = "Exportación bloqueada por advertencias (include_warnings=false)."
        db.commit()
        return ExogenaExportOut(
            ok=False,
            ejecucion_id=ejecucion.id,
            anio=anio,
            formato=formato,
            status=ejecucion.status.value,
            total_rows=0,
            total_errors=0,
            total_warnings=total_warnings,
            archivo_relpath=None,
            archivo_sha256=None,
            error_message=ejecucion.error_message,
            created_at=ejecucion.created_at,
        )

    mapeos_activos = (
        db.query(ExogenaMapeo)
        .filter(
            ExogenaMapeo.tenant_id == current_user.tenant_id,
            ExogenaMapeo.anio == anio,
            ExogenaMapeo.formato == formato,
            ExogenaMapeo.activo == "si",
        )
        .order_by(ExogenaMapeo.cuenta_contable.asc(), ExogenaMapeo.concepto.asc())
        .all()
    )
    params = (
        db.query(ExogenaAnualParametro)
        .filter(
            ExogenaAnualParametro.tenant_id == current_user.tenant_id,
            ExogenaAnualParametro.anio == anio,
        )
        .first()
    )
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    headers, rows, omitted_rows, source_summary = _build_export_rows(
        db=db,
        tenant_id=current_user.tenant_id,
        anio=anio,
        formato=formato,
        mapeos=mapeos_activos,
        params=params,
        tenant=tenant,
        consolidado=is_consolidado,
    )
    if not rows:
        _crear_validacion(
            db=db,
            tenant_id=current_user.tenant_id,
            anio=anio,
            formato=formato,
            severidad=ExogenaValidationSeverity.ERROR,
            codigo="NO_DATA_TO_EXPORT",
            mensaje="No hay datos operativos para generar este formato en el año seleccionado.",
            referencia_origen=f"{formato}:{anio}",
            metadata_json={"formato": formato, "anio": anio},
            ejecucion_id=ejecucion.id,
        )
        ejecucion.status = ExogenaExecutionStatus.ERROR
        ejecucion.total_rows = 0
        ejecucion.total_errors = total_errors + 1
        ejecucion.total_warnings = total_warnings
        ejecucion.error_message = "Exportación sin datos operativos para el período."
        db.commit()
        return ExogenaExportOut(
            ok=False,
            ejecucion_id=ejecucion.id,
            anio=anio,
            formato=formato,
            status=ejecucion.status.value,
            total_rows=0,
            total_errors=ejecucion.total_errors,
            total_warnings=total_warnings,
            archivo_relpath=None,
            archivo_sha256=None,
            error_message=ejecucion.error_message,
            created_at=ejecucion.created_at,
        )

    csv_bytes = _render_csv_bytes_from_dicts(rows, headers)
    relpath, sha256_hex = _guardar_csv_exogena(
        tenant_id=current_user.tenant_id,
        anio=anio,
        formato=formato,
        content=csv_bytes,
    )

    omitidos_relpath: str | None = None
    omitidos_sha256: str | None = None
    if omitted_rows:
        omitted_headers = [
            "formato",
            "anio",
            "fuente",
            "referencia",
            "motivo",
            "tipo_documento",
            "numero_documento",
            "nombre_razon_social",
            "concepto_origen",
            "direccion",
        ]
        omitted_bytes = _render_csv_bytes_from_dicts(omitted_rows, omitted_headers)
        omitidos_relpath, omitidos_sha256 = _guardar_csv_exogena(
            tenant_id=current_user.tenant_id,
            anio=anio,
            formato=f"{formato}_omitidos",
            content=omitted_bytes,
        )
        _crear_validacion(
            db=db,
            tenant_id=current_user.tenant_id,
            anio=anio,
            formato=formato,
            severidad=ExogenaValidationSeverity.WARNING,
            codigo="THIRD_PARTY_DATA_MISSING",
            mensaje=(
                "Se omitieron registros con tercero/documento incompleto; "
                "complete identificación y nombre para incluirlos."
            ),
            referencia_origen=f"{formato}:{anio}",
            metadata_json={
                "missing_rows": int(len(omitted_rows)),
                "omitidos_relpath": omitidos_relpath,
                "omitidos_sha256": omitidos_sha256,
            },
            ejecucion_id=ejecucion.id,
        )
        total_warnings += 1

    ejecucion.status = ExogenaExecutionStatus.SUCCESS
    ejecucion.total_rows = len(rows)
    ejecucion.total_errors = total_errors
    ejecucion.total_warnings = total_warnings
    ejecucion.archivo_relpath = relpath
    ejecucion.archivo_sha256 = sha256_hex
    ejecucion.omitidos_relpath = omitidos_relpath
    ejecucion.omitidos_sha256 = omitidos_sha256
    ejecucion.omitidos_rows = len(omitted_rows)
    ejecucion.fuente_resumen_json = source_summary
    ejecucion.error_message = None
    db.commit()

    return ExogenaExportOut(
        ok=True,
        ejecucion_id=ejecucion.id,
        anio=anio,
        formato=formato,
        status=ejecucion.status.value,
        total_rows=len(rows),
        total_errors=total_errors,
        total_warnings=total_warnings,
        omitidos_rows=len(omitted_rows),
        archivo_relpath=relpath,
        archivo_sha256=sha256_hex,
        error_message=None,
        created_at=ejecucion.created_at,
    )


@router.get("/ejecuciones", response_model=list[ExogenaExecutionItem])
def listar_ejecuciones_exogena(
    anio: str = Query(..., min_length=4, max_length=4),
    formato: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    if not anio.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El año debe ser numérico en formato YYYY.",
        )

    q = db.query(ExogenaEjecucion).filter(
        ExogenaEjecucion.tenant_id == current_user.tenant_id,
        ExogenaEjecucion.anio == anio,
    )
    if formato:
        f = formato.strip()
        if f and f not in SUPPORTED_FORMATS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Formato no soportado en MVP: {f}",
            )
        if f:
            q = q.filter(ExogenaEjecucion.formato == f)
    rows = q.order_by(ExogenaEjecucion.created_at.desc()).limit(limit).all()
    out: list[ExogenaExecutionItem] = []
    for r in rows:
        out.append(
            ExogenaExecutionItem(
                id=r.id,
                tenant_id=r.tenant_id,
                anio=r.anio,
                formato=r.formato,
                status=r.status.value if hasattr(r.status, "value") else str(r.status),
                total_rows=int(r.total_rows or 0),
                total_errors=int(r.total_errors or 0),
                total_warnings=int(r.total_warnings or 0),
                omitidos_rows=int(getattr(r, "omitidos_rows", 0) or 0),
                omitidos_relpath=getattr(r, "omitidos_relpath", None),
                fuente_resumen_json=list(getattr(r, "fuente_resumen_json", []) or []),
                archivo_relpath=r.archivo_relpath,
                archivo_sha256=r.archivo_sha256,
                error_message=r.error_message,
                created_at=r.created_at,
                created_by=r.created_by,
            )
        )
    return out


@router.get("/ejecuciones/{ejecucion_id}/archivo")
def descargar_archivo_ejecucion_exogena(
    ejecucion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    row = (
        db.query(ExogenaEjecucion)
        .filter(
            ExogenaEjecucion.id == ejecucion_id,
            ExogenaEjecucion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ejecución no encontrada.",
        )
    if not row.archivo_relpath:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La ejecución no tiene archivo exportado.",
        )
    file_path = _abs_csv_path(row.archivo_relpath)
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archivo exportado no encontrado en almacenamiento.",
        )
    filename = file_path.name
    return FileResponse(
        path=str(file_path),
        media_type="text/csv",
        filename=filename,
    )


@router.get("/ejecuciones/{ejecucion_id}/validaciones", response_model=list[ExogenaValidationItem])
def listar_validaciones_ejecucion_exogena(
    ejecucion_id: UUID,
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    ejec = (
        db.query(ExogenaEjecucion)
        .filter(
            ExogenaEjecucion.id == ejecucion_id,
            ExogenaEjecucion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not ejec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ejecución no encontrada.",
        )
    rows = (
        db.query(ExogenaValidacion)
        .filter(
            ExogenaValidacion.tenant_id == current_user.tenant_id,
            ExogenaValidacion.ejecucion_id == ejecucion_id,
        )
        .order_by(ExogenaValidacion.created_at.desc())
        .limit(limit)
        .all()
    )
    return [ExogenaValidationItem.model_validate(r) for r in rows]


@router.get("/ejecuciones/{ejecucion_id}/omitidos")
def descargar_omitidos_ejecucion_exogena(
    ejecucion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_contador_or_admin),
):
    row = (
        db.query(ExogenaEjecucion)
        .filter(
            ExogenaEjecucion.id == ejecucion_id,
            ExogenaEjecucion.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ejecución no encontrada.",
        )
    if not row.omitidos_relpath:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La ejecución no tiene archivo de omitidos.",
        )
    file_path = _abs_csv_path(row.omitidos_relpath)
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archivo de omitidos no encontrado en almacenamiento.",
        )
    return FileResponse(
        path=str(file_path),
        media_type="text/csv",
        filename=file_path.name,
    )
