"""
Corrige el nombre del operario (signer_name) en formato de pre-revision
ya guardado en vehiculos_proceso.recepcion_formato_extra_json.

Solo actualiza el texto del firmante; NO modifica la imagen de firma.

Uso:
  # Dry-run (recomendado primero)
  PYTHONPATH=/var/www/cdasoft/repo/backend \\
    /var/www/cdasoft/repo/backend/venv/bin/python \\
    scripts/fix_prerevision_signer_name.py \\
    --tenant-slug cda-del-alto-putumayo \\
    --fecha 2026-07-30 \\
    --nuevo-nombre "MAROLY MUÑOZ" \\
    --placas YQR09F,UGO358,AVB898,IJK156,AVA225,DWN915,CTB63H,GDR539

  # Ejecutar
  ... mismos argumentos ... --execute
"""
from __future__ import annotations

import argparse
import copy
import json
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import text

from app.db.database import SessionLocal


def _normalize_slug(raw: str) -> str:
    return (raw or "").strip().strip("/").lower()


def _normalize_placa(raw: str) -> str:
    return (raw or "").strip().upper().replace(" ", "").replace("-", "")


def _parse_placas(raw: str) -> list[str]:
    parts = [p.strip() for p in (raw or "").replace("\n", ",").split(",")]
    placas = [_normalize_placa(p) for p in parts if p.strip()]
    # unique preserving order
    seen: set[str] = set()
    out: list[str] = []
    for p in placas:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _resolve_tenant(db, tenant_slug_input: str):
    slug = _normalize_slug(tenant_slug_input)
    if not slug:
        raise ValueError("Debes enviar un slug valido")

    row = db.execute(
        text(
            """
            SELECT id::text AS id, slug, nombre, nombre_comercial
            FROM tenants
            WHERE lower(slug) = :slug_plain
               OR lower(slug) = :slug_prefixed
            LIMIT 1
            """
        ),
        {"slug_plain": slug, "slug_prefixed": f"/{slug}"},
    ).mappings().first()

    if not row:
        raise ValueError(f"No se encontro tenant con slug '{tenant_slug_input}'")
    return row


def _get_signer_name(extra: Any) -> str | None:
    if not isinstance(extra, dict):
        return None
    pre = extra.get("pre_revision")
    if not isinstance(pre, dict):
        return None
    firma = pre.get("firma_operario")
    if not isinstance(firma, dict):
        return None
    name = firma.get("signer_name")
    if name is None:
        return None
    text_name = str(name).strip()
    return text_name or None


