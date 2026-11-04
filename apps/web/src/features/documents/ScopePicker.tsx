import * as React from "react";
import { Check, ChevronDown, FileText, Folders, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CollectionColorDot } from "@/features/collections/CollectionsPanel";
import { useCollections } from "@/features/collections/hooks";
import { documentKind, KIND_ICONS } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { useReadyDocuments } from "./hooks";

export interface Scope {
  document_ids: string[];
  collection_ids: string[];
}

export const EMPTY_SCOPE: Scope = { document_ids: [], collection_ids: [] };

export function scopeSummary(scope: Scope, emptyLabel = "Todos os documentos prontos"): string {
  const d = scope.document_ids.length;
  const c = scope.collection_ids.length;
  if (!d && !c) return emptyLabel;
  const parts: string[] = [];
  if (d) parts.push(`${d} documento${d === 1 ? "" : "s"}`);
  if (c) parts.push(`${c} coleç${c === 1 ? "ão" : "ões"}`);
  return parts.join(" · ");
}

interface Props {
  value: Scope;
  onChange: (scope: Scope) => void;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
}

type Tab = "documents" | "collections";

/** Seletor de escopo (documentos e coleções) usado no chat e na pesquisa. */
export function ScopePicker({ value, onChange, disabled, className, emptyLabel }: Props) {
  const docs = useReadyDocuments();
  const collections = useCollections();
  const [tab, setTab] = React.useState<Tab>("documents");
  const [filter, setFilter] = React.useState("");

  const f = filter.trim().toLowerCase();
  const docList = (docs.data ?? []).filter((d) => !f || d.name.toLowerCase().includes(f));
  const colList = (collections.data ?? []).filter((c) => !f || c.name.toLowerCase().includes(f));

  const toggle = (key: keyof Scope, id: string) => {
    const set = new Set(value[key]);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ ...value, [key]: Array.from(set) });
  };

  const total = value.document_ids.length + value.collection_ids.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={cn("max-w-full justify-between gap-2", className)} aria-label="Selecionar escopo de documentos e coleções">
          <Layers className="shrink-0" />
          <span className="truncate" data-testid="scope-summary">{scopeSummary(value, emptyLabel)}</span>
          <ChevronDown className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div role="tablist" aria-label="Tipo de escopo" className="mb-2 grid grid-cols-2 rounded-md bg-muted p-0.5 text-xs">
          {(
            [
              ["documents", "Documentos", value.document_ids.length],
              ["collections", "Coleções", value.collection_ids.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn("rounded px-2 py-1.5 font-medium transition-colors", tab === key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              {count ? <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">{count}</span> : null}
            </button>
          ))}
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={tab === "documents" ? "Filtrar documentos…" : "Filtrar coleções…"}
          aria-label="Filtrar"
          className="mb-2 h-8"
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto" role="group" aria-label={tab === "documents" ? "Documentos disponíveis" : "Coleções disponíveis"}>
          {tab === "documents" ? (
            docs.isPending ? (
              <>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </>
            ) : docList.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {docs.data?.length ? "Nenhum documento corresponde ao filtro." : "Nenhum documento pronto para consulta."}
              </p>
            ) : (
              docList.map((d) => {
                const id = `scope-doc-${d.id}`;
                const Icon = KIND_ICONS[documentKind(d.mime_type)];
                return (
                  <label key={d.id} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60">
                    <Checkbox id={id} checked={value.document_ids.includes(d.id)} onCheckedChange={() => toggle("document_ids", d.id)} />
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  </label>
                );
              })
            )
          ) : collections.isPending ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : colList.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {collections.data?.length ? "Nenhuma coleção corresponde ao filtro." : "Nenhuma coleção criada."}
            </p>
          ) : (
            colList.map((c) => {
              const id = `scope-col-${c.id}`;
              return (
                <label key={c.id} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60">
                  <Checkbox id={id} checked={value.collection_ids.includes(c.id)} onCheckedChange={() => toggle("collection_ids", c.id)} />
                  <CollectionColorDot color={c.color} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.document_count} doc.</span>
                </label>
              );
            })
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_SCOPE)} disabled={total === 0}>
            Limpar
          </Button>
          {tab === "documents" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...value, document_ids: (docs.data ?? []).map((d) => d.id) })}
              disabled={!docs.data?.length || value.document_ids.length === docs.data.length}
            >
              <Check /> Todos os documentos
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Folders className="size-3" aria-hidden /> <FileText className="size-3" aria-hidden /> escopo = união
            </span>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
