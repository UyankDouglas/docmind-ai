"""Fase 3: busca híbrida, histórico de pesquisas, configurações de recuperação, streaming SSE e evidências."""

import json

import pytest

from app.models import WorkspaceMember
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.doc_factory import politica_txt
from tests.pdf_factory import contrato_pdf

pytestmark = [requires_db, pytest.mark.integration]


def _setup(client, enqueued):
    register(client)
    pdf = client.post(
        "/api/v1/documents/upload",
        files={"file": ("contrato.pdf", contrato_pdf(), "application/pdf")},
        headers=csrf_headers(client),
    ).json()
    txt = client.post(
        "/api/v1/documents/upload",
        files={"file": ("politica.txt", politica_txt(), "text/plain")},
        headers=csrf_headers(client),
    ).json()
    outcomes = run_pending_jobs(enqueued)
    assert all(o.status.value == "ready" for o in outcomes)
    return pdf, txt


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block or block.startswith(":"):
            continue
        event, data = None, None
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:].strip())
        if event:
            events.append((event, data))
    return events


# ----------------------------------------------------------------------------- busca híbrida
def test_hybrid_search_combines_lexical_and_vector_signals(client, enqueued):
    pdf, _ = _setup(client, enqueued)
    body = client.post(
        "/api/v1/search",
        json={"query": "aviso prévio rescisão 45 dias", "mode": "hybrid"},
        headers=csrf_headers(client),
    ).json()
    assert body["mode"] == "hybrid"
    assert body["lexical_candidates"] >= 1 and body["vector_candidates"] >= 1
    top = body["results"][0]
    assert top["document_id"] == pdf["id"]
    assert top["lexical_rank"] is not None and top["vector_rank"] is not None
    assert top["highlight"] and "<mark>" in top["highlight"]
    assert 0 < top["score"] < 0.1  # score RRF (1/(k+rank) somado)

    vec = client.post(
        "/api/v1/search",
        json={"query": "aviso prévio rescisão 45 dias", "mode": "vector"},
        headers=csrf_headers(client),
    ).json()
    assert vec["mode"] == "vector" and vec["lexical_candidates"] == 0
    assert all(r["lexical_rank"] is None and r["highlight"] is None for r in vec["results"])


def test_lexical_search_finds_exact_terms_and_respects_scope(client, enqueued):
    pdf, txt = _setup(client, enqueued)
    # Termo específico do TXT; escopo restrito ao PDF não pode devolver o TXT
    body = client.post(
        "/api/v1/search",
        json={"query": "VPN corporativa", "mode": "hybrid", "document_ids": [pdf["id"]]},
        headers=csrf_headers(client),
    ).json()
    assert all(r["document_id"] == pdf["id"] for r in body["results"])
    body = client.post(
        "/api/v1/search",
        json={"query": "VPN corporativa", "mode": "hybrid"},
        headers=csrf_headers(client),
    ).json()
    assert body["results"] and body["results"][0]["document_id"] == txt["id"]


def test_search_history_is_per_user_and_clearable(client, enqueued):
    _setup(client, enqueued)
    client.post(
        "/api/v1/search", json={"query": "prazo de cancelamento"}, headers=csrf_headers(client)
    )
    client.post(
        "/api/v1/search",
        json={"query": "VPN corporativa", "mode": "hybrid"},
        headers=csrf_headers(client),
    )
    hist = client.get("/api/v1/search/history").json()["items"]
    assert [h["query"] for h in hist] == ["VPN corporativa", "prazo de cancelamento"]
    assert hist[0]["mode"] == "hybrid" and hist[0]["result_count"] >= 1

    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    assert client.get("/api/v1/search/history").json()["items"] == []
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    client.get("/api/v1/auth/csrf")
    client.post(
        "/api/v1/auth/login",
        json={"email": "ana@example.com", "password": "senha-forte-123"},
        headers=csrf_headers(client),
    )
    assert client.delete("/api/v1/search/history", headers=csrf_headers(client)).status_code == 204
    assert client.get("/api/v1/search/history").json()["items"] == []


# ----------------------------------------------------------------------------- configurações
def test_workspace_retrieval_settings(client, enqueued, db):
    _setup(client, enqueued)
    current = client.get("/api/v1/workspaces/current/settings").json()
    assert current["retrieval"]["mode"] == "hybrid" and current["external_ai_enabled"] is True

    upd = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"retrieval": {"mode": "vector", "top_k": 3, "min_similarity": 0.05}},
        headers=csrf_headers(client),
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["retrieval"] == {
        **current["retrieval"],
        "mode": "vector",
        "top_k": 3,
        "min_similarity": 0.05,
    }
    bad = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"retrieval": {"top_k": 99}},
        headers=csrf_headers(client),
    )
    assert bad.status_code == 422

    # A configuração é aplicada na pesquisa (modo padrão agora é vetorial, top_k=3)
    body = client.post(
        "/api/v1/search", json={"query": "prazo de cancelamento"}, headers=csrf_headers(client)
    ).json()
    assert body["mode"] == "vector" and len(body["results"]) <= 3

    # Não-admin não altera
    me = client.get("/api/v1/auth/me").json()
    member = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == me["id"]).one()
    member.role = "viewer"
    db.commit()
    forbidden = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"retrieval": {"top_k": 2}},
        headers=csrf_headers(client),
    )
    assert forbidden.status_code == 403
    member.role = "admin"
    db.commit()


