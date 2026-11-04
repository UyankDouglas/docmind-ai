import { http } from "@/services/api";
import type { SearchResponse } from "@/types/api";

export interface SearchInput {
  query: string;
  document_ids?: string[];
  top_k?: number;
}

export const searchApi = {
  search: (input: SearchInput, signal?: AbortSignal) => http.post<SearchResponse>("/search", input, signal),
};
