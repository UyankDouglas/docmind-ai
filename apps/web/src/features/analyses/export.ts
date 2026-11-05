import type { ExportFormat } from "@/types/api";
import { analysesApi } from "./api";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  md: "text/markdown",
  json: "application/json",
};

/** Extrai o nome do arquivo de um Content-Disposition (`attachment; filename="x"` ou `filename*=UTF-8''x`). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* ignora e tenta o formato simples */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/** Dispara o download de um Blob no navegador (link temporário + revogação da URL). */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga após o clique ter sido processado pelo navegador
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadResponse(res: Response, fallbackName: string): Promise<string> {
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("content-disposition"), fallbackName);
  triggerDownload(blob, name);
  return name;
}

export async function downloadAnalysisExport(id: string, format: ExportFormat, slug = "analise"): Promise<string> {
  const res = await analysesApi.exportRaw(id, format);
  return downloadResponse(res, `${slug}.${format}`);
}

export async function downloadConversationExport(id: string, format: ExportFormat, slug = "conversa"): Promise<string> {
  const res = await analysesApi.exportConversationRaw(id, format);
  return downloadResponse(res, `${slug}.${format}`);
}
