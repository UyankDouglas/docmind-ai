import type { Analysis, AnalysisKind, AnalysisStatus, AnalysisStrategy, SummaryType } from "@/types/api";

export interface SummaryTypeOption {
  value: SummaryType;
  label: string;
  description: string;
}

export const SUMMARY_TYPES: readonly SummaryTypeOption[] = [
  { value: "general", label: "Resumo geral", description: "Visão geral fiel do conteúdo, na ordem do documento." },
  { value: "executive", label: "Resumo executivo", description: "O essencial para decisão, em poucos parágrafos." },
  { value: "topics", label: "Principais tópicos", description: "Lista dos temas tratados e onde aparecem." },
  { value: "obligations", label: "Obrigações e prazos", description: "Deveres, responsáveis, datas e prazos citados." },
  { value: "faq", label: "Perguntas frequentes", description: "Perguntas que o documento responde, com as respostas." },
  { value: "attention", label: "Pontos que exigem atenção", description: "Riscos, exceções, ambiguidades e cláusulas sensíveis." },
];

export const SUMMARY_TYPE_LABELS: Record<SummaryType, string> = Object.fromEntries(
  SUMMARY_TYPES.map((t) => [t.value, t.label]),
) as Record<SummaryType, string>;

export const KIND_LABELS: Record<AnalysisKind, string> = {
  summary: "Resumo",
  comparison: "Comparação",
  topics: "Tópicos",
  questions: "Perguntas sugeridas",
};

export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "Na fila",
  running: "Processando",
  succeeded: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export const STRATEGY_LABELS: Record<AnalysisStrategy, string> = {
  single_pass: "passagem única",
  hierarchical: "hierárquico",
  retrieval: "por recuperação",
};

export function strategyDescription(strategy: AnalysisStrategy, parts: number): string {
  switch (strategy) {
    case "single_pass":
      return "Passagem única: todo o texto coube em uma chamada ao modelo.";
    case "hierarchical":
      return `Hierárquico em ${parts} parte${parts === 1 ? "" : "s"}: o documento foi resumido por partes e as partes foram consolidadas.`;
    case "retrieval":
      return "Por recuperação: apenas os trechos mais relevantes para a pergunta foram lidos, não o documento inteiro.";
  }
}

export function analysisTypeLabel(a: Pick<Analysis, "kind" | "summary_type">): string {
  if (a.kind === "summary" && a.summary_type) return SUMMARY_TYPE_LABELS[a.summary_type];
  return KIND_LABELS[a.kind];
}

export const COMPARE_SUGGESTIONS: readonly string[] = [
  "Quais cláusulas são diferentes?",
  "Quais tópicos aparecem em ambos?",
  "Quais obrigações mudaram?",
  "Existem informações contraditórias?",
];
