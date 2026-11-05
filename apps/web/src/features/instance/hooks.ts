import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentKeys } from "@/features/documents/hooks";
import { instanceApi } from "./api";

export const instanceKeys = { info: ["instance"] as const };

/** Modo demonstração e cadastro: configuração pública, igual para todos os visitantes. */
export function useInstance() {
  return useQuery({
    queryKey: instanceKeys.info,
    queryFn: ({ signal }) => instanceApi.get(signal),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useLoadDemoSamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => instanceApi.loadSamples(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: documentKeys.all });
      void qc.invalidateQueries({ queryKey: ["collections"] });
      void qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}
