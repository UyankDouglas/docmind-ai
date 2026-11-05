from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.schemas.analysis import AnalysisOut, CompareRequest, SummarizeRequest, analysis_out
from app.schemas.common import Paginated
from app.services import analyses as svc
from app.services import chat as chat_service
from app.services.auth import AuthContext

router = APIRouter(tags=["análises"])


@router.post("/documents/compare", response_model=AnalysisOut, status_code=status.HTTP_202_ACCEPTED)
def compare(
    payload: CompareRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    return analysis_out(
        svc.create_comparison(db, ctx, payload.document_ids, question=payload.question)
    )


@router.post(
    "/documents/{document_id}/summarize",
    response_model=AnalysisOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def summarize(
    document_id: uuid.UUID,
    payload: SummarizeRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    return analysis_out(svc.create_summary(db, ctx, document_id, summary_type=payload.type))


@router.post(
    "/documents/{document_id}/topics",
    response_model=AnalysisOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def topics(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    return analysis_out(svc.create_topics(db, ctx, document_id))


@router.post("/documents/{document_id}/questions", response_model=AnalysisOut)
def questions(
    document_id: uuid.UUID,
    response: Response,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    analysis, created = svc.create_or_reuse_questions(db, ctx, document_id)
    response.status_code = status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK
    return analysis_out(analysis)


@router.get("/analyses", response_model=Paginated[AnalysisOut])
def list_analyses(
    document_id: uuid.UUID | None = Query(default=None),
    kind: str | None = Query(default=None, max_length=20),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Paginated[AnalysisOut]:
    items, total = svc.list_analyses(
        db, ctx, document_id=document_id, kind=kind, page=page, page_size=page_size
    )
    return Paginated(
        items=[analysis_out(a) for a in items], total=total, page=page, page_size=page_size
    )


@router.get("/analyses/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    return analysis_out(svc.get_analysis(db, ctx, analysis_id))


@router.delete("/analyses/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(
    analysis_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    svc.delete_analysis(db, ctx, svc.get_analysis(db, ctx, analysis_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/analyses/{analysis_id}/cancel", response_model=AnalysisOut)
def cancel_analysis(
    analysis_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> AnalysisOut:
    return analysis_out(svc.cancel_analysis(db, ctx, svc.get_analysis(db, ctx, analysis_id)))


def _download(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/analyses/{analysis_id}/export")
def export_analysis(
    analysis_id: uuid.UUID,
    format: str = Query(default="md", pattern="^(md|json)$"),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    a = svc.get_analysis(db, ctx, analysis_id)
    return _download(*svc.export_analysis(a, format))


@router.get("/conversations/{conversation_id}/export")
def export_conversation(
    conversation_id: uuid.UUID,
    format: str = Query(default="md", pattern="^(md|json)$"),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    conv = chat_service.get_conversation(db, ctx, conversation_id)
    return _download(*svc.export_conversation(db, conv, format))
