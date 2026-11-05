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
3. **Validar** sem imprimir a chave: `cd backend && uv run python ../scripts/check_gemini.py --compose` no host
   (em produção: `docker compose -f docker-compose.prod.yml exec api python /scripts/check_gemini.py`). O script confere chave, modelos
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

`docker-compose.prod.yml` constrói as imagens (API/worker em `python:3.13-slim` com usuário não root; frontend
servido por **Caddy**, que também faz o proxy de `/api/*` e o HTTPS). Só o Caddy publica portas (80/443);
PostgreSQL, Redis, MinIO e a API ficam na rede interna do Compose. Logs com rotação (10 MB × 3 por serviço).

- **HTTPS automático**: com `SITE_ADDRESS=demo.seu-dominio.com` no `.env`, o Caddy obtém e renova o certificado
  Let's Encrypt e redireciona HTTP para HTTPS. Exige o DNS apontando para o servidor e as portas 80 e 443 abertas.
  Sem domínio, use `<ip-com-hifens>.sslip.io` (ex.: `203-0-113-10.sslip.io`), que resolve para o próprio IP e aceita
  certificado válido. `SITE_ADDRESS` vazio = HTTP simples na porta 80 (atrás de outro proxy).
- Certificados ficam no volume `caddy_data`; apagá-lo força nova emissão (sujeita aos limites do Let's Encrypt).

Checklist mínimo:

- `APP_ENV=production`, `SECRET_KEY` aleatório, `COOKIE_SECURE=true`, `CORS_ORIGINS` e `APP_BASE_URL` com o domínio real.
- `GEMINI_API_KEY` apenas no `.env` do host (permissão 600) ou no gerenciador de segredos, com `EMBEDDING_PROVIDER=gemini`
  e `LLM_PROVIDER=gemini`; confira com `docker compose -f docker-compose.prod.yml exec api python /scripts/check_gemini.py`.
- Senhas fortes e aleatórias para PostgreSQL e MinIO (o bootstrap gera); bucket privado.
- Backups diários do PostgreSQL e do MinIO (`deploy/backup.sh`); retenção definida.
- Limites de uso (`RATE_LIMIT_*`, `MAX_UPLOAD_MB`, `MAX_PDF_PAGES`) revisados.
- Monitoramento de `GET /api/v1/health`.
- `MAIL_*` para envio real de e-mails (sem isso, convites e recuperação de senha só aparecem no log do servidor).
- O worker roda o Celery beat embutido (`-B`) para a retenção diária; mantenha **uma única** réplica do worker com `-B` (ou separe um serviço `beat`).
- OCR: só se instalar `tesseract-ocr` + idioma na imagem e `uv sync --extra ocr` (ver `docs/ocr-evaluation.md`).

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## Demo pública

O modo demonstração (`DEMO_MODE=true`) foi feito para expor o DocMind a visitantes sem expor a chave nem dados
reais:

- **Aviso fixo** no login e uma faixa no app: "Ambiente de demonstração… não envie documentos reais", com o aviso de
  uso de dados do nível gratuito da Gemini API.
- **Cadastro aberto com workspace isolado por visitante** (`REGISTRATION_ENABLED=true`). Cada workspace novo recebe
  os limites `NEW_WORKSPACE_MAX_DOCUMENTS`, `NEW_WORKSPACE_MAX_STORAGE_MB`, `NEW_WORKSPACE_MONTHLY_TOKEN_BUDGET` e a
  retenção `NEW_WORKSPACE_RETENTION_DAYS` (conversas, análises e histórico apagados após N dias).
- **Teto diário global** (`GLOBAL_DAILY_TOKEN_BUDGET`): soma o consumo de todos os visitantes; atingido, perguntas,
  pesquisas, análises e uploads respondem "limite diário de uso de IA desta instância" até a meia-noite UTC. É o que
  impede um visitante de esgotar a quota gratuita da chave para todos.
- **Botão "Carregar documentos de exemplo"** no estado vazio de Documentos e do Dashboard: envia os cinco arquivos
  fictícios de `samples/` pelo pipeline normal (mesmos limites, deduplicação e teto), numa coleção própria.
- Limites de upload e uso mais restritos no modelo `deploy/env.production.example` (5 MB, 40 páginas, 20 perguntas/hora).

### Servidor

Qualquer VM Linux (Ubuntu 22.04/24.04 ou Debian 12) com **2 vCPU e 4 GB de RAM** roda a stack com folga; com 2 GB
funciona com swap (o bootstrap cria 2 GB se faltar memória). Opções comuns: uma VPS pequena em qualquer provedor ou
uma VM ARM do nível Always Free da Oracle Cloud (confira as condições atuais do provedor). Requisitos: IP público,
portas 80 e 443 liberadas no firewall **do provedor** (security list / security group) e acesso SSH.

> **Oracle Cloud**: além da security list, as imagens Ubuntu da OCI trazem regras `iptables` que bloqueiam 80/443.
> Libere com `sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`.

### Publicação em um comando

```bash
# no servidor
git clone https://github.com/UyankDouglas/docmind-ai.git && cd docmind-ai
sudo ./deploy/bootstrap.sh --sslip                      # ou: --domain demo.seu-dominio.com
```

O `deploy/bootstrap.sh`:

1. instala Docker Engine + Compose pelo repositório oficial da Docker (se ainda não houver) e cria swap se faltar memória;
2. descobre o IP público (com `--sslip`) e monta o endereço `<ip>.sslip.io`;
3. gera o `.env` a partir de `deploy/env.production.example` com `SECRET_KEY` e senhas aleatórias, e pede a
   `GEMINI_API_KEY` **sem eco** (ou lê da variável de ambiente); o arquivo fica com permissão 600. Um `.env`
   existente nunca é sobrescrito;
4. sobe a stack, espera a API, roda `check_gemini.py` dentro do contêiner e confere o HTTPS público;
5. opcionalmente (`--seed-email demo@seu-dominio`) cria uma conta já com os documentos fictícios (senha pedida no terminal).

Sem chave, `--fake` publica a demo com o provedor determinístico; a interface avisa que as respostas não vêm de um
modelo real.

### Operação

```bash
docker compose -f docker-compose.prod.yml ps                     # estado
docker compose -f docker-compose.prod.yml logs -f api worker web # logs
git pull && docker compose -f docker-compose.prod.yml up -d --build   # atualizar
```

Para fechar o cadastro depois (só convites), troque `REGISTRATION_ENABLED=false` no `.env` e recrie `api` e `worker`
(`docker compose -f docker-compose.prod.yml up -d --force-recreate api worker`). O mesmo vale para os limites.

### Backup e restauração

```bash
sudo ./deploy/backup.sh                 # ./backups, mantém 7 dias
echo "30 3 * * * root cd $(pwd) && ./deploy/backup.sh >> /var/log/docmind-backup.log 2>&1" | sudo tee /etc/cron.d/docmind-backup

# restauração (com a stack no ar)
docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/docmind-db-<DATA>.dump
docker compose -f docker-compose.prod.yml exec -T minio tar -C /bitnami/minio/data -xzf - < backups/docmind-files-<DATA>.tar.gz
```

### Limitações conhecidas da demo

- Contas e documentos dos visitantes não expiram sozinhos (a retenção apaga conversas, análises, histórico e
  documentos excluídos). Para zerar a demo: `docker compose -f docker-compose.prod.yml down -v` e subir de novo.
- Sem `MAIL_*`, visitantes não recuperam senha por e-mail.
- O teto diário conta tokens, não requisições; os limites por minuto do nível gratuito ainda podem gerar 429
  transitórios, tratados com retentativas e mensagem ao usuário.
- Nunca publique documentos reais na demo: os arquivos de `samples/` são sintéticos por desenho.

## CI

`.github/workflows/ci.yml` executa: ruff + migrations do zero + pytest (com serviço pgvector), typecheck + lint +
vitest + build do frontend, validação dos arquivos Compose, auditoria de dependências (`pip-audit`, `pnpm audit`),
build das imagens de produção e a suíte E2E com Playwright contra a stack Docker (provedores `fake`).
