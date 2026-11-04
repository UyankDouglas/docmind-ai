// Tipos espelhando docs/api-contract.md (Fase 1 + adições da Fase 2)

export type Role = "admin" | "editor" | "viewer";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface UserMe {
  id: string;
  name: string;
  email: string;
  created_at: string;
  workspace: WorkspaceSummary;
}

export interface Workspace extends WorkspaceSummary {
  created_at: string;
  settings: { external_ai_enabled: boolean };
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: string;
}

export type DocumentStatus =
  | "uploaded"
  | "validating"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed"
  | "cancelled";

export const PROCESSING_STATUSES: readonly DocumentStatus[] = [
  "uploaded",
  "validating",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
];

export function isProcessingStatus(status: DocumentStatus): boolean {
  return PROCESSING_STATUSES.includes(status);
}

/** PDF = page; DOCX/TXT = section (sem paginação real) */
export type LocationType = "page" | "section";

export const MIME_PDF = "application/pdf";
export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_TXT = "text/plain";
export type SupportedMime = typeof MIME_PDF | typeof MIME_DOCX | typeof MIME_TXT;

export interface DocumentOwner {
  id: string;
  name: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  page_count: number | null;
  char_count: number | null;
  chunk_count: number;
  status: DocumentStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  indexing_version: number;
  owner: DocumentOwner;
  // Fase 2
  location_type: LocationType;
  tags: string[];
  collection_id: string | null;
  collection_name: string | null;
  has_text_layer: boolean;
  warnings: string[];
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  version: number;
  status: DocumentStatus;
  chunk_count: number;
  page_count: number | null;
  chunking_version: string;
  embedding_model: string | null;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface TextSection {
  index: number;
  label: string;
  text: string;
  chunk_ids: string[];
}

export interface DocumentText {
  document_id: string;
  location_type: LocationType;
  sections: TextSection[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "extract" | "chunk" | "embed" | "index" | "reprocess" | "delete";

export interface ProcessingJob {
  id: string;
  job_type: JobType;
  status: JobStatus;
  attempt: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export interface DocumentStatusResponse {
  id: string;
  status: DocumentStatus;
  error_message: string | null;
  page_count: number | null;
  chunk_count: number;
  processed_at: string | null;
  jobs: ProcessingJob[];
}

export interface Chunk {
  id: string;
  document_id: string;
  position: number;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  text: string;
  token_count: number;
  location_type: LocationType;
  location_label: string;
}

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  document_name: string;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  text: string;
  score: number;
  location_type: LocationType;
  location_label: string;
  mime_type: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  latency_ms: number;
  embedding_model: string;
}

export interface Citation {
  id: string;
  index: number;
  chunk_id: string | null;
  document_id: string | null;
  document_name: string;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  snippet: string;
  location_type: LocationType;
  location_label: string;
  mime_type: string | null;
}

export type MessageStatus = "ok" | "no_evidence" | "ai_unavailable" | "error";

export interface Feedback {
  rating: 1 | -1;
  comment: string | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status: MessageStatus;
  citations: Citation[];
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  feedback: Feedback | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  document_ids: string[];
  collection_ids: string[];
}

export interface Conversation extends ConversationSummary {
  messages: Message[];
}

export interface AiStatus {
  configured: boolean;
  embedding_provider: string;
  llm_provider: string;
  embedding_model: string;
  llm_model: string;
  external_processing: boolean;
  notice: string;
}

export interface Usage {
  questions_last_hour: number;
  uploads_last_hour: number;
  prompt_tokens_month: number;
  completion_tokens_month: number;
  estimated_cost_usd_month: number | null;
  limits: {
    questions_per_hour: number;
    uploads_per_hour: number;
    max_upload_mb: number;
    max_pdf_pages: number;
  };
}

export interface Health {
  status: "ok" | "degraded";
  services: { database: boolean; redis: boolean; storage: boolean };
  ai: AiStatus;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface SendMessageResponse {
  user_message: Message;
  assistant_message: Message;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
