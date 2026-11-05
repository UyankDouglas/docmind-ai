"""Fase 5: membros e convites, troca de workspace, senha e sessões, limites de custo, auditoria,
retenção, provedores e OCR opcional."""

import re
import uuid

import pytest

from app.core.config import settings
from app.providers.mail import ConsoleMailSender, set_mail_sender
from app.providers.ocr import FakeOcrProvider, set_ocr_provider
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.pdf_factory import contrato_pdf, scanned_like_pdf

pytestmark = [requires_db, pytest.mark.integration]


@pytest.fixture
def mailbox():
    sender = ConsoleMailSender()
    set_mail_sender(sender)
    yield sender
    set_mail_sender(None)


def _logout(client):
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()


def _login(client, email, password="senha-forte-123"):
    client.get("/api/v1/auth/csrf")
    r = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers=csrf_headers(client),
    )
    assert r.status_code == 200, r.text
    return r.json()


def _link(mail, prefix):
    m = re.search(prefix + r"\S+", mail.text)
    assert m, mail.text
    return m.group(0)


# ----------------------------------------------------------------------------- convites e membros
def test_invite_accept_switch_roles_and_remove(client, mailbox):
    register(client, name="Ana", email="ana@example.com")
    inv = client.post(
        "/api/v1/workspaces/current/invitations",
        json={"email": "Bruno@Example.com", "role": "editor"},
        headers=csrf_headers(client),
    )
    assert inv.status_code == 201, inv.text
    accept_url = inv.json()["accept_url"]
    assert accept_url and "/invite/" in accept_url and mailbox.sent[-1].to == "bruno@example.com"
    token = accept_url.rsplit("/", 1)[-1]
    dup = client.post(
        "/api/v1/workspaces/current/invitations",
        json={"email": "bruno@example.com", "role": "viewer"},
        headers=csrf_headers(client),
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "invitation_pending"
    ana_ws = client.get("/api/v1/auth/me").json()["workspace"]["id"]

    # Página pública do convite
    pub = client.get(f"/api/v1/invitations/{token}").json()
    assert (
        pub["email"] == "br***@example.com"
        and pub["role"] == "editor"
        and pub["status"] == "pending"
    )
    assert client.get("/api/v1/invitations/token-invalido").status_code == 404

    # Bruno cria conta com outro e-mail → não pode aceitar; com o e-mail certo → aceita
    _logout(client)
    register(client, name="Carla", email="carla@example.com")
    assert (
        client.post(f"/api/v1/invitations/{token}/accept", headers=csrf_headers(client)).status_code
        == 403
    )
    _logout(client)
    register(client, name="Bruno", email="bruno@example.com")
    me = client.post(f"/api/v1/invitations/{token}/accept", headers=csrf_headers(client))
    assert me.status_code == 200, me.text
    assert me.json()["workspace"]["id"] == ana_ws and me.json()["workspace"]["role"] == "editor"
    assert (
        client.post(f"/api/v1/invitations/{token}/accept", headers=csrf_headers(client)).status_code
        == 409
    )

    # Bruno vê dois workspaces e alterna
    wss = client.get("/api/v1/workspaces").json()["items"]
    assert len(wss) == 2 and sum(w["is_current"] for w in wss) == 1
    own = next(w for w in wss if w["role"] == "admin")
    sw = client.post(
        "/api/v1/workspaces/switch", json={"workspace_id": own["id"]}, headers=csrf_headers(client)
    )
    assert sw.status_code == 200 and sw.json()["workspace"]["id"] == own["id"]
    assert client.get("/api/v1/documents").json()["total"] == 0
    assert (
        client.post(
            "/api/v1/workspaces/switch",
            json={"workspace_id": str(uuid.uuid4())},
            headers=csrf_headers(client),
        ).status_code
        == 403
    )
    client.post(
        "/api/v1/workspaces/switch", json={"workspace_id": ana_ws}, headers=csrf_headers(client)
    )

    # Editor não gerencia membros nem convida
    assert client.get("/api/v1/workspaces/current/invitations").status_code == 403
    assert (
        client.post(
            "/api/v1/workspaces/current/invitations",
            json={"email": "x@example.com"},
            headers=csrf_headers(client),
        ).status_code
        == 403
    )

    # Ana altera papel, não pode deixar o workspace sem admin, e remove Bruno
    _logout(client)
    _login(client, "ana@example.com")
    bruno_id = me.json()["id"]
    ana_id = client.get("/api/v1/auth/me").json()["id"]
    upd = client.patch(
        f"/api/v1/workspaces/current/members/{bruno_id}",
        json={"role": "viewer"},
        headers=csrf_headers(client),
    )
    assert upd.status_code == 200 and upd.json()["role"] == "viewer"
    last = client.patch(
        f"/api/v1/workspaces/current/members/{ana_id}",
        json={"role": "viewer"},
        headers=csrf_headers(client),
    )
    assert last.status_code == 409 and last.json()["error"]["code"] == "last_admin"
    invs = client.get("/api/v1/workspaces/current/invitations").json()["items"]
    assert invs[0]["status"] == "accepted" and invs[0]["accept_url"] is None
    assert (
        client.delete(
            f"/api/v1/workspaces/current/members/{bruno_id}", headers=csrf_headers(client)
        ).status_code
        == 204
    )
    assert len(client.get("/api/v1/workspaces/current/members").json()["items"]) == 1

    # Bruno perdeu o acesso imediatamente (sessão revogada)
    _logout(client)
    _login(client, "bruno@example.com")
    assert client.get("/api/v1/auth/me").json()["workspace"]["id"] != ana_ws

    # Renomear workspace (admin)
    _logout(client)
    _login(client, "ana@example.com")
    assert (
        client.patch(
            "/api/v1/workspaces/current",
            json={"name": "Jurídico Aurora"},
            headers=csrf_headers(client),
        ).json()["name"]
        == "Jurídico Aurora"
    )
    revoke = client.post(
        "/api/v1/workspaces/current/invitations",
        json={"email": "dani@example.com"},
        headers=csrf_headers(client),
    ).json()
    assert (
        client.delete(
            f"/api/v1/workspaces/current/invitations/{revoke['id']}", headers=csrf_headers(client)
        ).status_code
        == 204
    )
    assert (
        client.get(f"/api/v1/invitations/{revoke['accept_url'].rsplit('/', 1)[-1]}").json()[
            "status"
        ]
        == "revoked"
    )


# ----------------------------------------------------------------------------- senha e sessões
def test_password_reset_change_and_sessions(client, mailbox):
    register(client)
    _logout(client)
    client.get("/api/v1/auth/csrf")
    r = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "ninguem@example.com"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 202 and not mailbox.sent  # não revela
    r = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "ana@example.com"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 202 and mailbox.sent
    link = _link(mailbox.sent[-1], r"reset-password\?token=")
    token = link.split("token=")[-1]
    assert (
        client.post(
            "/api/v1/auth/reset-password",
            json={"token": "x" * 20, "password": "nova-senha-123"},
            headers=csrf_headers(client),
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "password": "nova-senha-123"},
            headers=csrf_headers(client),
        ).status_code
        == 204
    )
    assert (
        client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "password": "outra-senha-123"},
            headers=csrf_headers(client),
        ).status_code
        == 404
    )  # uso único
    _login(client, "ana@example.com", "nova-senha-123")

    # Duas sessões: a antiga é revogada ao trocar a senha
    first_cookies = dict(client.cookies)
    _login(client, "ana@example.com", "nova-senha-123")
    sessions = client.get("/api/v1/auth/sessions").json()["items"]
    assert len(sessions) == 2 and sum(s["is_current"] for s in sessions) == 1
    other = next(s for s in sessions if not s["is_current"])
    assert (
        client.delete(
            f"/api/v1/auth/sessions/{other['id']}", headers=csrf_headers(client)
        ).status_code
        == 204
    )
    assert len(client.get("/api/v1/auth/sessions").json()["items"]) == 1
    current = client.get("/api/v1/auth/sessions").json()["items"][0]
    assert (
        client.delete(
            f"/api/v1/auth/sessions/{current['id']}", headers=csrf_headers(client)
        ).status_code
        == 422
    )

    bad = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "errada", "new_password": "senha-forte-456"},
        headers=csrf_headers(client),
    )
    assert bad.status_code == 401
    ok = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "nova-senha-123", "new_password": "senha-forte-456"},
        headers=csrf_headers(client),
    )
    assert ok.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 200  # sessão atual mantida
    client.cookies.clear()
    client.cookies.update(first_cookies)
    assert client.get("/api/v1/auth/me").status_code == 401  # sessão antiga revogada


