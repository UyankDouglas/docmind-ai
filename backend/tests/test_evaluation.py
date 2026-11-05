"""Fase 6: módulo de avaliação do RAG (dataset, métricas, runner e relatório)."""

import json

import pytest

from app.providers.llm import FakeLLMProvider
from app.rag.evaluation.dataset import QUESTIONS, dataset_hash, validate
from app.rag.evaluation.metrics import precision_at_k, recall_at_k, reciprocal_rank
from app.rag.evaluation.runner import EvaluationRunner, KeywordJudge, render_markdown, write_report
from tests.conftest import requires_db


def test_dataset_is_valid_and_covers_required_types():
    validate()
    types = {q.type for q in QUESTIONS}
    assert {
        "direct",
        "page",
        "cross",
        "similar_names",
        "unanswerable",
        "contradiction",
        "malicious",
    } <= types
    assert sum(q.should_abstain for q in QUESTIONS) >= 5
    assert len(QUESTIONS) >= 30
    assert len(dataset_hash()) == 16 and dataset_hash() == dataset_hash()  # determinístico


def test_metrics():
    assert recall_at_k(["a", "b", "c"], {"a", "c", "z"}, 3) == pytest.approx(2 / 3)
    assert recall_at_k(["a"], set(), 3) == 0.0
    assert precision_at_k(["a", "b"], {"a"}, 2) == 0.5
    assert precision_at_k([], {"a"}, 2) == 0.0
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["x"], {"a"}) == 0.0


def test_keyword_judge_requires_keywords_in_answer_and_evidence():
    judge = KeywordJudge()
    q = QUESTIONS[0]  # c01: "24"
    assert judge.supported(q, "O prazo é de 24 meses.", ["vigorará pelo prazo de 24 meses"]) is True
    assert judge.supported(q, "O prazo é de 24 meses.", ["texto sem o número"]) is False
    assert judge.supported(q, "Não sei.", ["24 meses"]) is False
    unanswerable = next(x for x in QUESTIONS if x.should_abstain)
    assert judge.supported(unanswerable, "qualquer", ["x"]) is None


@requires_db
@pytest.mark.integration
def test_runner_subset_produces_consistent_report(engine, tmp_path):
    from app.core import database as database_module

    ids = {"c06", "a03", "d01", "t01", "u01", "s02", "m01"}
    subset = [q for q in QUESTIONS if q.id in ids]
    db = database_module.SessionLocal()
    runner = EvaluationRunner(db, judge=KeywordJudge(), llm=FakeLLMProvider(), questions=subset)
    try:
        runner.setup()
        assert len(runner.docs_by_name) == 5 and all(
            d.status == "ready" for d in runner.docs_by_name.values()
        )
        report = runner.run()
    finally:
        runner.teardown()
        db.close()

    assert report.dataset_hash == dataset_hash() and report.judge == "keyword-proxy"
    assert report.providers["llm_provider"] == "fake"
    by_id = {r.id: r for r in report.results}
    assert set(by_id) == ids and report.summary["errors"] == 0
    # Recuperação acha o trecho relevante nas perguntas diretas
    assert (
        by_id["c06"].recall_at_k == 1.0
        and by_id["c06"].citations >= 1
        and by_id["c06"].valid_citations
    )
    assert by_id["d01"].relevant_total >= 1 and by_id["t01"].relevant_total >= 1
    # Abstenção: pergunta sem resposta e pergunta fora do escopo
    assert by_id["u01"].abstained and by_id["u01"].abstention_correct
    assert by_id["s02"].abstained and by_id["s02"].abstention_correct
    # Maliciosa não é obedecida
    assert by_id["m01"].malicious_compliance is False
    assert report.summary["pct_correct_abstention_when_unanswerable"] == 100.0
    assert report.summary["latency_ms"]["p50"] is not None and report.benchmark["indexing"]
    assert any("fake" in lim for lim in report.limitations)

    json_path, md_path = write_report(report, tmp_path)
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["summary"]["questions"] == len(ids) and data["dataset_version"]
    md = render_markdown(report)
    assert "## Métricas" in md and "## Limitações" in md and "| c06 |" in md
    assert md_path.read_text(encoding="utf-8") == md
