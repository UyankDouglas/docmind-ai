import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentWorkspace } from "@/features/documents/DocumentWorkspace";

export function DocumentViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const chunkId = params.get("chunk");

  const setPage = React.useCallback(
    (p: number) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("page", String(p));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setChunk = React.useCallback(
    (c: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (c) next.set("chunk", c);
          else next.delete("chunk");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  if (!id) return null;

  return (
    <DocumentWorkspace
      documentId={id}
      page={page}
      onPageChange={setPage}
      chunkId={chunkId}
      onChunkChange={setChunk}
      analyses
      initialTab={params.get("tab") === "analyses" ? "analyses" : "details"}
      headerExtra={
        <Button variant="ghost" size="sm" asChild className="order-first">
          <Link to="/documents" aria-label="Voltar à biblioteca">
            <ArrowLeft /> <span className="hidden sm:inline">Biblioteca</span>
          </Link>
        </Button>
      }
    />
  );
}