# ----------------------------------------------------------------------------- limites e custo
def test_budget_and_document_limits_block_requests(client, enqueued):
    register(client)
    doc = client.post(
        "/api/v1/documents/upload",
        files={"file": ("c.pdf", contrato_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    ).json()
    run_pending_jobs(enqueued)
    upd = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"limits": {"max_documents": 1, "monthly_token_budget": 1}},
        headers=csrf_headers(client),
    )
    assert upd.status_code == 200 and upd.json()["limits"]["max_documents"] == 1
    assert (
        client.patch(
            "/api/v1/workspaces/current/settings",
            json={"limits": {"max_documents": 0}},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )

    # Já houve consumo de tokens (embeddings) → orçamento de 1 token está estourado
    usage = client.get("/api/v1/usage").json()
    assert usage["blocked"] is True and "Orçamento" in usage["blocked_reason"]
    assert usage["limits"]["max_documents"] == 1 and usage["documents_count"] == 1
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    r = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o prazo?"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 429 and r.json()["error"]["code"] == "usage_limit_exceeded"
    assert (
        client.get(f"/api/v1/conversations/{conv['id']}").json()["message_count"] == 0
    )  # nada persistido
    assert (
        client.post(
            "/api/v1/search", json={"query": "prazo"}, headers=csrf_headers(client)
        ).status_code
        == 429
    )
    assert (
        client.post(
            f"/api/v1/documents/{doc['id']}/summarize",
            json={"type": "general"},
            headers=csrf_headers(client),
        ).status_code
        == 429
    )
    up = client.post(
        "/api/v1/documents/upload",
        files={"file": ("d.pdf", scanned_like_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    )
    assert up.status_code == 429 and "documentos" in up.json()["error"]["message"]

    # Remover o limite libera
    client.patch(
        "/api/v1/workspaces/current/settings",
        json={"limits": {"monthly_token_budget": None, "max_documents": None}},
        headers=csrf_headers(client),
    )
    assert client.get("/api/v1/usage").json()["blocked"] is False
    assert (
        client.post(
            "/api/v1/search", json={"query": "prazo"}, headers=csrf_headers(client)
        ).status_code
        == 200
    )


# ----------------------------------------------------------------------------- auditoria e uso administrativo
def test_admin_usage_and_audit(client, enqueued, db):
    register(client)
    client.post(
        "/api/v1/documents/upload",
        files={"file": ("c.pdf", contrato_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    )
    run_pending_jobs(enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
        headers=csrf_headers(client),
    )

    usage = client.get("/api/v1/admin/usage", params={"days": 7}).json()
    assert (
        usage["totals"]["questions"] >= 1
        and usage["totals"]["uploads"] == 1
        and usage["totals"]["documents"] == 1
    )
    assert usage["by_user"][0]["email"] == "ana@example.com" and usage["by_day"]

    audit = client.get("/api/v1/audit", params={"action": "document."}).json()
    assert audit["total"] >= 1 and all(e["action"].startswith("document.") for e in audit["items"])
    assert audit["items"][0]["user"]["email"] == "ana@example.com"
    everything = client.get("/api/v1/audit").json()
    assert {e["action"] for e in everything["items"]} >= {
        "user.register",
        "document.upload",
        "conversation.ask",
    }
    csv_export = client.get("/api/v1/audit/export", params={"format": "csv"})
    assert csv_export.status_code == 200 and csv_export.headers["content-type"].startswith(
        "text/csv"
    )
    assert "document.upload" in csv_export.text
    js = client.get("/api/v1/audit/export", params={"format": "json"}).json()
    assert isinstance(js, list) and js

    # Não-admin: 403 em uso/auditoria
    from app.models import WorkspaceMember

    me = client.get("/api/v1/auth/me").json()
    member = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == me["id"]).one()
    member.role = "viewer"
    db.commit()
    assert client.get("/api/v1/admin/usage").status_code == 403
    assert client.get("/api/v1/audit").status_code == 403
    member.role = "admin"
    db.commit()


# ----------------------------------------------------------------------------- retenção
def test_retention_policy_purges_old_data(client, enqueued, db):
    from datetime import timedelta

    from app.models import Analysis, Conversation, Document, SearchQuery
    from app.models.base import utcnow

    register(client)
    doc = client.post(
        "/api/v1/documents/upload",
        files={"file": ("c.pdf", contrato_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    ).json()
    run_pending_jobs(enqueued)
    conv = client.post(
        "/api/v1/conversations", json={"title": "antiga"}, headers=csrf_headers(client)
    ).json()
    client.post("/api/v1/search", json={"query": "prazo"}, headers=csrf_headers(client))
    client.delete(f"/api/v1/documents/{doc['id']}", headers=csrf_headers(client))
    assert (
        client.patch(
            "/api/v1/workspaces/current/settings",
            json={
                "retention": {
                    "conversations_days": 30,
                    "search_history_days": 7,
                    "deleted_documents_days": 1,
                }
            },
            headers=csrf_headers(client),
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/v1/workspaces/current/settings",
            json={"retention": {"analyses_days": 0}},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )

    # Nada vence ainda
    run = client.post(
        "/api/v1/workspaces/current/retention/run", headers=csrf_headers(client)
    ).json()["deleted"]
    assert run == {"conversations": 0, "analyses": 0, "search_queries": 0, "documents": 0}

    # Envelhece os registros artificialmente
    old = utcnow() - timedelta(days=400)
    db.query(Conversation).filter(Conversation.id == uuid.UUID(conv["id"])).update(
        {"updated_at": old}
    )
    db.query(SearchQuery).update({"created_at": old})
    db.query(Document).filter(Document.id == uuid.UUID(doc["id"])).update({"deleted_at": old})
    db.commit()

    run = client.post(
        "/api/v1/workspaces/current/retention/run", headers=csrf_headers(client)
    ).json()["deleted"]
    assert run["conversations"] == 1 and run["search_queries"] == 1 and run["documents"] == 1
    db.expire_all()
    assert db.get(Document, uuid.UUID(doc["id"])) is None
    assert client.get("/api/v1/conversations").json()["items"] == []
    assert client.get("/api/v1/workspaces/current/settings").json()["retention"]["last_run_at"]
    assert db.query(Analysis).count() == 0


# ----------------------------------------------------------------------------- provedores e OCR
def test_provider_settings_and_ocr_fallback(client, enqueued, monkeypatch):
    register(client)
    s = client.get("/api/v1/workspaces/current/settings").json()["ai"]
    assert s["ocr_available"] is False and s["ocr_enabled"] is False and s["llm_model"] is None
    assert (
        client.patch(
            "/api/v1/workspaces/current/settings",
            json={"ai": {"ocr_enabled": True}},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/api/v1/workspaces/current/settings",
            json={"ai": {"llm_model": "modelo-proibido"}},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )
    monkeypatch.setattr(settings, "llm_allowed_models", "gpt-4o-mini,gpt-4.1-mini")
    ok = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"ai": {"llm_model": "gpt-4.1-mini"}},
        headers=csrf_headers(client),
    )
    assert ok.status_code == 200 and ok.json()["ai"]["llm_model"] == "gpt-4.1-mini"
    # Modelo escolhido é usado pelo chat (provedor fake rotulado pelo modelo)
    client.post(
        "/api/v1/documents/upload",
        files={"file": ("c.pdf", contrato_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    )
    run_pending_jobs(enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    from app.providers.llm import set_llm_provider

    set_llm_provider(None)
    monkeypatch.setattr(settings, "llm_provider", "fake")
    a = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
        headers=csrf_headers(client),
    ).json()["assistant_message"]
    assert a["model"] == "fake-gpt-4.1-mini"

    # OCR: com provedor disponível e habilitado, PDF digitalizado vira texto marcado como OCR
    set_ocr_provider(
        FakeOcrProvider(
            {
                1: "CONTRATO DIGITALIZADO. O prazo de aviso prévio é de 45 dias para cancelamento do contrato.",
                2: "Foro de Curitiba.",
            }
        )
    )
    ok = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"ai": {"ocr_enabled": True}},
        headers=csrf_headers(client),
    )
    assert ok.status_code == 200 and ok.json()["ai"]["ocr_enabled"] is True
    scan = client.post(
        "/api/v1/documents/upload",
        files={"file": ("scan.pdf", scanned_like_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    ).json()
    run_pending_jobs(enqueued)
    doc = client.get(f"/api/v1/documents/{scan['id']}").json()
    assert doc["status"] == "ready", doc["error_message"]
    assert any("OCR" in w for w in doc["warnings"])
    text = client.get(f"/api/v1/documents/{scan['id']}/text").json()
    assert "45 dias" in text["sections"][0]["text"]
    set_ocr_provider(None)
