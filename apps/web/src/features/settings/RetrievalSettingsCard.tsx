import * as React from "react";
import { Lock, Save, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/services/api";
import { RETRIEVAL_LIMITS, type RetrievalMode, type RetrievalSettings, type WorkspaceSettings } from "@/types/api";
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from "./hooks";

export interface RetrievalFormValues {
  mode: RetrievalMode;
  top_k: string;
  min_similarity: string;
  max_context_tokens: string;
  rrf_k: string;
  external_ai_enabled: boolean;
}

export function toFormValues(s: WorkspaceSettings): RetrievalFormValues {
  return {
    mode: s.retrieval.mode,
    top_k: String(s.retrieval.top_k),
    min_similarity: String(s.retrieval.min_similarity),
    max_context_tokens: String(s.retrieval.max_context_tokens),
    rrf_k: String(s.retrieval.rrf_k),
    external_ai_enabled: s.external_ai_enabled,
  };
}

/** Valida os campos conforme os limites do contrato; devolve erros por campo em pt-BR. */
export function validateRetrievalForm(v: RetrievalFormValues): Partial<Record<keyof RetrievalFormValues, string>> {
  const errors: Partial<Record<keyof RetrievalFormValues, string>> = {};
  const check = (key: "top_k" | "max_context_tokens" | "rrf_k", integer = true) => {
    const n = Number(v[key]);
    const { min, max } = RETRIEVAL_LIMITS[key];
    if (v[key].trim() === "" || Number.isNaN(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
      errors[key] = `Informe um inteiro entre ${min} e ${max}.`;
    }
  };
  check("top_k");
  check("max_context_tokens");
  check("rrf_k");
  const sim = Number(v.min_similarity.replace(",", "."));
  if (v.min_similarity.trim() === "" || Number.isNaN(sim) || sim < 0 || sim > 1) {
    errors.min_similarity = "Informe um valor entre 0 e 1.";
  }
  return errors;
}

export function toPatch(v: RetrievalFormValues, current: WorkspaceSettings) {
  const retrieval: Partial<RetrievalSettings> = {};
  if (v.mode !== current.retrieval.mode) retrieval.mode = v.mode;
  if (Number(v.top_k) !== current.retrieval.top_k) retrieval.top_k = Number(v.top_k);
  const sim = Number(v.min_similarity.replace(",", "."));
  if (sim !== current.retrieval.min_similarity) retrieval.min_similarity = sim;
  if (Number(v.max_context_tokens) !== current.retrieval.max_context_tokens) retrieval.max_context_tokens = Number(v.max_context_tokens);
  if (Number(v.rrf_k) !== current.retrieval.rrf_k) retrieval.rrf_k = Number(v.rrf_k);
  const patch: { external_ai_enabled?: boolean; retrieval?: Partial<RetrievalSettings> } = {};
  if (v.external_ai_enabled !== current.external_ai_enabled) patch.external_ai_enabled = v.external_ai_enabled;
  if (Object.keys(retrieval).length > 0) patch.retrieval = retrieval;
  return patch;
}

export function RetrievalSettingsCard({ isAdmin, privacyNotice }: { isAdmin: boolean; privacyNotice?: string }) {
  const settings = useWorkspaceSettings();
  const update = useUpdateWorkspaceSettings();
  const { toast } = useToast();
  const [values, setValues] = React.useState<RetrievalFormValues | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<keyof RetrievalFormValues, string>>>({});

  const current = settings.data;
  const form = values ?? (current ? toFormValues(current) : null);

  if (settings.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.isError || !current || !form) {
    return <p className="text-sm text-muted-foreground">Não foi possível carregar as configurações de recuperação.</p>;
  }

  const set = <K extends keyof RetrievalFormValues>(key: K, value: RetrievalFormValues[K]) => {
    setValues({ ...form, [key]: value });
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(toFormValues(current));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateRetrievalForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const patch = toPatch(form, current);
    if (Object.keys(patch).length === 0) return;
    try {
      const saved = await update.mutateAsync(patch);
      setValues(toFormValues(saved));
      toast({ kind: "success", title: "Configurações salvas" });
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível salvar", description: errorMessage(err) });
    }
  };

  const ro = !isAdmin;

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Configurações de recuperação" noValidate>
      {ro ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden /> Somente administradores podem alterar estas configurações.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="retrieval-mode">Modo de busca</Label>
          <Select value={form.mode} onValueChange={(v) => set("mode", v as RetrievalMode)} disabled={ro}>
            <SelectTrigger id="retrieval-mode" aria-label="Modo de busca">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">Híbrida (vetorial + léxica, fusão RRF)</SelectItem>
              <SelectItem value="vector">Vetorial (somente embeddings)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Field id="top_k" label={`Trechos recuperados (top_k, ${RETRIEVAL_LIMITS.top_k.min}–${RETRIEVAL_LIMITS.top_k.max})`} value={form.top_k} onChange={(v) => set("top_k", v)} error={errors.top_k} disabled={ro} min={RETRIEVAL_LIMITS.top_k.min} max={RETRIEVAL_LIMITS.top_k.max} />
        <Field id="min_similarity" label="Limiar de similaridade (0–1)" value={form.min_similarity} onChange={(v) => set("min_similarity", v)} error={errors.min_similarity} disabled={ro} min={0} max={1} step={0.01} />
        <Field id="max_context_tokens" label={`Tokens de contexto (${RETRIEVAL_LIMITS.max_context_tokens.min}–${RETRIEVAL_LIMITS.max_context_tokens.max})`} value={form.max_context_tokens} onChange={(v) => set("max_context_tokens", v)} error={errors.max_context_tokens} disabled={ro} min={RETRIEVAL_LIMITS.max_context_tokens.min} max={RETRIEVAL_LIMITS.max_context_tokens.max} step={100} />
        <Field id="rrf_k" label="Constante RRF (k)" value={form.rrf_k} onChange={(v) => set("rrf_k", v)} error={errors.rrf_k} disabled={ro} min={RETRIEVAL_LIMITS.rrf_k.min} max={RETRIEVAL_LIMITS.rrf_k.max} />
      </div>

      <div className="rounded-lg border border-border p-3">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={form.external_ai_enabled}
            onCheckedChange={(c) => set("external_ai_enabled", c === true)}
            disabled={ro}
            aria-label="Permitir processamento por provedor externo de IA"
          />
          <span>
            <span className="block font-medium">Permitir processamento por provedor externo de IA</span>
            <span className="block text-xs text-muted-foreground">
              {privacyNotice ??
                "Ao fazer perguntas, trechos relevantes dos documentos (não os arquivos inteiros) são enviados ao provedor configurado. Desative para bloquear a geração externa neste workspace."}
            </span>
          </span>
        </label>
        {!form.external_ai_enabled ? (
          <Alert variant="warning" className="mt-3">
            <ShieldAlert />
            <AlertDescription>Com o processamento externo desativado, o chat informará que a geração está indisponível; a pesquisa continua funcionando.</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {!ro ? (
        <div className="flex items-center gap-2">
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            <Save /> Salvar
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => { setValues(null); setErrors({}); }}>
              Descartar
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
