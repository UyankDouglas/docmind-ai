import * as React from "react";
import { NavLink } from "react-router";
import { FolderKanban, FolderPlus, Folders, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import { cn } from "@/lib/utils";
import type { Collection } from "@/types/api";
import { CollectionDialog } from "./CollectionDialog";
import { useCollections, useCreateCollection, useDeleteCollection, useUpdateCollection } from "./hooks";
import type { CollectionInput } from "./api";

interface Props {
  canManage: boolean;
  activeId?: string | null;
  className?: string;
}

export function CollectionColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", !color && "bg-muted-foreground/50", className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function CollectionsPanel({ canManage, activeId, className }: Props) {
  const { data, isPending, isError } = useCollections();
  const create = useCreateCollection();
  const update = useUpdateCollection();
  const remove = useDeleteCollection();
  const { toast } = useToast();

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Collection | null>(null);
  const [toDelete, setToDelete] = React.useState<Collection | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const submitCreate = async (input: CollectionInput) => {
    setFormError(null);
    try {
      await create.mutateAsync(input);
      setCreating(false);
      toast({ kind: "success", title: "Coleção criada", description: input.name });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const submitEdit = async (input: CollectionInput) => {
    if (!editing) return;
    setFormError(null);
    try {
      await update.mutateAsync({ id: editing.id, ...input });
      setEditing(null);
      toast({ kind: "success", title: "Coleção atualizada" });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast({ kind: "success", title: "Coleção excluída", description: "Os documentos foram mantidos." });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível excluir", description: errorMessage(e) });
    } finally {
      setToDelete(null);
    }
  };

  return (
    <section className={cn("rounded-xl border border-border bg-card", className)} aria-label="Coleções">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Folders className="size-4 text-primary" aria-hidden /> Coleções
        </h2>
        {canManage ? (
          <Button size="icon-sm" variant="ghost" onClick={() => setCreating(true)} aria-label="Nova coleção">
            <FolderPlus />
          </Button>
        ) : null}
      </div>
      <nav aria-label="Lista de coleções" className="p-2">
        <NavLink
          to="/documents"
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60",
              isActive && !activeId ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
            )
          }
        >
          <FolderKanban className="size-4" aria-hidden /> Todos os documentos
        </NavLink>
        {isPending ? (
          <div className="mt-1 space-y-1 px-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Não foi possível carregar as coleções.</p>
        ) : data.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Nenhuma coleção. {canManage ? "Crie uma para agrupar documentos." : ""}
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {data.map((c) => (
              <li key={c.id} className="group relative" data-testid="collection-item">
                <NavLink
                  to={`/collections/${c.id}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm hover:bg-accent/60",
                      isActive ? "bg-primary/10 font-medium text-primary" : "text-foreground",
                    )
                  }
                >
                  <CollectionColorDot color={c.color} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.document_count}</span>
                </NavLink>
                {canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label={`Ações da coleção ${c.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(c)}>
                        <Pencil /> Renomear
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setToDelete(c)}>
                        <Trash2 /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </nav>

      <CollectionDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o) setFormError(null);
        }}
        onSubmit={submitCreate}
        pending={create.isPending}
        error={formError}
      />
      <CollectionDialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setFormError(null);
          }
        }}
        collection={editing}
        onSubmit={submitEdit}
        pending={update.isPending}
        error={formError}
      />
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir coleção?</DialogTitle>
            <DialogDescription>
              A coleção <strong className="text-foreground">{toDelete?.name}</strong> será removida. Os{" "}
              {toDelete?.document_count ?? 0} documento{toDelete?.document_count === 1 ? "" : "s"} dela{" "}
              <strong className="text-foreground">não serão excluídos</strong>; apenas deixarão de pertencer à coleção.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => void confirmDelete()}>
              Excluir coleção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
