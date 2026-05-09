"""
Helpers de auditoría SARLAFT.
"""
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.sarlaft_audit_log import SarlaftAuditLog
from app.models.usuario import Usuario


def log_sarlaft_event(
    db: Session,
    *,
    tenant_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID | None = None,
    actor_user: Usuario | None = None,
    before_json: dict[str, Any] | None = None,
    after_json: dict[str, Any] | None = None,
) -> SarlaftAuditLog:
    row = SarlaftAuditLog(
        tenant_id=tenant_id,
        actor_user_id=actor_user.id if actor_user else None,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        before_json=before_json,
        after_json=after_json,
    )
    db.add(row)
    return row
