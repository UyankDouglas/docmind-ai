import * as React from "react";
import { Link } from "react-router";
import { AlertTriangle, Ban, Eye, FolderInput, MoreHorizontal, Pencil, RefreshCw, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge, STATUS_LABELS } from "@/components/StatusBadge";
import { CollectionColorDot } from "@/features/collections/CollectionsPanel";
import { documentKind, KIND_ICONS, KIND_LABELS, KIND_TONES } from "@/lib/documents";
import { cn, formatBytes, formatRelative } from "@/lib/utils";
import { isProcessingStatus, type DocumentItem } from "@/types/api";
import { useDocumentStatus } from "./hooks";

export type RowAction = "rename" | "tags" | "move" | "reprocess" | "cancel" | "delete";

interface Props {
  doc: DocumentItem;
  onAction: (action: RowAction, doc: DocumentItem) => void;
  canManage: boolean;
  collectionColor?: string | null;
}

export const DocumentRow = React.memo(function DocumentRow({ doc, onAction, canManage, collectionColor = null }: Props) {
  const { data: live } = useDocumentStatus(doc.id, doc.status);
  const status = live?.status ?? doc.status;
  const errorMessage = live?.error_message ?? doc.error_message;
  const pageCount = live?.page_count ?? doc.page_count;
  const chunkCount = live?.chunk_count ?? doc.chunk_count;
  const processing = isProcessingStatus(status);
  const kind = documentKind(doc.mime_type);
  const Icon = KIND_ICONS[kind];
  const unitLabel = doc.location_type === "page" ? "pág." : "seções";

  return (
    <tr className="group border-b border-border last:border-0 hover:bg-accent/30" data-testid="document-row">
      <td className="px-4 py-3">
        <Link to={`/documents/${doc.id}`} className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", KIND_TONES[kind])} title={KIND_LABELS[kind]}>
            <Icon className="size-4" aria-hidden />
            <span className="sr-only">{KIND_LABELS[kind]}</span>
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{doc.name}</span>
              {doc.warnings?.length ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex text-warning" aria-label={`${doc.warnings.length} aviso(s) da extração`} data-testid="doc-warning">
                      <AlertTriangle className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <ul className="list-disc space-y-1 pl-4 text-left">
                      {doc.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {KIND_LABELS[kind]} · {formatBytes(doc.size_bytes)}
              {pageCount ? ` · ${pageCount} ${unitLabel}` : ""}
              {chunkCount ? ` · ${chunkCount} trechos` : ""}
              {` · v${doc.indexing_version}`}
            </span>
          </span>
        </Link>
        {(doc.tags?.length || doc.collection_name) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-12">
            {doc.collection_name ? (
              <Link to={`/collections/${doc.collection_id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                <CollectionColorDot color={collectionColor} /> {doc.collection_name}
              </Link>
            ) : null}
            {doc.tags?.map((t) => (
              <Badge key={t} variant="muted" className="px-2 py-0 text-[11px]" data-testid="doc-tag">
                #{t}
              </Badge>
            ))}
          </div>
        ) : null}
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
                <DropdownMenuItem onSelect={() => onAction("rename", doc)}>
                  <Pencil /> Renomear
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction("tags", doc)}>
                  <Tags /> Editar tags
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction("move", doc)}>
                  <FolderInput /> Mover para coleção
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {processing ? (
                  <DropdownMenuItem onSelect={() => onAction("cancel", doc)}>
                    <Ban /> Cancelar processamento
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onAction("reprocess", doc)}>
                    <RefreshCw /> Reprocessar
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => onAction("delete", doc)}>
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
