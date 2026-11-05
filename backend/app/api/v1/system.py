from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.schemas.system import AiStatus, HealthOut, InstanceInfo, UsageOut
from app.services import demo as demo_service
from app.services import system as system_service
from app.services.auth import AuthContext
from app.services.usage import usage_summary

router = APIRouter(tags=["sistema"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)) -> dict:
    return system_service.health(db)


@router.get("/instance", response_model=InstanceInfo)
def instance() -> dict:
    """Público: modo demonstração, cadastro habilitado e aviso exibido antes do login."""
    return demo_service.instance_info()


@router.get("/settings/ai", response_model=AiStatus)
def ai_settings(ctx: AuthContext = Depends(get_current_auth)) -> dict:
    return system_service.ai_status(ctx.workspace.external_ai_enabled)


@router.get("/usage", response_model=UsageOut)
def usage(ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)) -> dict:
    return usage_summary(db, ctx.workspace_id, ctx.user.id)
