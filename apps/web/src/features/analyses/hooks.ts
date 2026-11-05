import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isAnalysisActive, type Analysis, type Paginated, type SummaryType } from "@/types/api";
import { analysesApi, type CompareInput, type ListAnalysesParams } from "./api";

export const ANALYSIS_POLL_MS = 2500;

export const analysisKeys = {
  all: ["analyses"] as const,
  list: (params: ListAnalysesParams) => ["analyses", "list", params] as const,
  detail: (id: string) => ["analyses", "detail", id] as const,
};

/** Intervalo de polling: 2,5 s enquanto a análise está na fila/processando; para quando termina. */
export function analysisRefetchInterval(analysis: Analysis | undefined): number | false {
  if (!analysis) return false;
  return isAnalysisActive(analysis.status) ? ANALYSIS_POLL_MS : false;
}

export function useAnalyses(params: ListAnalysesParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: analysisKeys.list(params),
    queryFn: ({ signal }) => analysesApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    // enquanto houver alguma análise ativa na lista, atualiza periodicamente
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((a) => isAnalysisActive(a.status)) ? ANALYSIS_POLL_MS : false;
    },
  });
}

export function useAnalysis(id: string | null | undefined) {
  return useQuery({
    queryKey: analysisKeys.detail(id ?? ""),
    queryFn: ({ signal }) => analysesApi.get(id!, signal),
    enabled: !!id,
    refetchInterval: (query) => analysisRefetchInterval(query.state.data),
  });
}

function seedAnalysis(qc: QueryClient, analysis: Analysis) {
  qc.setQueryData(analysisKeys.detail(analysis.id), analysis);
  void qc.invalidateQueries({ queryKey: analysisKeys.all });
}

export function useSummarize(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: SummaryType) => analysesApi.summarize(documentId, type),
    onSuccess: (a) => seedAnalysis(qc, a),
  });
}

export function useGenerateTopics(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => analysesApi.topics(documentId),
    onSuccess: (a) => seedAnalysis(qc, a),
  });
}

export function useGenerateQuestions(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => analysesApi.questions(documentId),
    onSuccess: (a) => seedAnalysis(qc, a),
  });
}

export function useCompareDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompareInput) => analysesApi.compare(input),
    onSuccess: (a) => seedAnalysis(qc, a),
  });
}

export function useCancelAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => analysesApi.cancel(id),
    onSuccess: (a) => seedAnalysis(qc, a),
  });
}

export function useDeleteAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => analysesApi.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: analysisKeys.detail(id) });
      qc.setQueriesData<Paginated<Analysis>>({ queryKey: ["analyses", "list"] }, (old) =>
        old ? { ...old, items: old.items.filter((a) => a.id !== id), total: Math.max(0, old.total - 1) } : old,
      );
      void qc.invalidateQueries({ queryKey: analysisKeys.all });
    },
  });
}
