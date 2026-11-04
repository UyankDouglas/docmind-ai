# PROGRESS — DocMind AI

> Leia este arquivo ao iniciar uma sessão de desenvolvimento. Depois inspecione o repositório e
> verifique o estado real antes de retomar.

## Fase atual

**Fase 2 — Biblioteca Documental: concluída e validada com a stack Docker completa** (04/11/2026).
Fase 1 concluída anteriormente no mesmo dia. Pendente apenas a execução com `OPENAI_API_KEY` real
(o `.env` local usa provedores `fake`).

## Funcionalidades concluídas (Fase 2)

- [x] Extratores **DOCX** (python-docx: títulos → seções, tabelas em linhas, rejeita criptografados) e **TXT**
  (encoding por BOM/UTF-8/charset_normalizer com preferência cp1252 para pt-BR, seções por título ou blocos).
- [x] Localização honesta por tipo: PDF cita **páginas**; DOCX/TXT citam **seções** (`location_type`, `location_label`
  gerados pelo backend). Chunking fecha trechos em troca de página (≥ 200 tokens) ou de seção (≥ 80 tokens).
- [x] Upload múltiplo com fila na UI (3 simultâneos, erro por arquivo), validação de assinatura por tipo no servidor,
  limite de documentos em processamento por usuário (`MAX_CONCURRENT_UPLOADS_PER_USER`).
- [x] **Coleções** (CRUD, nome único por workspace, cor, contagem; excluir mantém documentos) e escopo por coleção em
  pesquisa e chat (união com documentos explícitos).
- [x] **Tags** (normalizadas, até 20), renomear, mover para coleção, filtros por status/tipo/coleção/tag e ordenação.
- [x] **Versionamento**: `document_versions` (uma linha por indexação: status, chunks, páginas, modelo de embedding),
  painel de versões na UI; `document_pages` guarda o texto extraído por página/seção.
- [x] **Cancelamento cooperativo** (`POST /documents/{id}/cancel`) e tratamento de falhas por versão.
- [x] Visualizador de texto para DOCX/TXT (índice de seções, destaque exato do trecho com fallback sinalizado),
  citações e pesquisa usando rótulos de seção, dashboard com contagem por tipo.
- [x] Migração `95820e00bccc` com `server_default` e backfill de versões/rótulos para dados existentes.

## Testes executados (Fase 2, 04/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose (`docmind_test`) | **69 passed** (16 novos: extração DOCX/TXT, upload disfarçado, coleções + isolamento, tags/filtros/ordenação, versões + cancelamento, limite de uploads simultâneos, escopo por coleção) |
| Ruff + `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend `typecheck`, `lint`, `test`, `build` | 0 erros TS, 0 erros ESLint (12 warnings `react-refresh`), **45 passed**, build OK |
| `scripts/smoke_test.py` contra a stack Docker | OK: PDF, DOCX e TXT processados pelo worker; citações de DOCX/TXT por seção |
| Fluxo manual no navegador (stack Docker) | cadastro → criar coleção → upload múltiplo DOCX+TXT pela UI → "Pronto" → visualizador de texto por seções → pergunta → fonte "Seções 1–3 · …" abre o texto lado a lado |

## Funcionalidades concluídas (Fase 1)

- [x] Monorepositório: `apps/web`, `backend`, `docker`, `docs`, `samples`, `scripts`, CI (GitHub Actions).
- [x] Docker Compose (dev e prod) com PostgreSQL+pgvector, Redis, MinIO, API, worker, web e healthchecks.
- [x] Migrations Alembic (schema inicial com 14 tabelas, extensão `vector`).
- [x] Autenticação: cadastro, login, logout, sessões no servidor, cookies HttpOnly, CSRF, rate limiting, Argon2id.
- [x] Workspaces e papéis (admin/editor/viewer); isolamento por workspace em todas as consultas.
- [x] Upload seguro de PDF (assinatura, tamanho, páginas, duplicidade, nome interno aleatório, MinIO/local).
- [x] Pipeline: extração (pypdf) → normalização → chunking (tiktoken, por página/seção) → embeddings → pgvector.
- [x] Status reais por etapa + jobs persistidos, reprocessamento com nova versão de indexação, exclusão que limpa índice e storage.
- [x] `RetrievalService` (cosseno exato, filtros de workspace/documentos/modelo) e endpoint `/search`.
- [x] Chat: conversas, mensagens, contexto delimitado, validação de citações, referências geradas pelo backend, feedback, uso/custo (estimado só com preços configurados).
- [x] Frontend completo: login/cadastro, dashboard, biblioteca, visualizador PDF.js com destaque, chat lado a lado com citações clicáveis, pesquisa, configurações, tema claro/escuro, responsivo, acessível.
- [x] Provedores de IA por adaptador (OpenAI real / fake determinístico), modelos por variável de ambiente.
- [x] Documentação: README, `docs/architecture.md`, `rag-pipeline.md`, `security.md`, `decisions.md`, `evaluation.md`, `deploy.md`, `api-contract.md`.

## Testes executados (Fase 1, 04/11/2026)

| Suíte | Comando | Resultado |
|---|---|---|
| Backend (unit + integração, PGlite+pgvector em `127.0.0.1:5434`) | `cd backend && TEST_DATABASE_URL=... uv run pytest` | **53 passed** |
| Backend lint/format | `uv run ruff check app tests && ruff format --check` | OK |
| Migrations | `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | 0 erros TS, 0 erros ESLint (9 warnings `react-refresh`), **28 passed**, build OK |
| Fluxo manual no navegador (API local + provedores fake) | cadastro → login → upload pela UI → status "Pronto" (5 pág.) → visualizador → pergunta → resposta com `[1]` → clique na fonte abre o PDF na página com o trecho destacado | OK |
| Stack Docker Compose completa (`docker compose up --build`) | 6 serviços saudáveis; `scripts/smoke_test.py` → upload → `ready` em 1,5 s via worker separado + Redis + MinIO → resposta com citação → abstenção → download | OK |
| Pytest contra o PostgreSQL do Compose (`docmind_test`) | **53 passed** | OK |
| Fluxo via API após reprocessamento (chunking por página) | reprocess → 3 trechos (v2) → pergunta sobre cancelamento → citação em **páginas 3–4** (a página 3 tem < 200 tokens e foi agrupada à 4); pergunta fora do domínio → `no_evidence` sem citações | OK |

