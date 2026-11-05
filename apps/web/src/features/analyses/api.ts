import { apiFetch, http } from "@/services/api";
import type { Analysis, AnalysisKind, ExportFormat, Paginated, SummaryType } from "@/types/api";

export interface ListAnalysesParams {
  document_id?: string;
  kind?: AnalysisKind;
  page?: number;
  page_size?: number;
}

export interface CompareInput {
  document_ids: string[];
  question?: string;
}

export const COMPARE_MIN_DOCUMENTS = 2;
export const COMPARE_MAX_DOCUMENTS = 5;

export const analysesApi = {
  list: (params: ListAnalysesParams, signal?: AbortSignal) =>
    http.get<Paginated<Analysis>>("/analyses", { ...params }, signal),
  get: (id: string, signal?: AbortSignal) => http.get<Analysis>(`/analyses/${id}`, undefined, signal),
  summarize: (documentId: string, type: SummaryType) =>
    http.post<Analysis>(`/documents/${documentId}/summarize`, { type }),
  topics: (documentId: string) => http.post<Analysis>(`/documents/${documentId}/topics`),
  questions: (documentId: string) => http.post<Analysis>(`/documents/${documentId}/questions`),
  compare: (input: CompareInput) => http.post<Analysis>("/documents/compare", input),
  cancel: (id: string) => http.post<Analysis>(`/analyses/${id}/cancel`),
  remove: (id: string) => http.delete(`/analyses/${id}`),
  /** Resposta bruta do arquivo exportado (o chamador converte em blob). */
  exportRaw: (id: string, format: ExportFormat, signal?: AbortSignal) =>
    apiFetch(`/analyses/${id}/export`, { query: { format }, signal, headers: { Accept: "*/*" } }),
  exportConversationRaw: (conversationId: string, format: ExportFormat, signal?: AbortSignal) =>
    apiFetch(`/conversations/${conversationId}/export`, {
      query: { format },
      signal,
      headers: { Accept: "*/*" },
    }),
};
