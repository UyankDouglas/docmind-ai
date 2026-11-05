import * as React from "react";
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagsEditor } from "@/components/TagsEditor";
import { useCollections } from "@/features/collections/hooks";
import { cn, formatBytes } from "@/lib/utils";
import { documentKind, KIND_ICONS } from "@/lib/documents";
import { errorMessage } from "@/services/api";
import { useDocumentTags, useUploadDocument } from "./hooks";
import { useUsage } from "@/features/settings/hooks";
import { ACCEPT_ATTR, MAX_CONCURRENT_UPLOADS, maxUploadBytes, runWithConcurrency, validateFile } from "./uploadQueue";

export { MAX_UPLOAD_BYTES, validateFile } from "./uploadQueue";

export type QueueState = "pending" | "uploading" | "done" | "error";

export interface QueueItem {
  id: number;
  file: File;
  state: QueueState;
  error?: string;
}

const STATE_LABELS: Record<QueueState, string> = {
  pending: "Aguardando",
  uploading: "Enviando",
  done: "Enviado",
  error: "Erro",
};

let seq = 0;

interface Props {
  className?: string;
  compact?: boolean;
  /** coleção pré-selecionada; quem renderiza usa `key` para reiniciar ao trocar de coleção */
  defaultCollectionId?: string | null;
  /** oculta os campos de coleção/tags (ex.: dashboard) */
  hideOptions?: boolean;
}

export function UploadDropzone({ className, compact = false, defaultCollectionId = null, hideOptions = false }: Props) {
  const [dragging, setDragging] = React.useState(false);
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [collectionId, setCollectionId] = React.useState<string>(defaultCollectionId ?? "none");
  const [tags, setTags] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const upload = useUploadDocument();
  const collections = useCollections();
  const knownTags = useDocumentTags();
  // O limite vem do servidor (MAX_UPLOAD_MB); a demonstração pública usa um valor menor que o padrão.
  const usage = useUsage();
  const maxBytes = maxUploadBytes(usage.data?.limits?.max_upload_mb);

  const patch = (id: number, data: Partial<QueueItem>) =>
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...data } : x)));

  const processFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const items: QueueItem[] = Array.from(files).map((file) => {
        const err = validateFile(file, maxBytes);
        return { id: ++seq, file, state: err ? "error" : "pending", error: err ?? undefined };
      });
      setQueue((q) => [...items, ...q].slice(0, 50));
      const options = { collection_id: collectionId === "none" ? null : collectionId, tags };
      const valid = items.filter((i) => i.state === "pending");
      await runWithConcurrency(valid, MAX_CONCURRENT_UPLOADS, async (item) => {
        patch(item.id, { state: "uploading" });
        try {
          await upload.mutateAsync({ file: item.file, options });
          patch(item.id, { state: "done" });
        } catch (e) {
          patch(item.id, { state: "error", error: errorMessage(e, "Falha no envio.") });
        }
      });
    },
    [upload, collectionId, tags, maxBytes],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void processFiles(e.dataTransfer.files);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const uploadingCount = queue.filter((q) => q.state === "uploading").length;

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Área de envio de documentos. Arraste arquivos PDF, DOCX ou TXT ou pressione Enter para selecionar."
        onClick={() => inputRef.current?.click()}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors focus-visible:outline-2 focus-visible:outline-ring",
          compact ? "px-4 py-6" : "px-6 py-10",
          dragging ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50 hover:bg-accent/40",
        )}
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {dragging ? <FileUp className="size-6" aria-hidden /> : <UploadCloud className="size-6" aria-hidden />}
        </div>
        <p className="text-sm font-medium">{dragging ? "Solte para enviar" : "Arraste arquivos aqui ou clique para selecionar"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, DOCX ou TXT · até {formatBytes(maxBytes)} por arquivo · até {MAX_CONCURRENT_UPLOADS} envios simultâneos.
          Os limites também são validados pelo servidor.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="sr-only"
          data-testid="upload-input"
          onChange={(e) => {
            if (e.target.files?.length) void processFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {!hideOptions ? (
        <div className="mt-3 grid gap-3 rounded-xl border border-border bg-card/60 p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="upload-collection">Coleção do lote (opcional)</Label>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger id="upload-collection" aria-label="Coleção para os próximos envios">
                <SelectValue placeholder="Sem coleção" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem coleção</SelectItem>
                {(collections.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upload-tags">Tags do lote (opcional)</Label>
            <TagsEditor id="upload-tags" value={tags} onChange={setTags} suggestions={(knownTags.data ?? []).map((t) => t.tag)} aria-label="Tags para os próximos envios" />
          </div>
        </div>
      ) : null}

      {queue.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label="Fila de envio" data-testid="upload-queue">
          {queue.map((item) => {
            const Icon = KIND_ICONS[documentKind(item.file.type) === "other" ? "other" : documentKind(item.file.type)];
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm" data-state={item.state}>
                {item.state === "uploading" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-label={STATE_LABELS.uploading} />
                ) : item.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-label={STATE_LABELS.done} />
                ) : item.state === "error" ? (
                  <XCircle className="size-4 shrink-0 text-destructive" aria-label={STATE_LABELS.error} />
                ) : (
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={STATE_LABELS.pending} />
                )}
                <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.file.size)}</span>
                <span className="sr-only">{STATE_LABELS[item.state]}</span>
                {item.error ? <span className="shrink-0 text-xs text-destructive">{item.error}</span> : null}
              </li>
            );
          })}
          <li className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{uploadingCount > 0 ? `${uploadingCount} em envio…` : ""}</span>
            <Button variant="ghost" size="sm" onClick={() => setQueue((q) => q.filter((i) => i.state === "uploading"))} disabled={uploadingCount === queue.length}>
              Limpar lista
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
