import { apiFetch, http } from "@/services/api";
import type { Chunk, DocumentItem, DocumentStatus, DocumentStatusResponse, Paginated } from "@/types/api";

export interface ListDocumentsParams {
  q?: string;
  status?: DocumentStatus | "";
  page?: number;
  page_size?: number;
}

export const documentsApi = {
  list: (params: ListDocumentsParams, signal?: AbortSignal) =>
    http.get<Paginated<DocumentItem>>("/documents", { ...params }, signal),
  get: (id: string, signal?: AbortSignal) => http.get<DocumentItem>(`/documents/${id}`, undefined, signal),
  status: (id: string, signal?: AbortSignal) =>
    http.get<DocumentStatusResponse>(`/documents/${id}/status`, undefined, signal),
  chunks: (id: string, page?: number, signal?: AbortSignal) =>
    http.get<{ items: Chunk[] }>(`/documents/${id}/chunks`, { page }, signal),
  chunk: (chunkId: string, signal?: AbortSignal) => http.get<Chunk>(`/chunks/${chunkId}`, undefined, signal),
  upload: (file: File, signal?: AbortSignal) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return apiFetch("/documents/upload", { method: "POST", body: form, signal }).then(
      (r) => r.json() as Promise<DocumentItem>,
    );
  },
  reprocess: (id: string) => http.post<DocumentItem>(`/documents/${id}/reprocess`),
  remove: (id: string) => http.delete(`/documents/${id}`),
  /** Baixa o arquivo original com credenciais; retorna o ArrayBuffer para o PDF.js. */
  downloadArrayBuffer: async (id: string, signal?: AbortSignal) => {
    const res = await apiFetch(`/documents/${id}/download`, { method: "GET", signal, headers: { Accept: "*/*" } });
    return res.arrayBuffer();
  },
};
