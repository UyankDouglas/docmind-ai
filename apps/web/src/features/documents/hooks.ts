import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isProcessingStatus, type DocumentItem, type DocumentStatusResponse, type Paginated } from "@/types/api";
import { documentsApi, type DocumentPatch, type ListDocumentsParams, type UploadOptions } from "./api";

export const documentKeys = {
  all: ["documents"] as const,
  list: (params: ListDocumentsParams) => ["documents", "list", params] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
  status: (id: string) => ["documents", "status", id] as const,
  chunks: (id: string, page?: number) => ["documents", "chunks", id, page ?? null] as const,
  chunk: (chunkId: string) => ["chunks", chunkId] as const,
  versions: (id: string) => ["documents", "versions", id] as const,
  text: (id: string) => ["documents", "text", id] as const,
  tags: ["documents", "tags"] as const,
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

export function useDocumentVersions(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: documentKeys.versions(id ?? ""),
    queryFn: ({ signal }) => documentsApi.versions(id!, signal),
    enabled: !!id && enabled,
    select: (d) => d.items,
  });
}

export function useDocumentText(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: documentKeys.text(id ?? ""),
    queryFn: ({ signal }) => documentsApi.text(id!, signal),
    enabled: !!id && enabled,
    staleTime: 60_000,
  });
}

export function useDocumentTags() {
  return useQuery({
    queryKey: documentKeys.tags,
    queryFn: ({ signal }) => documentsApi.tags(signal),
    select: (d) => d.items,
    staleTime: 30_000,
  });
}

function useInvalidateDocuments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: documentKeys.all });
    void qc.invalidateQueries({ queryKey: ["collections"] });
  };
}

export function useUploadDocument() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: ({ file, options }: { file: File; options?: UploadOptions }) => documentsApi.upload(file, options),
    onSuccess: (doc) => {
      qc.setQueriesData<Paginated<DocumentItem>>({ queryKey: ["documents", "list"] }, (old) => {
        if (!old || old.page !== 1) return old;
        if (old.items.some((d) => d.id === doc.id)) return old;
        return { ...old, items: [doc, ...old.items], total: old.total + 1 };
      });
      invalidate();
    },
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & DocumentPatch) => documentsApi.patch(id, input),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(doc.id), doc);
      invalidate();
    },
  });
}

export function useReprocessDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: (id: string) => documentsApi.reprocess(id), onSuccess: invalidate });
}

export function useCancelDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: (id: string) => documentsApi.cancel(id), onSuccess: invalidate });
}

export function useDeleteDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: (id: string) => documentsApi.remove(id), onSuccess: invalidate });
}
