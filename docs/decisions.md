# Registro de decisões (ADR resumido)

| # | Decisão | Alternativas | Motivo |
|---|---|---|---|
| 1 | SQLAlchemy 2 **síncrono** (psycopg 3) na API e no worker | Async SQLAlchemy + asyncpg | Um único modelo de sessão compartilhado com o Celery; FastAPI executa rotas síncronas em threadpool; menos complexidade para a Fase 1. |
| 2 | Sessões no servidor + cookie HttpOnly em vez de JWT | JWT em localStorage | Revogação imediata, sem token exposto ao JS, requisito do prompt. |
| 3 | CSRF double-submit **validado contra a sessão** | Apenas SameSite | SameSite=Lax não cobre todos os navegadores/fluxos; o token na sessão impede reuso de cookie forjado. |
| 4 | `EmbeddingRecord` separado de `DocumentChunk` | Coluna `vector` no chunk | Permite múltiplos modelos/reindexação e torna explícitos modelo, dimensão e data de cada vetor. |
| 5 | `workspace_id` desnormalizado em chunks e embeddings | Apenas via JOIN | O filtro de isolamento é aplicado na própria tabela de vetores, sem depender de um JOIN correto em cada consulta. |
| 6 | Busca cosseno exata (sem HNSW) | HNSW/IVFFlat desde o início | Volume pequeno; índice ANN será avaliado com métricas na Fase 6. |
| 7 | Chunking próprio com tiktoken | LangChain/LlamaIndex splitters | Requisito de transparência; controle sobre páginas, títulos e sobreposição. |
| 8 | Citações `[n]` validadas estruturalmente + referências geradas pelo backend | Confiar no texto do modelo | Impede páginas/documentos inventados; o modelo só pode apontar para trechos do contexto. |
| 9 | Provedores `fake` determinísticos para testes | Mocks ad hoc / gravações HTTP | Testes reprodutíveis sem rede ou custo; o embedding por hash de palavras preserva similaridade lexical suficiente para testar recuperação e filtros. |
| 10 | Modelos de IA só por variáveis de ambiente | Nomes fixos no código | Modelos são descontinuados; troca sem redeploy. |
| 11 | Soft delete em documentos e conversas; hard delete de chunks/embeddings | Hard delete total | Mantém auditoria/histórico redigido e remove conteúdo dos índices ativos imediatamente. |
| 12 | Status de processamento persistidos por etapa | Percentual estimado | O usuário vê o estado real; sem timers simulando progresso. |
| 13 | Frontend em Vite 7 (não 8) | Vite 8 | `@vitejs/plugin-react` e Vitest ainda não suportavam Vite 8 de forma estável na data de criação. |
| 14 | PGlite (+pgvector) como banco **local de desenvolvimento/testes** quando o Docker não está disponível | Exigir Docker sempre | Permitiu executar migrations e a suíte de integração nesta máquina; não substitui PostgreSQL em produção (uma conexão por vez). |
| 15 | Duplicidade por SHA-256 bloqueia upload no mesmo workspace | Permitir cópias | Evita reindexar e cobrar embeddings do mesmo conteúdo; a Fase 2 trará versionamento explícito. |
| 16 | Full-Text Search com coluna `tsvector` gerada + GIN em vez de serviço externo (Elasticsearch/OpenSearch) | Elastic/OpenSearch, pg_trgm | Mesmo banco, mesmas transações e filtros de isolamento; suficiente para o volume e sem novo componente operacional. |
| 17 | Fusão RRF em vez de combinação linear de scores | Soma ponderada normalizada, reranker neural | Scores vetoriais e léxicos têm escalas incomparáveis; RRF é robusto, determinístico e explicável. Reranker fica para avaliação na Fase 6. |
| 18 | Streaming só após "context" e com `done` validado | Streamar e citar ao mesmo tempo | O prompt do projeto exige fontes garantidas antes de streaming: o cliente conhece os trechos citáveis antes do primeiro token e só mostra como definitivo o texto validado. |
| 19 | `retrieval_meta` persistido por mensagem e exposto por endpoint próprio | Recalcular sob demanda | Explicabilidade reproduzível: o que foi recuperado naquele momento, não o que seria recuperado hoje. |
| 20 | Análises sempre assíncronas (Celery) com polling, mesmo para documentos curtos | Síncrono para curtos | Um único caminho de execução, cancelamento cooperativo e limites de tempo do worker; a UI já tinha o padrão de polling dos documentos. |
| 21 | Resumo hierárquico com marcadores `[n]` globais preservados entre partes e síntese | Resumir partes sem citações e citar só na síntese | Mantém rastreabilidade até o trecho original mesmo após duas passagens pelo modelo. |
| 22 | Comparação completa só quando cabe no orçamento; senão recuperação por documento com `complete=false` | Sempre recuperar | Documentos curtos ganham comparação exaustiva real; longos não fingem exaustividade. |
| 23 | Fontes, cobertura e limitações montadas pelo backend, nunca pelo modelo | Pedir ao modelo que liste limitações | O modelo não sabe o que não recebeu; o backend sabe quantos trechos existem e quantos entraram. |
