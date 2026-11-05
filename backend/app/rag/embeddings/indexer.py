"""Geração de embeddings para chunks e gravação no pgvector.

Processo por lote: recebe chunks → gera vetores → valida dimensão → grava EmbeddingRecord
(1:1 com o chunk) com modelo, dimensão e data. Idempotente: chunks já indexados com o mesmo
modelo e dimensão são ignorados; chunks com embedding de **outro** modelo (ex.: OpenAI →
Gemini) têm o registro substituído no lugar, respeitando a unicidade de `chunk_id`.
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
    chunks_replaced: int = 0  # embeddings de outro modelo substituídos no lugar
    prompt_tokens: int = 0
    batches: int = 0
    latency_ms: int = 0
    tokens_source: str = "provider"


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
        existing: dict[uuid.UUID, EmbeddingRecord] = {
            r.chunk_id: r
            for r in self.db.scalars(
                select(EmbeddingRecord).where(EmbeddingRecord.document_id == document_id)
            )
        }

        def _current(record: EmbeddingRecord | None) -> bool:
            return (
                record is not None
                and record.model == self.provider.model
                and record.dimensions == self.expected_dimensions
            )

        pending = [c for c in chunks if not _current(existing.get(c.id))]
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
                record = existing.get(chunk.id)
                if record is None:
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
                else:
                    # Substituição no lugar: `chunk_id` é único, então nunca inserimos um segundo
                    # registro para o mesmo chunk; o vetor antigo (outro modelo) deixa de existir.
                    record.model = result.model
                    record.dimensions = result.dimensions
                    record.embedding = vector
                    record.indexed_at = now
                    stats.chunks_replaced += 1
            self.db.flush()
            stats.chunks_embedded += len(batch)
            stats.prompt_tokens += result.prompt_tokens
            stats.latency_ms += result.latency_ms
            stats.batches += 1
            source = (result.extra or {}).get("tokens_source")
            if source and source != "provider":
                stats.tokens_source = str(source)
            if on_progress:
                on_progress(stats)
        return stats
