import * as React from "react";
import { NavLink } from "react-router";
import { MessageSquarePlus, MessageSquareText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatRelative } from "@/lib/utils";
import type { ConversationSummary } from "@/types/api";
import { useConversations, useDeleteConversation } from "./hooks";

interface Props {
  activeId?: string;
  onNew: () => void;
  creating?: boolean;
  onDeleted?: (id: string) => void;
  className?: string;
}

export function ConversationList({ activeId, onNew, creating, onDeleted, className }: Props) {
  const { data, isPending, isError } = useConversations();
  const remove = useDeleteConversation();
  const [toDelete, setToDelete] = React.useState<ConversationSummary | null>(null);

  const confirm = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    await remove.mutateAsync(id);
    setToDelete(null);
    onDeleted?.(id);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="text-sm font-semibold">Conversas</h2>
        <Button size="sm" variant="gradient" onClick={onNew} loading={creating} aria-label="Nova conversa">
          <MessageSquarePlus /> Nova
        </Button>
      </div>
      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isPending ? (
          <div className="space-y-2 px-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p className="px-2 text-xs text-muted-foreground">Não foi possível carregar as conversas.</p>
        ) : data.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <MessageSquareText className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {data.map((c) => (
              <li key={c.id} className="group relative">
                <NavLink
                  to={`/chat/${c.id}`}
                  className={({ isActive }) =>
                    cn(
                      "block rounded-lg px-3 py-2 pr-9 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      isActive || c.id === activeId ? "bg-primary/15 text-foreground" : "hover:bg-accent/60",
                    )
                  }
                >
                  <span className="block truncate font-medium">{c.title || "Nova conversa"}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {c.message_count} msg · {formatRelative(c.updated_at)}
                  </span>
                </NavLink>
                <button
                  type="button"
                  onClick={() => setToDelete(c)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100"
                  aria-label={`Excluir conversa ${c.title || ""}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir conversa?</DialogTitle>
            <DialogDescription>O histórico de mensagens e referências desta conversa será removido.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => void confirm()}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
