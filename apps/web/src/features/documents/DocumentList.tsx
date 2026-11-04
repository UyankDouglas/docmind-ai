import * as React from "react";
import { ArrowDownUp, FolderOpen, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/Skeletons";
import { STATUS_LABELS } from "@/components/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { useCollections } from "@/features/collections/hooks";
import { MIME_FILTER_OPTIONS, type SupportedMimeFilter } from "@/lib/documents";
import { errorMessage } from "@/services/api";
import type { DocumentItem, DocumentStatus } from "@/types/api";
import type { DocumentPatch, DocumentSort, ListDocumentsParams } from "./api";
import { ConfirmDialog, EditTagsDialog, MoveToCollectionDialog, RenameDocumentDialog } from "./DocumentDialogs";
import { DocumentRow, type RowAction } from "./DocumentRow";
import {
  useCancelDocument,
  useDeleteDocument,
  useDocumentTags,
  useDocuments,
  useReprocessDocument,
  useUpdateDocument,
} from "./hooks";

const STATUS_OPTIONS: Array<{ value: DocumentStatus | "all"; label: string }> = [
  { value: "all", label: "Todos os status" },
  ...(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

const SORT_OPTIONS: Array<{ value: DocumentSort; label: string }> = [
  { value: "-created_at", label: "Mais recentes" },
  { value: "created_at", label: "Mais antigos" },
  { value: "name", label: "Nome (A–Z)" },
  { value: "-name", label: "Nome (Z–A)" },
  { value: "-size_bytes", label: "Maiores" },
  { value: "size_bytes", label: "Menores" },
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Props {
  canManage: boolean;
  onUploadClick?: () => void;
  /** quando definido, a lista fica restrita à coleção (rota /collections/:id) */
  collectionId?: string | null;
}

export function DocumentList({ canManage, onUploadClick, collectionId = null }: Props) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<DocumentStatus | "all">("all");
  const [mime, setMime] = React.useState<SupportedMimeFilter>("all");
  const [collection, setCollection] = React.useState<string>("all");
  const [tag, setTag] = React.useState<string>("all");
  const [sort, setSort] = React.useState<DocumentSort>("-created_at");
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const debouncedQ = useDebounced(q);
  const { toast } = useToast();
  const collections = useCollections();
  const tags = useDocumentTags();

  const effectiveCollection = collectionId ?? (collection === "all" ? undefined : collection);

  const params = React.useMemo<ListDocumentsParams>(
    () => ({
      q: debouncedQ || undefined,
      status: status === "all" ? undefined : status,
      mime_type: mime === "all" ? undefined : mime,
      collection_id: effectiveCollection,
      tag: tag === "all" ? undefined : tag,
      sort,
      page,
      page_size: pageSize,
    }),
    [debouncedQ, status, mime, effectiveCollection, tag, sort, page],
  );
  const { data, isPending, isError, error, refetch, isFetching } = useDocuments(params);

  const update = useUpdateDocument();
  const remove = useDeleteDocument();
  const reprocess = useReprocessDocument();
  const cancel = useCancelDocument();

  const [renaming, setRenaming] = React.useState<DocumentItem | null>(null);
  const [tagging, setTagging] = React.useState<DocumentItem | null>(null);
  const [moving, setMoving] = React.useState<DocumentItem | null>(null);
  const [toDelete, setToDelete] = React.useState<DocumentItem | null>(null);
  const [toCancel, setToCancel] = React.useState<DocumentItem | null>(null);

  const resetPage = () => setPage(1);

  const submitPatch = (doc: DocumentItem, successTitle: string) => async (patch: DocumentPatch) => {
    try {
      await update.mutateAsync({ id: doc.id, ...patch });
      toast({ kind: "success", title: successTitle, description: patch.name ?? doc.name });
      setRenaming(null);
      setTagging(null);
      setMoving(null);
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível salvar", description: errorMessage(e) });
    }
  };

  const handleAction = async (action: RowAction, doc: DocumentItem) => {
    switch (action) {
      case "rename":
        setRenaming(doc);
        break;
      case "tags":
        setTagging(doc);
        break;
      case "move":
        setMoving(doc);
        break;
      case "delete":
        setToDelete(doc);
        break;
      case "cancel":
        setToCancel(doc);
        break;
      case "reprocess":
        try {
          await reprocess.mutateAsync(doc.id);
          toast({ kind: "info", title: "Reprocessamento iniciado", description: doc.name });
        } catch (e) {
          toast({ kind: "error", title: "Não foi possível reprocessar", description: errorMessage(e) });
        }
        break;
    }
  };

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

  const confirmCancel = async () => {
    if (!toCancel) return;
    try {
      await cancel.mutateAsync(toCancel.id);
      toast({ kind: "info", title: "Cancelamento solicitado", description: "O processamento será interrompido na próxima etapa." });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível cancelar", description: errorMessage(e) });
    } finally {
      setToCancel(null);
    }
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!debouncedQ || status !== "all" || mime !== "all" || tag !== "all" || (!collectionId && collection !== "all");
  const clearFilters = () => {
    setQ("");
    setStatus("all");
    setMime("all");
    setTag("all");
    setCollection("all");
    resetPage();
  };
  const colorById = React.useMemo(() => new Map((collections.data ?? []).map((c) => [c.id, c.color])), [collections.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            placeholder="Buscar por nome…"
            aria-label="Buscar documentos por nome"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as DocumentStatus | "all"); resetPage(); }}>
          <SelectTrigger className="lg:w-44" aria-label="Filtrar por status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mime} onValueChange={(v) => { setMime(v as SupportedMimeFilter); resetPage(); }}>
          <SelectTrigger className="lg:w-36" aria-label="Filtrar por tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            {MIME_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!collectionId ? (
          <Select value={collection} onValueChange={(v) => { setCollection(v); resetPage(); }}>
            <SelectTrigger className="lg:w-44" aria-label="Filtrar por coleção">
              <SelectValue placeholder="Coleção" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as coleções</SelectItem>
              {(collections.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={tag} onValueChange={(v) => { setTag(v); resetPage(); }}>
          <SelectTrigger className="lg:w-40" aria-label="Filtrar por tag">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as tags</SelectItem>
            {(tags.data ?? []).map((t) => (
              <SelectItem key={t.tag} value={t.tag}>#{t.tag} ({t.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v as DocumentSort); resetPage(); }}>
          <SelectTrigger className="lg:w-40" aria-label="Ordenar por">
            <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden />
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="self-center">
            <X /> Limpar filtros
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : FolderOpen}
          title={hasFilters ? "Nenhum documento corresponde aos filtros" : collectionId ? "Esta coleção está vazia" : "Nenhum documento ainda"}
          description={
            hasFilters
              ? "Tente outro termo ou limpe os filtros."
              : collectionId
                ? "Envie documentos para esta coleção ou mova documentos existentes para cá."
                : "Envie um PDF, DOCX ou TXT para começar a indexar e fazer perguntas."
          }
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
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
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  canManage={canManage}
                  onAction={(a, d) => void handleAction(a, d)}
                  collectionColor={doc.collection_id ? (colorById.get(doc.collection_id) ?? null) : null}
                />
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

      <RenameDocumentDialog doc={renaming} onClose={() => setRenaming(null)} onSubmit={renaming ? submitPatch(renaming, "Documento renomeado") : async () => {}} pending={update.isPending} />
      <EditTagsDialog doc={tagging} onClose={() => setTagging(null)} onSubmit={tagging ? submitPatch(tagging, "Tags atualizadas") : async () => {}} pending={update.isPending} />
      <MoveToCollectionDialog doc={moving} onClose={() => setMoving(null)} onSubmit={moving ? submitPatch(moving, "Documento movido") : async () => {}} pending={update.isPending} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Excluir documento?"
        description={
          <>
            <strong className="text-foreground">{toDelete?.name}</strong> será removido junto com seus trechos e embeddings. Esta ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir"
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        title="Cancelar processamento?"
        description={
          <>
            O processamento de <strong className="text-foreground">{toCancel?.name}</strong> será interrompido de forma cooperativa na próxima etapa. Você poderá reprocessar depois.
          </>
        }
        confirmLabel="Cancelar processamento"
        pending={cancel.isPending}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}
