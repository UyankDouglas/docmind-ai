"""Geração de embeddings para chunks e gravação no pgvector.

Processo por lote: recebe chunks → gera vetores → valida dimensão → grava EmbeddingRecord
(1:1 com o chunk) com modelo, dimensão e data. Idempotente: chunks já indexados com o mesmo
modelo são ignorados.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import DocumentChunk, EmbeddingRecord
from app.models.base import utcnow
from app.providers.embeddings import EmbeddingProvider, validate_dimensions

log = get_logger(__name__)


@dataclass(slots=True)
class IndexingStats:
    chunks_total: int = 0
    chunks_embedded: int = 0
    chunks_skipped: int = 0
    prompt_tokens: int = 0
    batches: int = 0
    latency_ms: int = 0


class EmbeddingIndexer:
    def __init__(
        self,
        db: Session,
        provider: EmbeddingProvider,
        *,
        batch_size: int = 32,
        expected_dimensions: int | None = None,
    ) -> None:
        self.db = db
        self.provider = provider
        self.batch_size = batch_size
        self.expected_dimensions = expected_dimensions or provider.dimensions

    def index_document_chunks(
        self,
        document_id: uuid.UUID,
        workspace_id: uuid.UUID,
        *,
        should_cancel: Callable[[], bool] | None = None,
        on_progress: Callable[[IndexingStats], None] | None = None,
    ) -> IndexingStats:
        stats = IndexingStats()
        chunks = list(
            self.db.scalars(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == document_id)
                .order_by(DocumentChunk.position)
            )
        )
        stats.chunks_total = len(chunks)
        existing = {
            r.chunk_id
            for r in self.db.scalars(
                select(EmbeddingRecord).where(
                    EmbeddingRecord.document_id == document_id,
                    EmbeddingRecord.model == self.provider.model,
                )
            )
        }
        pending = [c for c in chunks if c.id not in existing]
        stats.chunks_skipped = len(chunks) - len(pending)

        for i in range(0, len(pending), self.batch_size):
            if should_cancel and should_cancel():
                log.info("indexing_cancelled", document_id=str(document_id))
                break
            batch = pending[i : i + self.batch_size]
            result = self.provider.embed_texts([c.text for c in batch])
            validate_dimensions(result.vectors, self.expected_dimensions)
            now = utcnow()
            for chunk, vector in zip(batch, result.vectors, strict=True):
                if chunk.workspace_id != workspace_id:  # defesa adicional
                    raise RuntimeError("Chunk fora do workspace esperado durante indexação.")
                self.db.add(
                    EmbeddingRecord(
                        chunk_id=chunk.id,
                        document_id=chunk.document_id,
                        workspace_id=chunk.workspace_id,
                        model=result.model,
                        dimensions=result.dimensions,
                        embedding=vector,
                        indexed_at=now,
                    )
                )
            self.db.flush()
            stats.chunks_embedded += len(batch)
            stats.prompt_tokens += result.prompt_tokens
            stats.latency_ms += result.latency_ms
            stats.batches += 1
            if on_progress:
                on_progress(stats)
        return stats
