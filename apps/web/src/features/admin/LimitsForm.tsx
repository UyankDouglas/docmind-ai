import * as React from "react";
import { Info, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from "@/features/settings/hooks";
import { errorMessage } from "@/services/api";
import type { WorkspaceLimits } from "@/types/api";

export type LimitsFormValues = Record<keyof WorkspaceLimits, string>;

const FIELDS: Array<{ key: keyof WorkspaceLimits; label: string; hint: string; step?: number; integer: boolean }> = [
  { key: "monthly_token_budget", label: "Orçamento mensal de tokens", hint: "Soma de tokens de entrada e saída no mês. Ao atingir, perguntas, pesquisas e análises são bloqueadas.", integer: true },
  { key: "monthly_cost_budget_usd", label: "Teto de custo mensal (US$)", hint: "Só tem efeito quando o servidor tem a tabela de preços configurada (PRICE_*).", step: 0.01, integer: false },
  { key: "max_documents", label: "Máximo de documentos", hint: "Novos uploads são recusados ao atingir o total.", integer: true },
  { key: "max_storage_mb", label: "Armazenamento máximo (MB)", hint: "Tamanho somado dos arquivos originais.", integer: true },
];

export function limitsToForm(l: WorkspaceLimits): LimitsFormValues {
  return {
    monthly_token_budget: l.monthly_token_budget == null ? "" : String(l.monthly_token_budget),
    monthly_cost_budget_usd: l.monthly_cost_budget_usd == null ? "" : String(l.monthly_cost_budget_usd),
    max_documents: l.max_documents == null ? "" : String(l.max_documents),
    max_storage_mb: l.max_storage_mb == null ? "" : String(l.max_storage_mb),
  };
}

/** Campo vazio = sem limite (null). Devolve erros por campo. */
export function parseLimits(v: LimitsFormValues): { values: WorkspaceLimits; errors: Partial<Record<keyof WorkspaceLimits, string>> } {
  const errors: Partial<Record<keyof WorkspaceLimits, string>> = {};
  const values = {} as WorkspaceLimits;
  for (const f of FIELDS) {
    const raw = v[f.key].trim().replace(",", ".");
    if (raw === "") {
      values[f.key] = null;
      continue;
    }
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0 || (f.integer && !Number.isInteger(n))) {
      errors[f.key] = f.integer ? "Informe um inteiro ≥ 0 ou deixe vazio para sem limite." : "Informe um número ≥ 0 ou deixe vazio para sem limite.";
      values[f.key] = null;
      continue;
    }
    values[f.key] = n;
  }
  return { values, errors };
}

export function limitsPatch(next: WorkspaceLimits, current: WorkspaceLimits): Partial<WorkspaceLimits> {
  const patch: Partial<WorkspaceLimits> = {};
  for (const f of FIELDS) {
    if (next[f.key] !== current[f.key]) patch[f.key] = next[f.key];
  }
  return patch;
}

export function LimitsForm() {
  const settings = useWorkspaceSettings();
  const update = useUpdateWorkspaceSettings();
  const { toast } = useToast();
  const [values, setValues] = React.useState<LimitsFormValues | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<keyof WorkspaceLimits, string>>>({});

  if (settings.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.isError || !settings.data) return <p className="text-sm text-muted-foreground">Não foi possível carregar os limites.</p>;
  const current = settings.data.limits;
  const form = values ?? limitsToForm(current);
  const dirty = JSON.stringify(form) !== JSON.stringify(limitsToForm(current));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { values: parsed, errors: errs } = parseLimits(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const patch = limitsPatch(parsed, current);
    if (Object.keys(patch).length === 0) return;
    try {
      const saved = await update.mutateAsync({ limits: patch });
      setValues(limitsToForm(saved.limits));
      toast({ kind: "success", title: "Limites salvos" });
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível salvar", description: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Limites e custos" noValidate>
      <div>
        <h2 className="text-lg font-semibold">Limites e custos</h2>
        <p className="text-sm text-muted-foreground">Tetos por workspace aplicados pelo servidor. Campos vazios significam sem limite.</p>
      </div>
      <Alert variant="info">
        <Info />
        <AlertDescription>
          Custos são sempre estimativas e dependem dos preços configurados no servidor; sem preços, o teto de custo não é aplicado e a interface mostra "sem estimativa".
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`limit-${f.key}`}>{f.label}</Label>
            <Input
              id={`limit-${f.key}`}
              type="number"
              inputMode="decimal"
              min={0}
              step={f.step}
              placeholder="Sem limite"
              value={form[f.key]}
              onChange={(e) => {
                setValues({ ...form, [f.key]: e.target.value });
                setErrors((er) => ({ ...er, [f.key]: undefined }));
              }}
              aria-invalid={!!errors[f.key]}
              aria-describedby={`limit-${f.key}-hint`}
            />
            <p id={`limit-${f.key}-hint`} className="text-xs text-muted-foreground">
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
      <div className="flex items-center gap-2">
        <Button type="submit" loading={update.isPending} disabled={!dirty}>
          <Save /> Salvar limites
        </Button>
        {dirty ? (
          <Button type="button" variant="ghost" onClick={() => { setValues(null); setErrors({}); }}>
            Descartar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
