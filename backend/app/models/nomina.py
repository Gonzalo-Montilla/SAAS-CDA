"""
Modelos base del módulo de nómina (multitenant).
"""
from datetime import date, datetime, timezone
from decimal import Decimal
import enum
import uuid

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Boolean,
    Enum as SQLEnum,
    ForeignKey,
    Numeric,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class TipoContratoNomina(str, enum.Enum):
    FIJO = "fijo"
    INDEFINIDO = "indefinido"
    OBRA_LABOR = "obra_labor"
    APRENDIZAJE = "aprendizaje"
    TEMPORAL = "temporal"


class PeriodicidadNomina(str, enum.Enum):
    QUINCENAL = "quincenal"
    MENSUAL = "mensual"


class EstadoContratoNomina(str, enum.Enum):
    ACTIVO = "activo"
    SUSPENDIDO = "suspendido"
    FINALIZADO = "finalizado"


class EstadoPeriodoNomina(str, enum.Enum):
    BORRADOR = "borrador"
    PRELIQUIDADA = "preliquidada"
    APROBADA = "aprobada"
    CERRADA = "cerrada"
    PAGADA = "pagada"


class TipoNovedadNomina(str, enum.Enum):
    DEVENGO = "devengo"
    DEDUCCION = "deduccion"


class NominaEmpleado(Base):
    __tablename__ = "nomina_empleados"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "documento_tipo",
            "documento_numero",
            name="ux_nomina_empleado_doc_tenant",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    centro_costo_id = Column(UUID(as_uuid=True), ForeignKey("nomina_centros_costo.id"), nullable=True, index=True)
    codigo_interno = Column(String(50), nullable=True, index=True)
    documento_tipo = Column(String(20), nullable=False)
    documento_numero = Column(String(40), nullable=False)
    nombres = Column(String(120), nullable=False)
    apellidos = Column(String(120), nullable=False)
    email = Column(String(255), nullable=True)
    celular = Column(String(30), nullable=True)
    fecha_ingreso = Column(Date, nullable=False, default=date.today)
    activo = Column(String(10), nullable=False, default="si")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    contratos = relationship("NominaContrato", back_populates="empleado", cascade="all, delete-orphan")


class NominaContrato(Base):
    __tablename__ = "nomina_contratos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    empleado_id = Column(UUID(as_uuid=True), ForeignKey("nomina_empleados.id"), nullable=False, index=True)
    centro_costo_id = Column(UUID(as_uuid=True), ForeignKey("nomina_centros_costo.id"), nullable=True, index=True)
    tipo_contrato = Column(SQLEnum(TipoContratoNomina), nullable=False)
    es_salario_integral = Column(Boolean, nullable=False, default=False)
    periodicidad = Column(SQLEnum(PeriodicidadNomina), nullable=False, default=PeriodicidadNomina.MENSUAL)
    salario_base = Column(Numeric(14, 2), nullable=False)
    fecha_inicio = Column(Date, nullable=False)
    fecha_fin = Column(Date, nullable=True)
    estado = Column(SQLEnum(EstadoContratoNomina), nullable=False, default=EstadoContratoNomina.ACTIVO)
    observaciones = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    empleado = relationship("NominaEmpleado", back_populates="contratos")


