import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collectionsApi, type CollectionInput } from "./api";

export const collectionKeys = {
  all: ["collections"] as const,
  list: ["collections", "list"] as const,
  detail: (id: string) => ["collections", "detail", id] as const,
};

export function useCollections() {
  return useQuery({
    queryKey: collectionKeys.list,
    queryFn: ({ signal }) => collectionsApi.list(signal),
    select: (d) => d.items,
    staleTime: 30_000,
  });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: collectionKeys.detail(id ?? ""),
    queryFn: ({ signal }) => collectionsApi.get(id!, signal),
    enabled: !!id,
  });
}

function useInvalidateCollections() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: collectionKeys.all });
    void qc.invalidateQueries({ queryKey: ["documents"] });
  };
}

export function useCreateCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({ mutationFn: (input: CollectionInput) => collectionsApi.create(input), onSuccess: invalidate });
}

export function useUpdateCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CollectionInput>) => collectionsApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteCollection() {
  const invalidate = useInvalidateCollections();
  return useMutation({ mutationFn: (id: string) => collectionsApi.remove(id), onSuccess: invalidate });
}
