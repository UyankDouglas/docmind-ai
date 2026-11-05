"""CLI: `uv run python -m app.rag.evaluation --out ../docs/evaluation`

Executa a avaliação completa contra o banco configurado (DATABASE_URL), em um workspace temporário.
Com `--judge llm` usa o próprio provedor configurado como juiz (só faz sentido com provedor real).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.core.database import SessionLocal
from app.providers.llm import get_llm_provider
from app.rag.evaluation.dataset import QUESTIONS, validate
from app.rag.evaluation.runner import EvaluationRunner, KeywordJudge, LLMJudge, write_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Avaliação reproduzível do RAG do DocMind AI")
    parser.add_argument(
        "--out", default="../docs/evaluation", help="diretório de saída (latest.json / latest.md)"
    )
    parser.add_argument("--judge", choices=["keyword", "llm"], default="keyword")
    parser.add_argument("--only", nargs="*", help="ids de perguntas a executar (padrão: todas)")
    parser.add_argument(
        "--keep-workspace", action="store_true", help="não remover o workspace de avaliação"
    )
    args = parser.parse_args()

    validate()
    questions = [q for q in QUESTIONS if not args.only or q.id in args.only]
    llm = get_llm_provider()
    judge = LLMJudge(llm) if args.judge == "llm" else KeywordJudge()

    db = SessionLocal()
    runner = EvaluationRunner(
        db, judge=judge, llm=llm, questions=questions, keep_workspace=args.keep_workspace
    )
    try:
        runner.setup()
        report = runner.run()
    finally:
        try:
            runner.teardown()
        finally:
            db.close()
    json_path, md_path = write_report(report, Path(args.out))
    print(json.dumps(report.summary, ensure_ascii=False, indent=2))
    print(f"\nRelatório: {md_path} e {json_path}")
    return 0 if report.summary["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
