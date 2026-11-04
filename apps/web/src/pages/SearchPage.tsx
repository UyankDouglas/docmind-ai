import * as React from "react";
import { Link, useSearchParams } from "react-router";
import { Search, SearchX } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/Skeletons";
import { EMPTY_SCOPE, ScopePicker, type Scope } from "@/features/documents/ScopePicker";
import { documentKind, KIND_ICONS, locationLabel, viewerHref } from "@/lib/documents";
import { useSemanticSearch } from "@/features/search/hooks";
import type { SearchInput } from "@/features/search/api";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = React.useState(q);
  const [lastQ, setLastQ] = React.useState(q);
  // sincroniza o campo quando a URL muda (ex.: busca pela topbar)
  if (lastQ !== q) {
    setLastQ(q);
    setText(q);
  }
  const [scope, setScope] = React.useState<Scope>(EMPTY_SCOPE);
  const [submitted, setSubmitted] = React.useState<Scope>(EMPTY_SCOPE);

  const input = React.useMemo<SearchInput | null>(
    () =>
      q
        ? {
            query: q,
            document_ids: submitted.document_ids.length ? submitted.document_ids : undefined,
            collection_ids: submitted.collection_ids.length ? submitted.collection_ids : undefined,
            top_k: 10,
          }
        : null,
    [q, submitted],
  );

  const { data, isFetching, isError, error, refetch } = useSemanticSearch(input);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = text.trim();
    if (!next) return;
    setSubmitted(scope);
    setParams({ q: next }, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Pesquisa semântica"
        description="Encontre trechos por significado, sem geração de resposta por IA. Os resultados mostram documento, localização (página ou seção) e similaridade."
      />
      <form onSubmit={submit} className="mb-6 flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex.: prazo de cancelamento, multa por atraso, confidencialidade…"
            aria-label="Consulta"
            className="h-10 pl-9"
          />
        </div>
        <ScopePicker value={scope} onChange={setScope} className="h-10 sm:w-72" />
        <Button type="submit" variant="gradient" className="h-10" loading={isFetching} disabled={!text.trim()}>
          Pesquisar
        </Button>
      </form>

      {!input ? (
        <EmptyState icon={Search} title="Digite uma consulta" description="A busca compara o significado da sua pergunta com os trechos indexados." />
      ) : isFetching && !data ? (
        <TableSkeleton rows={4} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data && data.results.length === 0 ? (
        <EmptyState icon={SearchX} title="Nenhum trecho relevante" description="Tente reformular a consulta ou ampliar a seleção de documentos." />
      ) : data ? (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            {data.results.length} resultado{data.results.length === 1 ? "" : "s"} · {data.latency_ms} ms · modelo {data.embedding_model}
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
                    <Badge variant="purple">{(r.score * 100).toFixed(0)}% similar</Badge>
                    <Link to={href} className="inline-flex items-center gap-1 font-medium hover:underline">
                      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                      {r.document_name}
                    </Link>
                    <span className="text-muted-foreground">· {locationLabel(r)}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground/90 line-clamp-5 whitespace-pre-wrap">{r.text}</p>
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
  );
}
