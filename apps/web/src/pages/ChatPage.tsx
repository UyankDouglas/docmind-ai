import * as React from "react";
import { useNavigate, useParams } from "react-router";
import { AlertTriangle, Download, FileJson, FileText, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadConversationExport } from "@/features/analyses/export";
import type { ExportFormat } from "@/types/api";
import { useToast } from "@/components/ui/toast";
import { useMe } from "@/features/auth/hooks";
import { useAiStatus } from "@/features/settings/hooks";
import { UsageBlockBanner } from "@/features/settings/UsageBlockBanner";
import { EMPTY_SCOPE, ScopePicker, type Scope } from "@/features/documents/ScopePicker";
import { DocumentWorkspace } from "@/features/documents/DocumentWorkspace";
import { ChatComposer } from "@/features/chat/ChatComposer";
import { ChatThread } from "@/features/chat/ChatThread";
import { ConversationList } from "@/features/chat/ConversationList";
import {
  useConversation,
  useCreateConversation,
  useSendFeedback,
  useStreamMessage,
  useUpdateConversation,
} from "@/features/chat/hooks";
import { EvidenceDialog } from "@/features/chat/EvidencePanel";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { errorMessage } from "@/services/api";
import type { Citation } from "@/types/api";
import { isPdf, viewerHref } from "@/lib/documents";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Qual é o prazo para cancelamento do contrato?",
  "Resuma as principais obrigações das partes.",
  "Quais valores e formas de pagamento estão previstos?",
  "Existe cláusula de confidencialidade? O que ela estabelece?",
];

interface ViewerState {
  documentId: string;
  page: number;
  chunkId: string | null;
  citationId: string | null;
}

