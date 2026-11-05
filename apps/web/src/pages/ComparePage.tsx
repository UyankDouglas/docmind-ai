import * as React from "react";
import { useNavigate, useSearchParams } from "react-router";
import { GitCompareArrows, History } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/EmptyState";
import { useReadyDocuments } from "@/features/documents/hooks";
import { documentKind, KIND_ICONS, viewerHref } from "@/lib/documents";
import { errorMessage } from "@/services/api";
import { cn, formatRelative } from "@/lib/utils";
import type { AnalysisSource, ExportFormat } from "@/types/api";
import { COMPARE_MAX_DOCUMENTS, COMPARE_MIN_DOCUMENTS } from "@/features/analyses/api";
import { AnalysisResultView, AnalysisStatusBadge } from "@/features/analyses/AnalysisResultView";
import { downloadAnalysisExport } from "@/features/analyses/export";
import { useAnalyses, useAnalysis, useCancelAnalysis, useCompareDocuments, useDeleteAnalysis } from "@/features/analyses/hooks";
import { COMPARE_SUGGESTIONS } from "@/features/analyses/labels";

export const LABELS = ["A", "B", "C", "D", "E"] as const;

export function ComparePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const docs = useReadyDocuments();
  const [selected, setSelected] = React.useState<string[]>(() => params.get("docs")?.split(",").filter(Boolean) ?? []);
  const [question, setQuestion] = React.useState("");
  const compare = useCompareDocuments();
  const cancel = useCancelAnalysis();
  const remove = useDeleteAnalysis();
  const history = useAnalyses({ kind: "comparison", page: 1, page_size: 20 });
  const activeId = params.get("analysis");
  const analysis = useAnalysis(activeId);
  const [exporting, setExporting] = React.useState(false);

  const selectAnalysis = (id: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("analysis", id);
        else next.delete("analysis");
        return next;
      },
      { replace: true },
    );
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX_DOCUMENTS) {
        toast({ kind: "info", title: `Selecione no máximo ${COMPARE_MAX_DOCUMENTS} documentos` });
        return prev;
      }
      return [...prev, id];
    });
  };

  const canCompare = selected.length >= COMPARE_MIN_DOCUMENTS && selected.length <= COMPARE_MAX_DOCUMENTS && !compare.isPending;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canCompare) return;
    const q = question.trim();
    compare.mutate(
      { document_ids: selected, ...(q ? { question: q } : {}) },
      {
        onSuccess: (a) => selectAnalysis(a.id),
        onError: (err) => toast({ kind: "error", title: "Não foi possível iniciar a comparação", description: errorMessage(err) }),
      },
    );
  };

  const handleExport = async (format: ExportFormat) => {
    if (!analysis.data) return;
    setExporting(true);
    try {
      await downloadAnalysisExport(analysis.data.id, format, `comparacao-${analysis.data.id.slice(0, 8)}`);
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível exportar", description: errorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const openSource = (s: AnalysisSource) => {
    if (!s.document_id) return;
    navigate(viewerHref({ document_id: s.document_id, location_type: s.location_type, chunk_id: s.chunk_id }));
  };

  const items = docs.data ?? [];

  return (
    <div>
      <PageHeader
        title="Comparar documentos"
        description="Selecione de 2 a 5 documentos prontos. A comparação recupera evidências de cada documento e apresenta semelhanças, diferenças e contradições com fontes. Resultados baseados em trechos recuperados não são exaustivos."
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos</CardTitle>
              <CardDescription>
                {selected.length} selecionado{selected.length === 1 ? "" : "s"} · mínimo {COMPARE_MIN_DOCUMENTS}, máximo {COMPARE_MAX_DOCUMENTS}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3" aria-label="Configurar comparação">
                <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border p-1" role="group" aria-label="Documentos prontos">
                  {docs.isPending ? (
                    <>
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </>
                  ) : items.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum documento pronto para comparação.</p>
                  ) : (
                    items.map((d) => {
                      const id = `cmp-${d.id}`;
                      const Icon = KIND_ICONS[documentKind(d.mime_type)];
                      const pos = selected.indexOf(d.id);
                      return (
                        <label key={d.id} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60">
                          <Checkbox id={id} checked={pos >= 0} onCheckedChange={() => toggle(d.id)} aria-label={d.name} />
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                          {pos >= 0 ? <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{LABELS[pos]}</span> : null}
                        </label>
                      );
                    })
                  )}
                </div>

                <div>
                  <label htmlFor="compare-question" className="mb-1 block text-xs font-medium">
                    Pergunta orientadora (opcional)
                  </label>
                  <Input id="compare-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Quais obrigações mudaram?" maxLength={500} />
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sugestões de pergunta">
                    {COMPARE_SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <button type="button" onClick={() => setQuestion(s)} className={cn("rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:bg-accent", question === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <Button type="submit" className="w-full" disabled={!canCompare} loading={compare.isPending} variant="gradient">
                  <GitCompareArrows /> Comparar
                </Button>
                {selected.length > 0 && selected.length < COMPARE_MIN_DOCUMENTS ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    Selecione pelo menos {COMPARE_MIN_DOCUMENTS} documentos.
                  </p>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" aria-hidden /> Comparações anteriores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : (history.data?.items.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma comparação ainda.</p>
              ) : (
                <ul className="space-y-1" aria-label="Histórico de comparações">
                  {history.data!.items.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => selectAnalysis(a.id)}
                        aria-current={a.id === activeId ? "true" : undefined}
                        className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent/40", a.id === activeId ? "border-primary bg-primary/10" : "border-border")}
                      >
                        <span className="min-w-0 flex-1 truncate" title={a.title}>
                          {a.title}
                        </span>
                        <span className="text-muted-foreground">{formatRelative(a.created_at)}</span>
                        <AnalysisStatusBadge status={a.status} className="px-1.5 py-0 text-[10px]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          {!activeId ? (
            <EmptyState icon={GitCompareArrows} title="Nenhuma comparação selecionada" description="Escolha os documentos e clique em Comparar, ou abra uma comparação anterior." className="py-16" />
          ) : analysis.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : analysis.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar a comparação: {errorMessage(analysis.error)}</p>
          ) : analysis.data ? (
            <div className="space-y-3">
              <ul className="flex flex-wrap gap-2 text-xs" aria-label="Documentos comparados">
                {analysis.data.documents.map((d, i) => (
                  <li key={d.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
                    <span className="rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{d.label ?? LABELS[i]}</span>
                    <span className="max-w-[16rem] truncate">{d.name}</span>
                  </li>
                ))}
              </ul>
              <AnalysisResultView
                analysis={analysis.data}
                groupSources
                onSourceClick={openSource}
                onExport={handleExport}
                exporting={exporting}
                onCancel={analysis.data.status === "queued" || analysis.data.status === "running" ? () => cancel.mutate(analysis.data!.id) : undefined}
                cancelling={cancel.isPending}
                onDelete={() => {
                  if (!window.confirm("Excluir esta comparação?")) return;
                  remove.mutate(analysis.data!.id, { onSuccess: () => selectAnalysis(null) });
                }}
                deleting={remove.isPending}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
