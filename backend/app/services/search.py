"""Pesquisa semântica/híbrida independente do chat e histórico de pesquisas."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import SearchQuery, UsageKind
from app.models.base import utcnow
from app.providers.embeddings import get_embedding_provider
from app.rag.retrieval import RetrievalResult, RetrievalScope, RetrievalService
from app.services.auth import AuthContext
from app.services.limits import enforce_budget
from app.services.retrieval_settings import get_retrieval_settings
from app.services.usage import record_usage


def run_search(
    db: Session,
    ctx: AuthContext,
    *,
    query: str,
    document_ids: list[uuid.UUID] | None,
    collection_ids: list[uuid.UUID] | None,
    top_k: int | None,
    mode: str | None,
) -> RetrievalResult:
    enforce_budget(db, ctx.workspace)
    provider = get_embedding_provider()  # 503 ai_unavailable se não configurado
    rs = get_retrieval_settings(ctx.workspace)
    scope = RetrievalScope(
        workspace_id=ctx.workspace_id, document_ids=document_ids, collection_ids=collection_ids
    )
    result = RetrievalService(db, provider).retrieve(
        query,
        scope,
        mode=mode or rs.mode,
        top_k=top_k or rs.top_k,
        min_similarity=rs.min_similarity,
        rrf_k=rs.rrf_k,
    )
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.SEARCH,
        provider=provider.name,
        model=result.embedding_model,
        prompt_tokens=result.embedding_tokens,
        latency_ms=result.total_latency_ms,
        extra={"results": len(result.chunks), "mode": result.mode},
    )
    db.add(
        SearchQuery(
            workspace_id=ctx.workspace_id,
            user_id=ctx.user.id,
            query=query[:1000],
            mode=result.mode,
            result_count=len(result.chunks),
            latency_ms=result.total_latency_ms,
            created_at=utcnow(),
        )
    )
    db.commit()
    return result


def list_history(db: Session, ctx: AuthContext, *, limit: int = 20) -> list[SearchQuery]:
    return list(
        db.scalars(
            select(SearchQuery)
            .where(SearchQuery.workspace_id == ctx.workspace_id, SearchQuery.user_id == ctx.user.id)
            .order_by(SearchQuery.created_at.desc())
            .limit(limit)
        )
    )


def clear_history(db: Session, ctx: AuthContext) -> None:
    db.execute(
        delete(SearchQuery).where(
            SearchQuery.workspace_id == ctx.workspace_id, SearchQuery.user_id == ctx.user.id
        )
    )
    db.commit()
