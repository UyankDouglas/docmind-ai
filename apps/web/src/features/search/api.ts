import { http } from "@/services/api";
import type { RetrievalMode, SearchHistoryItem, SearchResponse } from "@/types/api";

export interface SearchInput {
  query: string;
  document_ids?: string[];
  collection_ids?: string[];
  top_k?: number;
  /** omitido = configuração do workspace */
  mode?: RetrievalMode;
}

export const searchApi = {
  search: (input: SearchInput, signal?: AbortSignal) => http.post<SearchResponse>("/search", input, signal),
  history: (limit = 20, signal?: AbortSignal) =>
    http.get<{ items: SearchHistoryItem[] }>("/search/history", { limit }, signal),
  clearHistory: () => http.delete("/search/history"),
};
