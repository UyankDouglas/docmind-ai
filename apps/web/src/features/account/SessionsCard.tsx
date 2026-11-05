import { LogOut, Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import { formatRelative } from "@/lib/utils";
import type { UserSessionInfo } from "@/types/api";
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "./hooks";

/** Rótulo curto e legível a partir do user-agent (sem bibliotecas). */
export function describeUserAgent(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Dispositivo desconhecido", mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : /python|curl|httpx/i.test(ua)
              ? "Cliente de API"
              : "Navegador";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

export function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const { toast } = useToast();

  if (sessions.isPending) return <Skeleton className="h-24 w-full" />;
  if (sessions.isError || !sessions.data) return <p className="text-sm text-muted-foreground">Não foi possível listar as sessões.</p>;

  const others = sessions.data.filter((s) => !s.is_current);

  const onRevoke = async (s: UserSessionInfo) => {
    try {
      await revoke.mutateAsync(s.id);
      toast({ kind: "success", title: "Sessão encerrada" });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível encerrar a sessão", description: errorMessage(e) });
    }
  };

  const onRevokeOthers = async () => {
    try {
      await revokeOthers.mutateAsync();
      toast({ kind: "success", title: "Outras sessões encerradas" });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível encerrar as sessões", description: errorMessage(e) });
    }
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Sessões ativas">
        {sessions.data.map((s) => {
          const { label, mobile } = describeUserAgent(s.user_agent);
          const Icon = mobile ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{label}</span>
                  {s.is_current ? <Badge variant="success">Esta sessão</Badge> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.ip_address ?? "IP não registrado"} · última atividade {formatRelative(s.last_seen_at)} · iniciada {formatRelative(s.created_at)}
                </span>
              </span>
              {!s.is_current ? (
                <Button variant="ghost" size="sm" onClick={() => void onRevoke(s)} disabled={revoke.isPending} aria-label={`Encerrar sessão ${label}`}>
                  <LogOut /> Encerrar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {others.length > 0 ? (
        <Button variant="outline" size="sm" onClick={() => void onRevokeOthers()} loading={revokeOthers.isPending}>
          Encerrar outras sessões ({others.length})
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma outra sessão ativa.</p>
      )}
    </div>
  );
}
