import * as pdfjs from "pdfjs-dist";

let configured = false;

/** Configura o worker do PDF.js uma única vez (bundle gerado pelo Vite). */
export function ensurePdfWorker(): typeof pdfjs {
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    configured = true;
  }
  return pdfjs;
}

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDocument> {
  const lib = ensurePdfWorker();
  // copia para evitar "detached ArrayBuffer" quando o worker toma posse do buffer
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)) });
  return task.promise;
}
