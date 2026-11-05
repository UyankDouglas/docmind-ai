# PROGRESS — DocMind AI

> Leia este arquivo ao iniciar uma sessão de desenvolvimento. Depois inspecione o repositório e
> verifique o estado real antes de retomar.

## Fase atual

**Migração para Google Gemini: implementada, testada e validada com a API real** (05/11/2026), sobre as seis
fases concluídas. O provedor padrão passou a ser a Gemini API (`gemini-embedding-001` em 1536 dimensões +
`gemini-3.5-flash-lite`, SDK oficial `google-genai`), com OpenAI e `fake` preservados. Com a chave do autor no
`.env` local: `scripts/check_gemini.py --compose` aprovado, 69 documentos reindexados com backup, smoke test
completo e fluxo na interface (pergunta → citação → visualizador) confirmados; a avaliação RAG com juiz LLM está
registrada em `docs/evaluation/` (ver tabela abaixo). Pendente: hospedar a demo pública.

## Migração OpenAI → Google Gemini (05/11/2026)

- [x] **Dependência**: `google-genai` 2.34 (`uv add "google-genai>=1.0,<3"`, lockfile atualizado); biblioteca legada não usada.
- [x] **Configuração** (`core/config.py`): provedores `gemini|openai|fake`, `GEMINI_API_KEY` só no backend, modelos
  padrão por provedor (`EMBEDDING_MODEL`/`LLM_MODEL` vazios assumem os do provedor), `GEMINI_THINKING_LEVEL`,
  `GEMINI_APPLY_TEMPERATURE`, `PROVIDER_RETRY_*`. `ai_configured` exige chave de **cada** provedor selecionado;
  `missing_configuration` nomeia a variável ausente; mensagens de status não citam mais só a OpenAI.
- [x] **`GeminiEmbeddingProvider`** (`providers/gemini.py`): `embed_content` com `task_type` `RETRIEVAL_DOCUMENT`
  (chunks) / `RETRIEVAL_QUERY` (perguntas), `output_dimensionality=1536`, normalização L2 dos vetores truncados,
  validação de dimensão, lotes ≤ 100, latência/modelo/uso; tokens marcados `estimated_local` quando a API não os informa.
- [x] **`GeminiLLMProvider`**: `generate()` e `stream()` reais (`generate_content` / `generate_content_stream`),
  `system` → `system_instruction`, `user`/`assistant` → `user`/`model` (documentos continuam na mensagem do usuário),
  `max_output_tokens`, temperatura opcional, `thinking_level` opcional, uso (`prompt`, `candidates + thoughts`),
  `finish_reason`, bloqueios de segurança e respostas vazias tratados; `LLMResult` final no stream.
- [x] **Erros e limites** (`providers/errors.py`): `ProviderError` (503, código próprio, mensagem pt-BR segura) para
  429 `RESOURCE_EXHAUSTED`, credencial inválida (400 "API key"/401/403), modelo indisponível (404), timeout, rede,
  5xx, resposta vazia, bloqueio; backoff exponencial com jitter limitado por `LLM_MAX_RETRIES` (SDK sem retentativas
  internas, para uma política única). Chat grava `status=error` com a mensagem ("limite do provedor atingido… tente
  mais tarde"), SSE emite `error` + `done`, busca devolve 503; worker reagenda transitórios e marca `failed` com a
  causa para credencial/modelo; nunca migra para modelo pago.
- [x] **Compatibilidade pgvector**: coluna `vector(1536)` e migrations intactas (`alembic check` sem drift); busca
  vetorial filtra por modelo+dimensão do provedor ativo; `stale_documents` em `RetrievalResult`/`retrieval_meta`/
  evidências e `ai.stale_embedding_documents` nas configurações do workspace (aviso no painel de provedores).
- [x] **Reindexação segura** (`rag/embeddings/reindex.py`, `python -m app.rag.embeddings.reindex`): `--dry-run`,
  backup em `embedding_records_backup` + `--restore`, substituição **no lugar** respeitando `chunk_id` único
  (`EmbeddingIndexer` agora atualiza registros de outro modelo), documento `embedding` → `ready` só com todos os
  chunks cobertos, `failed` com causa em falha (vetores antigos preservados por rollback), parada em quota/credencial,
  `--include-failed`, `DocumentVersion.embedding_model` e `ProcessingJob` atualizados. Nunca roda na inicialização.
- [x] **Worker/Compose**: `api` e `worker` já recebem `.env` por `env_file` (`GEMINI_API_KEY` incluída quando definida);
  chave fora do Dockerfile, do frontend e do git; `scripts/check_gemini.py --compose` confere a presença sem imprimir.
- [x] **UI (mínima)**: `AiStatus` com `provider_label`/`*_model_label`/`missing_configuration` ("Google Gemini",
  "Gemini 3.5 Flash-Lite", "Gemini Embedding 001"), aviso de uso de dados no nível gratuito do Gemini no texto de
  privacidade, aviso de documentos pendentes de reindexação em Administração → Provedores, "Tokens no mês (parte
  estimada)" quando aplicável.
