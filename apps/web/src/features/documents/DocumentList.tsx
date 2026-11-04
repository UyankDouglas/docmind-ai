import * as React from "react";
import { FolderOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/Skeletons";
import { STATUS_LABELS } from "@/components/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import type { DocumentItem, DocumentStatus } from "@/types/api";
import { DocumentRow } from "./DocumentRow";
import { useDeleteDocument, useDocuments, useReprocessDocument } from "./hooks";

const STATUS_OPTIONS: Array<{ value: DocumentStatus | "all"; label: string }> = [
  { value: "all", label: "Todos os status" },
  ...(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DocumentList({ canManage, onUploadClick }: { canManage: boolean; onUploadClick?: () => void }) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<DocumentStatus | "all">("all");
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const debouncedQ = useDebounced(q);
  const { toast } = useToast();

  const params = React.useMemo(
    () => ({ q: debouncedQ || undefined, status: status === "all" ? undefined : status, page, page_size: pageSize }),
    [debouncedQ, status, page],
  );
  const { data, isPending, isError, error, refetch, isFetching } = useDocuments(params);

  const remove = useDeleteDocument();
  const reprocess = useReprocessDocument();
  const [toDelete, setToDelete] = React.useState<DocumentItem | null>(null);

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast({ kind: "success", title: "Documento excluído", description: toDelete.name });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível excluir", description: errorMessage(e) });
    } finally {
      setToDelete(null);
    }
  };

  const handleReprocess = async (doc: DocumentItem) => {
    try {
      await reprocess.mutateAsync(doc.id);
      toast({ kind: "info", title: "Reprocessamento iniciado", description: doc.name });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível reprocessar", description: errorMessage(e) });
    }
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!debouncedQ || status !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nome…"
            aria-label="Buscar documentos por nome"
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as DocumentStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-56" aria-label="Filtrar por status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : FolderOpen}
          title={hasFilters ? "Nenhum documento corresponde aos filtros" : "Nenhum documento ainda"}
          description={
            hasFilters
              ? "Tente outro termo ou limpe os filtros."
              : "Envie seu primeiro PDF para começar a indexar e fazer perguntas."
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                Limpar filtros
              </Button>
            ) : onUploadClick ? (
              <Button variant="gradient" onClick={onUploadClick}>
                Enviar documento
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Lista de documentos</caption>
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Documento</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Responsável</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Enviado</th>
                <th scope="col" className="px-2 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
              {data.items.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} canManage={canManage} onDelete={setToDelete} onReprocess={handleReprocess} />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span>
              {total} documento{total === 1 ? "" : "s"}
            </span>
            {pages > 1 ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span>
                  {page} / {pages}
                </span>
                <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir documento?</DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">{toDelete?.name}</strong> será removido junto com seus trechos e
              embeddings. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => void confirmDelete()}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
