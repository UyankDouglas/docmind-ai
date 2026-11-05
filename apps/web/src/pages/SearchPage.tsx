import * as React from "react";
import { Link, useSearchParams } from "react-router";
import { History, Search, SearchX, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/Skeletons";
import { EMPTY_SCOPE, ScopePicker, type Scope } from "@/features/documents/ScopePicker";
import { useClearSearchHistory, useSearchHistory, useSemanticSearch } from "@/features/search/hooks";
import type { SearchInput } from "@/features/search/api";
import { useWorkspaceSettings } from "@/features/settings/hooks";
import { UsageBlockBanner } from "@/features/settings/UsageBlockBanner";
import { Highlight } from "@/lib/highlight";
import { documentKind, KIND_ICONS, locationLabel, viewerHref } from "@/lib/documents";
import { cn, formatRelative } from "@/lib/utils";
import type { RetrievalMode, SearchResult } from "@/types/api";

type ModeChoice = "default" | RetrievalMode;

export const MODE_SHORT: Record<RetrievalMode, string> = { hybrid: "Híbrida", vector: "Vetorial" };

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

export function ScoreDetails({ r, mode }: { r: SearchResult; mode: RetrievalMode }) {
  if (mode === "vector") return <Badge variant="purple">{pct(r.score)} similar</Badge>;
  const detail = `vetorial ${pct(r.vector_score)}${r.vector_rank ? ` (#${r.vector_rank})` : ""} · léxico ${pct(r.lexical_score)}${r.lexical_rank ? ` (#${r.lexical_rank})` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex flex-wrap items-center gap-1" data-testid="score-details">
          <Badge variant="purple">score {r.score.toFixed(3)}</Badge>
          <span className="text-[11px] text-muted-foreground">{detail}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Fusão RRF das posições vetorial e léxica. Scores parciais: similaridade cosseno e ts_rank normalizado.</TooltipContent>
    </Tooltip>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const modeParam = params.get("mode");
  const [text, setText] = React.useState(q);
  const [lastQ, setLastQ] = React.useState(q);
  if (lastQ !== q) {
    setLastQ(q);
    setText(q);
  }
  const [scope, setScope] = React.useState<Scope>(EMPTY_SCOPE);
  const [submitted, setSubmitted] = React.useState<Scope>(EMPTY_SCOPE);
  const [modeChoice, setModeChoice] = React.useState<ModeChoice>(
    modeParam === "vector" || modeParam === "hybrid" ? modeParam : "default",
  );
  const [confirmClear, setConfirmClear] = React.useState(false);

  const workspaceSettings = useWorkspaceSettings();
  const defaultMode: RetrievalMode = workspaceSettings.data?.retrieval.mode ?? "hybrid";
  const effectiveMode: RetrievalMode = modeChoice === "default" ? defaultMode : modeChoice;

  const input = React.useMemo<SearchInput | null>(
    () =>
      q
        ? {
            query: q,
            document_ids: submitted.document_ids.length ? submitted.document_ids : undefined,
            collection_ids: submitted.collection_ids.length ? submitted.collection_ids : undefined,
            top_k: 10,
            mode: modeChoice === "default" ? undefined : modeChoice,
          }
        : null,
    [q, submitted, modeChoice],
  );

  const { data, isFetching, isError, error, refetch } = useSemanticSearch(input);
  const history = useSearchHistory(20);
  const clearHistory = useClearSearchHistory();

  const runSearch = (next: string, mode: ModeChoice = modeChoice) => {
    if (!next) return;
    setSubmitted(scope);
    setModeChoice(mode);
    const p: Record<string, string> = { q: next };
    if (mode !== "default") p.mode = mode;
    setParams(p, { replace: true });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(text.trim());
  };

  const mode = data?.mode ?? effectiveMode;

  return (
    <div>
      <PageHeader
        title="Pesquisa semântica"
        description="Encontre trechos por significado e por termos exatos, sem geração de resposta por IA. Os resultados mostram documento, localização (página ou seção) e os scores da recuperação."
      />
      <UsageBlockBanner />
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div>
          <form onSubmit={submit} className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="search">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ex.: prazo de cancelamento, multa por atraso, confidencialidade…"
                aria-label="Consulta"
                className="h-10 pl-9"
              />
            </div>
            <ScopePicker value={scope} onChange={setScope} className="h-10 sm:w-64" />
            <Select value={modeChoice} onValueChange={(v) => setModeChoice(v as ModeChoice)}>
              <SelectTrigger className="h-10 sm:w-48" aria-label="Modo de busca">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Padrão ({MODE_SHORT[defaultMode]})</SelectItem>
                <SelectItem value="hybrid">Híbrida</SelectItem>
                <SelectItem value="vector">Vetorial</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="gradient" className="h-10" loading={isFetching} disabled={!text.trim()}>
              Pesquisar
            </Button>
          </form>

          {!input ? (
            <EmptyState
              icon={Search}
              title="Digite uma consulta"
              description="A busca híbrida combina similaridade semântica (embeddings) com termos exatos (Full-Text Search) e funde os resultados com RRF."
            />
          ) : isFetching && !data ? (
            <TableSkeleton rows={4} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : data && data.results.length === 0 ? (
            <EmptyState icon={SearchX} title="Nenhum trecho relevante" description="Tente reformular a consulta, trocar o modo de busca ou ampliar a seleção de documentos." />
          ) : data ? (
            <div>
              <p className="mb-3 text-xs text-muted-foreground" data-testid="search-summary">
                {data.results.length} resultado{data.results.length === 1 ? "" : "s"} · modo {MODE_SHORT[data.mode].toLowerCase()} ·{" "}
                {data.vector_candidates} candidato{data.vector_candidates === 1 ? "" : "s"} vetoria{data.vector_candidates === 1 ? "l" : "is"} ·{" "}
                {data.lexical_candidates} léxico{data.lexical_candidates === 1 ? "" : "s"} · {data.latency_ms} ms · modelo {data.embedding_model}
              </p>
              <ol className="space-y-3">
                {data.results.map((r, i) => {
                  const href = viewerHref({
                    document_id: r.document_id,
                    mime_type: r.mime_type,
                    location_type: r.location_type,
                    page_start: r.page_start,
                    chunk_id: r.chunk_id,
                  });
                  const Icon = KIND_ICONS[documentKind(r.mime_type)];
                  return (
                    <li
                      key={r.chunk_id}
                      className="rounded-xl border border-border bg-card p-4 animate-slide-up"
                      style={{ animationDelay: `${i * 30}ms` }}
                      data-testid="search-result"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <ScoreDetails r={r} mode={mode} />
                        <Link to={href} className="inline-flex items-center gap-1 font-medium hover:underline">
                          <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                          {r.document_name}
                        </Link>
                        <span className="text-muted-foreground">· {locationLabel(r)}</span>
                      </div>
                      {r.highlight ? (
                        <p className="mb-1 text-sm leading-relaxed" data-testid="search-highlight">
                          <Highlight html={r.highlight} />
                        </p>
                      ) : null}
                      <p className={cn("text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap", r.highlight ? "line-clamp-3 text-muted-foreground" : "line-clamp-5")}>
                        {r.text}
                      </p>
                      <div className="mt-2">
                        <Button variant="link" size="sm" className="h-auto px-0" asChild>
                          <Link to={href}>{r.location_type === "page" ? "Abrir na página" : "Abrir na seção"}</Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>

        <aside aria-label="Histórico de pesquisas" className="rounded-xl border border-border bg-card/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="size-3.5" aria-hidden /> Histórico
            </h2>
            {history.data && history.data.length > 0 ? (
              <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setConfirmClear(true)} aria-label="Limpar histórico de pesquisas">
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
          {history.isPending ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : history.isError ? (
            <p className="text-xs text-muted-foreground">Histórico indisponível.</p>
          ) : !history.data || history.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">Suas pesquisas recentes aparecerão aqui.</p>
          ) : (
            <ul className="space-y-0.5">
              {history.data.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setText(h.query);
                      runSearch(h.query, h.mode);
                    }}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Repetir pesquisa: ${h.query}`}
                  >
                    <span className="truncate font-medium">{h.query}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {MODE_SHORT[h.mode]} · {h.result_count} resultado{h.result_count === 1 ? "" : "s"} · {formatRelative(h.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar histórico de pesquisas?</DialogTitle>
            <DialogDescription>As pesquisas registradas para o seu usuário neste workspace serão removidas. Os documentos não são afetados.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              loading={clearHistory.isPending}
              onClick={() => clearHistory.mutate(undefined, { onSuccess: () => setConfirmClear(false) })}
            >
              Limpar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
