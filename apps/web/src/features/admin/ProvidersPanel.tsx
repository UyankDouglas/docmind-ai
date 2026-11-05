import * as React from "react";
import { Cpu, Save, ScanText, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAiStatus, useUpdateWorkspaceSettings, useWorkspaceSettings } from "@/features/settings/hooks";
import { errorMessage } from "@/services/api";

const SERVER_DEFAULT = "__default__";

export function ProvidersPanel() {
  const settings = useWorkspaceSettings();
  const ai = useAiStatus();
  const update = useUpdateWorkspaceSettings();
  const { toast } = useToast();
  const [model, setModel] = React.useState<string | null | undefined>(undefined);
  const [ocr, setOcr] = React.useState<boolean | undefined>(undefined);
  const [external, setExternal] = React.useState<boolean | undefined>(undefined);

  if (settings.isPending || ai.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.isError || !settings.data) return <p className="text-sm text-muted-foreground">Não foi possível carregar os provedores.</p>;

  const s = settings.data;
  const currentModel = model === undefined ? s.ai.llm_model : model;
  const currentOcr = ocr ?? s.ai.ocr_enabled;
  const currentExternal = external ?? s.external_ai_enabled;
  const dirty = currentModel !== s.ai.llm_model || currentOcr !== s.ai.ocr_enabled || currentExternal !== s.external_ai_enabled;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: { external_ai_enabled?: boolean; ai?: { llm_model?: string | null; ocr_enabled?: boolean } } = {};
    if (currentExternal !== s.external_ai_enabled) patch.external_ai_enabled = currentExternal;
    const aiPatch: { llm_model?: string | null; ocr_enabled?: boolean } = {};
    if (currentModel !== s.ai.llm_model) aiPatch.llm_model = currentModel;
    if (currentOcr !== s.ai.ocr_enabled) aiPatch.ocr_enabled = currentOcr;
    if (Object.keys(aiPatch).length > 0) patch.ai = aiPatch;
    if (Object.keys(patch).length === 0) return;
    try {
      await update.mutateAsync(patch);
      setModel(undefined);
      setOcr(undefined);
      setExternal(undefined);
      toast({ kind: "success", title: "Provedores atualizados" });
    } catch (err) {
      toast({ kind: "error", title: "Não foi possível salvar", description: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6" aria-label="Provedores de IA" noValidate>
      <div>
        <h2 className="text-lg font-semibold">Provedores de IA</h2>
        <p className="text-sm text-muted-foreground">As chaves ficam somente no servidor. Aqui você escolhe o modelo entre os permitidos e controla o processamento externo e o OCR.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusItem
          label="Provedor de IA"
          value={ai.data?.configured ? (ai.data.provider_label ?? ai.data.llm_provider) : `Não configurado${ai.data?.missing_configuration?.length ? ` (${ai.data.missing_configuration.join(", ")})` : ""}`}
          tone={ai.data?.configured ? "success" : "warning"}
        />
        <StatusItem label="Modelo de respostas" value={s.ai.llm_model ?? ai.data?.llm_model_label ?? ai.data?.llm_model ?? "padrão"} />
        <StatusItem label="Modelo de embeddings" value={s.ai.embedding_model_label || s.ai.embedding_model} />
      </div>
      {ai.data?.notice ? (
        <Alert variant="info">
          <ShieldAlert />
          <AlertDescription>{ai.data.notice}</AlertDescription>
        </Alert>
      ) : null}
      {s.ai.stale_embedding_documents > 0 ? (
        <Alert variant="warning" data-testid="stale-embeddings">
          <ShieldAlert />
          <AlertDescription>
            {s.ai.stale_embedding_documents === 1
              ? "1 documento tem embeddings gerados por outro modelo e está fora da busca semântica"
              : `${s.ai.stale_embedding_documents} documentos têm embeddings gerados por outro modelo e estão fora da busca semântica`}
            {" "}até ser reindexado com {s.ai.embedding_model_label || s.ai.embedding_model}. Peça ao operador do servidor para executar
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">python -m app.rag.embeddings.reindex</code>
            (faz backup antes de substituir os vetores; nenhum documento é excluído).
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="llm-model">Modelo de linguagem</Label>
        <Select value={currentModel ?? SERVER_DEFAULT} onValueChange={(v) => setModel(v === SERVER_DEFAULT ? null : v)}>
          <SelectTrigger id="llm-model" aria-label="Modelo de linguagem" className="sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SERVER_DEFAULT}>Padrão do servidor{ai.data?.llm_model ? ` (${ai.data.llm_model})` : ""}</SelectItem>
            {s.ai.allowed_llm_models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {s.ai.allowed_llm_models.length === 0 ? "O servidor não liberou modelos alternativos (LLM_ALLOWED_MODELS)." : "Somente modelos liberados pelo administrador do servidor aparecem aqui. Trocar o modelo de embeddings exige reindexação e não é feito por aqui."}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={currentExternal} onCheckedChange={(c) => setExternal(c === true)} aria-label="Permitir processamento por provedor externo de IA" />
          <span>
            <span className="block font-medium">Permitir processamento por provedor externo de IA</span>
            <span className="block text-xs text-muted-foreground">Trechos relevantes (não os arquivos inteiros) são enviados ao provedor configurado para gerar respostas e análises.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={currentOcr} onCheckedChange={(c) => setOcr(c === true)} disabled={!s.ai.ocr_available} aria-label="Ativar OCR para PDFs digitalizados" />
          <span>
            <span className="flex items-center gap-2 font-medium">
              <ScanText className="size-4 text-primary" aria-hidden /> OCR para PDFs digitalizados
              {!s.ai.ocr_available ? <Badge variant="muted">indisponível no servidor</Badge> : null}
            </span>
            <span className="block text-xs text-muted-foreground">
              {s.ai.ocr_available
                ? "Páginas sem camada de texto são reconhecidas por OCR local durante a extração. O texto reconhecido pode conter erros; as citações indicam quando a página veio de OCR."
                : "O servidor foi iniciado sem o mecanismo de OCR (imagem sem Tesseract ou OCR_ENABLED=false). Veja docs/ocr-evaluation.md para a avaliação técnica e como habilitar."}
            </span>
          </span>
        </label>
      </div>

      <Button type="submit" loading={update.isPending} disabled={!dirty}>
        <Save /> Salvar
      </Button>
    </form>
  );
}

function StatusItem({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Cpu className="size-3.5" aria-hidden /> {label}
      </p>
      <p className="mt-1 text-sm font-medium">
        {tone ? <Badge variant={tone}>{value}</Badge> : value}
      </p>
    </div>
  );
}
