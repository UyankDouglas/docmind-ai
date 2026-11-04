import { apiFetch, http } from "@/services/api";
import type {
  Chunk,
  DocumentItem,
  DocumentStatus,
  DocumentStatusResponse,
  DocumentText,
  DocumentVersion,
  Paginated,
  TagCount,
} from "@/types/api";

export type DocumentSort = "created_at" | "-created_at" | "name" | "-name" | "size_bytes" | "-size_bytes";

export interface ListDocumentsParams {
  q?: string;
  status?: DocumentStatus | "";
  collection_id?: string;
  tag?: string;
  mime_type?: string;
  sort?: DocumentSort;
  page?: number;
  page_size?: number;
}

export interface UploadOptions {
  collection_id?: string | null;
  tags?: string[];
}

export interface DocumentPatch {
  name?: string;
  tags?: string[];
  collection_id?: string | null;
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
  versions: (id: string, signal?: AbortSignal) =>
    http.get<{ items: DocumentVersion[] }>(`/documents/${id}/versions`, undefined, signal),
  text: (id: string, signal?: AbortSignal) => http.get<DocumentText>(`/documents/${id}/text`, undefined, signal),
  tags: (signal?: AbortSignal) => http.get<{ items: TagCount[] }>("/documents/tags", undefined, signal),
  upload: (file: File, options: UploadOptions = {}, signal?: AbortSignal) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (options.collection_id) form.append("collection_id", options.collection_id);
    if (options.tags?.length) form.append("tags", options.tags.join(","));
    return apiFetch("/documents/upload", { method: "POST", body: form, signal }).then(
      (r) => r.json() as Promise<DocumentItem>,
    );
  },
  patch: (id: string, input: DocumentPatch) => http.patch<DocumentItem>(`/documents/${id}`, input),
  reprocess: (id: string) => http.post<DocumentItem>(`/documents/${id}/reprocess`),
  cancel: (id: string) => http.post<DocumentItem>(`/documents/${id}/cancel`),
  remove: (id: string) => http.delete(`/documents/${id}`),
  /** Baixa o arquivo original com credenciais; retorna o ArrayBuffer para o PDF.js. */
  downloadArrayBuffer: async (id: string, signal?: AbortSignal) => {
    const res = await apiFetch(`/documents/${id}/download`, { method: "GET", signal, headers: { Accept: "*/*" } });
    return res.arrayBuffer();
  },
};
