import * as React from "react";
import { Play, Save, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from "@/features/settings/hooks";
import { errorMessage } from "@/services/api";
import { formatDateTime } from "@/lib/utils";
import type { RetentionRunResult, WorkspaceRetention } from "@/types/api";
import { useRunRetention } from "./hooks";

type RetentionKey = Exclude<keyof WorkspaceRetention, "last_run_at">;
export type RetentionFormValues = Record<RetentionKey, string>;

const FIELDS: Array<{ key: RetentionKey; label: string; hint: string }> = [
  { key: "conversations_days", label: "Conversas (dias)", hint: "Conversas e mensagens mais antigas que isso são excluídas." },
  { key: "analyses_days", label: "Análises (dias)", hint: "Resumos, comparações e tópicos gerados." },
  { key: "search_history_days", label: "Histórico de pesquisas (dias)", hint: "Pesquisas semânticas registradas por usuário." },
  { key: "deleted_documents_days", label: "Purga de documentos excluídos (dias)", hint: "Arquivos de documentos excluídos são apagados do armazenamento após esse prazo." },
];

export function retentionToForm(r: WorkspaceRetention): RetentionFormValues {
  return {
    conversations_days: r.conversations_days == null ? "" : String(r.conversations_days),
    analyses_days: r.analyses_days == null ? "" : String(r.analyses_days),
    search_history_days: r.search_history_days == null ? "" : String(r.search_history_days),
    deleted_documents_days: r.deleted_documents_days == null ? "" : String(r.deleted_documents_days),
  };
}

export function parseRetention(v: RetentionFormValues): { values: Record<RetentionKey, number | null>; errors: Partial<Record<RetentionKey, string>> } {
  const errors: Partial<Record<RetentionKey, string>> = {};
  const values = {} as Record<RetentionKey, number | null>;
  for (const f of FIELDS) {
    const raw = v[f.key].trim();
    if (raw === "") {
      values[f.key] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      errors[f.key] = "Informe um inteiro entre 1 e 3650 dias ou deixe vazio para não aplicar.";
      values[f.key] = null;
      continue;
    }
    values[f.key] = n;
  }
  return { values, errors };
}

export function RetentionForm() {
  const settings = useWorkspaceSettings();
  const update = useUpdateWorkspaceSettings();
  const run = useRunRetention();
  const { toast } = useToast();
  const [values, setValues] = React.useState<RetentionFormValues | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<RetentionKey, string>>>({});
  const [confirmRun, setConfirmRun] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<RetentionRunResult | null>(null);

  if (settings.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.isError || !settings.data) return <p className="text-sm text-muted-foreground">Não foi possível carregar a política de retenção.</p>;
  const current = settings.data.retention;
  const form = values ?? retentionToForm(current);
  const dirty = JSON.stringify(form) !== JSON.stringify(retentionToForm(current));
  const anyPolicy = FIELDS.some((f) => current[f.key] != null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { values: parsed, errors: errs } = parseRetention(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const patch: Partial<Record<RetentionKey, number | null>> = {};
    for (const f of FIELDS) if (parsed[f.key] !== current[f.key]) patch[f.key] = parsed[f.key];
    if (Object.keys(patch).length === 0) return;
    try {
      const saved = await update.mutateAsync({ retention: patch });
      setValues(retentionToForm(saved.retention));
      toast({ kind: "success", title: "Política de retenção salva" });
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível salvar", description: errorMessage(err) });
    }
  };

  const onRun = async () => {
    try {
      const result = await run.mutateAsync();
      setLastResult(result);
      setConfirmRun(false);
      toast({ kind: "success", title: "Retenção executada" });
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível executar", description: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Política de retenção" noValidate>
        <div>
          <h2 className="text-lg font-semibold">Retenção de dados</h2>
          <p className="text-sm text-muted-foreground">
            A política roda automaticamente uma vez por dia e pode ser executada agora. Campos vazios não aplicam limpeza. Última execução: {formatDateTime(current.last_run_at)}.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`retention-${f.key}`}>{f.label}</Label>
              <Input
                id={`retention-${f.key}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                placeholder="Não aplicar"
                value={form[f.key]}
                onChange={(e) => {
                  setValues({ ...form, [f.key]: e.target.value });
                  setErrors((er) => ({ ...er, [f.key]: undefined }));
                }}
                aria-invalid={!!errors[f.key]}
                aria-describedby={`retention-${f.key}-hint`}
              />
              <p id={`retention-${f.key}-hint`} className="text-xs text-muted-foreground">
                {f.hint}
              </p>
              {errors[f.key] ? (
                <p className="text-xs text-destructive" role="alert">
                  {errors[f.key]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            <Save /> Salvar política
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => { setValues(null); setErrors({}); }}>
              Descartar
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setConfirmRun(true)} disabled={!anyPolicy || dirty} title={dirty ? "Salve a política antes de executar" : undefined}>
            <Play /> Executar agora
          </Button>
        </div>
      </form>

      {lastResult ? (
        <Alert variant="success" data-testid="retention-result">
          <Trash2 />
          <AlertDescription>
            Removidos: {lastResult.deleted.conversations} conversa(s), {lastResult.deleted.analyses} análise(s), {lastResult.deleted.search_queries} pesquisa(s) e {lastResult.deleted.documents} documento(s) purgado(s) do armazenamento.
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar retenção agora?</DialogTitle>
            <DialogDescription>Os dados mais antigos que os prazos salvos serão excluídos permanentemente deste workspace. Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void onRun()} loading={run.isPending}>
              Executar retenção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
