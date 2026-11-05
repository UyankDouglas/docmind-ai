import { formatBytes } from "@/lib/utils";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_CONCURRENT_UPLOADS = 3;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;
export const ACCEPT_ATTR = "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,text/plain,.txt";

export function fileExtension(name: string): string {
  const m = /\.[^.]+$/.exec(name);
  return m ? m[0].toLowerCase() : "";
}

/** Limite de upload em bytes informado pelo servidor (`/usage`), com o padrão como reserva. */
export function maxUploadBytes(maxUploadMb: number | null | undefined): number {
  return maxUploadMb && maxUploadMb > 0 ? maxUploadMb * 1024 * 1024 : MAX_UPLOAD_BYTES;
}

export function validateFile(file: File, maxBytes: number = MAX_UPLOAD_BYTES): string | null {
  const ext = fileExtension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return "Formato não suportado. Envie PDF, DOCX ou TXT.";
  }
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > maxBytes) return `O arquivo excede o limite de ${formatBytes(maxBytes)}.`;
  return null;
}

/**
 * Executa `worker` para cada item com no máximo `limit` execuções simultâneas,
 * preservando a ordem de início. Erros individuais não interrompem os demais.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      try {
        await worker(next.item, next.index);
      } catch {
        // o chamador registra o erro por item
      }
    }
  });
  await Promise.all(runners);
}