def test_external_ai_toggle_blocks_real_providers_only(client, enqueued):
    _setup(client, enqueued)
    upd = client.patch(
        "/api/v1/workspaces/current/settings",
        json={"external_ai_enabled": False},
        headers=csrf_headers(client),
    )
    assert upd.status_code == 200 and upd.json()["external_ai_enabled"] is False
    assert client.get("/api/v1/settings/ai").json()["external_processing"] is False


# ----------------------------------------------------------------------------- streaming
def test_stream_endpoint_emits_context_deltas_and_validated_done(client, enqueued):
    pdf, _ = _setup(client, enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/messages/stream",
        json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
        headers=csrf_headers(client),
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())
    events = _parse_sse(body)
    kinds = [k for k, _ in events]
    assert kinds[0] == "user_message" and kinds[1] == "context" and kinds[-1] == "done"
    assert kinds.count("delta") >= 2
    context = events[1][1]["sources"]
    assert context and context[0]["index"] == 1 and context[0]["document_id"] == pdf["id"]
    streamed = "".join(d["text"] for k, d in events if k == "delta")
    final = events[-1][1]["assistant_message"]
    assert final["status"] == "ok" and final["citations"]
    assert final["content"].strip() == streamed.strip()
    assert all(c["chunk_id"] in {s["chunk_id"] for s in context} for c in final["citations"])

    # Persistido: a conversa reaberta traz as duas mensagens
    detail = client.get(f"/api/v1/conversations/{conv['id']}").json()
    assert detail["message_count"] == 2 and detail["messages"][1]["id"] == final["id"]


def test_stream_without_evidence_has_no_deltas(client, enqueued):
    _setup(client, enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    with client.stream(
        "POST",
        f"/api/v1/conversations/{conv['id']}/messages/stream",
        json={"content": "Qual é a capital da Mongólia?"},
        headers=csrf_headers(client),
    ) as resp:
        body = "".join(resp.iter_text())
    events = _parse_sse(body)
    kinds = [k for k, _ in events]
    assert kinds == ["user_message", "context", "done"]
    assert events[1][1]["sources"] == []
    assert events[2][1]["assistant_message"]["status"] == "no_evidence"


def test_stream_requires_csrf_and_scope(client, enqueued):
    _setup(client, enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    resp = client.post(f"/api/v1/conversations/{conv['id']}/messages/stream", json={"content": "x"})
    assert resp.status_code == 403


# ----------------------------------------------------------------------------- evidências
def test_retrieval_evidence_explains_the_answer(client, enqueued):
    _setup(client, enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    answer = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
        headers=csrf_headers(client),
    ).json()["assistant_message"]
    ev = client.get(f"/api/v1/messages/{answer['id']}/retrieval")
    assert ev.status_code == 200, ev.text
    ev = ev.json()
    assert ev["mode"] == "hybrid" and ev["params"]["top_k"] >= 1
    assert ev["candidates"], "deveria listar candidatos"
    cited = [c for c in ev["candidates"] if c["cited"]]
    assert cited and cited[0]["citation_index"] == 1 and cited[0]["in_context"]
    assert all(c["in_context"] for c in cited)
    assert ev["context_tokens"] > 0 and ev["latency"]["generation_ms"] is not None
    assert ev["usage"]["model"] == "fake-llm-v1"
    # Mensagem do usuário não tem evidências; outro usuário não acessa
    user_msg_id = client.get(f"/api/v1/conversations/{conv['id']}").json()["messages"][0]["id"]
    assert client.get(f"/api/v1/messages/{user_msg_id}/retrieval").status_code == 403
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    assert client.get(f"/api/v1/messages/{answer['id']}/retrieval").status_code == 404


# ----------------------------------------------------------------------------- histórico avançado e feedback
def test_conversation_search_and_feedback_summary(client, enqueued):
    _setup(client, enqueued)
    for title in ("Contrato Aurora", "Férias e afastamentos"):
        client.post("/api/v1/conversations", json={"title": title}, headers=csrf_headers(client))
    found = client.get("/api/v1/conversations", params={"q": "aurora"}).json()["items"]
    assert [c["title"] for c in found] == ["Contrato Aurora"]

    conv = found[0]
    answer = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o valor mensal do contrato?"},
        headers=csrf_headers(client),
    ).json()["assistant_message"]
    client.post(
        f"/api/v1/messages/{answer['id']}/feedback",
        json={"rating": -1},
        headers=csrf_headers(client),
    )
    usage = client.get("/api/v1/usage").json()
    assert usage["feedback"] == {"positive": 0, "negative": 1, "total_answers": 1}