- [x] **Docs**: `.env.example`, README, `backend/README.md`, `docs/architecture.md`, `docs/rag-pipeline.md`,
  `docs/deploy.md` (chave, nível gratuito, limites, reindexação), `docs/decisions.md` (ADR 24–30), `docs/evaluation.md`
  (rodada real pendente; resultados antigos preservados), `docs/api-contract.md`.

### Testes executados (migração Gemini, 05/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose | **145 passed** (33 unitários novos em `test_unit_gemini.py`: task types, dimensão, normalização, lotes, tokens oficial/estimado, conversão de papéis, geração, streaming, 429/credencial/404/timeout/rede, vazio/bloqueio, backoff, `ai_configured`, fábricas, rótulos; 6 de integração em `test_reindex_and_provider_errors.py`: exclusão de embeddings de outro modelo, reindexação no lugar com backup/restauração, falha sem deixar `ready` + parada por quota, quota no chat (sync e SSE), falha de embeddings no chat/busca, pipeline com credencial inválida e quota) |
| Ruff + `alembic check` | OK, sem drift |
| Frontend `typecheck`, `lint`, `test` | 0 erros TS, 0 erros ESLint, **102 passed** |
| `scripts/check_gemini.py --compose` (chave real) | **OK**: chave válida (60 modelos visíveis), `gemini-3.5-flash-lite` e `gemini-embedding-001` disponíveis, embedding de pergunta e de documentos com 1536 dimensões e norma 1.0 (`RETRIEVAL_QUERY`/`RETRIEVAL_DOCUMENT`), geração respondeu com `model_version=gemini-3.5-flash-lite` (21 tokens de entrada, 4 de saída, 0,9 s), streaming em 2 fragmentos, `GEMINI_API_KEY` presente em `api` e `worker` |
| Reindexação (`python -m app.rag.embeddings.reindex --yes`) | **OK**: 69 documentos (158 chunks) indexados com `fake-hash-v1` substituídos no lugar por `gemini-embedding-001`, backup `20261105T141817Z-9d7224`, 0 falhas, ~40 s, sem 429 |
| `scripts/smoke_test.py` com Gemini | **OK**: upload → `ready` em 3 s (5 páginas, 3 trechos) → resposta `ok` com `[1]` para o contrato (p. 3–4, "45 (quarenta e cinco) dias") → pergunta sem resposta → `no_evidence` sem citações → DOCX e TXT respondidos com fontes → download |
| Interface (stack Docker, navegador) | **OK**: Administração → Provedores mostra "Google Gemini", "Gemini 3.5 Flash-Lite", "Gemini Embedding 001" e o aviso de uso de dados no nível gratuito; chat respondeu em 2,6 s com citação [1] e o clique na fonte abriu o PDF na página citada |
| Avaliação RAG com Gemini (`python -m app.rag.evaluation --judge llm`, nível gratuito) | **43 perguntas, 0 erros**: Recall@K 1.0, MRR 0.90, 1º lugar 83%, citações válidas 100%, citações relevantes 97%, sustentação (juiz = o próprio modelo) 81%, abstenção quando não há resposta 100%, abstenção indevida 0%, 0 maliciosas obedecidas, latência p50/p95 1,7 s / 22,7 s (5 retentativas transitórias), 80,6 mil tokens de entrada. Precision@K 0.15 é artefato do corpus de 11 chunks. A primeira rodada expôs um erro de medição da abstenção (corrigido em `ef7517f0`); baseline `fake` em `docs/evaluation/2026-11-05-fake-provider.*`, run1 em `2026-11-05-gemini-run1.*`. Leitura em `docs/evaluation.md`. |

### Limitações conhecidas da migração

- A Gemini API não devolve tokens por texto nos embeddings: o uso de embeddings é estimado localmente (tiktoken, não o
  tokenizador do Gemini) e sinalizado como estimativa; a geração usa a contagem oficial do provedor.
- Limites do nível gratuito são por projeto e mudam; o sistema trata 429 com backoff e mensagem honesta, mas não
  conhece a quota restante.
- `gemini-3.5-flash-lite` raciocina por padrão (nível mínimo); `GEMINI_THINKING_LEVEL` permite ajustar custo/latência.

