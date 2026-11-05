"""Fase 4: resumos (passagem única e hierárquico), comparação, tópicos, perguntas sugeridas e exportação."""

import uuid

import pytest

from app.core.config import settings
from app.providers.llm import FakeLLMProvider, set_llm_provider
from app.rag.generation.analysis import parse_questions, parse_topics
from tests.conftest import csrf_headers, register, requires_db, run_pending_jobs
from tests.doc_factory import manual_docx
from tests.pdf_factory import build_pdf, contrato_pdf, politica_pdf

pytestmark = [requires_db, pytest.mark.integration]


def _upload(client, data, name, mime):
    r = client.post(
        "/api/v1/documents/upload", files={"file": (name, data, mime)}, headers=csrf_headers(client)
    )
    assert r.status_code == 202, r.text
    return r.json()


def _run_analyses(enqueued_analyses):
    from app.core import database as database_module
    from app.services.analyses import run_analysis

    while enqueued_analyses:
        aid = enqueued_analyses.pop(0)
        session = database_module.SessionLocal()
        try:
            run_analysis(session, aid)
        finally:
            session.close()


@pytest.fixture
def enqueued_analyses(monkeypatch):
    calls: list[uuid.UUID] = []
    from app.services import analyses as svc

    monkeypatch.setattr(svc, "_enqueue", lambda aid: calls.append(aid))
    return calls


