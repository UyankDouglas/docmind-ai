"""RetrievalService — busca semântica com isolamento por workspace.

Responsabilidades:
- Validar o escopo autorizado (workspace da sessão + documentos acessíveis e prontos).
- Gerar o embedding da pergunta.
- Buscar chunks por similaridade cosseno (pgvector, busca exata nesta fase).
- Filtrar por workspace, documentos e modelo de embedding compatível.
- Retornar trechos com metadados e métricas.

O `workspace_id` vem sempre da sessão autenticada — nunca do cliente.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ForbiddenError
from app.core.logging import get_logger
from app.models import Document, DocumentChunk, DocumentStatus, EmbeddingRecord
from app.providers.embeddings import EmbeddingProvider

log = get_logger(__name__)


@dataclass(slots=True)
class RetrievalScope:
    """Escopo autorizado, construído pelo backend a partir da sessão."""

    workspace_id: uuid.UUID
    document_ids: list[uuid.UUID] | None = None  # None = todos os documentos prontos do workspace


@dataclass(slots=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    text: str
    score: float
    page_start: int | None
    page_end: int | None
    section_title: str | None
    position: int
    token_count: int


@dataclass(slots=True)
class RetrievalResult:
    query: str
    chunks: list[RetrievedChunk]
    embedding_model: str
    embedding_tokens: int
    embedding_latency_ms: int
    search_latency_ms: int
    top_k: int
    min_similarity: float
    scoped_document_ids: list[uuid.UUID] = field(default_factory=list)

    @property
    def total_latency_ms(self) -> int:
        return self.embedding_latency_ms + self.search_latency_ms


class RetrievalService:
    def __init__(self, db: Session, provider: EmbeddingProvider) -> None:
        self.db = db
        self.provider = provider

    # ---------------------------------------------------------------- escopo
    def resolve_scope(self, scope: RetrievalScope) -> list[uuid.UUID]:
        """Retorna os documentos prontos e autorizados. Rejeita IDs fora do workspace."""
        stmt = select(Document.id).where(
            Document.workspace_id == scope.workspace_id,
            Document.deleted_at.is_(None),
            Document.status == DocumentStatus.READY,
        )
        if scope.document_ids is not None:
            if not scope.document_ids:
                return []
            requested = set(scope.document_ids)
            allowed = set(
                self.db.scalars(
                    select(Document.id).where(
                        Document.workspace_id == scope.workspace_id,
                        Document.deleted_at.is_(None),
                        Document.id.in_(requested),
                    )
                )
            )
            if requested - allowed:
                # Não revela quais IDs existem em outros workspaces
                raise ForbiddenError("Um ou mais documentos não pertencem ao seu workspace.")
            stmt = stmt.where(Document.id.in_(requested))
        return list(self.db.scalars(stmt))

    # ---------------------------------------------------------------- busca
    def retrieve(
        self,
        query: str,
        scope: RetrievalScope,
        *,
        top_k: int | None = None,
        min_similarity: float | None = None,
    ) -> RetrievalResult:
        top_k = top_k or settings.retrieval_top_k
        min_similarity = (
            settings.retrieval_min_similarity if min_similarity is None else min_similarity
        )

        doc_ids = self.resolve_scope(scope)
        emb = self.provider.embed_query(query)
        query_vector = emb.vectors[0]

        if not doc_ids:
            return RetrievalResult(
                query,
                [],
                emb.model,
                emb.prompt_tokens,
                emb.latency_ms,
                0,
                top_k,
                min_similarity,
                [],
            )

        started = time.perf_counter()
        distance = EmbeddingRecord.embedding.cosine_distance(query_vector)
        stmt = (
            select(DocumentChunk, Document.name, distance.label("distance"))
            .join(EmbeddingRecord, EmbeddingRecord.chunk_id == DocumentChunk.id)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                # Filtros de isolamento — aplicados em TODAS as tabelas envolvidas
                EmbeddingRecord.workspace_id == scope.workspace_id,
                DocumentChunk.workspace_id == scope.workspace_id,
                Document.workspace_id == scope.workspace_id,
                EmbeddingRecord.document_id.in_(doc_ids),
                # Nunca mistura embeddings de modelos diferentes
                EmbeddingRecord.model == self.provider.model,
                EmbeddingRecord.dimensions == self.provider.dimensions,
                # Somente a versão de indexação ativa do documento
                DocumentChunk.indexing_version == Document.indexing_version,
                Document.deleted_at.is_(None),
            )
            .order_by(distance.asc())
            .limit(top_k)
        )
        rows = self.db.execute(stmt).all()
        search_ms = int((time.perf_counter() - started) * 1000)

        chunks: list[RetrievedChunk] = []
        for chunk, doc_name, dist in rows:
            score = 1.0 - float(dist)
            if score < min_similarity:
                continue
            chunks.append(
                RetrievedChunk(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    document_name=doc_name,
                    text=chunk.text,
                    score=round(score, 4),
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    section_title=chunk.section_title,
                    position=chunk.position,
                    token_count=chunk.token_count,
                )
            )

        log.info(
            "retrieval_done",
            workspace_id=str(scope.workspace_id),
            documents=len(doc_ids),
            results=len(chunks),
            top_k=top_k,
            search_ms=search_ms,
            embedding_ms=emb.latency_ms,
        )
        return RetrievalResult(
            query=query,
            chunks=chunks,
            embedding_model=emb.model,
            embedding_tokens=emb.prompt_tokens,
            embedding_latency_ms=emb.latency_ms,
            search_latency_ms=search_ms,
            top_k=top_k,
            min_similarity=min_similarity,
            scoped_document_ids=doc_ids,
        )