## Funcionalidades concluídas (Fase 6)

- [x] **Avaliação RAG reproduzível** (`backend/app/rag/evaluation/`): dataset de 43 perguntas anotadas sobre 5 documentos
  sintéticos (novo aditivo contraditório), runner que indexa pelo pipeline real e responde pelo serviço do chat, métricas
  (Recall@K, Precision@K, MRR, citações válidas/relevantes, sustentação por juiz `keyword-proxy` ou LLM, abstenção,
  obediência maliciosa, latência, tokens, custo, benchmark), relatório JSON+Markdown com versão/commit/hash do dataset.
  Resultado atual (fake): Recall@K 1.0, Precision@K 0.41, MRR 0.84, citações válidas 100%, 0 maliciosas obedecidas,
  abstenção indevida 0%, abstenção quando não há resposta 33% (limite do provedor fake). Leitura em `docs/evaluation.md`.
- [x] **Melhoria de recuperação achada pela avaliação**: FTS com AND e fallback OR (recall 0.57 → 1.0 no dataset).
- [x] **Testes adversariais** no dataset (m01/m02) e nos testes de API; **benchmark** de recuperação/indexação no relatório.
- [x] **E2E Playwright** (`e2e/`): 8 testes (auth, fluxo RAG completo até o PDF e o histórico, biblioteca com DOCX/TXT e
  coleções, pesquisa híbrida + admin + convite, sem evidência) e spec de screenshots; duas rodadas verdes.
- [x] **Revisão de segurança** (`docs/security-review.md`) com correções: CSP/Permissions-Policy no Caddy, recusa de
  `SECRET_KEY` padrão em produção, e-mail mascarado no convite público, auditoria de dependências no CI.
- [x] **CI/CD ampliado**: lint+testes, typecheck+lint+vitest+build, Compose config, `pip-audit`/`pnpm audit`, build das
  imagens de produção (buildx com cache), E2E contra a stack Docker.
- [x] **Docker de produção** revisado (usuário não root, Caddy com headers, beat embutido, sem portas internas expostas).
- [x] **Screenshots** reais em `docs/screenshots/` e galeria no README; `scripts/seed_demo.py` e guia de demo pública.

## Testes executados (Fase 6, 05/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose | **106 passed** (4 novos: dataset válido, métricas, juiz, runner em subconjunto com relatório) |
| Avaliação completa (`python -m app.rag.evaluation`, fake) | 43 perguntas, 0 erros — `docs/evaluation/latest.md` |
| Frontend `typecheck`, `lint`, `test`, `build` | inalterados: 0 erros, **102 passed**, build OK |
| E2E Playwright contra a stack Docker | **8 passed** em duas rodadas; screenshots geradas (10 PNG 1440×900) |
| CI | ver execução no GitHub após o push desta fase (inclui os jobs novos) |

## Funcionalidades concluídas (Fase 5)

- [x] **Membros e convites**: convite por e-mail/link (token com hash, expiração, aceite restrito ao e-mail convidado),
  alteração de papel com proteção do último administrador, remoção com revogação imediata das sessões no workspace.
- [x] **Múltiplos workspaces por usuário**: `GET /workspaces`, `POST /workspaces/switch` (troca na sessão do servidor),
  switcher na topbar, renomear workspace (admin).
- [x] **Conta**: recuperação de senha (token de uso único, 202 neutro, revoga sessões), alteração de senha (revoga as
  outras sessões), listagem e revogação de sessões ativas; e-mail por SMTP ou registrado no log (dev).
- [x] **Permissões**: matriz admin/editor/viewer aplicada no backend (documentada em `docs/api-contract.md`).
- [x] **Limites e custos por workspace**: orçamento mensal de tokens, teto de custo (quando há preços), máximo de
  documentos e armazenamento — recusados com 429 **antes** de persistir; `/usage` expõe `blocked` e a UI mostra banner.
- [x] **Administração**: `/admin/usage` (por usuário e por dia), `/audit` com filtros e exportação CSV/JSON, área `/admin`.
- [x] **Retenção**: política por workspace (conversas, análises, histórico de pesquisas, purga de documentos excluídos
  do banco e do MinIO), aplicada diariamente pelo Celery beat (worker com `-B`) e sob demanda; auditada.
- [x] **Provedores**: modelo LLM por workspace a partir de `LLM_ALLOWED_MODELS`; toggle de IA externa; chaves só no servidor.
- [x] **OCR opcional**: avaliação técnica em `docs/ocr-evaluation.md`; adaptador Tesseract (`uv sync --extra ocr`),
  desligado por padrão, ativável por workspace só quando disponível; texto de OCR marcado com aviso.
