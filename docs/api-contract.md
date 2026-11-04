# Contrato da API — DocMind AI (Fase 1)

Base: `/api/v1`. Todas as respostas são JSON, exceto download de arquivos.

## Convenções

### Autenticação e sessão
- Sessão persistida no servidor; o navegador recebe o cookie **`docmind_session`** (HttpOnly, SameSite=Lax).
- Proteção CSRF por *double submit*: o backend define o cookie **`docmind_csrf`** (legível por JS). Toda requisição
  `POST/PUT/PATCH/DELETE` deve enviar o header **`X-CSRF-Token`** com o valor desse cookie. Falta/divergência → `403 csrf_invalid`.
- `GET /auth/csrf` garante o cookie CSRF antes do primeiro login/cadastro.
- O frontend **nunca** envia `workspace_id`; o workspace ativo vem da sessão.

### Erros
Formato padronizado:
```json
{ "error": { "code": "document_not_found", "message": "Documento não encontrado.", "details": null } }
```
Códigos comuns: `validation_error` (422, `details` = lista do Pydantic), `unauthorized` (401), `forbidden` (403),
`csrf_invalid` (403), `not_found` (404), `rate_limited` (429), `payload_too_large` (413),
`unsupported_media_type` (415), `ai_unavailable` (503), `usage_limit_exceeded` (429).

### Paginação
`?page=1&page_size=20` → `{ "items": [...], "total": 0, "page": 1, "page_size": 20 }`.

## Tipos

```ts
type Role = "admin" | "editor" | "viewer";

interface WorkspaceSummary { id: string; name: string; slug: string; role: Role }

interface UserMe {
  id: string; name: string; email: string; created_at: string;
  workspace: WorkspaceSummary;
}

interface Workspace extends WorkspaceSummary {
  created_at: string;
  settings: { external_ai_enabled: boolean };
}

interface Member { user_id: string; name: string; email: string; role: Role; joined_at: string }

type DocumentStatus =
  | "uploaded" | "validating" | "extracting" | "chunking"
  | "embedding" | "indexing" | "ready" | "failed" | "cancelled";

interface DocumentOwner { id: string; name: string }

interface Document {
  id: string; name: string; original_name: string; mime_type: string; size_bytes: number;
  sha256: string; page_count: number | null; char_count: number | null; chunk_count: number;
  status: DocumentStatus; error_message: string | null;
  created_at: string; updated_at: string; processed_at: string | null;
  indexing_version: number; owner: DocumentOwner;
}

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type JobType = "extract" | "chunk" | "embed" | "index" | "reprocess" | "delete";

interface ProcessingJob {
  id: string; job_type: JobType; status: JobStatus; attempt: number;
  created_at: string; started_at: string | null; finished_at: string | null;
  error_message: string | null;
}

interface DocumentStatusResponse {
  id: string; status: DocumentStatus; error_message: string | null;
  page_count: number | null; chunk_count: number; processed_at: string | null;
  jobs: ProcessingJob[];               // mais recente primeiro
}

interface Chunk {
  id: string; document_id: string; position: number;
  page_start: number | null; page_end: number | null; section_title: string | null;
  text: string; token_count: number;
}

interface SearchResult {
  chunk_id: string; document_id: string; document_name: string;
  page_start: number | null; page_end: number | null; section_title: string | null;
  text: string; score: number;          // similaridade cosseno (0..1)
}

interface SearchResponse {
  query: string; results: SearchResult[]; latency_ms: number; embedding_model: string;
}

interface Citation {
  id: string; index: number;            // índice 1-based usado no texto como [1], [2]
  chunk_id: string; document_id: string; document_name: string;
  page_start: number | null; page_end: number | null; section_title: string | null;
  snippet: string;                      // trecho do chunk (até ~300 chars)
}

type MessageStatus = "ok" | "no_evidence" | "ai_unavailable" | "error";

interface Message {
  id: string; role: "user" | "assistant"; content: string; created_at: string;
  status: MessageStatus;
  citations: Citation[];                // vazio para mensagens do usuário
  model: string | null; prompt_tokens: number | null; completion_tokens: number | null;
  latency_ms: number | null;
  feedback: { rating: 1 | -1; comment: string | null } | null;
}

interface ConversationSummary {
  id: string; title: string; created_at: string; updated_at: string;
  message_count: number; document_ids: string[];
}

interface Conversation extends ConversationSummary { messages: Message[] }

interface AiStatus {
  configured: boolean;                  // provedor real configurado?
  embedding_provider: string; llm_provider: string;
  embedding_model: string; llm_model: string;
  external_processing: boolean;         // trechos podem ser enviados a provedor externo
  notice: string;                       // aviso de privacidade em pt-BR
}

interface Usage {
  questions_last_hour: number; uploads_last_hour: number;
  prompt_tokens_month: number; completion_tokens_month: number;
  estimated_cost_usd_month: number | null;   // null quando não há tabela de preço
  limits: { questions_per_hour: number; uploads_per_hour: number; max_upload_mb: number; max_pdf_pages: number };
}
```

