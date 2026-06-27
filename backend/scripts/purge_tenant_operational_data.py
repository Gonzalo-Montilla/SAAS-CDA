"""
Purge físico de datos operativos por tenant, preservando configuración.

Uso recomendado:
  1) Ejecutar primero en modo dry-run (sin --execute) para revisar conteos.
  2) Tomar backup de la base.
  3) Ejecutar con --execute durante una ventana sin usuarios activos.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import List

from sqlalchemy import text

from app.db.database import SessionLocal


@dataclass(frozen=True)
class TableTarget:
    name: str
    note: str


# Orden child -> parent para minimizar errores de FK.
BASE_TARGET_TABLES: List[TableTarget] = [
    TableTarget("quality_survey_responses", "Respuestas de encuestas"),
    TableTarget("quality_survey_invites", "Invitaciones de encuestas"),
    TableTarget("iva_provision_registros", "Provisiones IVA"),
    TableTarget("rtm_renewal_reminders", "Recordatorios RTM"),
    TableTarget("facturas_electronicas", "Facturas electronicas emitidas"),
    TableTarget("documentos_soporte_electronicos", "Documentos soporte emitidos"),
    TableTarget("desglose_efectivo_tesoreria", "Desgloses tesoreria"),
    TableTarget("movimientos_tesoreria", "Movimientos tesoreria"),
    TableTarget("notificaciones_cierre_caja", "Notificaciones cierre caja"),
    TableTarget("desglose_efectivo_cierre", "Desglose cierre de caja"),
    TableTarget("movimientos_caja", "Movimientos de caja"),
    TableTarget("sarlaft_case_parties", "Partes asociadas a casos SARLAFT"),
    TableTarget("sarlaft_intercda_jobs", "Trabajos InterCDA SARLAFT"),
    TableTarget("sarlaft_intercda_signals", "Senales InterCDA SARLAFT"),
    TableTarget("sarlaft_batch_rows", "Filas batch SARLAFT"),
    TableTarget("sarlaft_batch_jobs", "Jobs batch SARLAFT"),
    TableTarget("sarlaft_manual_checks", "Validaciones manuales SARLAFT"),
    TableTarget("sarlaft_sirel_reports", "Reportes SIREL SARLAFT"),
    TableTarget("sarlaft_audit_logs", "Auditoria SARLAFT"),
    TableTarget("sarlaft_cases", "Casos SARLAFT"),
    TableTarget("sarlaft_profiles", "Perfiles SARLAFT"),
    TableTarget("tenant_documento_auditoria", "Documentos auditoria tenant"),
    TableTarget("runt_consultas_metricas", "Metricas RUNT"),
    TableTarget("appointments", "Citas"),
    TableTarget("saas_support_tickets", "Tickets de soporte del tenant"),
    TableTarget("vehiculos_proceso", "Recepciones/vehiculos en proceso"),
    TableTarget("cajas", "Cajas diarias"),
]

NOMINA_TARGET_TABLES: List[TableTarget] = [
    TableTarget("nomina_desprendible_versiones", "Desprendibles nomina"),
    TableTarget("nomina_liquidaciones", "Liquidaciones nomina"),
    TableTarget("nomina_novedades", "Novedades nomina"),
    TableTarget("nomina_contratos", "Contratos nomina"),
    TableTarget("nomina_periodos", "Periodos nomina"),
    TableTarget("nomina_empleados", "Empleados nomina"),
]


def _normalize_slug(raw: str) -> str:
    return (raw or "").strip().strip("/").lower()


def _build_targets(include_nomina: bool) -> List[TableTarget]:
    if include_nomina:
        return BASE_TARGET_TABLES + NOMINA_TARGET_TABLES
    return BASE_TARGET_TABLES


def _resolve_tenant(db, tenant_slug_input: str):
    slug = _normalize_slug(tenant_slug_input)
    if not slug:
        raise ValueError("Debes enviar un slug valido, por ejemplo: cda-del-putumayo")

    row = db.execute(
        text(
            """
            SELECT id::text AS id, slug, nombre
            FROM tenants
            WHERE lower(slug) = :slug_plain
               OR lower(slug) = :slug_prefixed
            LIMIT 1
            """
        ),
        {"slug_plain": slug, "slug_prefixed": f"/{slug}"},
    ).mappings().first()

    if not row:
        raise ValueError(
            f"No se encontro tenant con slug '{tenant_slug_input}'. "
            f"Intentados: ['{slug}', '/{slug}']"
        )
    return row


def _table_exists(db, table_name: str) -> bool:
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": f"public.{table_name}"},
        ).scalar()
    )


def _count_rows(db, table_name: str, tenant_id: str) -> int:
    return int(
        db.execute(
            text(f"SELECT COUNT(*) FROM {table_name} WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        ).scalar()
        or 0
    )


def _delete_rows(db, table_name: str, tenant_id: str) -> int:
    result = db.execute(
        text(f"DELETE FROM {table_name} WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    return int(result.rowcount or 0)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Purga datos operativos de un tenant sin tocar configuraciones base."
    )
    parser.add_argument(
        "--tenant-slug",
        required=True,
        help="Slug del tenant (con o sin / inicial). Ej: cda-del-putumayo",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Si se envia, ejecuta el borrado. Sin este flag, solo dry-run.",
    )
    parser.add_argument(
        "--include-nomina",
        action="store_true",
        help="Incluye tablas operativas de nomina en la purga.",
    )
    args = parser.parse_args()
    targets = _build_targets(args.include_nomina)

    db = SessionLocal()
    try:
        tenant = _resolve_tenant(db, args.tenant_slug)
        tenant_id = tenant["id"]
        print(f"Tenant objetivo: {tenant['nombre']} | slug={tenant['slug']} | id={tenant_id}")
        print("")

        print("Conteo previo por tabla:")
        total = 0
        pre_counts: list[tuple[TableTarget, int]] = []
        for target in targets:
            if not _table_exists(db, target.name):
                print(f" - {target.name:<30} {'N/A':>8}  (tabla no existe en este schema)")
                continue
            count = _count_rows(db, target.name, tenant_id)
            pre_counts.append((target, count))
            total += count
            print(f" - {target.name:<30} {count:>8}  ({target.note})")

        print("")
        print(f"Total filas objetivo: {total}")

        if not args.execute:
            print("")
            print("Dry-run completado. No se borro nada.")
            print("Para ejecutar realmente: agrega --execute")
            return

        print("")
        print("Ejecutando purga...")
        deleted_total = 0
        deleted_by_table: list[tuple[TableTarget, int]] = []
        for target in targets:
            if not _table_exists(db, target.name):
                print(f" - {target.name:<30} {'N/A':>8} tabla no existe, se omite")
                continue
            deleted = _delete_rows(db, target.name, tenant_id)
            deleted_total += deleted
            deleted_by_table.append((target, deleted))
            print(f" - {target.name:<30} {deleted:>8} eliminadas")

        db.commit()
        print("")
        print(f"Purga completada. Filas eliminadas: {deleted_total}")
        print("")
        print("Validacion post-purga:")
        residual_total = 0
        for target, _ in deleted_by_table:
            residual = _count_rows(db, target.name, tenant_id)
            residual_total += residual
            print(f" - {target.name:<30} {residual:>8} remanentes")
        print("")
        print(f"Total remanente en tablas objetivo: {residual_total}")
        if residual_total == 0:
            print("OK: Tenant limpio en tablas operativas objetivo.")
        else:
            print("ATENCION: Hay remanentes. Revisar FKs o tablas no contempladas.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()

