from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog
from app.models.base import utcnow


def record_audit(
    db: Session,
    *,
    action: str,
    workspace_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Registra uma ação de auditoria. `details` nunca deve conter conteúdo de documentos."""
    entry = AuditLog(
        action=action,
        workspace_id=workspace_id,
        user_id=user_id,
        target_type=target_type,
        target_id=target_id,
        ip_address=ip_address,
        details=details or {},
        created_at=utcnow(),
    )
    db.add(entry)
    return entry
