import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { useDocumentVersions } from "./hooks";

export function VersionsPanel({ documentId, currentVersion }: { documentId: string; currentVersion?: number }) {
  const versions = useDocumentVersions(documentId);
  return (
    <section className="border-b border-border p-4" aria-label="Versões de indexação">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <History className="size-3.5" aria-hidden /> Versões
      </h3>
      {versions.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : versions.isError ? (
        <p className="text-xs text-muted-foreground">Não foi possível carregar as versões.</p>
      ) : versions.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma versão registrada.</p>
      ) : (
        <ol className="space-y-2" data-testid="versions-list">
          {versions.data.map((v) => (
            <li key={v.id} className="rounded-lg border border-border p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  v{v.version}
                  {v.version === currentVersion ? <span className="ml-1 text-[10px] uppercase text-primary">atual</span> : null}
                </span>
                <StatusBadge status={v.status} className="text-[10px]" />
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
                <dt>Trechos</dt>
                <dd>{v.chunk_count}</dd>
                <dt>Chunking</dt>
                <dd>{v.chunking_version}</dd>
                <dt>Embeddings</dt>
                <dd className="truncate" title={v.embedding_model ?? ""}>{v.embedding_model ?? "—"}</dd>
                <dt>Processado</dt>
                <dd>{formatDateTime(v.processed_at)}</dd>
              </dl>
              {v.error_message ? <p className="mt-1 text-destructive">{v.error_message}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
