"""Fase 2: DOCX/TXT, coleções, tags, filtros, versões, cancelamento, texto por seção e escopo por coleção."""

import pytest

from app.rag.extraction.base import DOCX_MIME, PDF_MIME, TXT_MIME
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.doc_factory import manual_docx, politica_txt
from tests.pdf_factory import contrato_pdf

pytestmark = [requires_db, pytest.mark.integration]


def upload(client, data: bytes, name: str, content_type: str = "application/octet-stream", **form):
    return client.post(
        "/api/v1/documents/upload",
        files={"file": (name, data, content_type)},
        data=form,
        headers=csrf_headers(client),
    )


def _ask(client, conv_id, question, **extra):
    resp = client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        json={"content": question, **extra},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["assistant_message"]


# ----------------------------------------------------------------------------- DOCX / TXT
def test_docx_upload_processes_into_sections(client, enqueued):
    register(client)
    resp = upload(client, manual_docx(), "manual.docx")
    assert resp.status_code == 202, resp.text
    doc = resp.json()
    assert doc["mime_type"] == DOCX_MIME and doc["location_type"] == "section"
    run_pending_jobs(enqueued)
    doc = client.get(f"/api/v1/documents/{doc['id']}").json()
    assert doc["status"] == "ready" and doc["page_count"] >= 3 and doc["chunk_count"] >= 1
    assert doc["has_text_layer"] is True

    text = client.get(f"/api/v1/documents/{doc['id']}/text").json()
    assert text["location_type"] == "section"
    labels = [s["label"] for s in text["sections"]]
    assert any(lbl.startswith("1. Backup") for lbl in labels)
    backup = next(s for s in text["sections"] if s["label"].startswith("1. Backup"))
    assert "35 dias" in backup["text"] and backup["chunk_ids"]

    chunks = client.get(f"/api/v1/documents/{doc['id']}/chunks").json()["items"]
    assert all(c["location_type"] == "section" for c in chunks)
    assert all(
        c["location_label"].startswith("Seç") or c["location_label"].startswith("Trecho")
        for c in chunks
    )
    assert "Página" not in " ".join(c["location_label"] for c in chunks)


