import * as React from "react";
import { AlertTriangle, Ban, CheckCircle2, Download, FileJson, FileText, Info, Loader2, Quote, Trash2, XCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/features/chat/markdown";
import { cn, formatDateTime } from "@/lib/utils";
import { isAnalysisActive, type Analysis, type AnalysisSource, type AnalysisStatus, type ExportFormat } from "@/types/api";
import { ANALYSIS_STATUS_LABELS, analysisTypeLabel, strategyDescription } from "./labels";

const STATUS_VARIANTS: Record<AnalysisStatus, NonNullable<BadgeProps["variant"]>> = {
  queued: "muted",
  running: "info",
  succeeded: "success",
  failed: "destructive",
  cancelled: "muted",
};

export function AnalysisStatusBadge({ status, className }: { status: AnalysisStatus; className?: string }) {
  const active = isAnalysisActive(status);
  return (
    <Badge variant={STATUS_VARIANTS[status]} className={cn("font-medium", className)} data-status={status}>
      {active ? <Loader2 className="size-3 animate-spin" aria-hidden /> : status === "succeeded" ? <CheckCircle2 className="size-3" aria-hidden /> : status === "failed" ? <XCircle className="size-3" aria-hidden /> : <Ban className="size-3" aria-hidden />}
      {ANALYSIS_STATUS_LABELS[status]}
    </Badge>
  );
}

export function sourceLabel(s: AnalysisSource): string {
  const doc = s.document_label ? `${s.document_label} · ${s.document_name}` : s.document_name;
  return s.location_label ? `${doc} — ${s.location_label}` : doc;
}

/** Marcador [n] clicável; marcadores sem fonte correspondente são exibidos como texto neutro. */
export function SourceChip({ source, index, onClick, active }: { source: AnalysisSource | undefined; index: number; onClick?: (s: AnalysisSource) => void; active?: boolean }) {
  if (!source) {
    return <span className="text-muted-foreground">[{index}]</span>;
  }
  const disabled = !source.document_id;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onClick?.(source)}
          disabled={disabled}
          className={cn(
            "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 align-text-top text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
            active ? "border-primary bg-primary text-primary-foreground" : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
          )}
          aria-label={`Fonte ${index}: ${sourceLabel(source)}`}
          data-testid={`analysis-source-chip-${index}`}
        >
          {index}
        </button>
      </TooltipTrigger>
      <TooltipContent>{disabled ? `${sourceLabel(source)} (documento removido)` : sourceLabel(source)}</TooltipContent>
    </Tooltip>
  );
}

