"""Modo demonstração: configuração pública, cadastro, limites de workspaces novos, teto diário global
e carga dos documentos fictícios de exemplo."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import Document, UsageKind, Workspace
from app.services.demo import DEMO_COLLECTION, DEMO_SAMPLES
from app.services.usage import record_usage
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.pdf_factory import contrato_pdf, politica_pdf

pytestmark = [requires_db, pytest.mark.integration]

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples"


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(settings, "demo_samples_dir", str(SAMPLES_DIR))
    return settings


def _upload(client, name: str, data: bytes):
    return client.post(
        "/api/v1/documents/upload",
        files={"file": (name, data, "application/pdf")},
        headers=csrf_headers(client),
    )


def test_instance_info_is_public_and_off_by_default(client):
    resp = client.get("/api/v1/instance")
    assert resp.status_code == 200
    assert resp.json() == {
        "demo_mode": False,
        "registration_enabled": True,
        "demo_samples_available": False,
        "demo_notice": None,
    }


def test_instance_info_in_demo_mode_warns_about_data(client, demo, monkeypatch):
    assert all((SAMPLES_DIR / name).is_file() for name in DEMO_SAMPLES)
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    body = client.get("/api/v1/instance").json()
    assert body["demo_mode"] is True
    assert body["demo_samples_available"] is True
    assert "Demonstração pública" in body["demo_notice"]
    assert "Não envie documentos reais" in body["demo_notice"]
    assert "Google pode usar o conteúdo" in body["demo_notice"]

    monkeypatch.setattr(settings, "llm_provider", "fake")
    monkeypatch.setattr(settings, "embedding_provider", "fake")
    assert "Google" not in client.get("/api/v1/instance").json()["demo_notice"]


def test_samples_unavailable_when_folder_missing(client, demo, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "demo_samples_dir", str(tmp_path))
    assert client.get("/api/v1/instance").json()["demo_samples_available"] is False
    register(client)
    resp = client.post("/api/v1/demo/samples", headers=csrf_headers(client))
    assert resp.status_code == 404


def test_registration_can_be_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "registration_enabled", False)
    assert client.get("/api/v1/instance").json()["registration_enabled"] is False
    client.get("/api/v1/auth/csrf")
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Ana Silva", "email": "ana@example.com", "password": "senha-forte-123"},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "registration_disabled"


def test_new_workspaces_get_default_limits_and_retention(client, enqueued, monkeypatch):
    monkeypatch.setattr(settings, "new_workspace_max_documents", 1)
    monkeypatch.setattr(settings, "new_workspace_max_storage_mb", 10)
    monkeypatch.setattr(settings, "new_workspace_monthly_token_budget", 50_000)
    monkeypatch.setattr(settings, "new_workspace_retention_days", 7)
    register(client)

    body = client.get("/api/v1/workspaces/current/settings").json()
    assert body["limits"] == {
        "monthly_token_budget": 50_000,
        "monthly_cost_budget_usd": None,
        "max_documents": 1,
        "max_storage_mb": 10,
    }
    retention = body["retention"]
    for key in (
        "conversations_days",
        "analyses_days",
        "search_history_days",
        "deleted_documents_days",
    ):
        assert retention[key] == 7

    assert _upload(client, "contrato.pdf", contrato_pdf()).status_code == 202
    resp = _upload(client, "politica.pdf", politica_pdf())
    assert resp.status_code == 429
    assert "Limite de 1 documentos" in resp.json()["error"]["message"]


def test_without_defaults_new_workspaces_have_no_limits(client):
    register(client)
    limits = client.get("/api/v1/workspaces/current/settings").json()["limits"]
    assert all(value is None for value in limits.values())


def test_global_daily_budget_is_shared_across_workspaces(client, enqueued, db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    # Outro visitante consome tokens no workspace DELE
    with TestClient(app, base_url="http://testserver") as other:
        register(other, name="Bruno Costa", email="bruno@example.com")
    other_ws = db.scalar(select(Workspace).where(Workspace.slug.like("bruno%")))
    register(client)
    assert _upload(client, "contrato.pdf", contrato_pdf()).status_code == 202
    run_pending_jobs(enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()

    record_usage(
        db,
        workspace_id=other_ws.id,
        user_id=None,
        kind=UsageKind.QUESTION,
        prompt_tokens=900,
        completion_tokens=200,
    )
    db.commit()
    monkeypatch.setattr(settings, "global_daily_token_budget", 1_000)

    question = {"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"}
    resp = client.post(
        f"/api/v1/conversations/{conv['id']}/messages", json=question, headers=csrf_headers(client)
    )
    assert resp.status_code == 429
    error = resp.json()["error"]
    assert error["code"] == "daily_budget_exceeded"
    assert "limite diário" in error["message"]

    search = client.post(
        "/api/v1/search", json={"query": "aviso prévio"}, headers=csrf_headers(client)
    )
    assert search.status_code == 429
    upload = _upload(client, "politica.pdf", politica_pdf())
    assert upload.status_code == 429
    assert upload.json()["error"]["code"] == "daily_budget_exceeded"

    # Sem teto, o mesmo fluxo volta a funcionar
    monkeypatch.setattr(settings, "global_daily_token_budget", None)
    resp = client.post(
        f"/api/v1/conversations/{conv['id']}/messages", json=question, headers=csrf_headers(client)
    )
    assert resp.status_code == 200, resp.text


def test_demo_samples_load_through_the_normal_pipeline(client, enqueued, demo, db):
    register(client)
    resp = client.post("/api/v1/demo/samples", headers=csrf_headers(client))
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["loaded"] == list(DEMO_SAMPLES)
    assert body["skipped"] == [] and body["stopped_reason"] is None
    assert len(enqueued) == len(DEMO_SAMPLES)

    outcomes = run_pending_jobs(enqueued)
    assert all(o.status.value == "ready" for o in outcomes), [o.error for o in outcomes]
    docs = client.get("/api/v1/documents").json()["items"]
    assert {d["name"] for d in docs} == set(DEMO_SAMPLES)
    assert all(d["collection_id"] == body["collection_id"] for d in docs)
    assert all("exemplo" in d["tags"] for d in docs)
    collections = client.get("/api/v1/collections").json()["items"]
    assert [c["name"] for c in collections] == [DEMO_COLLECTION]

    # Idempotente: a segunda chamada não duplica nada
    again = client.post("/api/v1/demo/samples", headers=csrf_headers(client)).json()
    assert again["loaded"] == [] and again["skipped"] == list(DEMO_SAMPLES)
    assert again["collection_id"] == body["collection_id"]
    assert db.query(Document).count() == len(DEMO_SAMPLES)


def test_demo_samples_respect_workspace_limits(client, enqueued, demo, monkeypatch):
    monkeypatch.setattr(settings, "new_workspace_max_documents", 2)
    register(client)
    body = client.post("/api/v1/demo/samples", headers=csrf_headers(client)).json()
    assert body["loaded"] == list(DEMO_SAMPLES[:2])
    assert "Limite de 2 documentos" in body["stopped_reason"]

    # Já no limite: nenhuma carga possível -> erro explícito (429), sem resposta parcial
    resp = client.post("/api/v1/demo/samples", headers=csrf_headers(client))
    assert resp.status_code == 429
    assert "Limite de 2 documentos" in resp.json()["error"]["message"]


def test_demo_samples_endpoint_hidden_outside_demo_mode(client):
    register(client)
    resp = client.post("/api/v1/demo/samples", headers=csrf_headers(client))
    assert resp.status_code == 404


def test_demo_samples_require_session(client, demo):
    assert client.post("/api/v1/demo/samples").status_code == 401
