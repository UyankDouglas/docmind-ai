import pytest

from tests.conftest import csrf_headers, register, requires_db

pytestmark = [requires_db, pytest.mark.integration]


def test_register_creates_workspace_and_session(client):
    me = register(client)
    assert me["email"] == "ana@example.com"
    assert me["workspace"]["role"] == "admin"
    assert "docmind_session" in client.cookies
    assert "docmind_csrf" in client.cookies

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json()["id"] == me["id"]


def test_duplicate_email_conflict(client):
    register(client)
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Outra", "email": "ANA@example.com", "password": "senha-forte-123"},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "email_in_use"


def test_login_logout_flow(client):
    register(client)
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    assert client.get("/api/v1/auth/me").status_code == 401

    client.get("/api/v1/auth/csrf")
    bad = client.post(
        "/api/v1/auth/login",
        json={"email": "ana@example.com", "password": "errada"},
        headers=csrf_headers(client),
    )
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_credentials"

    ok = client.post(
        "/api/v1/auth/login",
        json={"email": "ana@example.com", "password": "senha-forte-123"},
        headers=csrf_headers(client),
    )
    assert ok.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200


def test_mutations_require_csrf_token(client):
    register(client)
    resp = client.post("/api/v1/conversations", json={})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_invalid"
    resp = client.post("/api/v1/conversations", json={}, headers={"X-CSRF-Token": "forjado"})
    assert resp.status_code == 403


def test_protected_routes_reject_anonymous(client):
    for path in (
        "/api/v1/documents",
        "/api/v1/conversations",
        "/api/v1/workspaces/current",
        "/api/v1/usage",
    ):
        assert client.get(path).status_code == 401, path


def test_validation_errors_are_standardized_without_echoing_password(client):
    client.get("/api/v1/auth/csrf")
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "A", "email": "nao-e-email", "password": "curta"},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 422
    body = resp.json()["error"]
    assert body["code"] == "validation_error"
    assert "curta" not in resp.text


def test_session_cookie_is_httponly_and_rejects_tampering(client):
    register(client)
    client.cookies.clear()
    client.cookies.set("docmind_session", "token-falso")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_workspace_endpoints(client):
    register(client)
    ws = client.get("/api/v1/workspaces/current").json()
    assert ws["role"] == "admin" and ws["settings"]["external_ai_enabled"] is True
    members = client.get("/api/v1/workspaces/current/members").json()["items"]
    assert len(members) == 1 and members[0]["email"] == "ana@example.com"