export function CoverageBlock({ analysis }: { analysis: Analysis }) {
  const r = analysis.result;
  if (!r) return null;
  const cov = r.coverage;
  return (
    <section className="rounded-lg border border-border bg-card/60 p-3 text-xs" aria-label="Cobertura e limitações" data-testid="analysis-coverage">
      <h4 className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
        <Info className="size-3.5" aria-hidden /> Cobertura e limitações
      </h4>
      <ul className="space-y-1 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Estratégia:</span> {strategyDescription(cov.strategy, cov.parts)}
        </li>
        <li>
          <span className="font-medium text-foreground">Trechos lidos:</span> {cov.chunks_used} de {cov.chunks_total}
          {cov.tokens_used ? ` · ${cov.tokens_used.toLocaleString("pt-BR")} tokens` : ""}
        </li>
        {cov.complete ? (
          <li className="flex items-start gap-1.5 text-success">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Todos os trechos dos documentos foram considerados.
          </li>
        ) : (
          <li className="flex items-start gap-1.5 text-warning" data-testid="coverage-incomplete">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Cobertura parcial: nem todos os trechos foram lidos. Não trate o resultado como exaustivo.
          </li>
        )}
        {r.limitations.map((l) => (
          <li key={l} className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {l}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SourcesList({ sources, onSourceClick, activeChunkId, grouped = false }: { sources: AnalysisSource[]; onSourceClick?: (s: AnalysisSource) => void; activeChunkId?: string | null; grouped?: boolean }) {
  if (sources.length === 0) return null;
  const groups = grouped
    ? Array.from(
        sources.reduce<Map<string, AnalysisSource[]>>((acc, s) => {
          const key = `${s.document_label ?? ""}|${s.document_name}`;
          acc.set(key, [...(acc.get(key) ?? []), s]);
          return acc;
        }, new Map()),
      )
    : [["", sources] as const];

  return (
    <section aria-label="Fontes" data-testid="analysis-sources">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Quote className="size-3.5" aria-hidden /> Fontes
      </h4>
      <div className="space-y-3">
        {groups.map(([key, list]) => (
          <div key={key || "all"}>
            {grouped ? (
              <p className="mb-1 text-xs font-medium">
                {list[0]?.document_label ? <span className="mr-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{list[0].document_label}</span> : null}
                {list[0]?.document_name}
              </p>
            ) : null}
            <ol className="space-y-1.5">
              {list.map((s) => (
                <li key={`${s.index}-${s.chunk_id ?? "x"}`}>
                  <button
                    type="button"
                    onClick={() => onSourceClick?.(s)}
                    disabled={!s.document_id}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                      activeChunkId && s.chunk_id === activeChunkId ? "border-primary bg-primary/10" : "border-border",
                    )}
                    aria-label={`Fonte ${s.index}: ${sourceLabel(s)}`}
                  >
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 px-1 text-[11px] font-semibold text-primary">{s.index}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {grouped ? s.location_label : sourceLabel(s)}
                        {!s.document_id ? <span className="ml-1 text-muted-foreground">(documento removido)</span> : null}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground">{s.snippet}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface AnalysisResultViewProps {
  analysis: Analysis;
  onSourceClick?: (s: AnalysisSource) => void;
  activeChunkId?: string | null;
  onExport?: (format: ExportFormat) => void;
  exporting?: boolean;
  onDelete?: () => void;
  onCancel?: () => void;
  deleting?: boolean;
  cancelling?: boolean;
  /** agrupa fontes por documento (comparações) */
  groupSources?: boolean;
  className?: string;
}

/**
 * Exibe uma análise em qualquer estado: fila/processando (indicador indeterminado, sem percentual),
 * falha (mensagem do backend), cancelada, ou concluída (Markdown com marcadores [n] clicáveis,
 * fontes e bloco de cobertura/limitações sempre visível).
 */
export function AnalysisResultView({ analysis, onSourceClick, activeChunkId, onExport, exporting, onDelete, onCancel, deleting, cancelling, groupSources = false, className }: AnalysisResultViewProps) {
  const sources = analysis.result?.sources ?? [];
  const byIndex = React.useMemo(() => new Map(sources.map((s) => [s.index, s])), [sources]);
  const renderCitation = React.useCallback(
    (index: number, key: string) => {
      const s = byIndex.get(index);
      return <SourceChip key={key} source={s} index={index} onClick={onSourceClick} active={!!activeChunkId && s?.chunk_id === activeChunkId} />;
    },
    [byIndex, onSourceClick, activeChunkId],
  );

  const active = isAnalysisActive(analysis.status);

  return (
    <article className={cn("space-y-4", className)} aria-label={analysis.title} data-testid="analysis-result" data-status={analysis.status}>
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={analysis.title}>
            {analysis.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {analysisTypeLabel(analysis)} · {formatDateTime(analysis.created_at)}
            {analysis.model ? ` · ${analysis.model}` : ""}
            {analysis.prompt_tokens != null && analysis.completion_tokens != null ? ` · ${analysis.prompt_tokens + analysis.completion_tokens} tokens` : ""}
          </p>
        </div>
        <AnalysisStatusBadge status={analysis.status} />
        {active && onCancel ? (
          <Button variant="outline" size="sm" onClick={onCancel} loading={cancelling} aria-label="Cancelar análise">
            <Ban /> Cancelar
          </Button>
        ) : null}
        {analysis.status === "succeeded" && onExport ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" loading={exporting} aria-label="Exportar análise">
                <Download /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onExport("md")}>
                <FileText /> Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("json")}>
                <FileJson /> JSON (.json)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!active && onDelete ? (
          <Button variant="ghost" size="icon-sm" onClick={onDelete} loading={deleting} aria-label="Excluir análise">
            <Trash2 />
          </Button>
        ) : null}
      </header>

      {active ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" role="status" aria-live="polite" data-testid="analysis-processing">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <div>
            <p className="font-medium text-foreground">{analysis.status === "queued" ? "Na fila de processamento" : "Analisando o documento…"}</p>
            <p className="text-xs">O tempo depende do tamanho do documento e do provedor de IA. Esta tela atualiza sozinha.</p>
          </div>
        </div>
      ) : null}

      {analysis.status === "failed" ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="analysis-error">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-medium">A análise falhou</p>
            <p className="text-xs text-muted-foreground">{analysis.error_message ?? "Erro não informado pelo servidor."}</p>
          </div>
        </div>
      ) : null}

      {analysis.status === "cancelled" ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Análise cancelada{analysis.error_message ? `: ${analysis.error_message}` : "."}</p>
      ) : null}

      {analysis.status === "succeeded" && analysis.result ? (
        <>
          {analysis.question ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
              <span className="font-medium">Pergunta orientadora:</span> {analysis.question}
            </p>
          ) : null}
          <div className="rounded-lg border border-border bg-card p-4 text-sm" data-testid="analysis-content">
            <Markdown content={analysis.result.content} renderCitation={renderCitation} />
          </div>
          <CoverageBlock analysis={analysis} />
          <SourcesList sources={sources} onSourceClick={onSourceClick} activeChunkId={activeChunkId} grouped={groupSources} />
        </>
      ) : null}
    </article>
  );
}
