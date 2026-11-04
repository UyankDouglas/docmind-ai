# PROGRESS — DocMind AI

> Leia este arquivo ao iniciar uma sessão de desenvolvimento. Depois inspecione o repositório e
> verifique o estado real antes de retomar.

## Fase atual

**Fase 1 — Fundação e RAG funcional: implementada e validada localmente** (04/11/2026).
Pendência de validação: subir a stack completa com Docker Compose (Redis, MinIO, worker Celery em
processo separado) — o Docker Desktop não inicia na máquina de desenvolvimento (sem WSL). A
validação foi feita com PGlite+pgvector, armazenamento em disco e Celery em modo eager.

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

## Testes executados (04/11/2026)

| Suíte | Comando | Resultado |
|---|---|---|
| Backend (unit + integração, PGlite+pgvector em `127.0.0.1:5434`) | `cd backend && TEST_DATABASE_URL=... uv run pytest` | **53 passed** |
| Backend lint/format | `uv run ruff check app tests && ruff format --check` | OK |
| Migrations | `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | 0 erros TS, 0 erros ESLint (9 warnings `react-refresh`), **28 passed**, build OK |
| Fluxo manual no navegador (API local + provedores fake) | cadastro → login → upload pela UI → status "Pronto" (5 pág.) → visualizador → pergunta → resposta com `[1]` → clique na fonte abre o PDF na página com o trecho destacado | OK |
| Fluxo via API após reprocessamento (chunking por página) | reprocess → 3 trechos (v2) → pergunta sobre cancelamento → citação em **páginas 3–4** (a página 3 tem < 200 tokens e foi agrupada à 4); pergunta fora do domínio → `no_evidence` sem citações | OK |

Não executado: Playwright E2E (planejado para a Fase 6), suíte com provedor OpenAI real (sem chave
configurada neste ambiente), stack Docker completa.

## Falhas conhecidas / dívidas

- `taskkill` global bloqueado no ambiente; scripts devem matar processos por PID.
- `react-refresh/only-export-components` gera 9 warnings (componentes que exportam helpers); aceitável, não desabilitado.
- O provedor `fake` responde ecoando o primeiro trecho; serve para a mecânica, não para qualidade.
- Em documentos muito curtos, páginas com < 200 tokens são agrupadas (citação pode cobrir 2 páginas).
- E-mails com domínios reservados (ex.: `.local`) são rejeitados pelo validador; a mensagem agora é traduzida.

## Decisões de arquitetura

Ver `docs/decisions.md` (ADRs 1–15). Destaques: SQLAlchemy síncrono; sessões no servidor; CSRF validado
contra a sessão; `EmbeddingRecord` separado; `workspace_id` desnormalizado em chunks/embeddings; busca
exata sem HNSW; citações validadas estruturalmente; PGlite como banco local sem Docker.

## Próximos passos

1. Validar `docker compose up --build` em uma máquina com Docker funcional (ou após instalar WSL):
   fluxo completo com worker separado, Redis e MinIO.
2. Rodar o fluxo com `OPENAI_API_KEY` real e registrar o resultado (pergunta → resposta → página).
3. Iniciar a **Fase 2**: DOCX/TXT (`rag/extraction/docx.py`, `txt.py`), coleções e tags, upload múltiplo
   com fila visível, filtros, versionamento explícito (`DocumentVersion`), exclusão controlada e
   tratamento de falhas parciais.
4. Playwright: login → upload → processamento → pergunta → citação → visualizador (`e2e/`).
