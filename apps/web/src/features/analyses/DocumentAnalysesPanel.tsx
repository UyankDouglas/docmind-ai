import * as React from "react";
import { BookOpenText, ChevronRight, ListTree, MessageCircleQuestion, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import { cn, formatRelative } from "@/lib/utils";
import { isAnalysisActive, type Analysis, type AnalysisKind, type AnalysisSource, type ExportFormat, type SummaryType } from "@/types/api";
import { AnalysisResultView, AnalysisStatusBadge, SourceChip } from "./AnalysisResultView";
import { downloadAnalysisExport } from "./export";
import { useAnalyses, useAnalysis, useCancelAnalysis, useDeleteAnalysis, useGenerateQuestions, useGenerateTopics, useSummarize } from "./hooks";
import { SUMMARY_TYPES, analysisTypeLabel } from "./labels";
import { useAskAboutDocument } from "./useAskAboutDocument";

type Tab = "summary" | "topics" | "questions";

const TABS: Array<{ key: Tab; label: string; icon: typeof BookOpenText }> = [
  { key: "summary", label: "Resumos", icon: BookOpenText },
  { key: "topics", label: "Tópicos", icon: ListTree },
  { key: "questions", label: "Perguntas", icon: MessageCircleQuestion },
];

interface Props {
  documentId: string;
  documentReady: boolean;
  onSourceClick?: (s: AnalysisSource) => void;
  activeChunkId?: string | null;
  className?: string;
}

/** Área "Análises" do documento: resumos, tópicos e perguntas sugeridas, com histórico por documento. */
export function DocumentAnalysesPanel({ documentId, documentReady, onSourceClick, activeChunkId, className }: Props) {
  const [tab, setTab] = React.useState<Tab>("summary");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { toast } = useToast();

  const list = useAnalyses({ document_id: documentId, page: 1, page_size: 50 });
  const items = React.useMemo(() => (list.data?.items ?? []).filter((a) => a.kind === (tab as AnalysisKind)), [list.data, tab]);

  // seleção padrão: a análise mais recente da aba
  const effectiveId = selectedId && items.some((a) => a.id === selectedId) ? selectedId : (items[0]?.id ?? null);
  const detail = useAnalysis(effectiveId);
  const analysis: Analysis | undefined = detail.data ?? items.find((a) => a.id === effectiveId);

  const summarize = useSummarize(documentId);
  const topics = useGenerateTopics(documentId);
  const questions = useGenerateQuestions(documentId);
  const cancel = useCancelAnalysis();
  const remove = useDeleteAnalysis();
  const [exporting, setExporting] = React.useState(false);
  const [summaryType, setSummaryType] = React.useState<SummaryType>("general");

  const onError = (title: string) => (e: unknown) => toast({ kind: "error", title, description: errorMessage(e) });

  const generate = () => {
    const onSuccess = (a: Analysis) => setSelectedId(a.id);
    if (tab === "summary") summarize.mutate(summaryType, { onSuccess, onError: onError("Não foi possível iniciar o resumo") });
    else if (tab === "topics") topics.mutate(undefined, { onSuccess, onError: onError("Não foi possível iniciar a extração de tópicos") });
    else questions.mutate(undefined, { onSuccess, onError: onError("Não foi possível gerar perguntas") });
  };
  const generating = summarize.isPending || topics.isPending || questions.isPending;

  const handleExport = async (format: ExportFormat) => {
    if (!analysis) return;
    setExporting(true);
    try {
      await downloadAnalysisExport(analysis.id, format, `${analysisTypeLabel(analysis)}-${analysis.id.slice(0, 8)}`.toLowerCase().replace(/\s+/g, "-"));
    } catch (e) {
      onError("Não foi possível exportar")(e);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = () => {
    if (!analysis) return;
    if (!window.confirm("Excluir esta análise? Os documentos não são afetados.")) return;
    remove.mutate(analysis.id, { onSuccess: () => setSelectedId(null), onError: onError("Não foi possível excluir") });
  };

  const selectedOption = SUMMARY_TYPES.find((t) => t.value === summaryType);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-testid="document-analyses">
      <div role="tablist" aria-label="Tipo de análise" className="grid shrink-0 grid-cols-3 gap-1 border-b border-border p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setSelectedId(null);
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              tab === t.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" aria-hidden /> {t.label}
          </button>
        ))}
      </div>

      <div className="shrink-0 space-y-2 border-b border-border p-3">
        {tab === "summary" ? (
          <>
            <label className="text-xs font-medium" htmlFor="summary-type">
              Tipo de resumo
            </label>
            <Select value={summaryType} onValueChange={(v) => setSummaryType(v as SummaryType)}>
              <SelectTrigger id="summary-type" aria-label="Tipo de resumo" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUMMARY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOption ? <p className="text-[11px] text-muted-foreground">{selectedOption.description}</p> : null}
          </>
        ) : tab === "topics" ? (
          <p className="text-xs text-muted-foreground">Extrai os principais temas do documento, cada um com descrição e fontes.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Sugere perguntas que o documento consegue responder. Clique em uma para perguntar no chat.</p>
        )}
        <Button size="sm" className="w-full" onClick={generate} loading={generating} disabled={!documentReady} aria-label={tab === "summary" ? "Gerar resumo" : tab === "topics" ? "Extrair tópicos" : "Gerar perguntas"}>
          <Sparkles /> {tab === "summary" ? "Gerar resumo" : tab === "topics" ? "Extrair tópicos" : "Gerar perguntas"}
        </Button>
        {!documentReady ? <p className="text-[11px] text-muted-foreground">Disponível quando o documento estiver pronto.</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma análise deste tipo ainda.</p>
        ) : (
          <>
            {items.length > 1 ? (
              <ul className="mb-3 space-y-1" aria-label="Análises anteriores">
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-current={a.id === effectiveId ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40",
                        a.id === effectiveId ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{analysisTypeLabel(a)}</span>
                      <span className="text-muted-foreground">{formatRelative(a.created_at)}</span>
                      <AnalysisStatusBadge status={a.status} className="px-1.5 py-0 text-[10px]" />
                      <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {analysis ? (
              tab === "topics" && analysis.status === "succeeded" ? (
                <TopicsView analysis={analysis} onSourceClick={onSourceClick} activeChunkId={activeChunkId} onExport={handleExport} exporting={exporting} onDelete={handleDelete} deleting={remove.isPending} />
              ) : tab === "questions" && analysis.status === "succeeded" ? (
                <QuestionsView analysis={analysis} documentId={documentId} onDelete={handleDelete} deleting={remove.isPending} />
              ) : (
                <AnalysisResultView
                  analysis={analysis}
                  onSourceClick={onSourceClick}
                  activeChunkId={activeChunkId}
                  onExport={handleExport}
                  exporting={exporting}
                  onCancel={isAnalysisActive(analysis.status) ? () => cancel.mutate(analysis.id, { onError: onError("Não foi possível cancelar") }) : undefined}
                  cancelling={cancel.isPending}
                  onDelete={handleDelete}
                  deleting={remove.isPending}
                />
              )
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function TopicsView({ analysis, onSourceClick, activeChunkId, onExport, exporting, onDelete, deleting }: { analysis: Analysis; onSourceClick?: (s: AnalysisSource) => void; activeChunkId?: string | null; onExport: (f: ExportFormat) => void; exporting: boolean; onDelete: () => void; deleting: boolean }) {
  const topics = analysis.result?.topics ?? [];
  const sources = analysis.result?.sources ?? [];
  const byIndex = new Map(sources.map((s) => [s.index, s]));
  if (topics.length === 0) {
    return <AnalysisResultView analysis={analysis} onSourceClick={onSourceClick} activeChunkId={activeChunkId} onExport={onExport} exporting={exporting} onDelete={onDelete} deleting={deleting} />;
  }
  return (
    <div className="space-y-3" data-testid="topics-view">
      <ul className="space-y-2">
        {topics.map((t, i) => (
          <li key={`${t.title}-${i}`} className="rounded-lg border border-border bg-card p-3">
            <h4 className="text-sm font-semibold">{t.title}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
            {t.source_indices.length ? (
              <p className="mt-2 text-xs">
                Fontes: {t.source_indices.map((n) => <SourceChip key={n} source={byIndex.get(n)} index={n} onClick={onSourceClick} active={!!activeChunkId && byIndex.get(n)?.chunk_id === activeChunkId} />)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <AnalysisResultView analysis={analysis} onSourceClick={onSourceClick} activeChunkId={activeChunkId} onExport={onExport} exporting={exporting} onDelete={onDelete} deleting={deleting} />
    </div>
  );
}

export function QuestionsView({ analysis, documentId, onDelete, deleting }: { analysis: Analysis; documentId: string; onDelete?: () => void; deleting?: boolean }) {
  const { ask, isPending } = useAskAboutDocument(documentId);
  const { toast } = useToast();
  const list = analysis.result?.questions ?? [];
  return (
    <div className="space-y-3" data-testid="questions-view">
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">O modelo não devolveu perguntas utilizáveis para este documento.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Perguntas sugeridas">
          {list.map((q) => (
            <li key={q}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => void ask(q).catch((e) => toast({ kind: "error", title: "Não foi possível abrir o chat", description: errorMessage(e) }))}
                className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-left text-xs text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AnalysisResultView analysis={{ ...analysis, result: analysis.result ? { ...analysis.result, content: analysis.result.content || "" } : null }} onDelete={onDelete} deleting={deleting} />
    </div>
  );
}
