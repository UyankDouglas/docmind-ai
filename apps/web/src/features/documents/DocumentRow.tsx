import * as React from "react";
import { Link } from "react-router";
import { Eye, FileText, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, STATUS_LABELS } from "@/components/StatusBadge";
import { formatBytes, formatRelative } from "@/lib/utils";
import { isProcessingStatus, type DocumentItem } from "@/types/api";
import { useDocumentStatus } from "./hooks";

interface Props {
  doc: DocumentItem;
  onDelete: (doc: DocumentItem) => void;
  onReprocess: (doc: DocumentItem) => void;
  canManage: boolean;
}

export const DocumentRow = React.memo(function DocumentRow({ doc, onDelete, onReprocess, canManage }: Props) {
  const { data: live } = useDocumentStatus(doc.id, doc.status);
  const status = live?.status ?? doc.status;
  const errorMessage = live?.error_message ?? doc.error_message;
  const pageCount = live?.page_count ?? doc.page_count;
  const chunkCount = live?.chunk_count ?? doc.chunk_count;
  const processing = isProcessingStatus(status);

  return (
    <tr className="group border-b border-border last:border-0 hover:bg-accent/30" data-testid="document-row">
      <td className="px-4 py-3">
        <Link to={`/documents/${doc.id}`} className="flex min-w-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-ring rounded-md">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{doc.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {formatBytes(doc.size_bytes)}
              {pageCount ? ` · ${pageCount} pág.` : ""}
              {chunkCount ? ` · ${chunkCount} trechos` : ""}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <StatusBadge status={status} />
          {processing ? <span className="text-[11px] text-muted-foreground">{STATUS_LABELS[status]}…</span> : null}
          {status === "failed" && errorMessage ? (
            <span className="max-w-[16rem] truncate text-[11px] text-destructive" title={errorMessage}>
              {errorMessage}
            </span>
          ) : null}
        </div>
      </td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">{doc.owner.name}</td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">{formatRelative(doc.created_at)}</td>
      <td className="px-2 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${doc.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/documents/${doc.id}`}>
                <Eye /> Abrir
              </Link>
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuItem disabled={processing} onSelect={() => onReprocess(doc)}>
                  <RefreshCw /> Reprocessar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => onDelete(doc)}>
                  <Trash2 /> Excluir
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});
