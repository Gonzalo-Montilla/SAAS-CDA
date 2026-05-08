"""
Motor legal base para cálculo de nómina Colombia (fase 1).

Notas:
- Este módulo implementa una base estándar con porcentajes generales.
- Algunos casos especiales (exoneraciones, topes, salario integral, riesgo ARL específico,
  novedades complejas, UGPP edge cases) se cubrirán en fases posteriores.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP


Q2 = Decimal("0.01")


def _q2(v: Decimal) -> Decimal:
    return v.quantize(Q2, rounding=ROUND_HALF_UP)


def calcular_base_legal_colombia(*, salario_base: Decimal, parametros: dict | None = None) -> dict[str, Decimal]:
    p = parametros or {}
    salario_minimo = _q2(Decimal(str(p.get("salario_minimo_mensual", "0") or "0")))
    tope_ibc_smmlv = Decimal(str(p.get("tope_ibc_smmlv", "25") or "25"))
    umbral_exoneracion_smmlv = Decimal(str(p.get("umbral_exoneracion_smmlv", "10") or "10"))
    exoneracion_aportes_activa = bool(p.get("exoneracion_aportes_activa", True))
    auxilio_transporte_mensual = _q2(Decimal(str(p.get("auxilio_transporte_mensual", "0") or "0")))
    aplica_auxilio_transporte = bool(p.get("aplica_auxilio_transporte", True))
    umbral_auxilio_transporte_smmlv = Decimal(str(p.get("umbral_auxilio_transporte_smmlv", "2") or "2"))
    aplica_fsp = bool(p.get("aplica_fsp", True))
    umbral_fsp_smmlv = Decimal(str(p.get("umbral_fsp_smmlv", "4") or "4"))
    pct_fsp_base = Decimal(str(p.get("pct_fsp_base", "0.01") or "0.01"))
    aplica_subsistencia = bool(p.get("aplica_subsistencia", True))
    aplica_retencion_fuente = bool(p.get("aplica_retencion_fuente", False))
    umbral_retencion_uvt = Decimal(str(p.get("umbral_retencion_uvt", "95") or "95"))
    pct_retencion_base = Decimal(str(p.get("pct_retencion_base", "0.19") or "0.19"))
    pct_ibc_salario_integral = Decimal(str(p.get("pct_ibc_salario_integral", "0.70") or "0.70"))
    es_salario_integral = bool(p.get("es_salario_integral", False))

    pct_salud_empleado = Decimal(str(p.get("pct_salud_empleado", "0.04") or "0.04"))
    pct_pension_empleado = Decimal(str(p.get("pct_pension_empleado", "0.04") or "0.04"))
    pct_salud_empresa = Decimal(str(p.get("pct_salud_empresa", "0.085") or "0.085"))
    pct_pension_empresa = Decimal(str(p.get("pct_pension_empresa", "0.12") or "0.12"))
    pct_arl_empresa = Decimal(str(p.get("pct_arl_empresa", "0.00522") or "0.00522"))
    pct_caja_empresa = Decimal(str(p.get("pct_caja_empresa", "0.04") or "0.04"))
    pct_sena_empresa = Decimal(str(p.get("pct_sena_empresa", "0.02") or "0.02"))
    pct_icbf_empresa = Decimal(str(p.get("pct_icbf_empresa", "0.03") or "0.03"))

    salario = _q2(Decimal(str(salario_base)))
    base = _q2(salario * pct_ibc_salario_integral) if es_salario_integral else salario
    if salario_minimo > 0:
        tope_ibc = _q2(salario_minimo * tope_ibc_smmlv)
        if base > tope_ibc:
            base = tope_ibc

    # Aportes empleado (deducibles de nómina)
    aporte_salud_empleado = _q2(base * pct_salud_empleado)
    aporte_pension_empleado = _q2(base * pct_pension_empleado)
    aporte_fsp_empleado = Decimal("0")
    aporte_subsistencia_empleado = Decimal("0")
    if salario_minimo > 0 and aplica_fsp and base >= (salario_minimo * umbral_fsp_smmlv):
        aporte_fsp_empleado = _q2(base * pct_fsp_base)
        if aplica_subsistencia and base >= (salario_minimo * Decimal("16")):
            aporte_subsistencia_empleado = _q2(base * Decimal("0.002"))
    retencion_fuente_empleado = Decimal("0")
    uvt = Decimal(str(p.get("uvt", "0") or "0"))
    if aplica_retencion_fuente and uvt > 0:
        base_uvt = base / uvt
        if base_uvt >= umbral_retencion_uvt:
            retencion_fuente_empleado = _q2(base * pct_retencion_base)

    total_deducciones_legales_empleado = _q2(
        aporte_salud_empleado
        + aporte_pension_empleado
        + aporte_fsp_empleado
        + aporte_subsistencia_empleado
        + retencion_fuente_empleado
    )

    # Aportes empleador (costo empresa; informativo, no descuenta al trabajador)
    aporte_salud_empresa = _q2(base * pct_salud_empresa)
    aporte_pension_empresa = _q2(base * pct_pension_empresa)
    aporte_arl_empresa = _q2(base * pct_arl_empresa)
    aporte_caja_empresa = _q2(base * pct_caja_empresa)
    aporte_sena_empresa = _q2(base * pct_sena_empresa)
    aporte_icbf_empresa = _q2(base * pct_icbf_empresa)

    if salario_minimo > 0 and exoneracion_aportes_activa and base < (salario_minimo * umbral_exoneracion_smmlv):
        aporte_salud_empresa = Decimal("0")
        aporte_sena_empresa = Decimal("0")
        aporte_icbf_empresa = Decimal("0")
    total_aportes_empresa = _q2(
        aporte_salud_empresa
        + aporte_pension_empresa
        + aporte_arl_empresa
        + aporte_caja_empresa
        + aporte_sena_empresa
        + aporte_icbf_empresa
    )

    # Provisiones prestacionales (mensuales)
    provision_prima = _q2(base / Decimal("12"))
    provision_cesantias = _q2(base / Decimal("12"))
    provision_intereses_cesantias = _q2(base * Decimal("0.12") / Decimal("12"))
    provision_vacaciones = _q2(base / Decimal("24"))
    total_provisiones = _q2(
        provision_prima + provision_cesantias + provision_intereses_cesantias + provision_vacaciones
    )

    auxilio_transporte_devengo = Decimal("0")
    if salario_minimo > 0 and aplica_auxilio_transporte and base <= (salario_minimo * umbral_auxilio_transporte_smmlv):
        auxilio_transporte_devengo = auxilio_transporte_mensual

    return {
        "base_cotizacion": base,
        "aporte_salud_empleado": aporte_salud_empleado,
        "aporte_pension_empleado": aporte_pension_empleado,
        "aporte_fsp_empleado": aporte_fsp_empleado,
        "aporte_subsistencia_empleado": aporte_subsistencia_empleado,
        "retencion_fuente_empleado": retencion_fuente_empleado,
        "total_deducciones_legales_empleado": total_deducciones_legales_empleado,
        "aporte_salud_empresa": aporte_salud_empresa,
        "aporte_pension_empresa": aporte_pension_empresa,
        "aporte_arl_empresa": aporte_arl_empresa,
        "aporte_caja_empresa": aporte_caja_empresa,
        "aporte_sena_empresa": aporte_sena_empresa,
        "aporte_icbf_empresa": aporte_icbf_empresa,
        "total_aportes_empresa": total_aportes_empresa,
        "provision_prima": provision_prima,
        "provision_cesantias": provision_cesantias,
        "provision_intereses_cesantias": provision_intereses_cesantias,
        "provision_vacaciones": provision_vacaciones,
        "total_provisiones": total_provisiones,
        "auxilio_transporte_devengo": auxilio_transporte_devengo,
    }