- [x] Migração `55240cc801dd`.

## Testes executados (Fase 5, 05/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose | **102 passed** (6 novos, abrangentes: convite → aceite → troca de workspace → papéis → remoção com revogação; reset/alteração de senha e sessões; limites de tokens/documentos bloqueando chat, busca, análises e upload; uso administrativo e auditoria com exportação e 403 para não-admin; retenção purgando conversas, pesquisas e documentos excluídos; modelo por workspace e OCR com provedor fake) |
| Ruff + `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend `typecheck`, `lint`, `test`, `build` | 0 erros TS, 0 erros ESLint (35 warnings `react-refresh`), **102 passed**, build OK |
| Fluxo manual no navegador (stack Docker) | `/admin`: membros, uso (totais, por dia, por usuário), auditoria com 8 registros reais e filtros, provedores (modelo permitido, IA externa, OCR indisponível), convite criado com link de aceite; worker com beat registrando `maintenance.apply_retention` |

## Funcionalidades concluídas (Fase 4)

- [x] **Análises assíncronas** (`analyses` + tarefa Celery `analysis.run`): criação → `queued` → worker → `succeeded`/`failed`/`cancelled`,
  polling na UI sem percentuais, cancelamento cooperativo, teto de tokens de entrada por análise (`analysis_too_large`).
- [x] **Resumos** em 6 tipos (geral, executivo, principais tópicos, obrigações e prazos, FAQ, pontos de atenção); **estratégia
  hierárquica** quando o documento excede o orçamento de contexto (partes → síntese) preservando os marcadores `[n]` globais;
  nunca resume só o começo.
- [x] **Comparação entre 2–5 documentos** (rótulos A–E) com pergunta orientadora: completa quando cabe no orçamento; caso
  contrário, recuperação dos trechos mais relevantes por documento com `complete=false` e limitação explícita.
- [x] **Tópicos** (cards com fontes) e **perguntas sugeridas** (reutilizadas por versão do documento; clique abre o chat).
- [x] **Fontes, cobertura e limitações geradas pelo backend** em toda análise (estratégia, trechos lidos/total, tokens,
  marcadores inválidos removidos, aviso de provedor de testes); citações validadas estruturalmente.
- [x] **Exportação** de análises e conversas em Markdown/JSON, sempre com a lista de fontes e as limitações.
- [x] UI: aba "Análises" no documento, página `/compare`, card de análises recentes, botão "Exportar conversa".
- [x] Migração `b98a59388bb2`.

## Testes executados (Fase 4, 05/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose | **96 passed** (13 novos: parsers; resumo em passagem única com fontes válidas e marcador inválido removido; resumo hierárquico com partes cobrindo todos os trechos sem repetição; documento não pronto / tipo inválido / análise grande demais; comparação completa e por recuperação; validação de quantidade e isolamento; tópicos + reutilização de perguntas + listagem; cancelar, exportar md/json e excluir; exportação de conversa; falha honesta sem provedor; prompt injection em resumo) |
| Ruff + `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend `typecheck`, `lint`, `test`, `build` | 0 erros TS, 0 erros ESLint (23 warnings `react-refresh`), **83 passed**, build OK |
| Fluxo manual no navegador (stack Docker) | aba Análises → "Gerar resumo" → worker processa (`analysis.run`) → resultado com `[1]`, fontes por seção, cobertura "2 de 2 trechos" e limitações; `/compare` com DOCX (A) × TXT (B) → comparação completa com fontes agrupadas |

Correções durante a validação: o seletor de documentos prontos pedia `page_size=200` (máximo da API é 100) e a lista vinha
vazia; plural de "útil" no resumo de feedback.

## Funcionalidades concluídas (Fase 3)

- [x] **Busca híbrida**: coluna `tsvector` gerada (português) + índice GIN em `document_chunks`; candidatos léxicos
  com `websearch_to_tsquery`/`ts_rank_cd`/`ts_headline`; fusão **Reciprocal Rank Fusion** com `vector_score`,
  `lexical_score`, posições e `highlight` por resultado. Modo `vector` ou `hybrid` (padrão).
- [x] **Configurações de recuperação por workspace** (`GET/PATCH /workspaces/current/settings`, só admin, limites
  validados): modo, `top_k`, limiar, tokens de contexto, `rrf_k`, e toggle de IA externa. Aplicadas em pesquisa e chat.
