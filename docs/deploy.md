# Execução e deploy

## Desenvolvimento com Docker Compose (recomendado)

```bash
cp .env.example .env            # ajuste SECRET_KEY e OPENAI_API_KEY
docker compose up --build
```

Serviços: `postgres` (pgvector), `redis`, `minio` (console em http://localhost:9001), `api`
(http://localhost:8000, docs em `/api/docs`), `worker` (Celery) e `web` (http://localhost:5173).
A API aplica `alembic upgrade head` ao iniciar. Todos os serviços possuem healthchecks.

> **Imagem do MinIO**: `minio/minio` deixou de ser distribuída publicamente (Docker Hub e quay.io negam o pull).
> O Compose usa `bitnamilegacy/minio` (build MinIO 2025-05, congelada), suficiente para desenvolvimento.
> Para produção, avalie um servidor S3 mantido (ex.: `rustfs/rustfs`) ou um serviço S3 gerenciado; a aplicação
> só depende da API S3 via SDK `minio`.

> **Windows**: após abrir o Docker Desktop, o daemon pode levar vários minutos até responder; `docker info`
> retorna "unable to start" nesse intervalo. Aguarde antes de concluir que há um problema.

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
- `APP_BASE_URL` com o domínio público (links de convite e recuperação de senha) e `MAIL_*` para envio real de e-mails.
- O worker roda o Celery beat embutido (`-B`) para a retenção diária; mantenha **uma única** réplica do worker com `-B` (ou separe um serviço `beat`).
- OCR: só se instalar `tesseract-ocr` + idioma na imagem e `uv sync --extra ocr` (ver `docs/ocr-evaluation.md`).

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## CI

`.github/workflows/ci.yml` executa: ruff + migrations do zero + pytest (com serviço pgvector),
typecheck + lint + vitest + build do frontend e validação dos arquivos Compose.
