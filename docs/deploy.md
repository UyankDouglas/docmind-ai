# Execução e deploy

## Desenvolvimento com Docker Compose (recomendado)

```bash
cp .env.example .env            # ajuste SECRET_KEY e OPENAI_API_KEY
docker compose up --build
```

Serviços: `postgres` (pgvector), `redis`, `minio` (console em http://localhost:9001), `api`
(http://localhost:8000, docs em `/api/docs`), `worker` (Celery) e `web` (http://localhost:5173).
A API aplica `alembic upgrade head` ao iniciar. Todos os serviços possuem healthchecks.

## Desenvolvimento sem Docker (alternativa)

Quando o Docker não está disponível, é possível rodar tudo localmente:

1. **Banco**: PGlite + pgvector (PostgreSQL em WASM) — `scripts/pglite/`:
   ```bash
   cd scripts/pglite && pnpm install
   PGLITE_PORT=5435 PGLITE_DATA=../../data/pglite node server.mjs
   ```
   Limitação: uma conexão por vez. Não use em produção.
2. **API** (processa documentos no próprio processo, sem Redis/MinIO):
   ```bash
   cd backend && uv sync
   # carregue as variáveis de .env.local-dev (DATABASE_URL, STORAGE_BACKEND=local, CELERY_TASK_ALWAYS_EAGER=true ...)
   uv run alembic upgrade head
   uv run uvicorn app.main:app --reload --port 8000
   ```
3. **Frontend**:
   ```bash
   cd apps/web && pnpm install && pnpm dev
   ```

Sem `OPENAI_API_KEY`, use `EMBEDDING_PROVIDER=fake` e `LLM_PROVIDER=fake`: a interface informa que o
provedor é determinístico de testes (as respostas não são geradas por um LLM real).

## Testes

```bash
# backend (requer PostgreSQL+pgvector acessível em TEST_DATABASE_URL; caso contrário, os testes de
# integração são pulados com aviso)
cd backend && TEST_DATABASE_URL=postgresql+psycopg://docmind:docmind@localhost:5432/docmind_test uv run pytest

# frontend
cd apps/web && pnpm test
```

## Produção

`docker-compose.prod.yml` constrói as imagens (API/worker em `python:3.13-slim` com usuário não
root; frontend servido por **Caddy** com proxy de `/api/*` para a API).

Checklist mínimo:

- `APP_ENV=production`, `SECRET_KEY` aleatório, `COOKIE_SECURE=true`, `CORS_ORIGINS` com o domínio real.
- Senhas fortes para PostgreSQL e MinIO; bucket privado.
- TLS: coloque o Caddy (ou outro proxy) com certificado na frente do serviço `web`.
- Backups do volume do PostgreSQL e do MinIO; retenção definida.
- Limites de uso (`RATE_LIMIT_*`, `MAX_UPLOAD_MB`, `MAX_PDF_PAGES`) revisados.
- Monitoramento de `GET /api/v1/health`.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## CI

`.github/workflows/ci.yml` executa: ruff + migrations do zero + pytest (com serviço pgvector),
typecheck + lint + vitest + build do frontend e validação dos arquivos Compose.
