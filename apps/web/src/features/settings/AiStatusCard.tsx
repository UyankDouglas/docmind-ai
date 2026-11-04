import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiStatus } from "./hooks";

export function AiStatusCard({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError } = useAiStatus();

  if (isPending) return <Skeleton className="h-20 w-full" />;
  if (isError) {
    return (
      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>Status da IA indisponível</AlertTitle>
        <AlertDescription>Não foi possível consultar a configuração do provedor.</AlertDescription>
      </Alert>
    );
  }

  if (!data.configured) {
    return (
      <Alert variant="warning" data-testid="ai-unconfigured">
        <AlertTriangle />
        <AlertTitle>Geração com IA indisponível</AlertTitle>
        <AlertDescription>
          Nenhum provedor de IA está configurado neste ambiente. Uploads e extração continuam funcionando, mas
          embeddings, pesquisa semântica e respostas no chat exigem uma chave de API configurada no servidor.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="info">
      <Sparkles />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        IA configurada
        <Badge variant="purple">{data.llm_provider}</Badge>
        {!compact ? (
          <>
            <Badge variant="muted">LLM: {data.llm_model}</Badge>
            <Badge variant="muted">Embeddings: {data.embedding_model}</Badge>
          </>
        ) : null}
      </AlertTitle>
      <AlertDescription>
        {data.external_processing ? (
          <p className="flex items-start gap-1.5">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>{data.notice}</span>
          </p>
        ) : (
          <p>{data.notice}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
