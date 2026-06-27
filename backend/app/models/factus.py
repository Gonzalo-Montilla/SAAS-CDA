"""
Configuración Factus por tenant y registro de documentos electrónicos.
"""
from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class TenantFactusSettings(Base):
    """Factus del CDA (tenant) para su operación (cobros a ciudadanos, terceros, DSE, etc.).

    No almacena la cuenta de P. ej. PROMETHEUS; la factura de suscripción al SaaS usa
    `SAAS_BILLING_FACTUS_*` en la app (otro comercio emisor y otro juego de credenciales en Factus).
    """

    __tablename__ = "tenant_factus_settings"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    modo = Column(String(20), nullable=False, default="manual")  # manual | factus
    use_sandbox = Column(Boolean, nullable=False, default=True)

    # Credenciales ambiente de pruebas (sandbox / api-sandbox.factus.com.co)
    client_id = Column(String(200), nullable=True)
    client_secret_encrypted = Column(Text, nullable=True)
    api_username = Column(String(255), nullable=True)
    api_password_encrypted = Column(Text, nullable=True)

    # Credenciales producción (api.factus.com.co) — misma forma que sandbox; se usan si use_sandbox es False
    production_client_id = Column(String(200), nullable=True)
    production_client_secret_encrypted = Column(Text, nullable=True)
    production_api_username = Column(String(255), nullable=True)
    production_api_password_encrypted = Column(Text, nullable=True)

    default_numbering_range_id = Column(Integer, nullable=True)
    documento_soporte_numbering_range_id = Column(Integer, nullable=True)
    # Notificaciones documento soporte (análogo a send_email en factura: proveedor vía Factus + copia CDA vía SMTP)
    documento_soporte_notificar_proveedor_factus = Column(Boolean, nullable=False, default=True)
    documento_soporte_correo_notificacion_cda = Column(String(255), nullable=True)
    # Entorno retenciones DSE (fase 1): qué conceptos usa el CDA; el motor usará este subconjunto.
    dse_retencion_usar_compras = Column(Boolean, nullable=False, default=True)
    dse_retencion_usar_servicios = Column(Boolean, nullable=False, default=True)
    dse_retencion_usar_arrendamiento = Column(Boolean, nullable=False, default=True)
    dse_retencion_usar_honorarios = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class FacturaElectronica(Base):
    """Traza de documentos emitidos vía Factus (vinculación con cobro en fases posteriores)."""

    __tablename__ = "facturas_electronicas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    vehiculo_proceso_id = Column(UUID(as_uuid=True), ForeignKey("vehiculos_proceso.id", ondelete="SET NULL"), nullable=True, index=True)
    billing_checkout_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_billing_checkout_sessions.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
        index=True,
    )

    reference_code = Column(String(120), nullable=False, index=True)
    factus_bill_id = Column(Integer, nullable=True)
    numero_documento = Column(String(80), nullable=True)
    cufe = Column(String(200), nullable=True)
    public_url = Column(String(800), nullable=True)
    emitido_por_usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    pdf_storage_relpath = Column(String(512), nullable=True)
    pdf_sha256_hex = Column(String(64), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class FacturaCorreccion(Base):
    """Historial de correcciones por factura emitida (NC + reemisión)."""

    __tablename__ = "facturas_correcciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    vehiculo_proceso_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vehiculos_proceso.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    factura_electronica_original_id = Column(
        UUID(as_uuid=True),
        ForeignKey("facturas_electronicas.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    factura_electronica_nueva_id = Column(
        UUID(as_uuid=True),
        ForeignKey("facturas_electronicas.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    motivo = Column(String(40), nullable=False)
    estado = Column(String(20), nullable=False, default="completed")  # completed | failed
    error_detalle = Column(Text, nullable=True)

    factura_original_numero = Column(String(80), nullable=True)
    factura_original_factus_bill_id = Column(Integer, nullable=True)
    nota_credito_numero = Column(String(80), nullable=True)
    nota_credito_factus_id = Column(Integer, nullable=True)
    factura_nueva_numero = Column(String(80), nullable=True)
    factura_nueva_factus_bill_id = Column(Integer, nullable=True)

    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    ejecutado_por_usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class DocumentoSoporteElectronico(Base):
    """Documento soporte DIAN emitido por el comprador (CDA) vía Factus, vinculado a un egreso."""

    __tablename__ = "documentos_soporte_electronicos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    source_module = Column(String(20), nullable=False)
    movimiento_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    reference_code = Column(String(120), nullable=False, index=True)
    factus_document_id = Column(Integer, nullable=True)
    numero_documento = Column(String(80), nullable=True)
    cuds = Column(String(200), nullable=True)
    public_url = Column(String(800), nullable=True)
    emitido_por_usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    pdf_storage_relpath = Column(String(512), nullable=True)
    pdf_sha256_hex = Column(String(64), nullable=True)
    # Instantánea del concepto de retención del proveedor de catálogo al emitir (fase 2: montos / payload Factus).
    concepto_retencion_dse = Column(String(32), nullable=True)
    # Motor parametrizable (UVT + tasas por año); null si no hubo cálculo (sin concepto/tasa/UVT).
    retencion_calculada_cop = Column(Numeric(14, 2), nullable=True)
    retencion_calculo_anio = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
