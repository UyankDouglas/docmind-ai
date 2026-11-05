import type { Analysis } from "@/types/api";

/** Rota onde uma análise pode ser vista: comparações em /compare, as demais na aba Análises do documento. */
export function analysisHref(a: Pick<Analysis, "id" | "kind" | "document_ids">): string {
  if (a.kind === "comparison") return `/compare?analysis=${a.id}`;
  const docId = a.document_ids[0];
  return docId ? `/documents/${docId}?tab=analyses` : "/documents";
}
