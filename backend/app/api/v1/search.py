from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.schemas.chat import (
    SearchHistoryItem,
    SearchHistoryList,
    SearchRequest,
    SearchResponse,
    SearchResultOut,
)
from app.services import search as search_service
from app.services.auth import AuthContext

router = APIRouter(tags=["pesquisa"])


@router.post("/search", response_model=SearchResponse)
def search(
    payload: SearchRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> SearchResponse:
    result = search_service.run_search(
        db,
        ctx,
        query=payload.query,
        document_ids=payload.document_ids,
        collection_ids=payload.collection_ids,
        top_k=payload.top_k,
        mode=payload.mode,
    )
    return SearchResponse(
        query=result.query,
        results=[
            SearchResultOut(
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                document_name=c.document_name,
                page_start=c.page_start,
                page_end=c.page_end,
                section_title=c.section_title,
                text=c.text,
                score=c.score,
                location_type=c.location_type,
                location_label=c.location_label,
                mime_type=c.mime_type,
                vector_score=c.vector_score,
                lexical_score=c.lexical_score,
                vector_rank=c.vector_rank,
                lexical_rank=c.lexical_rank,
                highlight=c.highlight,
            )
            for c in result.chunks
        ],
        latency_ms=result.total_latency_ms,
        embedding_model=result.embedding_model,
        mode=result.mode,
        vector_candidates=result.vector_candidates,
        lexical_candidates=result.lexical_candidates,
    )


@router.get("/search/history", response_model=SearchHistoryList)
def history(
    limit: int = Query(default=20, ge=1, le=100),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> SearchHistoryList:
    items = search_service.list_history(db, ctx, limit=limit)
    return SearchHistoryList(
        items=[
            SearchHistoryItem(
                id=i.id,
                query=i.query,
                mode=i.mode,
                result_count=i.result_count,
                latency_ms=i.latency_ms,
                created_at=i.created_at,
            )
            for i in items
        ]
    )


@router.delete("/search/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> Response:
    search_service.clear_history(db, ctx)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