class NominaPeriodo(Base):
    __tablename__ = "nomina_periodos"
    __table_args__ = (
        UniqueConstraint("tenant_id", "anio", "mes", name="ux_nomina_periodo_tenant_mes"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    anio = Column(String(4), nullable=False)
    mes = Column(String(2), nullable=False)
    fecha_inicio = Column(Date, nullable=False)
    fecha_fin = Column(Date, nullable=False)
    fecha_pago = Column(Date, nullable=True)
    estado = Column(SQLEnum(EstadoPeriodoNomina), nullable=False, default=EstadoPeriodoNomina.BORRADOR)
    observaciones = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    opened_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    closed_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    novedades = relationship("NominaNovedad", back_populates="periodo", cascade="all, delete-orphan")
    liquidaciones = relationship("NominaLiquidacion", back_populates="periodo", cascade="all, delete-orphan")


class NominaNovedad(Base):
    __tablename__ = "nomina_novedades"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    periodo_id = Column(UUID(as_uuid=True), ForeignKey("nomina_periodos.id"), nullable=False, index=True)
    empleado_id = Column(UUID(as_uuid=True), ForeignKey("nomina_empleados.id"), nullable=False, index=True)
    tipo = Column(SQLEnum(TipoNovedadNomina), nullable=False)
    concepto = Column(String(120), nullable=False)
    unidades = Column(Numeric(10, 2), nullable=False, default=1)
    valor_unitario = Column(Numeric(14, 2), nullable=False, default=0)
    valor_total = Column(Numeric(14, 2), nullable=False, default=0)
    observaciones = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    periodo = relationship("NominaPeriodo", back_populates="novedades")


class NominaLiquidacion(Base):
    __tablename__ = "nomina_liquidaciones"
    __table_args__ = (
        UniqueConstraint("tenant_id", "periodo_id", "empleado_id", name="ux_nomina_liq_tenant_periodo_empleado"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    periodo_id = Column(UUID(as_uuid=True), ForeignKey("nomina_periodos.id"), nullable=False, index=True)
    empleado_id = Column(UUID(as_uuid=True), ForeignKey("nomina_empleados.id"), nullable=False, index=True)
    contrato_id = Column(UUID(as_uuid=True), ForeignKey("nomina_contratos.id"), nullable=False, index=True)
    salario_base = Column(Numeric(14, 2), nullable=False, default=0)
    total_devengos = Column(Numeric(14, 2), nullable=False, default=0)
    total_deducciones = Column(Numeric(14, 2), nullable=False, default=0)
    neto_pagar = Column(Numeric(14, 2), nullable=False, default=0)
    auxilio_transporte_devengo = Column(Numeric(14, 2), nullable=False, default=0)
    base_cotizacion = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_salud_empleado = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_pension_empleado = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_fsp_empleado = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_subsistencia_empleado = Column(Numeric(14, 2), nullable=False, default=0)
    retencion_fuente_empleado = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_salud_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_pension_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_arl_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_caja_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_sena_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    aporte_icbf_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    provision_prima = Column(Numeric(14, 2), nullable=False, default=0)
    provision_cesantias = Column(Numeric(14, 2), nullable=False, default=0)
    provision_intereses_cesantias = Column(Numeric(14, 2), nullable=False, default=0)
    provision_vacaciones = Column(Numeric(14, 2), nullable=False, default=0)
    costo_total_empresa = Column(Numeric(14, 2), nullable=False, default=0)
    desprendible_folio = Column(String(30), nullable=True, index=True)
    desprendible_version = Column(Integer, nullable=False, default=1)
    desprendible_pdf_relpath = Column(String(512), nullable=True)
    desprendible_pdf_sha256 = Column(String(64), nullable=True)
    desprendible_generated_at = Column(DateTime, nullable=True)
    observaciones = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)

    periodo = relationship("NominaPeriodo", back_populates="liquidaciones")
    versiones_desprendible = relationship(
        "NominaDesprendibleVersion",
        back_populates="liquidacion",
        cascade="all, delete-orphan",
    )


class NominaDesprendibleVersion(Base):
    __tablename__ = "nomina_desprendible_versiones"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "liquidacion_id",
            "version",
            name="ux_nomina_desprendible_version",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    liquidacion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("nomina_liquidaciones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    periodo_id = Column(UUID(as_uuid=True), ForeignKey("nomina_periodos.id"), nullable=False, index=True)
    empleado_id = Column(UUID(as_uuid=True), ForeignKey("nomina_empleados.id"), nullable=False, index=True)
    folio = Column(String(30), nullable=True, index=True)
    version = Column(Integer, nullable=False)
    pdf_relpath = Column(String(512), nullable=False)
    pdf_sha256 = Column(String(64), nullable=False)
    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    generated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    motivo = Column(String(40), nullable=False, default="generacion")

    liquidacion = relationship("NominaLiquidacion", back_populates="versiones_desprendible")


class NominaCentroCosto(Base):
    __tablename__ = "nomina_centros_costo"
    __table_args__ = (
        UniqueConstraint("tenant_id", "codigo", name="ux_nomina_centro_costo_codigo_tenant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    sucursal_id = Column(UUID(as_uuid=True), ForeignKey("sucursales.id"), nullable=True, index=True)
    codigo = Column(String(30), nullable=False)
    nombre = Column(String(160), nullable=False)
    descripcion = Column(Text, nullable=True)
    activo = Column(String(10), nullable=False, default="si")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)


class NominaParametroLegal(Base):
    __tablename__ = "nomina_parametros_legales"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="ux_nomina_parametros_legales_tenant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    salario_minimo_mensual = Column(Numeric(14, 2), nullable=False, default=0)
    auxilio_transporte_mensual = Column(Numeric(14, 2), nullable=False, default=0)
    uvt = Column(Numeric(14, 2), nullable=False, default=0)
    tope_ibc_smmlv = Column(Numeric(6, 2), nullable=False, default=25)
    umbral_exoneracion_smmlv = Column(Numeric(6, 2), nullable=False, default=10)
    exoneracion_aportes_activa = Column(Boolean, nullable=False, default=True)
    aplica_auxilio_transporte = Column(Boolean, nullable=False, default=True)
    umbral_auxilio_transporte_smmlv = Column(Numeric(6, 2), nullable=False, default=2)
    aplica_fsp = Column(Boolean, nullable=False, default=True)
    umbral_fsp_smmlv = Column(Numeric(6, 2), nullable=False, default=4)
    pct_fsp_base = Column(Numeric(6, 5), nullable=False, default=Decimal("0.01"))
    aplica_subsistencia = Column(Boolean, nullable=False, default=True)
    aplica_retencion_fuente = Column(Boolean, nullable=False, default=False)
    umbral_retencion_uvt = Column(Numeric(8, 2), nullable=False, default=95)
    pct_retencion_base = Column(Numeric(6, 5), nullable=False, default=Decimal("0.19"))
    pct_ibc_salario_integral = Column(Numeric(6, 5), nullable=False, default=Decimal("0.70"))
    pct_salud_empleado = Column(Numeric(6, 5), nullable=False, default=Decimal("0.04"))
    pct_pension_empleado = Column(Numeric(6, 5), nullable=False, default=Decimal("0.04"))
    pct_salud_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.085"))
    pct_pension_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.12"))
    pct_arl_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.00522"))
    pct_caja_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.04"))
    pct_sena_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.02"))
    pct_icbf_empresa = Column(Numeric(6, 5), nullable=False, default=Decimal("0.03"))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
