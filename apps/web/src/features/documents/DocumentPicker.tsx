import * as React from "react";
import { Check, ChevronDown, FileText, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useReadyDocuments } from "./hooks";
import { cn } from "@/lib/utils";

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  /** texto quando nada está selecionado */
  emptyLabel?: string;
}

/** Multi-seleção de documentos prontos (com checkboxes), usada no chat e na pesquisa. */
export function DocumentPicker({ value, onChange, disabled, className, emptyLabel = "Todos os documentos prontos" }: Props) {
  const { data, isPending } = useReadyDocuments();
  const [filter, setFilter] = React.useState("");
  const docs = React.useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data ?? []).filter((d) => !f || d.name.toLowerCase().includes(f));
  }, [data, filter]);

  const selected = new Set(value);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const label =
    value.length === 0
      ? emptyLabel
      : value.length === 1
        ? (data?.find((d) => d.id === value[0])?.name ?? "1 documento")
        : `${value.length} documentos selecionados`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={cn("max-w-full justify-between gap-2", className)} aria-label="Selecionar documentos">
          <Files className="shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar documentos…"
          aria-label="Filtrar documentos"
          className="mb-2 h-8"
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto" role="group" aria-label="Documentos disponíveis">
          {isPending ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : docs.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {data?.length ? "Nenhum documento corresponde ao filtro." : "Nenhum documento pronto para consulta."}
            </p>
          ) : (
            docs.map((d) => {
              const id = `doc-pick-${d.id}`;
              return (
                <label
                  key={d.id}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
                >
                  <Checkbox id={id} checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {d.page_count ? <span className="text-xs text-muted-foreground">{d.page_count} p.</span> : null}
                </label>
              );
            })
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={value.length === 0}>
            Limpar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange((data ?? []).map((d) => d.id))}
            disabled={!data?.length || value.length === data.length}
          >
            <Check /> Selecionar todos
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
