import * as React from "react";
import { ChevronDown, ChevronRight, Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ErrorState } from "@/components/ErrorState";
import { filenameFromDisposition, triggerDownload } from "@/features/analyses/export";
import { useMembers } from "@/features/settings/hooks";
import { errorMessage } from "@/services/api";
import { formatDateTime } from "@/lib/utils";
import type { AuditEntry } from "@/types/api";
import { adminApi, type AuditExportFormat, type AuditFilters } from "./api";
import { useAudit } from "./hooks";

const ALL = "__all__";
const PAGE_SIZE = 25;

/** Ações conhecidas (o backend pode registrar outras; o filtro aceita texto livre). */
export const KNOWN_ACTIONS = [
  "user.register",
  "user.login",
  "user.login_failed",
  "user.logout",
  "document.upload",
  "document.update",
  "document.reprocess",
  "document.cancel",
  "document.delete",
  "collection.create",
  "collection.update",
  "collection.delete",
  "conversation.ask",
  "conversation.delete",
  "analysis.summary",
  "analysis.comparison",
  "analysis.topics",
  "analysis.questions",
  "workspace.settings",
];

export function AuditPanel() {
  const [action, setAction] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState<AuditExportFormat | null>(null);
  const members = useMembers();
  const { toast } = useToast();

  const filters: AuditFilters = React.useMemo(
    () => ({
      action: action.trim() || undefined,
      user_id: userId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    [action, userId, from, to, page],
  );
  const audit = useAudit(filters);
  const total = audit.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onExport = async (format: AuditExportFormat) => {
    setExporting(format);
    try {
      const res = await adminApi.auditExportRaw(format, { action: filters.action, user_id: filters.user_id, from: filters.from, to: filters.to });
      const blob = await res.blob();
      triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition"), `auditoria.${format}`));
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível exportar", description: errorMessage(e) });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Auditoria</h2>
          <p className="text-sm text-muted-foreground">Ações registradas no workspace (sem conteúdo de documentos ou perguntas).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void onExport("csv")} loading={exporting === "csv"}>
            <Download /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onExport("json")} loading={exporting === "json"}>
            <Download /> JSON
          </Button>
        </div>
      </div>

      <form
        className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4"
        aria-label="Filtros de auditoria"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="audit-action">Ação</Label>
          <Input id="audit-action" list="audit-actions" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="ex.: document.upload" />
          <datalist id="audit-actions">
            {KNOWN_ACTIONS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-user">Usuário</Label>
          <Select value={userId || ALL} onValueChange={(v) => { setUserId(v === ALL ? "" : v); setPage(1); }}>
            <SelectTrigger id="audit-user" aria-label="Usuário">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {(members.data ?? []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from">De</Label>
          <Input id="audit-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">Até</Label>
          <Input id="audit-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </form>

      {audit.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : audit.isError || !audit.data ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Registros de auditoria</caption>
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Detalhes</span></th>
                  <th scope="col" className="px-3 py-2">Quando</th>
                  <th scope="col" className="px-3 py-2">Ação</th>
                  <th scope="col" className="px-3 py-2">Usuário</th>
                  <th scope="col" className="px-3 py-2">Alvo</th>
                  <th scope="col" className="px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      <Filter className="mx-auto mb-2 size-5" aria-hidden /> Nenhum registro para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  audit.data.items.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} expanded={expanded === entry.id} onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} registro{total === 1 ? "" : "s"} · página {page} de {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AuditRow({ entry, expanded, onToggle }: { entry: AuditEntry; expanded: boolean; onToggle: () => void }) {
  const hasDetails = entry.details && Object.keys(entry.details).length > 0;
  return (
    <>
      <tr className="align-top">
        <td className="px-2 py-2">
          {hasDetails ? (
            <button type="button" onClick={onToggle} className="rounded p-0.5 hover:bg-accent" aria-expanded={expanded} aria-label={expanded ? "Ocultar detalhes" : "Mostrar detalhes"}>
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : null}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(entry.created_at)}</td>
        <td className="px-3 py-2 font-mono text-xs">{entry.action}</td>
        <td className="px-3 py-2">
          {entry.user ? (
            <>
              <span className="block">{entry.user.name}</span>
              <span className="block text-xs text-muted-foreground">{entry.user.email}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {entry.target_type ? `${entry.target_type} ${entry.target_id ? entry.target_id.slice(0, 8) + "…" : ""}` : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{entry.ip_address ?? "—"}</td>
      </tr>
      {expanded && hasDetails ? (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-4 py-2">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs" data-testid="audit-details">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
