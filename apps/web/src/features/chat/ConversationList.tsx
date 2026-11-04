import * as React from "react";
import { NavLink } from "react-router";
import { MessageSquarePlus, MessageSquareText, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import { cn, formatRelative } from "@/lib/utils";
import type { ConversationSummary } from "@/types/api";
import { useConversations, useDeleteConversation, useUpdateConversation } from "./hooks";

interface Props {
  activeId?: string;
  onNew: () => void;
  creating?: boolean;
  onDeleted?: (id: string) => void;
  className?: string;
}

export type ConversationGroupKey = "today" | "yesterday" | "week" | "older";

export const GROUP_LABELS: Record<ConversationGroupKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  week: "Esta semana",
  older: "Anteriores",
};

/** Agrupa por data de atualização, preservando a ordem recebida (mais recentes primeiro). */
export function groupConversations(
  items: ConversationSummary[],
  now: Date = new Date(),
): Array<{ key: ConversationGroupKey; items: ConversationSummary[] }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: Record<ConversationGroupKey, ConversationSummary[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const c of items) {
    const t = new Date(c.updated_at).getTime();
    if (Number.isNaN(t) || t < startOfToday - 6 * day) buckets.older.push(c);
    else if (t >= startOfToday) buckets.today.push(c);
    else if (t >= startOfToday - day) buckets.yesterday.push(c);
    else buckets.week.push(c);
  }
  return (Object.keys(buckets) as ConversationGroupKey[])
    .map((key) => ({ key, items: buckets[key] }))
    .filter((g) => g.items.length > 0);
}

export function ConversationList({ activeId, onNew, creating, onDeleted, className }: Props) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data, isPending, isError } = useConversations(debounced);
  const remove = useDeleteConversation();
  const update = useUpdateConversation();
  const { toast } = useToast();
  const [toDelete, setToDelete] = React.useState<ConversationSummary | null>(null);
  const [toRename, setToRename] = React.useState<ConversationSummary | null>(null);
  const [title, setTitle] = React.useState("");

  const confirmDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    try {
      await remove.mutateAsync(id);
      setToDelete(null);
      onDeleted?.(id);
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível excluir", description: errorMessage(e) });
    }
  };

  const openRename = (c: ConversationSummary) => {
    setTitle(c.title);
    setToRename(c);
  };

  const confirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toRename) return;
    const next = title.trim();
    if (!next) return;
    try {
      await update.mutateAsync({ id: toRename.id, title: next });
      setToRename(null);
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível renomear", description: errorMessage(err) });
    }
  };

  const groups = React.useMemo(() => groupConversations(data ?? []), [data]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 p-3 pb-2">
        <h2 className="text-sm font-semibold">Conversas</h2>
        <Button size="sm" variant="gradient" onClick={onNew} loading={creating} aria-label="Nova conversa">
          <MessageSquarePlus /> Nova
        </Button>
      </div>
      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar conversa…"
          aria-label="Buscar conversas por título"
          className="h-8 pl-8 text-xs"
        />
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
        ) : groups.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <MessageSquareText className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">{debounced ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={GROUP_LABELS[g.key]} className="mb-2">
              <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[g.key]}
              </h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => (
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Ações da conversa ${c.title || ""}`}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openRename(c)}>
                          <Pencil /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setToDelete(c)}>
                          <Trash2 /> Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            </section>
          ))
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
            <Button variant="destructive" loading={remove.isPending} onClick={() => void confirmDelete()}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toRename} onOpenChange={(o) => !o && setToRename(null)}>
        <DialogContent>
          <form onSubmit={(e) => void confirmRename(e)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Renomear conversa</DialogTitle>
              <DialogDescription>O título ajuda a reencontrar a conversa no histórico.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="conversation-title">Título</Label>
              <Input id="conversation-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setToRename(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={update.isPending} disabled={!title.trim()}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