## Endpoints

### Saúde e configuração
| Método | Rota | Resposta |
|---|---|---|
| GET | `/health` | `{ status: "ok"\|"degraded", services: { database: bool, redis: bool, storage: bool }, ai: AiStatus }` |
| GET | `/settings/ai` | `AiStatus` (autenticado) |

### Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/auth/csrf` | — | `{ csrf_token }` + cookie |
| POST | `/auth/register` | `{ name, email, password }` (senha ≥ 8) | `201 UserMe` + cookies |
| POST | `/auth/login` | `{ email, password }` | `200 UserMe` + cookies |
| POST | `/auth/logout` | — | `204` |
| GET | `/auth/me` | — | `UserMe` (401 se não autenticado) |

Cadastro cria automaticamente um workspace pessoal ("Workspace de <nome>") com papel `admin`.

### Workspaces
| GET | `/workspaces/current` | `Workspace` |
| GET | `/workspaces/current/members` | `{ items: Member[] }` |

### Documentos
| Método | Rota | Observações |
|---|---|---|
| POST | `/documents/upload` | multipart `file`; 202 `Document` (status `uploaded`); erros 413/415/429 |
| GET | `/documents` | query `q`, `status`, `page`, `page_size`; `Paginated<Document>` |
| GET | `/documents/{id}` | `Document` |
| GET | `/documents/{id}/status` | `DocumentStatusResponse` (fazer polling a cada 2–3 s enquanto não `ready`/`failed`) |
| GET | `/documents/{id}/download` | stream do arquivo (`Content-Disposition: inline`). Usar `fetch` com `credentials` e `URL.createObjectURL` para o PDF.js |
| GET | `/documents/{id}/chunks` | query `page` (número da página) opcional; `{ items: Chunk[] }` |
| GET | `/chunks/{chunk_id}` | `Chunk` |
| POST | `/documents/{id}/reprocess` | 202 `Document` |
| DELETE | `/documents/{id}` | 204 (remove arquivo, chunks e embeddings) |

### Pesquisa semântica (sem IA generativa)
| POST | `/search` | `{ query, document_ids?: string[], top_k?: number }` → `SearchResponse` |

### Conversas
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/conversations` | `{ title?, document_ids?: string[] }` | `201 Conversation` |
| GET | `/conversations` | — | `{ items: ConversationSummary[] }` |
| GET | `/conversations/{id}` | — | `Conversation` |
| PATCH | `/conversations/{id}` | `{ title?, document_ids? }` | `Conversation` |
| DELETE | `/conversations/{id}` | — | 204 |
| POST | `/conversations/{id}/messages` | `{ content, document_ids?: string[] }` | `{ user_message: Message, assistant_message: Message }` |
| POST | `/messages/{id}/feedback` | `{ rating: 1 \| -1, comment? }` | `Message` |

Regras de geração: a resposta do assistente cita fontes com marcadores `[n]`; cada `n` corresponde a
`citations[].index`. `status = "no_evidence"` quando não há trechos suficientes (o conteúdo traz a mensagem padrão em pt-BR).
`status = "ai_unavailable"` quando não há provedor configurado (HTTP 200 com mensagem explicativa, para que a UI mostre o aviso).

### Uso
| GET | `/usage` | `Usage` |

---

# Adições da Fase 2 — Biblioteca Documental

## Tipos novos e alterados

```ts
type LocationType = "page" | "section";   // PDF = page; DOCX/TXT = section (sem paginação real)