function conversationScope(c: { document_ids: string[]; collection_ids?: string[] } | undefined): Scope {
  return { document_ids: c?.document_ids ?? [], collection_ids: c?.collection_ids ?? [] };
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { toast } = useToast();
  const { data: user } = useMe();
  const ai = useAiStatus();

  const [listOpen, setListOpen] = React.useState(true);
  const [viewer, setViewer] = React.useState<ViewerState | null>(null);
  const [pendingScope, setPendingScope] = React.useState<Scope>(EMPTY_SCOPE);

  const conversation = useConversation(conversationId);
  const create = useCreateConversation();
  const update = useUpdateConversation();
  const stream = useStreamMessage(conversationId ?? "");
  const feedback = useSendFeedback(conversationId ?? "");
  const [explainId, setExplainId] = React.useState<string | null>(null);

  const scope: Scope = conversationId ? conversationScope(conversation.data) : pendingScope;
  const scopeEmpty = scope.document_ids.length === 0 && scope.collection_ids.length === 0;

  const setScope = (next: Scope) => {
    if (!conversationId) {
      setPendingScope(next);
      return;
    }
    update.mutate({ id: conversationId, document_ids: next.document_ids, collection_ids: next.collection_ids });
  };

  const startConversation = async (firstMessage?: string) => {
    try {
      const conv = await create.mutateAsync({
        document_ids: pendingScope.document_ids,
        collection_ids: pendingScope.collection_ids,
      });
      navigate(`/chat/${conv.id}`, { state: firstMessage ? { firstMessage } : undefined });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível criar a conversa", description: errorMessage(e) });
    }
  };

  const handleSend = async (content: string) => {
    if (!conversationId) {
      await startConversation(content);
      return;
    }
    try {
      await stream.send({ content });
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível enviar a pergunta", description: errorMessage(e) });
    }
  };

  const streamError = stream.state.error;
  const clearStreamError = stream.clearError;
  React.useEffect(() => {
    if (streamError) {
      toast({ kind: "error", title: "A geração falhou", description: streamError });
      clearStreamError();
    }
  }, [streamError, clearStreamError, toast]);

  // Envia a primeira mensagem após criar a conversa a partir da tela vazia
  const sentFirstRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const state = window.history.state?.usr as { firstMessage?: string } | undefined;
    const first = state?.firstMessage;
    if (conversationId && first && conversation.data && sentFirstRef.current !== conversationId) {
      sentFirstRef.current = conversationId;
      window.history.replaceState({ ...window.history.state, usr: {} }, "");
      void handleSend(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversation.data]);

  const openCitation = (c: Citation) => {
    if (!c.document_id) {
      toast({ kind: "info", title: "Documento indisponível", description: "A fonte citada foi removida do workspace." });
      return;
    }
    const page = c.location_type === "page" || isPdf(c.mime_type) ? (c.page_start ?? 1) : 1;
    const target: ViewerState = { documentId: c.document_id, page, chunkId: c.chunk_id, citationId: c.id };
    if (!isDesktop) {
      navigate(
        viewerHref({
          document_id: c.document_id,
          mime_type: c.mime_type,
          location_type: c.location_type,
          page_start: c.page_start,
          chunk_id: c.chunk_id,
        }),
      );
      return;
    }
    setViewer(target);
  };

  const handleFeedback = (messageId: string, rating: 1 | -1) => {
    feedback.mutate(
      { messageId, rating },
      { onError: (e) => toast({ kind: "error", title: "Não foi possível registrar o feedback", description: errorMessage(e) }) },
    );
  };

  const aiUnavailable = ai.data ? !ai.data.configured : false;

  const [exporting, setExporting] = React.useState(false);
  const exportConversation = async (format: ExportFormat) => {
    if (!conversationId) return;
    setExporting(true);
    try {
      await downloadConversationExport(conversationId, format, `conversa-${conversationId.slice(0, 8)}`);
    } catch (e) {
      toast({ kind: "error", title: "Não foi possível exportar a conversa", description: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Lista de conversas */}
      {isDesktop && listOpen ? (
        <aside className="w-72 shrink-0 border-r border-border bg-sidebar/60">
          <ConversationList
            activeId={conversationId}
            onNew={() => {
              setPendingScope(EMPTY_SCOPE);
              navigate("/chat");
            }}
            onDeleted={(id) => {
              if (id === conversationId) navigate("/chat");
            }}
          />
        </aside>
      ) : null}

      {/* Área principal */}
      <section className={cn("flex min-w-0 flex-1 flex-col", viewer && isDesktop && "max-w-[55%]")} aria-label="Chat com documentos">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/60 px-3 py-2">
          {isDesktop ? (
            <Button variant="ghost" size="icon-sm" onClick={() => setListOpen((v) => !v)} aria-label={listOpen ? "Ocultar conversas" : "Mostrar conversas"}>
              {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => navigate("/chat")}>
              Conversas
            </Button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {conversationId ? (conversation.data?.title || "Conversa") : "Nova conversa"}
          </h1>
          <ScopePicker value={scope} onChange={setScope} disabled={update.isPending} className="max-w-[18rem]" />
          {conversationId && (conversation.data?.message_count ?? 0) > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" loading={exporting} aria-label="Exportar conversa">
                  <Download />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportConversation("md")}>
                  <FileText /> Exportar Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportConversation("json")}>
                  <FileJson /> Exportar JSON (.json)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <UsageBlockBanner className="m-3 mb-0" />
        {aiUnavailable ? (
          <Alert variant="warning" className="m-3 mb-0">
            <AlertTriangle />
            <AlertDescription>
              Geração com IA indisponível: nenhum provedor configurado. As perguntas serão registradas, mas não haverá resposta gerada.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversationId ? (
            <ChatThread
              conversation={conversation.data}
              isPending={conversation.isPending}
              isError={conversation.isError}
              error={conversation.error}
              onRetry={() => void conversation.refetch()}
              sending={stream.isStreaming}
              stream={stream.state}
              userName={user?.name}
              onCitationClick={openCitation}
              onFeedback={handleFeedback}
              feedbackPending={feedback.isPending}
              activeCitationId={viewer?.citationId ?? null}
              suggestions={SUGGESTIONS}
              onSuggestion={(s) => void handleSend(s)}
              onExplain={setExplainId}
            />
          ) : !isDesktop ? (
            <div className="flex h-full flex-col">
              <ConversationList
                activeId={undefined}
                onNew={() => void startConversation()}
                creating={create.isPending}
                className="min-h-0 flex-1"
              />
            </div>
          ) : (
            <ChatThread
              conversation={{
                id: "new",
                title: "",
                created_at: "",
                updated_at: "",
                message_count: 0,
                document_ids: pendingScope.document_ids,
                collection_ids: pendingScope.collection_ids,
                messages: [],
              }}
              isPending={false}
              isError={false}
              error={null}
              onRetry={() => {}}
              sending={create.isPending}
              userName={user?.name}
              onCitationClick={openCitation}
              onFeedback={() => {}}
              suggestions={SUGGESTIONS}
              onSuggestion={(s) => void handleSend(s)}
            />
          )}
        </div>

        {(conversationId || isDesktop) ? (
          <div className="shrink-0 border-t border-border bg-background/80 p-3 backdrop-blur">
            <div className="mx-auto max-w-4xl">
              <ChatComposer
                onSend={(c) => void handleSend(c)}
                pending={stream.isStreaming || create.isPending}
                onStop={stream.isStreaming ? stream.stop : undefined}
                disabled={conversation.isError}
                hint={scopeEmpty ? "Sem seleção: todos os documentos prontos do workspace serão considerados" : undefined}
              />
            </div>
          </div>
        ) : null}
      </section>

      <EvidenceDialog messageId={explainId} onOpenChange={(o) => !o && setExplainId(null)} />

      {/* Visualizador lado a lado */}
      {viewer && isDesktop ? (
        <aside className="flex min-w-0 flex-1 flex-col border-l border-border" aria-label="Documento citado">
          <DocumentWorkspace
            documentId={viewer.documentId}
            page={viewer.page}
            onPageChange={(p) => setViewer((v) => (v ? { ...v, page: p } : v))}
            chunkId={viewer.chunkId}
            onChunkChange={(c) => setViewer((v) => (v ? { ...v, chunkId: c, citationId: c ? v.citationId : null } : v))}
            embedded
            headerExtra={
              <Button variant="ghost" size="icon-sm" onClick={() => setViewer(null)} aria-label="Fechar visualizador">
                <X />
              </Button>
            }
          />
        </aside>
      ) : null}
    </div>
  );
}