def _set_signer_name(extra: dict, nuevo_nombre: str) -> dict:
    updated = copy.deepcopy(extra)
    pre = updated.get("pre_revision")
    if not isinstance(pre, dict):
        pre = {}
        updated["pre_revision"] = pre
    firma = pre.get("firma_operario")
    if not isinstance(firma, dict):
        firma = {}
        pre["firma_operario"] = firma
    firma["signer_name"] = nuevo_nombre
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Corrige signer_name de pre-revision por tenant/placas/fecha (dry-run por defecto)."
    )
    parser.add_argument("--tenant-slug", required=True)
    parser.add_argument(
        "--placas",
        required=True,
        help="Lista de placas separadas por coma. Ej: YQR09F,UGO358",
    )
    parser.add_argument(
        "--fecha",
        required=True,
        help="Fecha operativa YYYY-MM-DD. Filtra por fecha_registro (dia Colombia UTC-5).",
    )
    parser.add_argument(
        "--nuevo-nombre",
        required=True,
        help='Nombre exacto a dejar en el formato. Ej: "MAROLY MUÑOZ"',
    )
    parser.add_argument(
        "--nombre-actual-contiene",
        default="MARIO",
        help="Solo corrige si el signer_name actual contiene este texto (default: MARIO).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Sin este flag solo hace dry-run.",
    )
    args = parser.parse_args()

    placas = _parse_placas(args.placas)
    if not placas:
        raise ValueError("No se recibieron placas validas")

    try:
        target_day = datetime.strptime(args.fecha.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("Fecha invalida. Usa YYYY-MM-DD") from exc

    # fecha_registro se guarda en UTC; ventanear dia Colombia (UTC-5).
    day_start_utc = datetime.combine(target_day, time.min) + timedelta(hours=5)
    day_end_utc = datetime.combine(target_day + timedelta(days=1), time.min) + timedelta(hours=5)

    nuevo_nombre = (args.nuevo_nombre or "").strip()
    if len(nuevo_nombre) < 3:
        raise ValueError("nuevo-nombre demasiado corto")

    filtro_actual = (args.nombre_actual_contiene or "").strip().upper()

    db = SessionLocal()
    try:
        tenant = _resolve_tenant(db, args.tenant_slug)
        tenant_id = tenant["id"]
        print(
            f"Tenant: {tenant.get('nombre_comercial') or tenant['nombre']} "
            f"| slug={tenant['slug']} | id={tenant_id}"
        )
        print(f"Fecha objetivo: {target_day.isoformat()}")
        print(f"Placas ({len(placas)}): {', '.join(placas)}")
        print(f"Nuevo nombre: {nuevo_nombre}")
        print(f"Filtro nombre actual contiene: {filtro_actual or '(sin filtro)'}")
        print(f"Modo: {'EXECUTE' if args.execute else 'DRY-RUN'}")
        print("")

        placas_csv = ",".join(placas)
        rows = db.execute(
            text(
                """
                SELECT
                  id::text AS id,
                  placa,
                  estado::text AS estado,
                  fecha_registro,
                  recepcion_formato_extra_json
                FROM vehiculos_proceso
                WHERE tenant_id = CAST(:tenant_id AS uuid)
                  AND upper(replace(replace(placa, ' ', ''), '-', '')) = ANY(
                    string_to_array(:placas_csv, ',')
                  )
                  AND fecha_registro >= :day_start_utc
                  AND fecha_registro < :day_end_utc
                ORDER BY placa, fecha_registro
                """
            ),
            {
                "tenant_id": tenant_id,
                "placas_csv": placas_csv,
                "day_start_utc": day_start_utc,
                "day_end_utc": day_end_utc,
            },
        ).mappings().all()

        found_placas = {_normalize_placa(r["placa"]) for r in rows}
        missing = [p for p in placas if p not in found_placas]

        print(f"Registros encontrados: {len(rows)}")
        if missing:
            print(f"Placas SIN registro en esa fecha/tenant: {', '.join(missing)}")
        print("")

        to_update: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []

        for row in rows:
            extra = row["recepcion_formato_extra_json"]
            if isinstance(extra, str):
                try:
                    extra = json.loads(extra)
                except Exception:
                    extra = None

            current = _get_signer_name(extra)
            placa = _normalize_placa(row["placa"])
            info = {
                "id": row["id"],
                "placa": placa,
                "estado": row["estado"],
                "signer_actual": current,
            }

            if not isinstance(extra, dict):
                info["motivo"] = "sin recepcion_formato_extra_json"
                skipped.append(info)
                continue
            if not current:
                info["motivo"] = "sin signer_name en firma_operario"
                skipped.append(info)
                continue
            if filtro_actual and filtro_actual not in current.upper():
                info["motivo"] = f"signer_name no contiene '{filtro_actual}'"
                skipped.append(info)
                continue
            if current.strip().upper() == nuevo_nombre.strip().upper():
                info["motivo"] = "ya tiene el nombre nuevo"
                skipped.append(info)
                continue

            to_update.append(
                {
                    **info,
                    "extra": extra,
                }
            )

        print("Candidatos a corregir:")
        if not to_update:
            print("  (ninguno)")
        for item in to_update:
            print(
                f"  - {item['placa']} | estado={item['estado']} | "
                f"'{item['signer_actual']}' -> '{nuevo_nombre}' | id={item['id']}"
            )

        print("")
        print("Omitidos:")
        if not skipped:
            print("  (ninguno)")
        for item in skipped:
            print(
                f"  - {item['placa']} | estado={item['estado']} | "
                f"signer='{item['signer_actual']}' | {item['motivo']}"
            )

        if not args.execute:
            print("")
            print("Dry-run completado. No se modifico nada.")
            print("Si los candidatos estan bien, agrega --execute")
            return

        if not to_update:
            print("")
            print("Nada para actualizar.")
            return

        updated = 0
        for item in to_update:
            new_extra = _set_signer_name(item["extra"], nuevo_nombre)
            db.execute(
                text(
                    """
                    UPDATE vehiculos_proceso
                    SET recepcion_formato_extra_json = CAST(:extra AS jsonb)
                    WHERE id = CAST(:id AS uuid)
                      AND tenant_id = CAST(:tenant_id AS uuid)
                    """
                ),
                {
                    "extra": json.dumps(new_extra, ensure_ascii=False),
                    "id": item["id"],
                    "tenant_id": tenant_id,
                },
            )
            updated += 1

        db.commit()
        print("")
        print(f"Actualizacion completada. Filas corregidas: {updated}")
        print("Valida regenerando 1-2 PDFs de pre-revision desde Recepcion/Caja.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