- [x] **Streaming SSE** (`POST /conversations/{id}/messages/stream`): `user_message` → `context` (trechos citáveis)
  → `delta` (rascunho) → `done` (mensagem persistida **após** validação de citações). UI com botão Parar e fallback
  síncrono. Pipeline de pergunta refatorado como gerador de eventos compartilhado pelos dois endpoints.
- [x] **Evidências por resposta** (`GET /messages/{id}/retrieval` + painel "Como esta resposta foi gerada"):
  candidatos com scores, quais entraram no contexto e quais foram citados, tokens, latências e uso.
- [x] **Histórico avançado**: busca de conversas por título, agrupamento por data, renomear/excluir; histórico de
  pesquisas por usuário (`GET/DELETE /search/history`); resumo de feedback em `/usage`.
- [x] Pesquisa com seletor de modo, detalhe dos scores, destaque `<mark>` sanitizado e contadores de candidatos.
- [x] Migração `e788f9f8bb8f`; provedores com `stream()` (OpenAI `stream=True` com uso; fake por palavras).

## Testes executados (Fase 3, 04/11/2026)

| Suíte | Resultado |
|---|---|
| Pytest contra PostgreSQL+pgvector do Compose | **83 passed** (14 novos: RRF e validação de configurações; busca híbrida com sinais léxico+vetorial, termos exatos e escopo; histórico por usuário; configurações admin/não-admin e aplicação na busca; toggle de IA externa; SSE com `context` → `delta` → `done` validado, sem evidência, CSRF; evidências; busca de conversas e feedback) |
| Ruff + `alembic upgrade head` + `alembic check` | OK, sem drift |
| Frontend `typecheck`, `lint`, `test`, `build` | 0 erros TS, 0 erros ESLint (20 warnings `react-refresh`), **69 passed**, build OK |
| `scripts/smoke_test.py` contra a stack Docker | OK |
| Fluxo manual no navegador (stack Docker) | pesquisa híbrida "VPN corporativa" com scores vetorial/léxico, destaque e histórico → pergunta no chat via SSE (API registrou `/messages/stream`) → resposta com fonte "Seções 3–4" → painel de evidências com candidato citado [1], parâmetros, latência e uso |

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
- Sem reranker neural: a relevância híbrida depende do RRF; parâmetros só devem mudar com a avaliação da Fase 6.
- O streaming do provedor OpenAI (`create(stream=True)`) ainda não foi exercitado com chave real.
- Com o provedor `fake`, resumos/comparações apenas ecoam o primeiro trecho; a qualidade real depende de um LLM.
- Sem exportação em PDF/DOCX (apenas Markdown e JSON); perguntas sugeridas usam amostra de trechos em documentos longos.
- Sem 2FA; sem SMTP configurado os links de convite/recuperação só aparecem no log do servidor (o admin pode copiar o link do convite na UI).
- OCR só funciona com Tesseract instalado no servidor (a imagem Docker padrão não o inclui); PDFs digitalizados com imagens não extraíveis pelo pypdf continuam sem texto.
- Teto de custo mensal só é efetivo quando `PRICE_*_PER_1M` estão configurados; sem preços o sistema não estima custo.
- A avaliação com provedor `fake` não mede qualidade semântica; o juiz `keyword-proxy` é lexical. Rodar com `--judge llm` e chave real.
- A suíte E2E cadastra um usuário por teste; o limite de 10 cadastros/min por IP exige `RATE_LIMIT_LOGIN_PER_MINUTE` maior para rodadas repetidas (o CI já ajusta).
- O job E2E do CI sobe a stack inteira com `docker compose up --build` (alguns minutos por execução).
- E-mails com domínios reservados (ex.: `.local`) são rejeitados pelo validador; a mensagem agora é traduzida.

## Decisões de arquitetura

Ver `docs/decisions.md` (ADRs 1–15). Destaques: SQLAlchemy síncrono; sessões no servidor; CSRF validado
contra a sessão; `EmbeddingRecord` separado; `workspace_id` desnormalizado em chunks/embeddings; busca
exata sem HNSW; citações validadas estruturalmente; PGlite como banco local sem Docker.

## Próximos passos

1. Hospedar a demo pública (TLS + `APP_BASE_URL` + `scripts/seed_demo.py`, com `GEMINI_API_KEY` só no host) e
   registrar o link no README.
2. Com a avaliação real como baseline, comparar alvos de chunk/`top_k`/limiar e avaliar `GEMINI_THINKING_LEVEL`
   (custo/latência × sustentação), repetindo `python -m app.rag.evaluation --judge llm`.
4. Evoluções fora do plano original: 2FA, reranker neural, rasterização para OCR, exportação PDF/DOCX.
5. Playwright: login → upload → processamento → pergunta → citação → visualizador (`e2e/`).