interface Collection {
  id: string; name: string; description: string | null; color: string | null;
  document_count: number; created_at: string; updated_at: string;
}

interface Document {
  // ...campos da Fase 1, mais:
  location_type: LocationType;           // como interpretar page_start/page_end
  tags: string[];
  collection_id: string | null;
  collection_name: string | null;
  has_text_layer: boolean;               // false quando a extração não achou texto
  warnings: string[];                    // avisos da extração (ex.: páginas sem texto)
}

interface DocumentVersion {
  id: string; version: number; status: DocumentStatus; chunk_count: number;
  page_count: number | null; chunking_version: string; embedding_model: string | null;
  created_at: string; processed_at: string | null; error_message: string | null;
}

interface Chunk {
  // ...Fase 1, mais:
  location_type: LocationType;
  location_label: string;                // "Página 4", "Páginas 3–4", "Seção 2 · CLÁUSULA 6", "Trecho 7"
}

interface Citation {
  // ...Fase 1, mais:
  location_type: LocationType;
  location_label: string;
  mime_type: string | null;              // para a UI decidir o visualizador (PDF.js ou texto)
}

interface SearchResult { /* ...Fase 1, mais: */ location_type: LocationType; location_label: string; mime_type: string }

interface ConversationSummary { /* ...Fase 1, mais: */ collection_ids: string[] }
```

`DocumentStatus` ganha `cancelled` como resultado de `POST /documents/{id}/cancel` (já existia no enum).

## Upload

- `POST /documents/upload` aceita **PDF, DOCX e TXT** (extensão + assinatura: `%PDF-`, `PK\x03\x04` com
  `word/document.xml`, texto decodificável sem bytes nulos). Campos opcionais do multipart:
  `collection_id` (uuid) e `tags` (string separada por vírgula).
- Upload múltiplo: o frontend envia um arquivo por requisição, em fila, respeitando
  `MAX_CONCURRENT_UPLOADS_PER_USER` (429 `usage_limit_exceeded` quando excedido).

## Documentos

| Método | Rota | Corpo / query | Observações |
|---|---|---|---|
| GET | `/documents` | + `collection_id`, `tag`, `mime_type` (`application/pdf` \| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` \| `text/plain`), `sort` (`created_at` \| `name` \| `size_bytes`, prefixo `-` para desc) | |
| PATCH | `/documents/{id}` | `{ name?, tags?, collection_id? }` (`collection_id: null` remove da coleção) | admin/editor |
| POST | `/documents/{id}/cancel` | — | Cancelamento cooperativo do processamento em curso; 409 se já terminou |
| GET | `/documents/{id}/versions` | — | `{ items: DocumentVersion[] }`, mais recente primeiro |
| GET | `/documents/{id}/text` | query `section` opcional | `{ document_id, location_type, sections: [{ index, label, text, chunk_ids: string[] }] }` — usado pelo visualizador de DOCX/TXT (texto extraído por seção, sem renderização do arquivo original) |
| GET | `/documents/tags` | — | `{ items: [{ tag, count }] }` do workspace |

## Coleções

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/collections` | — | `{ items: Collection[] }` |
| POST | `/collections` | `{ name, description?, color? }` | `201 Collection` (nome único por workspace → 409 `collection_exists`) |
| GET | `/collections/{id}` | — | `Collection` |
| PATCH | `/collections/{id}` | `{ name?, description?, color? }` | `Collection` |
| DELETE | `/collections/{id}` | — | 204; documentos ficam sem coleção (não são excluídos) |

Papéis: criar/editar/excluir coleções exige admin/editor.

## Escopo por coleção

- `POST /search`, `POST /conversations`, `PATCH /conversations/{id}` e `POST /conversations/{id}/messages`
  aceitam `collection_ids?: string[]` além de `document_ids`. Escopo efetivo = união dos documentos das coleções
  com os `document_ids` informados; vazio em ambos = todos os documentos prontos do workspace.

---

# Adições da Fase 3 — Busca avançada e Chat

## Tipos

```ts
type RetrievalMode = "vector" | "hybrid";

interface RetrievalSettings {
  mode: RetrievalMode;            // padrão "hybrid"
  top_k: number;                  // 1..30
  min_similarity: number;         // 0..1 (aplicado ao score vetorial)
  max_context_tokens: number;     // 1000..12000
  rrf_k: number;                  // constante da fusão RRF (padrão 60)
}

