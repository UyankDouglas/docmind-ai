"""Validação real da configuração Google Gemini do DocMind (sem imprimir a chave).

Verifica, com a chave configurada no ambiente/.env do backend:
1. presença de GEMINI_API_KEY e provedores selecionados;
2. validade da chave (listagem de modelos);
3. disponibilidade dos modelos de geração e de embeddings configurados;
4. uma chamada de embedding (dimensão == EMBEDDING_DIMENSIONS, vetor normalizado, task_type);
5. uma geração curta (texto retornado, modelo efetivamente usado, uso de tokens);
6. opcionalmente, se os contêineres `api` e `worker` do Compose recebem a variável (--compose).

Uso (dentro de backend/, com o .env carregado pelo próprio Settings):
    uv run python ../scripts/check_gemini.py [--compose] [--json]

Sai com 0 quando tudo passa, 2 quando falta a chave (verificação pendente) e 1 em falhas.
As duas chamadas reais são mínimas (um embedding, uma geração de poucos tokens) e contam para
a quota do projeto; o script não usa modelos pagos nem ativa faturamento.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compose", action="store_true", help="checa a variável nos contêineres")
    parser.add_argument("--json", action="store_true", help="imprime o resultado em JSON")
    args = parser.parse_args()

    from app.core.config import settings

    report: dict = {
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "embedding_model": settings.embedding_model,
        "llm_model": settings.llm_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "checks": {},
    }
    checks = report["checks"]

    def ok(name: str, value=True, **extra) -> None:
        checks[name] = {"status": "ok", **({"value": value} if value is not True else {}), **extra}

    def fail(name: str, message: str, **extra) -> None:
        checks[name] = {"status": "fail", "message": message, **extra}

    def pending(name: str, message: str) -> None:
        checks[name] = {"status": "pending", "message": message}

    key = settings.gemini_api_key
    if not key:
        pending("api_key", "GEMINI_API_KEY ausente no ambiente do backend (.env).")
        return _finish(report, args.json, code=2)
    ok("api_key", "presente (não exibida)")

    if settings.embedding_provider != "gemini" or settings.llm_provider != "gemini":
        checks["providers"] = {
            "status": "warn",
            "message": "EMBEDDING_PROVIDER/LLM_PROVIDER não estão ambos em 'gemini'; "
            "a aplicação não usará o Gemini até que estejam.",
        }
    else:
        ok("providers", "gemini + gemini")

    from google.genai import errors as genai_errors
    from google.genai import types

    from app.providers.errors import ProviderError
    from app.providers.gemini import (
        GeminiEmbeddingProvider,
        GeminiLLMProvider,
        list_models,
        make_client,
        map_error,
    )
    from app.providers.llm import LLMMessage

    client = make_client(key, timeout_seconds=60)

    # 2–3. chave válida + modelos disponíveis
    try:
        models = list_models(client)
    except (genai_errors.APIError, Exception) as exc:  # noqa: BLE001
        err = map_error(exc)
        fail("api_key_valid", f"{err.code}: {err.message}")
        return _finish(report, args.json, code=1)
    ok("api_key_valid", f"{len(models)} modelos visíveis")
    names = {n.removeprefix("models/"): actions for n, actions in models}
    for label, model, action in (
        ("llm_model_available", settings.llm_model, "generateContent"),
        ("embedding_model_available", settings.embedding_model, "embedContent"),
    ):
        actions = names.get(model)
        if actions is None:
            fail(label, f"modelo '{model}' não aparece na listagem desta chave")
        elif actions and action not in actions:
            fail(label, f"modelo '{model}' não suporta {action}: {actions}")
        else:
            ok(label, model, supported_actions=actions)

    # 4. embedding real
    try:
        emb = GeminiEmbeddingProvider(
            api_key=key, model=settings.embedding_model, dimensions=settings.embedding_dimensions
        )
        started = time.perf_counter()
        q = emb.embed_query("Qual é o prazo de aviso prévio do contrato?")
        d = emb.embed_texts(["O prazo de aviso prévio é de 45 dias.", "Cláusula de confidencialidade."])
        norm = math.sqrt(sum(x * x for x in q.vectors[0]))
        ok(
            "embedding",
            {
                "query_dimensions": len(q.vectors[0]),
                "document_dimensions": [len(v) for v in d.vectors],
                "query_norm": round(norm, 6),
                "task_types": [q.extra.get("task_type"), d.extra.get("task_type")],
                "tokens_source": d.extra.get("tokens_source"),
                "latency_ms": int((time.perf_counter() - started) * 1000),
            },
        )
        if len(q.vectors[0]) != settings.embedding_dimensions:
            fail("embedding_dimensions", f"{len(q.vectors[0])} != {settings.embedding_dimensions}")
        else:
            ok("embedding_dimensions", settings.embedding_dimensions)
    except ProviderError as exc:
        fail("embedding", f"{exc.code}: {exc.message}", detail=exc.detail)

    # 5. geração real (curta)
    try:
        llm = GeminiLLMProvider(api_key=key, model=settings.llm_model)
        result = llm.generate(
            [
                LLMMessage("system", "Responda em português, em uma frase curta."),
                LLMMessage("user", "Diga apenas: DocMind operacional."),
            ],
            max_tokens=64,
        )
        ok(
            "generation",
            {
                "model_reported": result.model,
                "configured_model": settings.llm_model,
                "model_matches": result.model.startswith(settings.llm_model),
                "text_preview": result.text[:80],
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "finish_reason": result.finish_reason,
                "latency_ms": result.latency_ms,
            },
        )
        stream_parts = []
        for item in llm.stream([LLMMessage("user", "Conte de 1 a 5, separados por vírgula.")], max_tokens=32):
            if isinstance(item, str):
                stream_parts.append(item)
        ok("streaming", {"chunks": len(stream_parts), "text_preview": "".join(stream_parts)[:60]})
    except ProviderError as exc:
        fail("generation", f"{exc.code}: {exc.message}", detail=exc.detail)
    _ = types  # mantém o import explícito do SDK para o leitor

    # 6. variáveis nos contêineres
    if args.compose:
        for service in ("api", "worker"):
            try:
                out = subprocess.run(
                    ["docker", "compose", "exec", "-T", service, "sh", "-c", "test -n \"$GEMINI_API_KEY\" && echo present || echo missing"],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                status = out.stdout.strip() or out.stderr.strip()[:120]
                (ok if status == "present" else fail)(f"compose_{service}_env", status if status != "present" else "GEMINI_API_KEY presente")
            except Exception as exc:  # noqa: BLE001
                fail(f"compose_{service}_env", f"{type(exc).__name__}: {exc}")

    failed = any(c.get("status") == "fail" for c in checks.values())
    return _finish(report, args.json, code=1 if failed else 0)


def _finish(report: dict, as_json: bool, *, code: int) -> int:
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            f"Provedores: embeddings={report['embedding_provider']} ({report['embedding_model']}, "
            f"{report['embedding_dimensions']}d) · respostas={report['llm_provider']} ({report['llm_model']})"
        )
        for name, check in report["checks"].items():
            status = check["status"].upper()
            detail = check.get("message") or check.get("value", "")
            print(f"  [{status:7}] {name}: {detail if not isinstance(detail, dict) else json.dumps(detail, ensure_ascii=False)}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