Não executado: Playwright E2E (planejado para a Fase 6) e suíte com provedor OpenAI real (sem chave
configurada neste ambiente; o `.env` local está com `EMBEDDING_PROVIDER=fake` e `LLM_PROVIDER=fake`).

## Falhas conhecidas / dívidas

- `minio/minio` saiu do Docker Hub/quay.io; o Compose usa `bitnamilegacy/minio` (build 2025-05 congelada). Avaliar RustFS ou S3 gerenciado para produção.
- Docker Desktop no Windows pode levar vários minutos para o daemon responder após abrir.
- No Windows, `curl http://localhost:5173` pode falhar (resolve ::1); navegadores fazem fallback para 127.0.0.1.
- `react-refresh/only-export-components` gera 9 warnings (componentes que exportam helpers); aceitável, não desabilitado.
- O provedor `fake` responde ecoando o primeiro trecho; serve para a mecânica, não para qualidade.
- Em documentos muito curtos, páginas com < 200 tokens (ou seções com < 80) são agrupadas; a citação pode cobrir
  um intervalo ("Páginas 3–4", "Seções 1–3").
- O visualizador de DOCX/TXT mostra o texto extraído, não o arquivo renderizado (formatação original não é reproduzida).
- Vite em contêiner usa polling de arquivos (`VITE_USE_POLLING`); HMR via WebSocket só funciona acessando por `localhost`.
- E-mails com domínios reservados (ex.: `.local`) são rejeitados pelo validador; a mensagem agora é traduzida.

## Decisões de arquitetura

Ver `docs/decisions.md` (ADRs 1–15). Destaques: SQLAlchemy síncrono; sessões no servidor; CSRF validado
contra a sessão; `EmbeddingRecord` separado; `workspace_id` desnormalizado em chunks/embeddings; busca
exata sem HNSW; citações validadas estruturalmente; PGlite como banco local sem Docker.

## Próximos passos

1. Rodar o fluxo com `OPENAI_API_KEY` real (`EMBEDDING_PROVIDER=openai`, `LLM_PROVIDER=openai` no `.env`,
   `docker compose up -d --force-recreate api worker`, depois `scripts/smoke_test.py`) e registrar o resultado.
2. Iniciar a **Fase 3** (Busca avançada e chat): pesquisa híbrida (pgvector + Full-Text Search sobre
   `document_pages`/`document_chunks`, fusão RRF), histórico avançado, feedback agregado, streaming de respostas
   (somente após garantir a associação das fontes), configurações de recuperação por workspace.
3. Playwright: login → upload → processamento → pergunta → citação → visualizador (`e2e/`).
