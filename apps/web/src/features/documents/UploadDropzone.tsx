import * as React from "react";
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { errorMessage } from "@/services/api";
import { useUploadDocument } from "./hooks";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf"];

interface QueueItem {
  id: number;
  file: File;
  state: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export function validateFile(file: File): string | null {
  const isPdf = ACCEPTED_TYPES.includes(file.type) || /\.pdf$/i.test(file.name);
  if (!isPdf) return "Apenas arquivos PDF são aceitos nesta fase.";
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > MAX_UPLOAD_BYTES) return `O arquivo excede o limite de ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  return null;
}

let seq = 0;

export function UploadDropzone({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [dragging, setDragging] = React.useState(false);
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const upload = useUploadDocument();

  const processFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const items: QueueItem[] = list.map((file) => {
        const err = validateFile(file);
        return { id: ++seq, file, state: err ? "error" : "pending", error: err ?? undefined };
      });
      setQueue((q) => [...items, ...q].slice(0, 20));

      for (const item of items) {
        if (item.state === "error") continue;
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, state: "uploading" } : x)));
        try {
          await upload.mutateAsync(item.file);
          setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, state: "done" } : x)));
        } catch (e) {
          setQueue((q) =>
            q.map((x) => (x.id === item.id ? { ...x, state: "error", error: errorMessage(e, "Falha no envio.") } : x)),
          );
        }
      }
    },
    [upload],
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

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Área de envio de documentos. Arraste um PDF ou pressione Enter para selecionar."
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
        <p className="text-sm font-medium">
          {dragging ? "Solte para enviar" : "Arraste PDFs aqui ou clique para selecionar"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF com texto · até {formatBytes(MAX_UPLOAD_BYTES)} por arquivo. Os limites também são validados pelo servidor.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          data-testid="upload-input"
          onChange={(e) => {
            if (e.target.files?.length) void processFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 ? (
        <ul className="mt-3 space-y-1.5" aria-label="Fila de envio">
          {queue.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              {item.state === "uploading" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-label="Enviando" />
              ) : item.state === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Enviado" />
              ) : item.state === "error" ? (
                <XCircle className="size-4 shrink-0 text-destructive" aria-label="Erro" />
              ) : (
                <FileUp className="size-4 shrink-0 text-muted-foreground" aria-label="Aguardando" />
              )}
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.file.size)}</span>
              {item.error ? <span className="shrink-0 text-xs text-destructive">{item.error}</span> : null}
            </li>
          ))}
          <li className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setQueue([])}>
              Limpar lista
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
