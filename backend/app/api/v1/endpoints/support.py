"""
Endpoints de soporte para tenants (CDA).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.audit_log import AuditLog
from app.models.support_ticket import SaaSSupportTicket
from app.models.usuario import Usuario

router = APIRouter()

TENANT_SUPPORT_PRIORITIES = {"baja", "media", "alta", "critica"}


class TenantSupportTicketCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=8, max_length=4000)
    category: str = Field(default="general", max_length=40)
    priority: str = Field(default="media")


class TenantSupportTicketItem(BaseModel):
    id: str
    title: str
    description: str
    category: str
    priority: str
    status: str
    assigned_to_user_email: str | None = None
    tenant_response_message: str | None = None
    tenant_responded_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


def _validate_priority(priority: str) -> str:
    normalized = (priority or "").strip().lower()
    if normalized not in TENANT_SUPPORT_PRIORITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Prioridad inválida. Usa: {', '.join(sorted(TENANT_SUPPORT_PRIORITIES))}",
        )
    return normalized


def _extract_request_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("/tickets", response_model=list[TenantSupportTicketItem])
def list_my_support_tickets(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rows = (
        db.query(SaaSSupportTicket)
        .filter(SaaSSupportTicket.tenant_id == current_user.tenant_id)
        .order_by(SaaSSupportTicket.created_at.desc())
        .limit(100)
        .all()
    )

    assigned_user_ids = [ticket.assigned_to_saas_user_id for ticket in rows if ticket.assigned_to_saas_user_id]
    assigned_email_map: dict[str, str] = {}
    if assigned_user_ids:
        from app.models.saas_user import SaaSUser

        users = db.query(SaaSUser).filter(SaaSUser.id.in_(assigned_user_ids)).all()
        assigned_email_map = {str(u.id): u.email for u in users}

    return [
        TenantSupportTicketItem(
            id=str(ticket.id),
            title=ticket.title,
            description=ticket.description,
            category=ticket.category,
            priority=ticket.priority,
            status=ticket.status,
            assigned_to_user_email=(
                assigned_email_map.get(str(ticket.assigned_to_saas_user_id))
                if ticket.assigned_to_saas_user_id
                else None
            ),
            tenant_response_message=ticket.tenant_response_message,
            tenant_responded_at=ticket.tenant_responded_at,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
            resolved_at=ticket.resolved_at,
        )
        for ticket in rows
    ]


@router.post("/tickets", response_model=TenantSupportTicketItem, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    payload: TenantSupportTicketCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    normalized_priority = _validate_priority(payload.priority)
    category = (payload.category or "general").strip().lower()[:40] or "general"

    ticket = SaaSSupportTicket(
        tenant_id=current_user.tenant_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=category,
        priority=normalized_priority,
        status="abierto",
        assigned_to_saas_user_id=None,
        created_by_saas_user_id=None,  # Ticket originado por tenant.
        internal_notes=None,
        sla_due_at=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(ticket)
    db.flush()

    audit_log = AuditLog(
        action="tenant_support_ticket_create",
        description=f"Tenant creó ticket de soporte: {ticket.title}",
        usuario_id=current_user.id,
        usuario_email=current_user.email,
        usuario_nombre=current_user.nombre_completo,
        usuario_rol=str(current_user.rol.value if hasattr(current_user.rol, "value") else current_user.rol),
        ip_address=_extract_request_ip(request),
        user_agent=request.headers.get("User-Agent"),
        extra_data={
            "ticket_id": str(ticket.id),
            "tenant_id": str(current_user.tenant_id),
            "priority": ticket.priority,
            "category": ticket.category,
        },
        success="success",
    )
    db.add(audit_log)
    db.commit()
    db.refresh(ticket)

    return TenantSupportTicketItem(
        id=str(ticket.id),
        title=ticket.title,
        description=ticket.description,
        category=ticket.category,
        priority=ticket.priority,
        status=ticket.status,
        assigned_to_user_email=None,
        tenant_response_message=ticket.tenant_response_message,
        tenant_responded_at=ticket.tenant_responded_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        resolved_at=ticket.resolved_at,
    )

