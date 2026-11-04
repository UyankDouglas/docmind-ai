import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { searchApi, type SearchInput } from "./api";

export const searchKeys = {
  history: ["search", "history"] as const,
};

export function useSemanticSearch(input: SearchInput | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["search", "results", input],
    queryFn: async ({ signal }) => {
      const res = await searchApi.search(input!, signal);
      // cada pesquisa entra no histórico do usuário no backend
      void qc.invalidateQueries({ queryKey: searchKeys.history });
      return res;
    },
    enabled: !!input && input.query.trim().length > 0,
    staleTime: 60_000,
  });
}

export function useSearchHistory(limit = 20) {
  return useQuery({
    queryKey: [...searchKeys.history, limit],
    queryFn: ({ signal }) => searchApi.history(limit, signal),
    select: (d) => d.items,
    staleTime: 30_000,
  });
}

export function useClearSearchHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => searchApi.clearHistory(),
    onSuccess: () => {
      qc.setQueriesData({ queryKey: searchKeys.history }, { items: [] });
      void qc.invalidateQueries({ queryKey: searchKeys.history });
    },
  });
}
