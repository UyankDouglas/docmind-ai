import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isProcessingStatus, type DocumentItem, type DocumentStatusResponse, type Paginated } from "@/types/api";
import { documentsApi, type ListDocumentsParams } from "./api";

export const documentKeys = {
  all: ["documents"] as const,
  list: (params: ListDocumentsParams) => ["documents", "list", params] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
  status: (id: string) => ["documents", "status", id] as const,
  chunks: (id: string, page?: number) => ["documents", "chunks", id, page ?? null] as const,
  chunk: (chunkId: string) => ["chunks", chunkId] as const,
};

export const STATUS_POLL_MS = 2500;

export function useDocuments(params: ListDocumentsParams) {
  return useQuery({
    queryKey: documentKeys.list(params),
    queryFn: ({ signal }) => documentsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

/** Lista "todos" os documentos prontos (para seletores). */
export function useReadyDocuments() {
  return useQuery({
    queryKey: documentKeys.list({ status: "ready", page: 1, page_size: 200 }),
    queryFn: ({ signal }) => documentsApi.list({ status: "ready", page: 1, page_size: 200 }, signal),
    select: (d) => d.items,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: documentKeys.detail(id ?? ""),
    queryFn: ({ signal }) => documentsApi.get(id!, signal),
    enabled: !!id,
  });
}

/**
 * Polling do estado real de processamento enquanto o documento não estiver pronto/falho.
 * Quando o estado final chega, invalida as listas e o detalhe.
 */
export function useDocumentStatus(id: string, currentStatus: DocumentItem["status"], enabled = true) {
  const qc = useQueryClient();
  const shouldPoll = enabled && isProcessingStatus(currentStatus);
  return useQuery<DocumentStatusResponse>({
    queryKey: documentKeys.status(id),
    queryFn: async ({ signal }) => {
      const s = await documentsApi.status(id, signal);
      if (!isProcessingStatus(s.status)) {
        void qc.invalidateQueries({ queryKey: documentKeys.all });
      }
      return s;
    },
    enabled: shouldPoll,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && !isProcessingStatus(s) ? false : STATUS_POLL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useDocumentChunks(id: string | undefined, page?: number) {
  return useQuery({
    queryKey: documentKeys.chunks(id ?? "", page),
    queryFn: ({ signal }) => documentsApi.chunks(id!, page, signal),
    enabled: !!id,
    select: (d) => d.items,
  });
}

export function useChunk(chunkId: string | null | undefined) {
  return useQuery({
    queryKey: documentKeys.chunk(chunkId ?? ""),
    queryFn: ({ signal }) => documentsApi.chunk(chunkId!, signal),
    enabled: !!chunkId,
    staleTime: Infinity,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => documentsApi.upload(file),
    onSuccess: (doc) => {
      qc.setQueriesData<Paginated<DocumentItem>>({ queryKey: ["documents", "list"] }, (old) => {
        if (!old || old.page !== 1) return old;
        if (old.items.some((d) => d.id === doc.id)) return old;
        return { ...old, items: [doc, ...old.items], total: old.total + 1 };
      });
      void qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useReprocessDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.reprocess(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
}
