from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.models import UsageKind
from app.providers.embeddings import get_embedding_provider
from app.rag.retrieval import RetrievalScope, RetrievalService
from app.schemas.chat import SearchRequest, SearchResponse, SearchResultOut
from app.services.auth import AuthContext
from app.services.usage import record_usage

router = APIRouter(tags=["pesquisa"])


@router.post("/search", response_model=SearchResponse)
def search(
    payload: SearchRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> SearchResponse:
    provider = get_embedding_provider()  # 503 ai_unavailable se não configurado
    scope = RetrievalScope(
        workspace_id=ctx.workspace_id,
        document_ids=payload.document_ids,
        collection_ids=payload.collection_ids,
    )
    result = RetrievalService(db, provider).retrieve(payload.query, scope, top_k=payload.top_k)
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.SEARCH,
        provider=provider.name,
        model=result.embedding_model,
        prompt_tokens=result.embedding_tokens,
        latency_ms=result.total_latency_ms,
        extra={"results": len(result.chunks)},
    )
    db.commit()
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
            )
            for c in result.chunks
        ],
        latency_ms=result.total_latency_ms,
        embedding_model=result.embedding_model,
    )
