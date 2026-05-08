"""
Schemas del módulo de nómina (fase inicial).
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NominaEmpleadoCreate(BaseModel):
    sucursal_id: Optional[UUID] = None
    centro_costo_id: Optional[UUID] = None
    codigo_interno: Optional[str] = Field(default=None, max_length=50)
    documento_tipo: str = Field(min_length=2, max_length=20)
    documento_numero: str = Field(min_length=4, max_length=40)
    nombres: str = Field(min_length=2, max_length=120)
    apellidos: str = Field(min_length=2, max_length=120)
    email: Optional[str] = Field(default=None, max_length=255)
    celular: Optional[str] = Field(default=None, max_length=30)
    fecha_ingreso: date


class NominaEmpleadoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    sucursal_id: Optional[UUID] = None
    centro_costo_id: Optional[UUID] = None
    codigo_interno: Optional[str] = None
    documento_tipo: str
    documento_numero: str
    nombres: str
    apellidos: str
    email: Optional[str] = None
    celular: Optional[str] = None
    fecha_ingreso: date
    activo: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaContratoCreate(BaseModel):
    empleado_id: UUID
    centro_costo_id: Optional[UUID] = None
    es_salario_integral: bool = False
    tipo_contrato: str
    periodicidad: str
    salario_base: Decimal = Field(gt=0)
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    observaciones: Optional[str] = None


class NominaContratoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    empleado_id: UUID
    centro_costo_id: Optional[UUID] = None
    es_salario_integral: bool
    tipo_contrato: str
    periodicidad: str
    salario_base: Decimal
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    estado: str
    observaciones: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaPeriodoCreate(BaseModel):
    anio: str = Field(min_length=4, max_length=4)
    mes: str = Field(min_length=2, max_length=2)
    fecha_inicio: date
    fecha_fin: date
    fecha_pago: Optional[date] = None
    observaciones: Optional[str] = None


class NominaPeriodoEstadoUpdate(BaseModel):
    estado: str
    observaciones: Optional[str] = None


class NominaPeriodoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    anio: str
    mes: str
    fecha_inicio: date
    fecha_fin: date
    fecha_pago: Optional[date] = None
    estado: str
    observaciones: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaNovedadCreate(BaseModel):
    periodo_id: UUID
    empleado_id: UUID
    tipo: str
    concepto: str = Field(min_length=2, max_length=120)
    unidades: Decimal = Field(default=Decimal("1"), ge=0)
    valor_unitario: Decimal = Field(default=Decimal("0"), ge=0)
    valor_total: Decimal = Field(default=Decimal("0"), ge=0)
    observaciones: Optional[str] = None


class NominaNovedadResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    periodo_id: UUID
    empleado_id: UUID
    tipo: str
    concepto: str
    unidades: Decimal
    valor_unitario: Decimal
    valor_total: Decimal
    observaciones: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaLiquidacionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    periodo_id: UUID
    empleado_id: UUID
    contrato_id: UUID
    salario_base: Decimal
    total_devengos: Decimal
    total_deducciones: Decimal
    neto_pagar: Decimal
    auxilio_transporte_devengo: Decimal
    base_cotizacion: Decimal
    aporte_salud_empleado: Decimal
    aporte_pension_empleado: Decimal
    aporte_fsp_empleado: Decimal
    aporte_subsistencia_empleado: Decimal
    retencion_fuente_empleado: Decimal
    aporte_salud_empresa: Decimal
    aporte_pension_empresa: Decimal
    aporte_arl_empresa: Decimal
    aporte_caja_empresa: Decimal
    aporte_sena_empresa: Decimal
    aporte_icbf_empresa: Decimal
    provision_prima: Decimal
    provision_cesantias: Decimal
    provision_intereses_cesantias: Decimal
    provision_vacaciones: Decimal
    costo_total_empresa: Decimal
    desprendible_folio: Optional[str] = None
    desprendible_version: int
    desprendible_pdf_sha256: Optional[str] = None
    desprendible_generated_at: Optional[datetime] = None
    observaciones: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaPreliquidacionResumen(BaseModel):
    periodo_id: UUID
    empleados_liquidados: int
    total_salario_base: Decimal
    total_devengos: Decimal
    total_deducciones: Decimal
    total_neto_pagar: Decimal


class NominaConceptoDetalle(BaseModel):
    tipo: str
    concepto: str
    unidades: Decimal
    valor_unitario: Decimal
    valor_total: Decimal


class NominaDesprendibleBaseResponse(BaseModel):
    tenant_id: UUID
    periodo_id: UUID
    liquidacion_id: UUID
    empleado_id: UUID
    empleado_nombre: str
    empleado_documento: str
    salario_base: Decimal
    total_devengos: Decimal
    total_deducciones: Decimal
    neto_pagar: Decimal
    devengos: list[NominaConceptoDetalle]
    deducciones: list[NominaConceptoDetalle]


class NominaDesprendibleMetaResponse(BaseModel):
    liquidacion_id: UUID
    periodo_id: UUID
    empleado_id: UUID
    folio: Optional[str] = None
    version: int
    pdf_relpath: Optional[str] = None
    pdf_sha256: Optional[str] = None
    generated_at: Optional[datetime] = None


class NominaDesprendibleVersionResponse(BaseModel):
    id: UUID
    liquidacion_id: UUID
    periodo_id: UUID
    empleado_id: UUID
    folio: Optional[str] = None
    version: int
    pdf_relpath: str
    pdf_sha256: str
    generated_at: datetime
    generated_by: UUID
    motivo: str

    model_config = ConfigDict(from_attributes=True)


class NominaCentroCostoCreate(BaseModel):
    sucursal_id: Optional[UUID] = None
    codigo: str = Field(min_length=1, max_length=30)
    nombre: str = Field(min_length=2, max_length=160)
    descripcion: Optional[str] = None


class NominaCentroCostoResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    sucursal_id: Optional[UUID] = None
    codigo: str
    nombre: str
    descripcion: Optional[str] = None
    activo: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NominaParametroLegalResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    salario_minimo_mensual: Decimal
    auxilio_transporte_mensual: Decimal
    uvt: Decimal
    tope_ibc_smmlv: Decimal
    umbral_exoneracion_smmlv: Decimal
    exoneracion_aportes_activa: bool
    aplica_auxilio_transporte: bool
    umbral_auxilio_transporte_smmlv: Decimal
    aplica_fsp: bool
    umbral_fsp_smmlv: Decimal
    pct_fsp_base: Decimal
    aplica_subsistencia: bool
    aplica_retencion_fuente: bool
    umbral_retencion_uvt: Decimal
    pct_retencion_base: Decimal
    pct_ibc_salario_integral: Decimal
    pct_salud_empleado: Decimal
    pct_pension_empleado: Decimal
    pct_salud_empresa: Decimal
    pct_pension_empresa: Decimal
    pct_arl_empresa: Decimal
    pct_caja_empresa: Decimal
    pct_sena_empresa: Decimal
    pct_icbf_empresa: Decimal
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class NominaParametroLegalUpdate(BaseModel):
    salario_minimo_mensual: Optional[Decimal] = Field(default=None, ge=0)
    auxilio_transporte_mensual: Optional[Decimal] = Field(default=None, ge=0)
    uvt: Optional[Decimal] = Field(default=None, ge=0)
    tope_ibc_smmlv: Optional[Decimal] = Field(default=None, gt=0)
    umbral_exoneracion_smmlv: Optional[Decimal] = Field(default=None, gt=0)
    exoneracion_aportes_activa: Optional[bool] = None
    aplica_auxilio_transporte: Optional[bool] = None
    umbral_auxilio_transporte_smmlv: Optional[Decimal] = Field(default=None, gt=0)
    aplica_fsp: Optional[bool] = None
    umbral_fsp_smmlv: Optional[Decimal] = Field(default=None, gt=0)
    pct_fsp_base: Optional[Decimal] = Field(default=None, ge=0, le=1)
    aplica_subsistencia: Optional[bool] = None
    aplica_retencion_fuente: Optional[bool] = None
    umbral_retencion_uvt: Optional[Decimal] = Field(default=None, ge=0)
    pct_retencion_base: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_ibc_salario_integral: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_salud_empleado: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_pension_empleado: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_salud_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_pension_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_arl_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_caja_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_sena_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
    pct_icbf_empresa: Optional[Decimal] = Field(default=None, ge=0, le=1)