interface WorkspaceSettings {
  external_ai_enabled: boolean;
  retrieval: RetrievalSettings;
}

interface SearchResult {
  // ...Fases 1–2, mais:
  score: number;                  // score final (fundido quando hybrid; similaridade quando vector)
  vector_score: number | null;    // similaridade cosseno (null se veio só do léxico)
  lexical_score: number | null;   // ts_rank_cd normalizado (null se veio só do vetor)
  vector_rank: number | null;
  lexical_rank: number | null;
  highlight: string | null;       // trecho com <mark> do FTS quando houver
}

interface SearchResponse { /* ... */ mode: RetrievalMode; vector_candidates: number; lexical_candidates: number }

interface SearchHistoryItem { id: string; query: string; mode: RetrievalMode; result_count: number; latency_ms: number; created_at: string }

interface RetrievalEvidence {
  message_id: string;
  mode: RetrievalMode;
  params: { top_k: number; min_similarity: number; max_context_tokens: number; embedding_model: string };
  scoped_document_ids: string[];
  candidates: Array<{
    chunk_id: string; document_id: string; document_name: string; location_label: string;
    score: number; vector_score: number | null; lexical_score: number | null;
    in_context: boolean; cited: boolean; citation_index: number | null; snippet: string;
  }>;
  context_tokens: number; context_truncated: boolean; invalid_citations_removed: number[];
  latency: { retrieval_ms: number; generation_ms: number | null };
  usage: { prompt_tokens: number | null; completion_tokens: number | null; model: string | null };
}

interface FeedbackSummary { positive: number; negative: number; total_answers: number }
```

`Message.retrieval_meta` não é exposto diretamente; use `GET /messages/{id}/retrieval`.

## Endpoints

| Método | Rota | Corpo / query | Resposta |
|---|---|---|---|
| GET | `/workspaces/current/settings` | — | `WorkspaceSettings` |
| PATCH | `/workspaces/current/settings` | `{ external_ai_enabled?, retrieval?: Partial<RetrievalSettings> }` | `WorkspaceSettings` (somente admin; 403 caso contrário; 422 fora dos limites) |
| POST | `/search` | `+ mode?: RetrievalMode` (padrão = configuração do workspace) | `SearchResponse` |
| GET | `/search/history` | `limit?` (padrão 20) | `{ items: SearchHistoryItem[] }` — pesquisas do usuário no workspace |
| DELETE | `/search/history` | — | 204 (limpa o histórico do usuário) |
| GET | `/conversations` | `+ q?` (busca no título) | `{ items }` |
| GET | `/messages/{id}/retrieval` | — | `RetrievalEvidence` (somente mensagens do assistente do próprio usuário) |
| GET | `/usage` | — | `+ feedback: FeedbackSummary` |
| POST | `/conversations/{id}/messages/stream` | `SendMessageRequest` | **SSE** (`text/event-stream`), eventos abaixo |

### Streaming (SSE)

Mesma validação do endpoint síncrono. Sequência de eventos (`event:` + `data:` JSON, uma linha):

1. `user_message` → `Message` do usuário já persistida.
2. `context` → `{ sources: Array<{ index, chunk_id, document_id, document_name, location_label, location_type, mime_type, snippet }> }` —
   trechos **efetivamente enviados** ao modelo, com os índices `[n]` que o modelo pode citar. A UI pode
   mostrar “Consultando N trechos…”.
3. `delta` → `{ text }` (0..n vezes) — texto parcial **não validado**; a UI renderiza como rascunho.
4. `done` → `{ assistant_message: Message }` — mensagem final persistida, com texto após a validação de
   citações (marcadores inválidos removidos) e `citations` definitivas. **A UI deve substituir o rascunho por este conteúdo.**
5. `error` → `{ code, message }` quando a geração falha após o início (a mensagem de erro também é persistida com `status = "error"`).

Em `no_evidence` e `ai_unavailable` não há `delta`: vêm `user_message`, `context` (vazio) e `done`.
Heartbeat: linhas de comentário `: ping` a cada 15 s. Cabeçalhos: `Cache-Control: no-store`, `X-Accel-Buffering: no`.
