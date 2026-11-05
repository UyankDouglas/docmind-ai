# DocMind backend

API FastAPI + worker Celery do DocMind AI. Pipeline RAG em `app/rag/` (extração, chunking, embeddings,
recuperação híbrida, geração com citações, avaliação), serviços em `app/services/`, adaptadores de
provedores em `app/providers/`.

## Executar

```bash
uv sync                                   # dependências (inclui google-genai)
uv run alembic upgrade head               # migrations
uv run uvicorn app.main:app --reload      # API em http://localhost:8000 (docs em /api/docs)
uv run celery -A app.workers.celery_app:celery_app worker -B --loglevel=INFO   # worker + beat
```

As variáveis vêm de `.env` (na raiz ou em `backend/`); modelo em `../.env.example`.

## Provedores de IA

| Provedor | Variáveis | Observações |
|---|---|---|
| `gemini` (padrão) | `GEMINI_API_KEY`, `EMBEDDING_MODEL=gemini-embedding-001`, `LLM_MODEL=gemini-3.5-flash-lite`, `EMBEDDING_DIMENSIONS=1536` | SDK oficial `google-genai`; embeddings com `task_type` `RETRIEVAL_DOCUMENT`/`RETRIEVAL_QUERY`, `output_dimensionality=1536` e normalização L2; geração com `system_instruction` separada do histórico; streaming real |
| `openai` | `OPENAI_API_KEY`, `EMBEDDING_MODEL=text-embedding-3-small`, `LLM_MODEL=gpt-4o-mini` | mantido como alternativa |
| `fake` | — | determinístico, só testes/desenvolvimento; a interface avisa que não é IA real |

`EMBEDDING_PROVIDER` e `LLM_PROVIDER` são independentes, mas a IA só consta como configurada quando os dois
provedores escolhidos têm a chave de que precisam. Erros do provedor são normalizados em
`app/providers/errors.py` (`ai_quota_exceeded`, `ai_auth_failed`, `ai_model_unavailable`, `ai_timeout`,
`ai_temporarily_unavailable`, `ai_empty_response`, `ai_response_blocked`); os transitórios recebem
backoff exponencial com jitter limitado por `LLM_MAX_RETRIES`.

### Validar a chave Gemini (chamadas mínimas, sem imprimir a chave)

```bash
uv run python ../scripts/check_gemini.py            # + --compose para checar api/worker do Docker
```

### Trocar o modelo de embeddings (ex.: OpenAI → Gemini)

Embeddings de modelos diferentes não compartilham o mesmo espaço vetorial. A busca vetorial ignora
registros de outro modelo; para voltar a encontrá-los é preciso reindexar:

```bash
uv run python -m app.rag.embeddings.reindex --dry-run     # lista documentos afetados
uv run python -m app.rag.embeddings.reindex --yes         # backup + regeneração com o provedor atual
uv run python -m app.rag.embeddings.reindex --list-backups
uv run python -m app.rag.embeddings.reindex --restore <BACKUP_ID>
```

O comando nunca roda sozinho na inicialização, não exclui documentos/conversas/arquivos, substitui cada
vetor no lugar (respeitando `chunk_id` único) e, se a quota ou a credencial falharem, interrompe a rodada
deixando o documento como `failed` com a causa — nunca `ready` com vetores incompatíveis. Com a stack
Docker: `docker compose exec api python -m app.rag.embeddings.reindex --dry-run`.

## Testes e qualidade

```bash
TEST_DATABASE_URL=postgresql+psycopg://docmind:docmind@localhost:5432/docmind_test uv run pytest
uv run ruff check app tests && uv run ruff format --check app tests
uv run alembic check                       # sem drift entre modelos e migrations
uv run python -m app.rag.evaluation        # avaliação RAG reproduzível (ver ../docs/evaluation.md)
```

Os testes usam provedores `fake` e um SDK Gemini simulado (`tests/test_unit_gemini.py`); nenhum teste
automatizado faz chamadas reais.
