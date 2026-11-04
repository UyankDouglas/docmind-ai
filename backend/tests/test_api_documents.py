import pytest

from app.core.config import settings
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.pdf_factory import contrato_pdf, encrypt_pdf, scanned_like_pdf

pytestmark = [requires_db, pytest.mark.integration]


def upload(client, data: bytes, name: str = "contrato.pdf", content_type: str = "application/pdf"):
    return client.post(
        "/api/v1/documents/upload",
        files={"file": (name, data, content_type)},
        headers=csrf_headers(client),
    )


def test_upload_pdf_and_process_to_ready(client, enqueued):
    register(client)
    resp = upload(client, contrato_pdf())
    assert resp.status_code == 202, resp.text
    doc = resp.json()
    assert doc["status"] == "uploaded" and doc["size_bytes"] > 0 and len(doc["sha256"]) == 64
    assert len(enqueued) == 1

    status = client.get(f"/api/v1/documents/{doc['id']}/status").json()
    assert status["status"] == "uploaded"
    assert status["jobs"][0]["job_type"] == "extract" and status["jobs"][0]["status"] == "queued"

    outcomes = run_pending_jobs(enqueued)
    assert outcomes[0].status.value == "ready", outcomes[0].error

    status = client.get(f"/api/v1/documents/{doc['id']}/status").json()
    assert status["status"] == "ready"
    assert status["page_count"] == 5 and status["chunk_count"] > 0
    assert status["jobs"][0]["status"] == "succeeded"

    listing = client.get("/api/v1/documents").json()
    assert listing["total"] == 1 and listing["items"][0]["status"] == "ready"

    chunks = client.get(f"/api/v1/documents/{doc['id']}/chunks", params={"page": 4}).json()["items"]
    assert chunks and all(c["page_start"] <= 4 <= c["page_end"] for c in chunks)
    assert any("45 (quarenta e cinco) dias" in c["text"] for c in chunks)


def test_download_streams_original_file(client):
    register(client)
    data = contrato_pdf()
    doc = upload(client, data).json()
    resp = client.get(f"/api/v1/documents/{doc['id']}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.headers["content-disposition"].startswith("inline")
    assert resp.content == data


def test_rejects_non_pdf_and_fake_extension(client):
    register(client)
    assert (
        upload(client, b"hello world", name="notas.csv", content_type="text/csv").status_code == 415
    )
    fake = upload(client, b"MZ\x90\x00 not really a pdf", name="virus.pdf")
    assert fake.status_code == 415
    assert fake.json()["error"]["code"] == "unsupported_media_type"


def test_rejects_oversized_file(client, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    big = b"%PDF-1.4\n" + b"0" * (1024 * 1024 + 10)
    resp = upload(client, big)
    assert resp.status_code == 413


def test_duplicate_upload_is_conflict(client):
    register(client)
    assert upload(client, contrato_pdf()).status_code == 202
    dup = upload(client, contrato_pdf(), name="copia.pdf")
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate_document"


def test_encrypted_and_scanned_pdfs_fail_with_clear_messages(client, enqueued):
    register(client)
    enc = upload(client, encrypt_pdf(contrato_pdf()), name="protegido.pdf").json()
    scan = upload(client, scanned_like_pdf(), name="digitalizado.pdf").json()
    run_pending_jobs(enqueued)
    enc_status = client.get(f"/api/v1/documents/{enc['id']}/status").json()
    scan_status = client.get(f"/api/v1/documents/{scan['id']}/status").json()
    assert enc_status["status"] == "failed" and "senha" in enc_status["error_message"].lower()
    assert scan_status["status"] == "failed" and "OCR" in scan_status["error_message"]


def test_reprocess_bumps_indexing_version_and_reindexes(client, enqueued):
    register(client)
    doc = upload(client, contrato_pdf()).json()
    run_pending_jobs(enqueued)
    resp = client.post(f"/api/v1/documents/{doc['id']}/reprocess", headers=csrf_headers(client))
    assert resp.status_code == 202 and resp.json()["indexing_version"] == 2
    run_pending_jobs(enqueued)
    final = client.get(f"/api/v1/documents/{doc['id']}").json()
    assert (
        final["status"] == "ready" and final["indexing_version"] == 2 and final["chunk_count"] > 0
    )


def test_delete_removes_from_index_and_storage(client, enqueued, db):
    from sqlalchemy import func, select

    from app.models import DocumentChunk, EmbeddingRecord
    from app.providers.storage import get_storage

    register(client)
    doc = upload(client, contrato_pdf()).json()
    run_pending_jobs(enqueued)
    assert db.scalar(select(func.count()).select_from(EmbeddingRecord)) > 0

    resp = client.delete(f"/api/v1/documents/{doc['id']}", headers=csrf_headers(client))
    assert resp.status_code == 204
    assert client.get(f"/api/v1/documents/{doc['id']}").status_code == 404
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(DocumentChunk)) == 0
    assert db.scalar(select(func.count()).select_from(EmbeddingRecord)) == 0
    assert not any(get_storage()._data)  # type: ignore[attr-defined]


def test_isolation_between_workspaces(client, enqueued):
    # Usuário A envia um documento
    register(client, name="Ana", email="ana@example.com")
    doc = upload(client, contrato_pdf()).json()
    run_pending_jobs(enqueued)
    chunk_id = client.get(f"/api/v1/documents/{doc['id']}/chunks").json()["items"][0]["id"]

    # Usuário B (outro workspace) não enxerga nada do A
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    assert client.get("/api/v1/documents").json()["total"] == 0
    assert client.get(f"/api/v1/documents/{doc['id']}").status_code == 404
    assert client.get(f"/api/v1/documents/{doc['id']}/download").status_code == 404
    assert client.get(f"/api/v1/documents/{doc['id']}/chunks").status_code == 404
    assert client.get(f"/api/v1/chunks/{chunk_id}").status_code == 404
    assert (
        client.delete(f"/api/v1/documents/{doc['id']}", headers=csrf_headers(client)).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/documents/{doc['id']}/reprocess", headers=csrf_headers(client)
        ).status_code
        == 404
    )
    # Nem pode selecionar o documento de A em uma conversa
    resp = client.post(
        "/api/v1/conversations", json={"document_ids": [doc["id"]]}, headers=csrf_headers(client)
    )
    assert resp.status_code == 403
