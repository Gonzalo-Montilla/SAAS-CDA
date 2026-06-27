"""
Modelos base para módulo de Exógena (MVP Sprint 1).
"""
from datetime import datetime, timezone
import enum
import uuid

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class ExogenaExecutionStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCESS = "success"
    ERROR = "error"


class ExogenaValidationSeverity(str, enum.Enum):
    ERROR = "error"
    WARNING = "warning"


class ExogenaAnualParametro(Base):
    __tablename__ = "exogena_parametros_anuales"
    __table_args__ = (
        UniqueConstraint("tenant_id", "anio", name="ux_exogena_parametros_tenant_anio"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    anio = Column(String(4), nullable=False, index=True)
    uvt_anual = Column(Integer, nullable=False, default=0)
    topes_por_formato_json = Column(JSONB, nullable=False, default=dict)
    version_normativa = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)


class ExogenaMapeo(Base):
    __tablename__ = "exogena_mapeos"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "anio",
            "formato",
            "cuenta_contable",
            "concepto",
            "categoria",
            name="ux_exogena_mapeo_tenant_anio_formato_cuenta_concepto_categoria",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    anio = Column(String(4), nullable=False, index=True)
    formato = Column(String(10), nullable=False, index=True)
    cuenta_contable = Column(String(30), nullable=False)
    concepto = Column(String(20), nullable=False)
    categoria = Column(String(80), nullable=False, default="")
    saldo_a_reportar = Column(String(30), nullable=False, default="saldo_final")
    source_rule = Column(String(255), nullable=True)
    activo = Column(String(10), nullable=False, default="si")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)


class ExogenaEjecucion(Base):
    __tablename__ = "exogena_ejecuciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    anio = Column(String(4), nullable=False, index=True)
    formato = Column(String(10), nullable=False, index=True)
    status = Column(SQLEnum(ExogenaExecutionStatus), nullable=False, default=ExogenaExecutionStatus.PENDING)
    total_rows = Column(Integer, nullable=False, default=0)
    total_errors = Column(Integer, nullable=False, default=0)
    total_warnings = Column(Integer, nullable=False, default=0)
    archivo_relpath = Column(String(512), nullable=True)
    archivo_sha256 = Column(String(64), nullable=True)
    omitidos_relpath = Column(String(512), nullable=True)
    omitidos_sha256 = Column(String(64), nullable=True)
    omitidos_rows = Column(Integer, nullable=False, default=0)
    fuente_resumen_json = Column(JSONB, nullable=False, default=list)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)


class ExogenaValidacion(Base):
    __tablename__ = "exogena_validaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    ejecucion_id = Column(UUID(as_uuid=True), ForeignKey("exogena_ejecuciones.id"), nullable=True, index=True)
    anio = Column(String(4), nullable=False, index=True)
    formato = Column(String(10), nullable=False, index=True)
    severidad = Column(SQLEnum(ExogenaValidationSeverity), nullable=False)
    codigo = Column(String(60), nullable=False)
    mensaje = Column(Text, nullable=False)
    referencia_origen = Column(String(200), nullable=True)
    metadata_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
