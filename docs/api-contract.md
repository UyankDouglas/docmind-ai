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
