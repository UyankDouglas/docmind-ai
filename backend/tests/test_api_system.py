import pytest

from tests.conftest import register, requires_db

pytestmark = [requires_db, pytest.mark.integration]


def test_health_reports_services_and_ai(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["services"]["database"] is True
    assert body["ai"]["embedding_provider"] == "fake"
    assert "provedor determinístico" in body["ai"]["notice"]


def test_ai_settings_requires_auth_and_never_exposes_keys(client):
    assert client.get("/api/v1/settings/ai").status_code == 401
    register(client)
    body = client.get("/api/v1/settings/ai").json()
    assert set(body) == {
        "configured",
        "embedding_provider",
        "llm_provider",
        "embedding_model",
        "llm_model",
        "external_processing",
        "notice",
    }
    assert "key" not in str(body).lower()


def test_security_headers_present(client):
    resp = client.get("/api/v1/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
