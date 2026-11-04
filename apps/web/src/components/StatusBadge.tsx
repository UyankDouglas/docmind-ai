import { AlertCircle, Ban, CheckCircle2, Loader2 } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { isProcessingStatus, type DocumentStatus } from "@/types/api";
import { cn } from "@/lib/utils";

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: "Enviado",
  validating: "Validando",
  extracting: "Extraindo texto",
  chunking: "Dividindo em trechos",
  embedding: "Gerando embeddings",
  indexing: "Indexando",
  ready: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const VARIANTS: Record<DocumentStatus, NonNullable<BadgeProps["variant"]>> = {
  uploaded: "muted",
  validating: "info",
  extracting: "info",
  chunking: "info",
  embedding: "purple",
  indexing: "purple",
  ready: "success",
  failed: "destructive",
  cancelled: "muted",
};

export function StatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const processing = isProcessingStatus(status);
  return (
    <Badge variant={VARIANTS[status]} className={cn("font-medium", className)} data-status={status}>
      {processing ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : status === "ready" ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : status === "failed" ? (
        <AlertCircle className="size-3" aria-hidden />
      ) : (
        <Ban className="size-3" aria-hidden />
      )}
      {STATUS_LABELS[status]}
    </Badge>
  );
}
