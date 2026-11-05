"""Reindexação segura de embeddings, incompatibilidade de modelos e erros de provedor no fluxo.

Usa provedores determinísticos com nomes de modelo distintos para simular a troca
OpenAI → Gemini sem rede: embeddings de "fake-hash-v1" ficam fora da busca vetorial quando o
provedor atual é "fake-hash-v2", e a reindexação os substitui no lugar (chunk_id único).
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

from app.core.config import settings
from app.models import Document, DocumentVersion, EmbeddingRecord, ProcessingJob
from app.providers.embeddings import FakeEmbeddingProvider, set_embedding_provider
from app.providers.errors import ProviderAuthError, ProviderQuotaError
from app.providers.llm import set_llm_provider
from app.rag.embeddings.reindex import (
    BACKUP_TABLE,
    REINDEX_FAIL_PREFIX,
    list_backups,
    reindex_documents,
    restore_backup,
    stale_document_ids,
)
from app.rag.retrieval import RetrievalScope, RetrievalService
from app.services.processing import TransientProcessingError
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.pdf_factory import contrato_pdf, politica_pdf

pytestmark = [requires_db, pytest.mark.integration]

OLD = "fake-hash-v1"
NEW = "fake-hash-v2"
QUESTION = "Qual é o prazo de aviso prévio para cancelamento do contrato?"


def _upload(client, name: str, data: bytes) -> dict:
    resp = client.post(
        "/api/v1/documents/upload",
        files={"file": (name, data, "application/pdf")},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 202, resp.text
    return resp.json()


def _setup(client, enqueued, *, two: bool = False) -> list[dict]:
    register(client)
    set_embedding_provider(FakeEmbeddingProvider(model=OLD))
    docs = [_upload(client, "contrato.pdf", contrato_pdf())]
    if two:
        docs.append(_upload(client, "politica.pdf", politica_pdf()))
    outcomes = run_pending_jobs(enqueued)
    assert all(o.status.value == "ready" for o in outcomes), [o.error for o in outcomes]
    return docs


def _records(db, doc_id):
    return list(
        db.scalars(
            select(EmbeddingRecord)
            .where(EmbeddingRecord.document_id == doc_id)
            .order_by(EmbeddingRecord.chunk_id)
        )
    )


def _ask(client, question: str) -> dict:
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    resp = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": question},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["assistant_message"]


class _QuotaEmbedder:
    """Provedor real simulado cujo limite gratuito foi atingido."""

    name = "gemini"
    model = "gemini-embedding-001"
    dimensions = settings.embedding_dimensions

    def embed_texts(self, texts):
        raise ProviderQuotaError(detail="429 RESOURCE_EXHAUSTED (simulado)")

    def embed_query(self, text):
        raise ProviderQuotaError(detail="429 RESOURCE_EXHAUSTED (simulado)")


class _AuthEmbedder(_QuotaEmbedder):
    def embed_texts(self, texts):
        raise ProviderAuthError(detail="API key not valid (simulado)")


class _QuotaLLM:
    name = "gemini"
    model = "gemini-3.5-flash-lite"

    def generate(self, messages, *, max_tokens, temperature=0.1):
        raise ProviderQuotaError(detail="429 (simulado)")

    def stream(self, messages, *, max_tokens, temperature=0.1):
        raise ProviderQuotaError(detail="429 (simulado)")
        yield  # pragma: no cover - torna a função um gerador


# ----------------------------------------------------------------------------- incompatibilidade
def test_embeddings_of_other_model_are_excluded_from_vector_search(client, enqueued, db):
    (doc,) = _setup(client, enqueued)
    ws_id = db.get(Document, doc["id"]).workspace_id
    old_records = _records(db, doc["id"])
    assert old_records and all(r.model == OLD for r in old_records)

    # Troca de provedor (como OpenAI → Gemini): mesmo número de dimensões, espaço diferente
    new_provider = FakeEmbeddingProvider(model=NEW)
    set_embedding_provider(new_provider)
    service = RetrievalService(db, new_provider)
    vector = service.retrieve(QUESTION, RetrievalScope(workspace_id=ws_id), mode="vector")
    assert vector.chunks == []  # nunca compara vetores de modelos diferentes
    assert vector.stale_documents == 1
    hybrid = service.retrieve(QUESTION, RetrievalScope(workspace_id=ws_id), mode="hybrid")
    assert hybrid.chunks and all(c.lexical_rank is not None for c in hybrid.chunks)
    assert all(c.vector_rank is None for c in hybrid.chunks)
    assert hybrid.stale_documents == 1

    assert stale_document_ids(db, model=NEW, dimensions=settings.embedding_dimensions) == [
        old_records[0].document_id
    ]
    assert stale_document_ids(db, model=OLD, dimensions=settings.embedding_dimensions) == []

    # A API expõe a pendência ao administrador do workspace e nos metadados da resposta
    ws_settings = client.get("/api/v1/workspaces/current/settings").json()
    assert ws_settings["ai"]["stale_embedding_documents"] == 1
    assert ws_settings["ai"]["embedding_model"] == NEW
    assistant = _ask(client, QUESTION)
    evidence = client.get(f"/api/v1/messages/{assistant['id']}/retrieval").json()
    assert evidence["params"]["stale_documents"] == 1


def test_reindex_replaces_vectors_in_place_with_backup_and_restore(client, enqueued, db):
    (doc,) = _setup(client, enqueued)
    doc_id = db.get(Document, doc["id"]).id
    before = {r.chunk_id: (r.id, r.model) for r in _records(db, doc_id)}
    chunk_count = db.get(Document, doc_id).chunk_count
    assert len(before) == chunk_count

    new_provider = FakeEmbeddingProvider(model=NEW)
    set_embedding_provider(new_provider)
    ids = stale_document_ids(db, model=NEW, dimensions=new_provider.dimensions)
    report = reindex_documents(db, new_provider, ids)

    assert report.documents == 1 and report.reindexed == 1 and report.failed == 0
    assert report.chunks_replaced == chunk_count and report.backup_id
    assert report.stopped_reason is None
    after = {r.chunk_id: (r.id, r.model) for r in _records(db, doc_id)}
    assert set(after) == set(before)  # mesmos chunks, sem duplicar chunk_id
    assert all(after[c][0] == before[c][0] for c in before)  # registro atualizado, não recriado
    assert all(model == NEW for _, model in after.values())
    db.expire_all()
    document = db.get(Document, doc_id)
    assert document.status == "ready" and document.error_message is None
    version = db.scalar(
        select(DocumentVersion).where(
            DocumentVersion.document_id == doc_id,
            DocumentVersion.version == document.indexing_version,
        )
    )
    assert version.embedding_model == NEW
    job = db.scalar(
        select(ProcessingJob)
        .where(ProcessingJob.document_id == doc_id)
        .order_by(ProcessingJob.created_at.desc())
    )
    assert job.status == "succeeded" and job.metrics["reindex"] is True
    assert job.metrics["replaced"] == chunk_count
    assert stale_document_ids(db, model=NEW, dimensions=new_provider.dimensions) == []

    # A busca vetorial volta a funcionar com o novo modelo
    result = RetrievalService(db, new_provider).retrieve(
        QUESTION, RetrievalScope(workspace_id=document.workspace_id), mode="vector"
    )
    assert result.chunks and result.stale_documents == 0

    # Backup: vetores antigos preservados e restauráveis
    backups = list_backups(db)
    assert backups and backups[0][0] == report.backup_id and backups[0][2] == chunk_count
    backed_models = set(
        db.scalars(
            text(f"SELECT DISTINCT model FROM {BACKUP_TABLE} WHERE backup_id = :b"),
            {"b": report.backup_id},
        )
    )
    assert backed_models == {OLD}
    restored = restore_backup(db, report.backup_id)
    db.commit()
    assert restored == chunk_count
    assert {r.model for r in _records(db, doc_id)} == {OLD}
    assert db.scalar(select(func.count()).select_from(EmbeddingRecord)) == chunk_count


def test_reindex_failure_never_leaves_document_ready_and_stops_on_quota(client, enqueued, db):
    contrato, politica = _setup(client, enqueued, two=True)
    contrato_id = db.get(Document, contrato["id"]).id
    politica_id = db.get(Document, politica["id"]).id
    ids = [contrato_id, politica_id]

    report = reindex_documents(db, _QuotaEmbedder(), ids)
    assert report.failed == 1 and report.reindexed == 0
    assert report.stopped_reason == "ai_quota_exceeded"
    assert report.errors == [(str(contrato_id), "ai_quota_exceeded")]
    db.expire_all()
    failed = db.get(Document, contrato_id)
    assert failed.status == "failed"
    assert failed.error_message.startswith(REINDEX_FAIL_PREFIX)
    assert "limite" in failed.error_message.lower()
    # vetores antigos intactos (rollback), documento, chunks e arquivo preservados
    assert {r.model for r in _records(db, contrato_id)} == {OLD}
    assert failed.chunk_count > 0 and failed.deleted_at is None
    untouched = db.get(Document, politica_id)
    assert untouched.status == "ready" and {r.model for r in _records(db, politica_id)} == {OLD}

    # Documento com falha fica fora do escopo de busca até ser reindexado
    new_provider = FakeEmbeddingProvider(model=NEW)
    set_embedding_provider(new_provider)
    assert stale_document_ids(db, model=NEW, dimensions=new_provider.dimensions) == [politica_id]
    retry_ids = stale_document_ids(
        db, model=NEW, dimensions=new_provider.dimensions, include_failed=True
    )
    assert set(retry_ids) == {contrato_id, politica_id}
    report = reindex_documents(db, new_provider, retry_ids, backup=False)
    assert report.reindexed == 2 and report.failed == 0 and report.backup_id is None
    db.expire_all()
    assert db.get(Document, contrato_id).status == "ready"
    assert {r.model for r in _records(db, contrato_id)} == {NEW}


# ----------------------------------------------------------------------------- erros no fluxo
def test_chat_reports_provider_quota_honestly(client, enqueued):
    _setup(client, enqueued)
    set_llm_provider(_QuotaLLM())
    assistant = _ask(client, QUESTION)
    assert assistant["status"] == "error"
    assert assistant["citations"] == []
    assert "limite de uso do provedor" in assistant["content"].lower()
    assert "429" not in assistant["content"]

    # streaming: evento de erro com código próprio, depois `done`
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/messages/stream",
        json={"content": QUESTION},
        headers=csrf_headers(client),
    ) as resp:
        body = "".join(resp.iter_text())
    assert "event: error" in body and "ai_quota_exceeded" in body
    assert "event: done" in body


def test_chat_and_search_report_embedding_provider_failure(client, enqueued):
    _setup(client, enqueued)
    set_embedding_provider(_QuotaEmbedder())
    assistant = _ask(client, QUESTION)
    assert assistant["status"] == "error"
    assert "limite de uso do provedor" in assistant["content"].lower()

    resp = client.post("/api/v1/search", json={"query": QUESTION}, headers=csrf_headers(client))
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "ai_quota_exceeded"


def test_pipeline_marks_auth_failure_and_retries_quota(client, enqueued, db):
    register(client)
    set_embedding_provider(_AuthEmbedder())
    doc = _upload(client, "contrato.pdf", contrato_pdf())
    (outcome,) = run_pending_jobs(enqueued)
    assert outcome.status.value == "failed"
    assert "chave do provedor" in (outcome.error or "").lower()
    db.expire_all()
    stored = db.get(Document, doc["id"])
    assert stored.status == "failed" and stored.chunk_count == 0
    assert db.scalar(select(func.count()).select_from(EmbeddingRecord)) == 0

    set_embedding_provider(_QuotaEmbedder())
    doc2 = _upload(client, "politica.pdf", politica_pdf())
    with pytest.raises(TransientProcessingError) as exc:
        run_pending_jobs(enqueued)
    assert "limite" in (exc.value.user_message or "").lower()
    db.expire_all()
    pending = db.get(Document, doc2["id"])
    assert pending.status != "ready"  # aguarda nova tentativa do worker, nunca "pronto" sem vetores
    job = db.scalar(select(ProcessingJob).where(ProcessingJob.document_id == pending.id))
    assert job.status == "queued"
