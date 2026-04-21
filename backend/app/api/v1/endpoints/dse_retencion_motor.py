"""API parámetros motor retención DSE (UVT anual + tasas por concepto)."""
from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dse_retencion_conceptos import CONCEPTOS_RETENCION_DSE, normalizar_concepto_retencion_dse
from app.core.deps import get_admin, get_contador_or_admin, get_cajero_contador_or_admin, get_db
from app.models.dse_retencion_motor import DseRetencionTasaConcepto, DseUvtPorAnio
from app.models.usuario import Usuario
from app.schemas.dse_retencion_motor import (
    DseRetencionParametrosOut,
    DseRetencionParametrosPut,
    DseRetencionPreviewIn,
    DseRetencionPreviewOut,
)
from app.services.dse_retencion_motor_calculo import (
    calcular_retencion_desde_parametros,
    cargar_uvt_y_tasa,
    resultado_a_dict,
)
from app.services.factus_tenant_settings import get_or_create_settings_row

router = APIRouter()


@router.post("/preview", response_model=DseRetencionPreviewOut)
def post_dse_retencion_preview(
    body: DseRetencionPreviewIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_cajero_contador_or_admin),
):
    """
    Vista previa del motor: usa UVT y tasa del año en BD y umbrales UVT por concepto (referencia DIAN).
    No persiste; lectura para caja/tesorería al armar egresos y para contador/admin al validar parámetros.
    """
    try:
        c = normalizar_concepto_retencion_dse(body.concepto)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    fs = get_or_create_settings_row(db, current_user.tenant_id)
    from app.core.dse_retencion_conceptos import validar_concepto_para_tenant

    try:
        validar_concepto_para_tenant(fs, c)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    valor_uvt, tasa = cargar_uvt_y_tasa(db, current_user.tenant_id, body.anio, c)
    res = calcular_retencion_desde_parametros(
        body.monto,
        concepto=c,
        valor_uvt_cop=valor_uvt,
        tasa_porcentaje=tasa,
    )
    d = resultado_a_dict(res)
    return DseRetencionPreviewOut(
        retencion_cop=d["retencion_cop"],
        aplica=d["aplica"],
        base_minima_cop=d["base_minima_cop"],
        umbral_uvt=d["umbral_uvt"],
        tasa_porcentaje=d["tasa_porcentaje"],
        valor_uvt_cop=d["valor_uvt_cop"],
        motivo_sin_calculo=d["motivo_sin_calculo"],
    )


def _tasas_dict_for_tenant_anio(
    db: Session, tenant_id: UUID, anio: int
) -> dict[str, Optional[Decimal]]:
    rows = (
        db.query(DseRetencionTasaConcepto)
        .filter(
            DseRetencionTasaConcepto.tenant_id == tenant_id,
            DseRetencionTasaConcepto.anio == anio,
        )
        .all()
    )
    by_c = {r.concepto: r.porcentaje for r in rows}
    return {c: by_c.get(c) for c in CONCEPTOS_RETENCION_DSE}


@router.get("/parametros/{anio}", response_model=DseRetencionParametrosOut)
def get_parametros_dse_retencion(
    anio: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    if anio < 2000 or anio > 2100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Año no válido.")
    uvt_row = (
        db.query(DseUvtPorAnio)
        .filter(DseUvtPorAnio.tenant_id == current_user.tenant_id, DseUvtPorAnio.anio == anio)
        .first()
    )
    return DseRetencionParametrosOut(
        anio=anio,
        valor_uvt_cop=uvt_row.valor_uvt_cop if uvt_row else None,
        tasas=_tasas_dict_for_tenant_anio(db, current_user.tenant_id, anio),
    )


@router.put("/parametros/{anio}", response_model=DseRetencionParametrosOut)
def put_parametros_dse_retencion(
    anio: int,
    body: DseRetencionParametrosPut,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin),
):
    if anio < 2000 or anio > 2100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Año no válido.")

    fs = get_or_create_settings_row(db, current_user.tenant_id)
    habilitados = set()
    if getattr(fs, "dse_retencion_usar_compras", True):
        habilitados.add("compras")
    if getattr(fs, "dse_retencion_usar_servicios", True):
        habilitados.add("servicios")
    if getattr(fs, "dse_retencion_usar_arrendamiento", True):
        habilitados.add("arrendamiento")
    if getattr(fs, "dse_retencion_usar_honorarios", True):
        habilitados.add("honorarios")

    data = body.model_dump(exclude_unset=True)

    if "valor_uvt_cop" in data:
        raw_uvt = data["valor_uvt_cop"]
        uvt_row = (
            db.query(DseUvtPorAnio)
            .filter(DseUvtPorAnio.tenant_id == current_user.tenant_id, DseUvtPorAnio.anio == anio)
            .first()
        )
        if raw_uvt is None:
            if uvt_row:
                db.delete(uvt_row)
        else:
            if uvt_row:
                uvt_row.valor_uvt_cop = raw_uvt
            else:
                db.add(
                    DseUvtPorAnio(
                        tenant_id=current_user.tenant_id,
                        anio=anio,
                        valor_uvt_cop=raw_uvt,
                    )
                )

    if body.tasas is not None:
        for concepto_key, pct in body.tasas.items():
            try:
                c = normalizar_concepto_retencion_dse(concepto_key)
            except ValueError as e:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
            if c not in habilitados:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El concepto «{c}» no está habilitado en el entorno de retenciones.",
                )
            if pct is not None:
                if pct < 0 or pct > 100:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cada tasa debe estar entre 0 y 100.",
                    )
            row = (
                db.query(DseRetencionTasaConcepto)
                .filter(
                    DseRetencionTasaConcepto.tenant_id == current_user.tenant_id,
                    DseRetencionTasaConcepto.anio == anio,
                    DseRetencionTasaConcepto.concepto == c,
                )
                .first()
            )
            if pct is None:
                if row:
                    db.delete(row)
            else:
                if row:
                    row.porcentaje = pct
                else:
                    db.add(
                        DseRetencionTasaConcepto(
                            tenant_id=current_user.tenant_id,
                            anio=anio,
                            concepto=c,
                            porcentaje=pct,
                        )
                    )

    db.commit()

    uvt_after = (
        db.query(DseUvtPorAnio)
        .filter(DseUvtPorAnio.tenant_id == current_user.tenant_id, DseUvtPorAnio.anio == anio)
        .first()
    )
    return DseRetencionParametrosOut(
        anio=anio,
        valor_uvt_cop=uvt_after.valor_uvt_cop if uvt_after else None,
        tasas=_tasas_dict_for_tenant_anio(db, current_user.tenant_id, anio),
    )
