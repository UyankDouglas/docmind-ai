import { useNavigate } from "react-router";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useMe } from "@/features/auth/hooks";
import { errorMessage } from "@/services/api";
import { ROLE_LABELS } from "@/types/api";
import { cn } from "@/lib/utils";
import { useSwitchWorkspace, useWorkspaces } from "./hooks";

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const { data: user } = useMe();
  const workspaces = useWorkspaces();
  const switchWs = useSwitchWorkspace();
  const navigate = useNavigate();
  const { toast } = useToast();

  const current = user?.workspace;
  const items = workspaces.data ?? [];

  const onSelect = async (id: string) => {
    if (!current || id === current.id) return;
    try {
      await switchWs.mutateAsync(id);
      navigate("/", { replace: true });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível trocar de workspace", description: errorMessage(e) });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex max-w-[14rem] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
            className,
          )}
          aria-label="Trocar de workspace"
        >
          <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate font-medium">{current?.name ?? "Workspace"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.isPending ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum workspace disponível.</p>
        ) : (
          items.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => void onSelect(w.id)} aria-current={w.is_current ? "true" : undefined}>
              <span className="flex size-4 items-center justify-center">{w.is_current ? <Check className="size-4 text-primary" aria-hidden /> : null}</span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <Badge variant="muted" className="ml-auto">
                {ROLE_LABELS[w.role]}
              </Badge>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
