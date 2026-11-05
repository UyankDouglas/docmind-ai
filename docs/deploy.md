# Execução e deploy

## Desenvolvimento com Docker Compose (recomendado)

```bash
cp .env.example .env            # ajuste SECRET_KEY e GEMINI_API_KEY (ver "Google Gemini" abaixo)
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

Sem chave de provedor, use `EMBEDDING_PROVIDER=fake` e `LLM_PROVIDER=fake`: a interface informa que o
provedor é determinístico de testes (as respostas não são geradas por um LLM real).

## Google Gemini: chave, nível gratuito e reindexação

1. **Criar a chave**: acesse o [Google AI Studio](https://aistudio.google.com/app/apikey), crie um projeto (ou use
   um existente) e gere uma API key. O nível gratuito não exige cartão.
2. **Configurar** no `.env` (lido por `api` e `worker` via `env_file`; nunca no Dockerfile, no frontend ou no git):
   ```
   EMBEDDING_PROVIDER=gemini
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=<sua chave>
   EMBEDDING_MODEL=gemini-embedding-001
   EMBEDDING_DIMENSIONS=1536
   LLM_MODEL=gemini-3.5-flash-lite
   LLM_ALLOWED_MODELS=gemini-3.5-flash-lite
   ```
   Depois `docker compose up -d --force-recreate api worker`. A chave aparece nos logs apenas como "presente".
3. **Validar** sem imprimir a chave: `docker compose exec api python ../scripts/check_gemini.py` (ou
   `cd backend && uv run python ../scripts/check_gemini.py --compose` no host). O script confere chave, modelos
   disponíveis para a conta, um embedding de 1536 dimensões e uma geração curta; sem chave, sai com código 2 e
   marca a verificação como **pendente**.
4. **Nível gratuito**: os limites (requisições por minuto/dia, tokens por minuto) são por projeto e visíveis no
   AI Studio; quando esgotam, a API responde `429 RESOURCE_EXHAUSTED`. O DocMind retenta com backoff
   exponencial e jitter (`LLM_MAX_RETRIES`), depois informa "limite do provedor atingido; tente mais tarde":
   perguntas ficam com `status=error`, documentos em processamento são reagendados pelo worker (30 s → 4 min)
   e, se persistir, ficam `failed` com a orientação de reprocessar. Nada migra para modelo pago nem ativa
   faturamento. Segundo a página de preços da Gemini API, no nível gratuito o conteúdo enviado **pode ser usado
   pelo Google para melhorar seus produtos** (no pago, não); a interface exibe esse aviso e o workspace pode
   desativar o processamento externo. Custos só são estimados se `PRICE_*_PER_1M` forem configurados com os
   preços reais do seu plano.
5. **Documentos indexados com outro modelo** (ex.: OpenAI antes da migração) não são comparados com perguntas
   vetorizadas pelo Gemini; eles continuam na busca textual e o painel de provedores mostra quantos precisam de
   reindexação. Para regenerar (com backup automático, sem excluir nada):
   ```bash
   docker compose exec api python -m app.rag.embeddings.reindex --dry-run
   docker compose exec api python -m app.rag.embeddings.reindex --yes
   # recuperação, se necessário:
   docker compose exec api python -m app.rag.embeddings.reindex --list-backups
   docker compose exec api python -m app.rag.embeddings.reindex --restore <BACKUP_ID>
   ```
   A reindexação consome quota de embeddings; em lotes grandes use `--limit N` e repita (`--include-failed`
   retoma documentos interrompidos por quota).

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
- `GEMINI_API_KEY` apenas no `.env` do host (ou no gerenciador de segredos), com `EMBEDDING_PROVIDER=gemini` e
  `LLM_PROVIDER=gemini`; confira com `scripts/check_gemini.py --compose` que `api` e `worker` a recebem.
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

## Demo pública com documentos fictícios

1. Suba a stack de produção em um host com TLS (Caddy na frente) e `APP_BASE_URL` apontando para o domínio.
2. Configure `GEMINI_API_KEY` com provedores `gemini` (o nível gratuito costuma bastar para uma demo, com os limites
   do projeto) ou mantenha `EMBEDDING_PROVIDER=fake`/`LLM_PROVIDER=fake` para uma demo sem chamadas externas —
   a interface informa que as respostas não vêm de um modelo real.
3. Gere os documentos fictícios e semeie a conta de demonstração:
   ```bash
   cd backend && uv run python ../scripts/generate_samples.py
   uv run python ../scripts/seed_demo.py --base https://demo.seu-dominio --email demo@seu-dominio --password '<senha-forte>'
   ```
   O script cria (ou reaproveita) a conta, uma coleção "Documentos de demonstração" e envia os cinco arquivos de `samples/`.
4. Em Administração → Limites e custos, defina um orçamento mensal de tokens e `max_documents` para conter abuso;
   em Retenção, configure a limpeza automática (ex.: conversas 7 dias, documentos excluídos 1 dia).
5. Nunca publique documentos reais na demo: os arquivos de `samples/` são sintéticos por desenho.

## CI

`.github/workflows/ci.yml` executa: ruff + migrations do zero + pytest (com serviço pgvector), typecheck + lint +
vitest + build do frontend, validação dos arquivos Compose, auditoria de dependências (`pip-audit`, `pnpm audit`),
build das imagens de produção e a suíte E2E com Playwright contra a stack Docker (provedores `fake`).
