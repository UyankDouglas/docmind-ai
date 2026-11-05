from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_auth, storage_dep
from app.core.database import get_db
from app.providers.storage import ObjectStorage
from app.schemas.system import DemoSamplesOut
from app.services import demo as demo_service
from app.services.auth import AuthContext

router = APIRouter(prefix="/demo", tags=["demonstração"])


@router.post("/samples", response_model=DemoSamplesOut, status_code=status.HTTP_202_ACCEPTED)
def load_samples(
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(storage_dep),
) -> DemoSamplesOut:
    """Só no modo demonstração (404 fora dele): envia os documentos fictícios ao workspace atual."""
    result = demo_service.load_samples(db, storage, ctx, ip_address=client_ip(request))
    return DemoSamplesOut(
        collection_id=str(result.collection_id) if result.collection_id else None,
        loaded=result.loaded,
        skipped=result.skipped,
        stopped_reason=result.stopped_reason,
    )
