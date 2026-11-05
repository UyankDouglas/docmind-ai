"""RetrievalService — busca semântica, textual e híbrida com isolamento por workspace.

Responsabilidades:
- Validar o escopo autorizado (workspace da sessão + documentos/coleções acessíveis e prontos).
- Gerar o embedding da pergunta.
- Buscar candidatos por similaridade cosseno (pgvector, exata) e, no modo híbrido, por
  Full-Text Search do PostgreSQL (`tsvector` em português, `websearch_to_tsquery`).
- Fundir os rankings com Reciprocal Rank Fusion e devolver trechos com metadados e métricas.

O `workspace_id` vem sempre da sessão autenticada — nunca do cliente.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ForbiddenError
from app.core.logging import get_logger
from app.models import Document, DocumentChunk, DocumentStatus, EmbeddingRecord
from app.providers.embeddings import EmbeddingProvider
from app.rag.retrieval.fusion import reciprocal_rank_fusion
from app.services.locations import location_label, location_type_for

log = get_logger(__name__)

TS_CONFIG = "portuguese"
MODES = ("vector", "hybrid")
_WORD_RE = re.compile(r"[\wÀ-ÿ]+", re.UNICODE)


def lexical_query(question: str) -> str:
    """Converte uma pergunta em linguagem natural em consulta FTS com OR entre termos.

    `websearch_to_tsquery` usa AND por padrão, o que raramente casa com perguntas completas
    ("Em que dia vence o pagamento?" exige todos os lexemas no mesmo trecho). Com OR, o `ts_rank_cd`
    continua favorecendo trechos que contêm mais termos, e a fusão RRF pondera com o ranking vetorial.
    Frases entre aspas são preservadas como termos exatos.
    """
    quoted = re.findall(r'"([^"]+)"', question)
    rest = re.sub(r'"[^"]+"', " ", question)
    words = [w for w in _WORD_RE.findall(rest) if len(w) > 1]
    parts = [f'"{q.strip()}"' for q in quoted if q.strip()] + words
    return " or ".join(parts) if parts else question


@dataclass(slots=True)
class RetrievalScope:
    """Escopo autorizado, construído pelo backend a partir da sessão."""

    workspace_id: uuid.UUID
    document_ids: list[uuid.UUID] | None = None  # None = todos os documentos prontos do workspace
    collection_ids: list[uuid.UUID] | None = None  # união com document_ids quando informado


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
    mime_type: str = "application/pdf"
    vector_score: float | None = None
    lexical_score: float | None = None
    vector_rank: int | None = None
    lexical_rank: int | None = None
    highlight: str | None = None

    @property
    def location_type(self) -> str:
        return location_type_for(self.mime_type)

    @property
    def location_label(self) -> str:
        return location_label(
            location_type=self.location_type,
            page_start=self.page_start,
            page_end=self.page_end,
            section_title=self.section_title,
            position=self.position,
        )


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
    mode: str = "vector"
    vector_candidates: int = 0
    lexical_candidates: int = 0
    rrf_k: int = 60

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
        explicit = scope.document_ids is not None or scope.collection_ids is not None
        if explicit:
            requested: set[uuid.UUID] = set(scope.document_ids or [])
            if scope.collection_ids:
                from app.models import Collection

                allowed_cols = set(
                    self.db.scalars(
                        select(Collection.id).where(
                            Collection.workspace_id == scope.workspace_id,
                            Collection.id.in_(set(scope.collection_ids)),
                        )
                    )
                )
                if set(scope.collection_ids) - allowed_cols:
                    raise ForbiddenError("Uma ou mais coleções não pertencem ao seu workspace.")
                requested |= set(
                    self.db.scalars(
                        select(Document.id).where(
                            Document.workspace_id == scope.workspace_id,
                            Document.deleted_at.is_(None),
                            Document.collection_id.in_(allowed_cols),
                        )
                    )
                )
            if not requested:
                return []
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

    # ---------------------------------------------------------------- candidatos
    def _isolation_filters(self, workspace_id: uuid.UUID, doc_ids: list[uuid.UUID]) -> list:
        return [
            DocumentChunk.workspace_id == workspace_id,
            Document.workspace_id == workspace_id,
            DocumentChunk.document_id.in_(doc_ids),
            DocumentChunk.indexing_version == Document.indexing_version,
            Document.deleted_at.is_(None),
        ]

    def _vector_candidates(
        self,
        query_vector: list[float],
        workspace_id: uuid.UUID,
        doc_ids: list[uuid.UUID],
        limit: int,
    ) -> list[tuple[DocumentChunk, str, str, float]]:
        distance = EmbeddingRecord.embedding.cosine_distance(query_vector)
        stmt = (
            select(DocumentChunk, Document.name, Document.mime_type, distance.label("distance"))
            .join(EmbeddingRecord, EmbeddingRecord.chunk_id == DocumentChunk.id)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                EmbeddingRecord.workspace_id == workspace_id,
                EmbeddingRecord.document_id.in_(doc_ids),
                # Nunca mistura embeddings de modelos diferentes
                EmbeddingRecord.model == self.provider.model,
                EmbeddingRecord.dimensions == self.provider.dimensions,
                *self._isolation_filters(workspace_id, doc_ids),
            )
            .order_by(distance.asc())
            .limit(limit)
        )
        return [(c, n, m, 1.0 - float(d)) for c, n, m, d in self.db.execute(stmt).all()]

    def _lexical_candidates(
        self, query: str, workspace_id: uuid.UUID, doc_ids: list[uuid.UUID], limit: int
    ) -> list[tuple[DocumentChunk, str, str, float, str | None]]:
        """Primeiro exige todos os termos (AND, mais preciso); se nada casar, relaxa para OR."""
        rows = self._lexical_rows(query, workspace_id, doc_ids, limit)
        if not rows:
            relaxed = lexical_query(query)
            if relaxed != query:
                rows = self._lexical_rows(relaxed, workspace_id, doc_ids, limit)
        return rows

    def _lexical_rows(
        self, query_text: str, workspace_id: uuid.UUID, doc_ids: list[uuid.UUID], limit: int
    ) -> list[tuple[DocumentChunk, str, str, float, str | None]]:
        tsquery = func.websearch_to_tsquery(TS_CONFIG, query_text)
        rank = func.ts_rank_cd(DocumentChunk.text_search, tsquery)
        headline = func.ts_headline(
            TS_CONFIG,
            DocumentChunk.text,
            tsquery,
            "StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2",
        )
        stmt = (
            select(DocumentChunk, Document.name, Document.mime_type, rank.label("rank"), headline)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                DocumentChunk.text_search.op("@@")(tsquery),
                *self._isolation_filters(workspace_id, doc_ids),
            )
            .order_by(rank.desc(), DocumentChunk.position.asc())
            .limit(limit)
        )
        return [(c, n, m, float(r), h) for c, n, m, r, h in self.db.execute(stmt).all()]

    # ---------------------------------------------------------------- busca
    def retrieve(
        self,
        query: str,
        scope: RetrievalScope,
        *,
        mode: str = "vector",
        top_k: int | None = None,
        min_similarity: float | None = None,
        rrf_k: int = 60,
    ) -> RetrievalResult:
        if mode not in MODES:
            raise ValueError(f"modo de recuperação inválido: {mode}")
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
                mode=mode,
                rrf_k=rrf_k,
            )

        started = time.perf_counter()
        # No modo híbrido buscamos mais candidatos em cada ranking para a fusão ter material
        candidate_limit = top_k if mode == "vector" else max(top_k * 2, 10)
        vec_rows = self._vector_candidates(
            query_vector, scope.workspace_id, doc_ids, candidate_limit
        )
        vec_rows = [row for row in vec_rows if row[3] >= min_similarity]
        lex_rows = (
            self._lexical_candidates(query, scope.workspace_id, doc_ids, candidate_limit)
            if mode == "hybrid"
            else []
        )
        search_ms = int((time.perf_counter() - started) * 1000)

        by_id: dict[uuid.UUID, RetrievedChunk] = {}
        for rank, (chunk, name, mime, sim) in enumerate(vec_rows, start=1):
            by_id[chunk.id] = RetrievedChunk(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_name=name,
                text=chunk.text,
                score=round(sim, 4),
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                section_title=chunk.section_title,
                position=chunk.position,
                token_count=chunk.token_count,
                mime_type=mime,
                vector_score=round(sim, 4),
                vector_rank=rank,
            )
        if lex_rows:
            max_rank = max(r for _, _, _, r, _ in lex_rows) or 1.0
            for rank, (chunk, name, mime, lex, headline) in enumerate(lex_rows, start=1):
                norm = round(lex / max_rank, 4)
                item = by_id.get(chunk.id)
                if item is None:
                    item = RetrievedChunk(
                        chunk_id=chunk.id,
                        document_id=chunk.document_id,
                        document_name=name,
                        text=chunk.text,
                        score=0.0,
                        page_start=chunk.page_start,
                        page_end=chunk.page_end,
                        section_title=chunk.section_title,
                        position=chunk.position,
                        token_count=chunk.token_count,
                        mime_type=mime,
                    )
                    by_id[chunk.id] = item
                item.lexical_score = norm
                item.lexical_rank = rank
                item.highlight = headline

        if mode == "hybrid":
            fused = reciprocal_rank_fusion(
                {
                    "vector": [c.id for c, *_ in vec_rows],
                    "lexical": [c.id for c, *_ in lex_rows],
                },
                k=rrf_k,
            )
            ordered: list[RetrievedChunk] = []
            for item in fused[:top_k]:
                chunk = by_id[item.key]
                chunk.score = round(item.score, 6)
                ordered.append(chunk)
        else:
            ordered = sorted(by_id.values(), key=lambda c: -c.score)[:top_k]

        log.info(
            "retrieval_done",
            workspace_id=str(scope.workspace_id),
            mode=mode,
            documents=len(doc_ids),
            vector_candidates=len(vec_rows),
            lexical_candidates=len(lex_rows),
            results=len(ordered),
            top_k=top_k,
            search_ms=search_ms,
            embedding_ms=emb.latency_ms,
        )
        return RetrievalResult(
            query=query,
            chunks=ordered,
            embedding_model=emb.model,
            embedding_tokens=emb.prompt_tokens,
            embedding_latency_ms=emb.latency_ms,
            search_latency_ms=search_ms,
            top_k=top_k,
            min_similarity=min_similarity,
            scoped_document_ids=doc_ids,
            mode=mode,
            vector_candidates=len(vec_rows),
            lexical_candidates=len(lex_rows),
            rrf_k=rrf_k,
        )