def test_txt_upload_and_citation_uses_section_label(client, enqueued):
    register(client)
    doc = upload(client, politica_txt(), "politica.txt", "text/plain").json()
    assert doc["mime_type"] == TXT_MIME
    run_pending_jobs(enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    answer = _ask(
        client,
        conv["id"],
        "Qual é o tamanho mínimo das senhas e a cada quantos dias devem ser trocadas?",
    )
    assert answer["status"] == "ok", answer
    cit = answer["citations"][0]
    assert cit["location_type"] == "section"
    assert cit["location_label"].startswith("Seç")
    assert "Página" not in cit["location_label"]
    assert cit["mime_type"] == TXT_MIME

    results = client.post(
        "/api/v1/search",
        json={"query": "senhas 14 caracteres 180 dias"},
        headers=csrf_headers(client),
    ).json()["results"]
    assert (
        results and results[0]["location_type"] == "section" and results[0]["mime_type"] == TXT_MIME
    )


def test_rejects_disguised_files(client):
    register(client)
    assert upload(client, b"%PDF-1.4 fake", "x.docx").status_code == 415
    assert upload(client, bytes(range(256)) * 8, "bin.txt").status_code == 415
    assert upload(client, manual_docx(), "planilha.xlsx").status_code == 415


# ----------------------------------------------------------------------------- coleções
def test_collections_crud_and_document_assignment(client, enqueued):
    register(client)
    created = client.post(
        "/api/v1/collections",
        json={"name": "Contratos", "description": "Contratos vigentes", "color": "#8B5CF6"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    col = created.json()
    dup = client.post(
        "/api/v1/collections", json={"name": "contratos"}, headers=csrf_headers(client)
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "collection_exists"

    doc = upload(
        client, contrato_pdf(), "contrato.pdf", collection_id=col["id"], tags="juridico, 2026"
    ).json()
    assert doc["collection_id"] == col["id"] and doc["collection_name"] == "Contratos"
    assert doc["tags"] == ["juridico", "2026"]

    listing = client.get("/api/v1/collections").json()["items"]
    assert listing[0]["document_count"] == 1

    renamed = client.patch(
        f"/api/v1/collections/{col['id']}",
        json={"name": "Contratos 2026"},
        headers=csrf_headers(client),
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Contratos 2026"

    filtered = client.get("/api/v1/documents", params={"collection_id": col["id"]}).json()
    assert filtered["total"] == 1

    # Excluir coleção mantém o documento, apenas sem vínculo
    assert (
        client.delete(f"/api/v1/collections/{col['id']}", headers=csrf_headers(client)).status_code
        == 204
    )
    doc = client.get(f"/api/v1/documents/{doc['id']}").json()
    assert doc["collection_id"] is None and doc["status"] in ("uploaded", "ready")


def test_collections_are_isolated_between_workspaces(client):
    register(client, name="Ana", email="ana@example.com")
    col = client.post(
        "/api/v1/collections", json={"name": "Privada"}, headers=csrf_headers(client)
    ).json()
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    assert client.get("/api/v1/collections").json()["items"] == []
    assert client.get(f"/api/v1/collections/{col['id']}").status_code == 404
    assert (
        client.patch(
            f"/api/v1/collections/{col['id']}", json={"name": "x"}, headers=csrf_headers(client)
        ).status_code
        == 404
    )
    # Não pode usar a coleção alheia como escopo
    resp = client.post(
        "/api/v1/search",
        json={"query": "x", "collection_ids": [col["id"]]},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 403
    resp = upload(client, contrato_pdf(), "c.pdf", collection_id=col["id"])
    assert resp.status_code == 404


# ----------------------------------------------------------------------------- tags, filtros, update
def test_update_tags_name_and_filters(client, enqueued):
    register(client)
    pdf = upload(client, contrato_pdf(), "contrato.pdf").json()
    txt = upload(client, politica_txt(), "politica.txt").json()
    run_pending_jobs(enqueued)

    upd = client.patch(
        f"/api/v1/documents/{pdf['id']}",
        json={"name": "Contrato Aurora.pdf", "tags": ["Jurídico", "jurídico", " prioridade "]},
        headers=csrf_headers(client),
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["name"] == "Contrato Aurora.pdf"
    assert upd.json()["tags"] == ["Jurídico", "prioridade"]

    tags = client.get("/api/v1/documents/tags").json()["items"]
    assert {t["tag"] for t in tags} == {"Jurídico", "prioridade"}

    by_tag = client.get("/api/v1/documents", params={"tag": "prioridade"}).json()
    assert by_tag["total"] == 1 and by_tag["items"][0]["id"] == pdf["id"]
    by_type = client.get("/api/v1/documents", params={"mime_type": TXT_MIME}).json()
    assert by_type["total"] == 1 and by_type["items"][0]["id"] == txt["id"]
    by_pdf = client.get("/api/v1/documents", params={"mime_type": PDF_MIME}).json()
    assert by_pdf["total"] == 1
    sorted_asc = client.get("/api/v1/documents", params={"sort": "name"}).json()["items"]
    assert [d["name"] for d in sorted_asc] == sorted(d["name"] for d in sorted_asc)
    sorted_size = client.get("/api/v1/documents", params={"sort": "-size_bytes"}).json()["items"]
    assert sorted_size[0]["size_bytes"] >= sorted_size[-1]["size_bytes"]
    assert client.get("/api/v1/documents", params={"sort": "owner"}).status_code == 422


# ----------------------------------------------------------------------------- versões e cancelamento
def test_versions_history_and_cancel(client, enqueued):
    register(client)
    doc = upload(client, contrato_pdf(), "contrato.pdf").json()
    versions = client.get(f"/api/v1/documents/{doc['id']}/versions").json()["items"]
    assert [v["version"] for v in versions] == [1] and versions[0]["status"] == "uploaded"

    # Cancelamento antes do worker rodar: job enfileirado é cancelado e o documento reflete isso
    cancelled = client.post(f"/api/v1/documents/{doc['id']}/cancel", headers=csrf_headers(client))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    status = client.get(f"/api/v1/documents/{doc['id']}/status").json()
    assert status["jobs"][0]["status"] == "cancelled"
    outcomes = run_pending_jobs(enqueued)  # worker encontra o job cancelado e não processa
    assert outcomes and outcomes[0].status.value == "cancelled"
    assert (
        client.post(
            f"/api/v1/documents/{doc['id']}/cancel", headers=csrf_headers(client)
        ).status_code
        == 409
    )

    # Reprocessar cria a versão 2 e conclui
    assert (
        client.post(
            f"/api/v1/documents/{doc['id']}/reprocess", headers=csrf_headers(client)
        ).status_code
        == 202
    )
    run_pending_jobs(enqueued)
    versions = client.get(f"/api/v1/documents/{doc['id']}/versions").json()["items"]
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[0]["status"] == "ready" and versions[0]["chunk_count"] > 0
    assert (
        versions[0]["embedding_model"] == "fake-hash-v1" and versions[0]["chunking_version"] == "v1"
    )
    assert versions[1]["status"] == "cancelled"


def test_concurrent_upload_limit(client, monkeypatch):
    from app.core.config import settings

    register(client)
    monkeypatch.setattr(settings, "max_concurrent_uploads_per_user", 1)
    assert upload(client, contrato_pdf(), "a.pdf").status_code == 202
    resp = upload(client, politica_txt(), "b.txt")
    assert resp.status_code == 429 and resp.json()["error"]["code"] == "usage_limit_exceeded"


# ----------------------------------------------------------------------------- escopo por coleção
def test_collection_scope_in_chat_and_search(client, enqueued):
    register(client)
    col = client.post(
        "/api/v1/collections", json={"name": "TI"}, headers=csrf_headers(client)
    ).json()
    contrato = upload(client, contrato_pdf(), "contrato.pdf").json()
    manual = upload(client, manual_docx(), "manual.docx", collection_id=col["id"]).json()
    run_pending_jobs(enqueued)

    results = client.post(
        "/api/v1/search",
        json={
            "query": "prazo de aviso prévio para cancelamento do contrato",
            "collection_ids": [col["id"]],
        },
        headers=csrf_headers(client),
    ).json()["results"]
    assert all(r["document_id"] == manual["id"] for r in results)

    conv = client.post(
        "/api/v1/conversations", json={"collection_ids": [col["id"]]}, headers=csrf_headers(client)
    ).json()
    assert conv["collection_ids"] == [col["id"]]
    answer = _ask(
        client,
        conv["id"],
        "O backup completo do banco de dados deve ser executado diariamente com qual retenção de dias?",
    )
    assert answer["status"] == "ok"
    assert all(c["document_id"] == manual["id"] for c in answer["citations"])
    assert all(c["document_id"] != contrato["id"] for c in answer["citations"])

    # União: documento explícito + coleção
    updated = client.patch(
        f"/api/v1/conversations/{conv['id']}",
        json={"document_ids": [contrato["id"]], "collection_ids": [col["id"]]},
        headers=csrf_headers(client),
    ).json()
    assert updated["document_ids"] == [contrato["id"]] and updated["collection_ids"] == [col["id"]]
    answer = _ask(
        client, conv["id"], "Qual é o prazo de aviso prévio para cancelamento do contrato?"
    )
    assert any(c["document_id"] == contrato["id"] for c in answer["citations"])