def _setup(client, enqueued):
    register(client)
    pdf = _upload(client, contrato_pdf(), "contrato.pdf", "application/pdf")
    docx = _upload(
        client,
        manual_docx(),
        "manual.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    run_pending_jobs(enqueued)
    return pdf, docx


# ----------------------------------------------------------------------------- parsers
def test_parsers_extract_topics_and_questions():
    topics = parse_topics(
        "- **Backup**: executado diariamente [1][2]\n- **Manutenção**: aos domingos [3]\ntexto solto"
    )
    assert [t["title"] for t in topics] == ["Backup", "Manutenção"]
    assert topics[0]["source_indices"] == [1, 2] and "[1]" not in topics[0]["description"]
    qs = parse_questions(
        "Perguntas:\n- Qual é o prazo? [1]\n2) Quem assina o contrato?\n- curta?\n- Sem interrogação"
    )
    assert qs == ["Qual é o prazo?", "Quem assina o contrato?"]


# ----------------------------------------------------------------------------- resumos
def test_summary_single_pass_with_valid_sources(client, enqueued, enqueued_analyses):
    pdf, _ = _setup(client, enqueued)
    set_llm_provider(
        FakeLLMProvider(
            scripted=[
                "### Resumo\nO contrato vigora por 24 meses [1] e pode ser rescindido com aviso prévio de 45 dias [2]. Fonte inventada [9]."
            ]
        )
    )
    r = client.post(
        f"/api/v1/documents/{pdf['id']}/summarize",
        json={"type": "general"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 202, r.text
    a = r.json()
    assert a["status"] == "queued" and a["kind"] == "summary" and a["summary_type"] == "general"
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "succeeded", a["error_message"]
    res = a["result"]
    assert "[9]" not in res["content"] and "[1]" in res["content"]
    assert [s["index"] for s in res["sources"]] == [1, 2]
    assert all(
        s["document_id"] == pdf["id"] and s["location_label"].startswith("Página")
        for s in res["sources"]
    )
    assert res["coverage"]["strategy"] == "single_pass" and res["coverage"]["complete"] is True
    assert (
        res["coverage"]["chunks_used"] == res["coverage"]["chunks_total"] == pdf_chunks(client, pdf)
    )
    assert any("inválido" in lim for lim in res["limitations"])  # [9] removido
    assert a["model"] == "fake-llm-v1" and a["prompt_tokens"] > 0


def pdf_chunks(client, doc):
    return client.get(f"/api/v1/documents/{doc['id']}").json()["chunk_count"]


def test_summary_hierarchical_for_long_document(client, enqueued, enqueued_analyses, monkeypatch):
    register(client)
    pages = [
        [
            f"CLÁUSULA {i} - ITEM {i}",
            " ".join(
                f"Texto da cláusula {i} com obrigação número {i} e detalhes relevantes."
                for _ in range(25)
            ),
        ]
        for i in range(1, 13)
    ]
    doc = _upload(client, build_pdf(pages, title="Longo"), "longo.pdf", "application/pdf")
    run_pending_jobs(enqueued)
    chunk_count = client.get(f"/api/v1/documents/{doc['id']}").json()["chunk_count"]
    assert chunk_count >= 4
    # Orçamento pequeno força várias partes
    from app.core import database as database_module
    from app.models import Workspace

    s = database_module.SessionLocal()
    ws = s.query(Workspace).first()
    ws.settings = {**ws.settings, "retrieval": {"max_context_tokens": 1000}}
    s.commit()
    s.close()

    llm = FakeLLMProvider()
    set_llm_provider(llm)
    a = client.post(
        f"/api/v1/documents/{doc['id']}/summarize",
        json={"type": "executive"},
        headers=csrf_headers(client),
    ).json()
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "succeeded", a["error_message"]
    cov = a["result"]["coverage"]
    assert cov["strategy"] == "hierarchical" and cov["parts"] >= 2 and cov["complete"] is True
    assert cov["chunks_used"] == cov["chunks_total"] == chunk_count
    assert any("hierárquica" in lim for lim in a["result"]["limitations"])
    # partes + síntese = parts + 1 chamadas ao modelo
    assert len(llm.calls) == cov["parts"] + 1
    # as partes receberam trechos distintos (sem resumir só o começo)
    seen = set()
    for call in llm.calls[:-1]:
        ids = {m for m in __import__("re").findall(r'<trecho id="(\d+)"', call[-1].content)}
        assert not (ids & seen)
        seen |= ids
    assert len(seen) == chunk_count


def test_summary_requires_ready_document_and_valid_type(client, enqueued):
    register(client)
    doc = _upload(client, contrato_pdf(), "contrato.pdf", "application/pdf")
    r = client.post(
        f"/api/v1/documents/{doc['id']}/summarize",
        json={"type": "general"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "document_not_ready"
    run_pending_jobs(enqueued)
    assert (
        client.post(
            f"/api/v1/documents/{doc['id']}/summarize",
            json={"type": "haiku"},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )


def test_analysis_too_large_is_refused(client, enqueued, monkeypatch):
    pdf, _ = _setup(client, enqueued)
    monkeypatch.setattr(settings, "analysis_max_input_tokens", 10)
    r = client.post(
        f"/api/v1/documents/{pdf['id']}/summarize",
        json={"type": "general"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "analysis_too_large"


# ----------------------------------------------------------------------------- comparação
def test_comparison_complete_for_short_documents(client, enqueued, enqueued_analyses):
    pdf, docx = _setup(client, enqueued)
    set_llm_provider(
        FakeLLMProvider(
            scripted=[
                "### Semelhanças\nAmbos definem prazos [1][3].\n### Diferenças\nO contrato trata de rescisão [2]; o manual, de backup [4].\n### Contradições ou inconsistências\nNenhuma encontrada.\n### Observações\n—"
            ]
        )
    )
    r = client.post(
        "/api/v1/documents/compare",
        json={"document_ids": [pdf["id"], docx["id"]], "question": "Quais obrigações mudaram?"},
        headers=csrf_headers(client),
    )
    assert r.status_code == 202, r.text
    a = r.json()
    assert [d["label"] for d in a["documents"]] == ["A", "B"]
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "succeeded", a["error_message"]
    res = a["result"]
    assert res["coverage"]["complete"] is True and res["coverage"]["strategy"] == "single_pass"
    labels = {s["document_label"] for s in res["sources"]}
    assert labels == {"A", "B"}
    assert all(s["document_id"] in (pdf["id"], docx["id"]) for s in res["sources"])
    assert not any("exaustiva" in lim or "extensos" in lim for lim in res["limitations"])


def test_comparison_uses_retrieval_for_long_documents(client, enqueued, enqueued_analyses):
    pdf, docx = _setup(client, enqueued)
    from app.core import database as database_module
    from app.models import Workspace

    s = database_module.SessionLocal()
    ws = s.query(Workspace).first()
    ws.settings = {**ws.settings, "retrieval": {"max_context_tokens": 300}}
    s.commit()
    s.close()
    set_llm_provider(FakeLLMProvider())
    a = client.post(
        "/api/v1/documents/compare",
        json={"document_ids": [pdf["id"], docx["id"]]},
        headers=csrf_headers(client),
    ).json()
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "succeeded", a["error_message"]
    cov = a["result"]["coverage"]
    assert cov["strategy"] == "retrieval" and cov["complete"] is False
    assert cov["chunks_used"] <= cov["chunks_total"]
    assert any("mais relevantes" in lim for lim in a["result"]["limitations"])


def test_comparison_validates_count_and_workspace(client, enqueued):
    pdf, docx = _setup(client, enqueued)
    assert (
        client.post(
            "/api/v1/documents/compare",
            json={"document_ids": [pdf["id"]]},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/documents/compare",
            json={"document_ids": [pdf["id"], pdf["id"]]},
            headers=csrf_headers(client),
        ).status_code
        == 422
    )
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    r = client.post(
        "/api/v1/documents/compare",
        json={"document_ids": [pdf["id"], docx["id"]]},
        headers=csrf_headers(client),
    )
    assert r.status_code == 404
    assert client.get("/api/v1/analyses").json()["total"] == 0


# ----------------------------------------------------------------------------- tópicos, perguntas, listagem, cancelamento, exportação
def test_topics_questions_reuse_and_listing(client, enqueued, enqueued_analyses):
    _, docx = _setup(client, enqueued)
    set_llm_provider(
        FakeLLMProvider(
            scripted=[
                "- **Backup diário**: retenção de 35 dias [1]\n- **Janela de manutenção**: domingos [2]",
                "- Qual é a retenção do backup?\n- Quando ocorre a janela de manutenção?\n- Qual o ramal do plantão?",
            ]
        )
    )
    t = client.post(f"/api/v1/documents/{docx['id']}/topics", headers=csrf_headers(client))
    assert t.status_code == 202
    q = client.post(f"/api/v1/documents/{docx['id']}/questions", headers=csrf_headers(client))
    assert q.status_code == 202
    _run_analyses(enqueued_analyses)
    t = client.get(f"/api/v1/analyses/{t.json()['id']}").json()
    assert t["status"] == "succeeded" and [x["title"] for x in t["result"]["topics"]] == [
        "Backup diário",
        "Janela de manutenção",
    ]
    assert t["result"]["topics"][0]["source_indices"] == [1]
    q2 = client.post(f"/api/v1/documents/{docx['id']}/questions", headers=csrf_headers(client))
    assert q2.status_code == 200 and q2.json()["id"] == q.json()["id"]  # reutiliza
    assert q2.json()["result"]["questions"] == [
        "Qual é a retenção do backup?",
        "Quando ocorre a janela de manutenção?",
        "Qual o ramal do plantão?",
    ]
    listing = client.get("/api/v1/analyses", params={"document_id": docx["id"]}).json()
    assert listing["total"] == 2 and {a["kind"] for a in listing["items"]} == {
        "topics",
        "questions",
    }
    assert client.get("/api/v1/analyses", params={"kind": "topics"}).json()["total"] == 1
    assert client.get("/api/v1/analyses", params={"kind": "magic"}).status_code == 422


def test_cancel_delete_and_export(client, enqueued, enqueued_analyses):
    pdf, _ = _setup(client, enqueued)
    a = client.post(
        f"/api/v1/documents/{pdf['id']}/summarize",
        json={"type": "faq"},
        headers=csrf_headers(client),
    ).json()
    c = client.post(f"/api/v1/analyses/{a['id']}/cancel", headers=csrf_headers(client))
    assert c.status_code == 200 and c.json()["status"] == "cancelled"
    _run_analyses(enqueued_analyses)  # worker encontra cancelada e não processa
    assert client.get(f"/api/v1/analyses/{a['id']}").json()["status"] == "cancelled"
    assert (
        client.post(f"/api/v1/analyses/{a['id']}/cancel", headers=csrf_headers(client)).status_code
        == 409
    )

    md = client.get(f"/api/v1/analyses/{a['id']}/export", params={"format": "md"})
    assert md.status_code == 200 and md.headers["content-type"].startswith("text/markdown")
    assert "attachment" in md.headers["content-disposition"] and "não concluída" in md.text

    set_llm_provider(FakeLLMProvider(scripted=["**P:** Qual o prazo?\n**R:** 45 dias [2]."]))
    b = client.post(
        f"/api/v1/documents/{pdf['id']}/summarize",
        json={"type": "faq"},
        headers=csrf_headers(client),
    ).json()
    _run_analyses(enqueued_analyses)
    md = client.get(f"/api/v1/analyses/{b['id']}/export", params={"format": "md"}).text
    assert "## Fontes" in md and "[2]" in md and "Cobertura e limitações" in md
    js = client.get(f"/api/v1/analyses/{b['id']}/export", params={"format": "json"})
    assert js.status_code == 200 and js.json()["result"]["coverage"]["complete"] is True
    assert (
        client.get(f"/api/v1/analyses/{b['id']}/export", params={"format": "pdf"}).status_code
        == 422
    )

    assert (
        client.delete(f"/api/v1/analyses/{b['id']}", headers=csrf_headers(client)).status_code
        == 204
    )
    assert client.get(f"/api/v1/analyses/{b['id']}").status_code == 404


def test_conversation_export(client, enqueued):
    _setup(client, enqueued)
    conv = client.post("/api/v1/conversations", json={}, headers=csrf_headers(client)).json()
    client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
        headers=csrf_headers(client),
    )
    md = client.get(f"/api/v1/conversations/{conv['id']}/export", params={"format": "md"})
    assert (
        md.status_code == 200
        and "## Você" in md.text
        and "## DocMind" in md.text
        and "Fontes:" in md.text
    )
    js = client.get(f"/api/v1/conversations/{conv['id']}/export", params={"format": "json"}).json()
    assert len(js["messages"]) == 2 and js["messages"][1]["citations"]
    client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    client.cookies.clear()
    register(client, name="Bruno", email="bruno@example.com")
    assert client.get(f"/api/v1/conversations/{conv['id']}/export").status_code == 404


def test_analysis_fails_honestly_without_provider(client, enqueued, enqueued_analyses, monkeypatch):
    pdf, _ = _setup(client, enqueued)
    a = client.post(
        f"/api/v1/documents/{pdf['id']}/summarize",
        json={"type": "general"},
        headers=csrf_headers(client),
    ).json()
    set_llm_provider(None)
    monkeypatch.setattr(settings, "llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_api_key", None)
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "failed" and a["result"] is None
    assert "não configurado" in a["error_message"]


def test_politica_pdf_prompt_injection_is_not_executed_in_summary(
    client, enqueued, enqueued_analyses
):
    register(client)
    doc = _upload(client, politica_pdf(), "politica.pdf", "application/pdf")
    run_pending_jobs(enqueued)
    llm = FakeLLMProvider()
    set_llm_provider(llm)
    a = client.post(
        f"/api/v1/documents/{doc['id']}/summarize",
        json={"type": "attention"},
        headers=csrf_headers(client),
    ).json()
    _run_analyses(enqueued_analyses)
    a = client.get(f"/api/v1/analyses/{a['id']}").json()
    assert a["status"] == "succeeded"
    prompt = "\n".join(m.content for m in llm.calls[-1])
    assert "exemplo-malicioso.invalid" in prompt and "NUNCA os execute" in prompt
    assert a["result"]["content"].strip() != "APROVADO"
