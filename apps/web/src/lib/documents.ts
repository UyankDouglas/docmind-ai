import { FileText, FileType2, type LucideIcon, ScrollText } from "lucide-react";
import { MIME_DOCX, MIME_PDF, MIME_TXT, type LocationType } from "@/types/api";

export type DocumentKind = "pdf" | "docx" | "txt" | "other";

export function documentKind(mime: string | null | undefined): DocumentKind {
  switch (mime) {
    case MIME_PDF:
      return "pdf";
    case MIME_DOCX:
      return "docx";
    case MIME_TXT:
      return "txt";
    default:
      return "other";
  }
}

export const KIND_LABELS: Record<DocumentKind, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  other: "Arquivo",
};

export const KIND_ICONS: Record<DocumentKind, LucideIcon> = {
  pdf: FileText,
  docx: FileType2,
  txt: ScrollText,
  other: FileText,
};

export const KIND_TONES: Record<DocumentKind, string> = {
  pdf: "bg-primary/10 text-primary",
  docx: "bg-info/10 text-info",
  txt: "bg-cyan/10 text-cyan",
  other: "bg-muted text-muted-foreground",
};

export const MIME_FILTER_OPTIONS: Array<{ value: SupportedMimeFilter; label: string }> = [
  { value: "all", label: "Todos os tipos" },
  { value: MIME_PDF, label: "PDF" },
  { value: MIME_DOCX, label: "DOCX" },
  { value: MIME_TXT, label: "TXT" },
];
export type SupportedMimeFilter = "all" | typeof MIME_PDF | typeof MIME_DOCX | typeof MIME_TXT;

export function isPdf(mime: string | null | undefined): boolean {
  return mime === MIME_PDF;
}

interface Locatable {
  location_type?: LocationType | null;
  location_label?: string | null;
  page_start: number | null;
  page_end: number | null;
  section_title?: string | null;
  position?: number;
}

/**
 * Rótulo de localização a exibir. Usa `location_label` do backend; quando ausente, monta um
 * rótulo coerente com `location_type` sem nunca escrever "Página" para seções.
 */
export function locationLabel(item: Locatable): string {
  if (item.location_label) return item.location_label;
  const type: LocationType = item.location_type ?? "page";
  if (type === "page" && item.page_start) {
    return item.page_end && item.page_end !== item.page_start
      ? `Páginas ${item.page_start}–${item.page_end}`
      : `Página ${item.page_start}`;
  }
  if (item.page_start) {
    return item.section_title ? `Seção ${item.page_start} · ${item.section_title}` : `Seção ${item.page_start}`;
  }
  if (item.section_title) return item.section_title;
  if (typeof item.position === "number") return `Trecho ${item.position + 1}`;
  return "Posição textual";
}

/** URL do visualizador adequada ao tipo do documento. */
export function viewerHref(input: {
  document_id: string | null;
  mime_type?: string | null;
  location_type?: LocationType | null;
  page_start?: number | null;
  chunk_id?: string | null;
}): string {
  if (!input.document_id) return "#";
  const params = new URLSearchParams();
  const type = input.location_type ?? (isPdf(input.mime_type) ? "page" : "section");
  if (type === "page" && input.page_start) params.set("page", String(input.page_start));
  if (input.chunk_id) params.set("chunk", input.chunk_id);
  const qs = params.toString();
  return `/documents/${input.document_id}${qs ? `?${qs}` : ""}`;
}
