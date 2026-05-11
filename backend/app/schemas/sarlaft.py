"""
Schemas SARLAFT (Sprint 1).
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SarlaftMode = Literal["manual", "api"]
SarlaftApiTriggerMode = Literal["all", "risk_only", "on_demand"]
SarlaftPaymentMethod = Literal["efectivo", "mixto", "transferencia", "otro"]
SarlaftCasePartyRole = Literal["cliente", "propietario", "pagador", "apoderado"]


class SarlaftProfileResponse(BaseModel):
    enabled: bool
    mode: SarlaftMode
    cash_threshold_cop: Decimal
    api_trigger_mode: SarlaftApiTriggerMode
    api_provider: str | None = None
    api_fallback_to_manual: bool

    model_config = ConfigDict(from_attributes=True)


class SarlaftProfilePatch(BaseModel):
    enabled: bool | None = None
    mode: SarlaftMode | None = None
    cash_threshold_cop: Decimal | None = Field(default=None, ge=0)
    api_trigger_mode: SarlaftApiTriggerMode | None = None
    api_provider: str | None = Field(default=None, max_length=50)
    api_fallback_to_manual: bool | None = None


class SarlaftCasePartyInput(BaseModel):
    role: SarlaftCasePartyRole
    doc_type: str = Field(min_length=1, max_length=20)
    doc_number: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=2, max_length=220)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=300)
    metadata_json: dict[str, Any] | None = None


class SarlaftCaseCreate(BaseModel):
    operacion_ref: str | None = Field(default=None, max_length=120)
    sede_id: UUID | None = None
    transaction_amount_cop: Decimal = Field(ge=0)
    cash_amount_cop: Decimal = Field(ge=0)
    payment_method: SarlaftPaymentMethod
    parties: list[SarlaftCasePartyInput] = Field(min_length=1)

    @field_validator("parties")
    @classmethod
    def validate_parties_have_cliente(cls, value: list[SarlaftCasePartyInput]) -> list[SarlaftCasePartyInput]:
        if not any(p.role == "cliente" for p in value):
            raise ValueError("Debe existir al menos una parte con rol cliente.")
        return value

    @field_validator("cash_amount_cop")
    @classmethod
    def validate_cash_not_greater_than_total(cls, value: Decimal, info):
        total = info.data.get("transaction_amount_cop")
        if total is not None and value > total:
            raise ValueError("El valor en efectivo no puede superar el valor total de la operación.")
        return value


class SarlaftCasePartyResponse(BaseModel):
    id: UUID
    role: str
    doc_type: str
    doc_number: str
    full_name: str
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    address: str | None = None
    metadata_json: dict[str, Any] | None = None

    model_config = ConfigDict(from_attributes=True)


class SarlaftCaseResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    sede_id: UUID | None = None
    sede_nombre: str | None = None
    operacion_ref: str
    status: str
    risk_level: str
    risk_score: Decimal
    transaction_amount_cop: Decimal
    cash_amount_cop: Decimal
    payment_method: str
    vehiculo_id: str | None = None
    placa: str | None = None
    tipo_vehiculo: str | None = None
    cliente_doc_type: str | None = None
    cliente_doc_number: str | None = None
    cliente_full_name: str | None = None
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime | None = None
    parties: list[SarlaftCasePartyResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class SarlaftScreeningRequest(BaseModel):
    schema: Literal["Person", "Company", "LegalEntity"] = "Person"
    full_name: str = Field(min_length=2, max_length=220)
    document_number: str | None = Field(default=None, max_length=60)
    birth_date: str | None = Field(default=None, max_length=20, description="Formato ISO (YYYY-MM-DD o YYYY)")
    nationality: str | None = Field(default=None, max_length=120)
    dataset: str | None = Field(default=None, max_length=60)
    algorithm: str | None = Field(default=None, max_length=40)
    limit: int | None = Field(default=None, ge=1, le=20)
    case_id: UUID | None = Field(default=None, description="Caso SARLAFT a actualizar con la clasificación.")
    persist_in_case: bool = Field(
        default=True,
        description="Si llega case_id, aplica la clasificación al caso.",
    )


class SarlaftScreeningHit(BaseModel):
    entity_id: str | None = None
    caption: str | None = None
    schema: str | None = None
    score: float | None = None
    topics: list[str] = Field(default_factory=list)
    first_seen: str | None = None
    last_seen: str | None = None
    source_url: str | None = None


class SarlaftScreeningResponse(BaseModel):
    provider: str
    dataset: str
    algorithm: str
    threshold: float
    hits: list[SarlaftScreeningHit] = Field(default_factory=list)
    alert: bool
    raw_count: int
    risk_level: Literal["verde", "amarillo", "rojo"]
    recommended_action: str
    case_id: UUID | None = None


class SarlaftCaseSummaryResponse(BaseModel):
    id: UUID
    operacion_ref: str
    status: str
    risk_level: str
    risk_score: Decimal
    payment_method: str
    transaction_amount_cop: Decimal
    cash_amount_cop: Decimal
    placa: str | None = None
    tipo_vehiculo: str | None = None
    cliente_doc_type: str | None = None
    cliente_doc_number: str | None = None
    cliente_full_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SarlaftManualCheckCreate(BaseModel):
    subject_type: Literal["natural", "juridica"] = "natural"
    full_name: str = Field(min_length=2, max_length=220)
    doc_type: str | None = Field(default=None, max_length=20)
    doc_number: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    economic_activity: str | None = Field(default=None, max_length=200)
    legal_representative: str | None = Field(default=None, max_length=220)
    dataset: Literal["default", "sanctions"] = "sanctions"
    algorithm: str = Field(default="best", max_length=40)
    limit: int = Field(default=5, ge=1, le=20)
    nationality: str | None = Field(default=None, max_length=120)
    birth_date: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_required_by_subject_type(self):
        doc_type = (self.doc_type or "").strip().upper()
        doc_number = (self.doc_number or "").strip()
        full_name = (self.full_name or "").strip()
        email = (self.email or "").strip()
        phone = (self.phone or "").strip()
        if not full_name:
            raise ValueError("El nombre o razón social es obligatorio.")
        if not doc_type:
            raise ValueError("El tipo de documento es obligatorio.")
        if not doc_number:
            raise ValueError("El número de documento es obligatorio.")
        if not email:
            raise ValueError("El correo es obligatorio para trazabilidad SARLAFT.")
        if not phone:
            raise ValueError("El celular/teléfono es obligatorio para trazabilidad SARLAFT.")
        if self.subject_type == "juridica" and doc_type != "NIT":
            raise ValueError("Para persona jurídica el tipo de documento debe ser NIT.")
        return self


class SarlaftManualCheckResponse(BaseModel):
    id: UUID
    subject_type: str
    full_name: str
    doc_type: str | None = None
    doc_number: str | None = None
    email: str | None = None
    phone: str | None = None
    economic_activity: str | None = None
    legal_representative: str | None = None
    dataset: str
    algorithm: str
    risk_level: str
    risk_score: Decimal
    alert: bool
    hits_count: int
    notes: str | None = None
    certificate_code: str | None = None
    certificate_issued_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SarlaftCertificateVerificationResponse(BaseModel):
    tenant_slug: str | None = None
    certificate_code: str
    valido: bool
    generated_at: datetime | None = None
    manual_check_id: UUID | None = None
    full_name: str | None = None
    doc_type: str | None = None
    doc_number: str | None = None
    risk_level: str | None = None
    risk_score: Decimal | None = None
    result_label: str | None = None
    detail: str | None = None


class SarlaftInternalAlertResponse(BaseModel):
    id: UUID
    case_id: UUID | None = None
    operacion_ref: str | None = None
    alert_level: str
    operation_classification: str | None = None
    rule_code: str | None = None
    reason: str | None = None
    metrics: dict[str, Any] | None = None
    risk_level: str | None = None
    payment_method: str | None = None
    transaction_amount_cop: Decimal | None = None
    cash_amount_cop: Decimal | None = None
    decision_status: str | None = None
    decision_notes: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime


class SarlaftInternalAlertDecisionRequest(BaseModel):
    decision: Literal["justificada", "sospechosa"]
    notes: str | None = Field(default=None, max_length=2000)
