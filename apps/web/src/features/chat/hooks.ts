import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Conversation, ConversationSummary, Message, StreamSource } from "@/types/api";
import { errorMessage } from "@/services/api";
import { chatApi, type ConversationScopeInput, type SendMessageInput } from "./api";
import { streamMessage } from "./streaming";

export const chatKeys = {
  all: ["conversations"] as const,
  list: (q = "") => ["conversations", "list", q] as const,
  detail: (id: string) => ["conversations", "detail", id] as const,
  evidence: (messageId: string) => ["messages", messageId, "retrieval"] as const,
};

export function useConversations(q = "") {
  return useQuery({
    queryKey: chatKeys.list(q),
    queryFn: ({ signal }) => chatApi.list(q || undefined, signal),
    select: (d) => d.items,
    placeholderData: (prev) => prev,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: chatKeys.detail(id ?? ""),
    queryFn: ({ signal }) => chatApi.get(id!, signal),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConversationScopeInput) => chatApi.create(input),
    onSuccess: (conv) => {
      qc.setQueryData(chatKeys.detail(conv.id), conv);
      void qc.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}

export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & ConversationScopeInput) =>
      chatApi.update(id, input),
    onSuccess: (conv) => {
      qc.setQueryData(chatKeys.detail(conv.id), (old: Conversation | undefined) =>
        old ? { ...old, ...conv, messages: conv.messages ?? old.messages } : conv,
      );
      void qc.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chatApi.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: chatKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}

/** Mensagem otimista do usuário enquanto a resposta não chega. */
export function optimisticUserMessage(content: string): Message {
  return {
    id: `optimistic-${Date.now()}`,
    role: "user",
    content,
    created_at: new Date().toISOString(),
    status: "ok",
    citations: [],
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    feedback: null,
  };
}

function appendMessages(qc: QueryClient, conversationId: string, messages: Message[], removeId?: string) {
  const key = chatKeys.detail(conversationId);
  qc.setQueryData<Conversation>(key, (old) => {
    if (!old) return old;
    const kept = old.messages.filter((m) => m.id !== removeId && !messages.some((n) => n.id === m.id));
    const next = [...kept, ...messages];
    return { ...old, messages: next, message_count: next.length, updated_at: messages.at(-1)?.created_at ?? old.updated_at };
  });
}

function bumpConversationInLists(qc: QueryClient, conversationId: string, updatedAt: string, added: number) {
  qc.setQueriesData<{ items: ConversationSummary[] }>({ queryKey: ["conversations", "list"] }, (old) => {
    if (!old) return old;
    return {
      items: old.items
        .map((c) => (c.id === conversationId ? { ...c, updated_at: updatedAt, message_count: c.message_count + added } : c))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    };
  });
}

/** Envio síncrono (mantido como fallback e para testes). */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const key = chatKeys.detail(conversationId);
  return useMutation({
    mutationFn: (input: SendMessageInput) => chatApi.send(conversationId, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Conversation>(key);
      const optimistic = optimisticUserMessage(input.content);
      qc.setQueryData<Conversation>(key, (old) => (old ? { ...old, messages: [...old.messages, optimistic] } : old));
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (res, _v, ctx) => {
      appendMessages(qc, conversationId, [res.user_message, res.assistant_message], ctx?.optimisticId);
      bumpConversationInLists(qc, conversationId, res.assistant_message.created_at, 2);
      void qc.invalidateQueries({ queryKey: chatKeys.all });
      void qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export type StreamPhase = "idle" | "connecting" | "retrieving" | "generating";

export interface StreamState {
  phase: StreamPhase;
  draft: string;
  sources: StreamSource[];
  error: string | null;
}

const IDLE: StreamState = { phase: "idle", draft: "", sources: [], error: null };

/**
 * Envio com streaming (SSE). Mantém o rascunho fora do cache: só a mensagem final (`done`) entra na conversa.
 */
export function useStreamMessage(conversationId: string) {
  const qc = useQueryClient();
  const [state, setState] = React.useState<StreamState>(IDLE);
  const abortRef = React.useRef<AbortController | null>(null);
  const key = chatKeys.detail(conversationId);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const send = React.useCallback(
    async (input: SendMessageInput): Promise<Message | null> => {
      if (!conversationId) return null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      await qc.cancelQueries({ queryKey: key });
      const optimistic = optimisticUserMessage(input.content);
      qc.setQueryData<Conversation>(key, (old) => (old ? { ...old, messages: [...old.messages, optimistic] } : old));
      setState({ phase: "connecting", draft: "", sources: [], error: null });

      let userPersisted = false;
      let streamError: string | null = null;
      try {
        const outcome = await streamMessage(
          conversationId,
          input,
          {
            onUserMessage: (m) => {
              userPersisted = true;
              appendMessages(qc, conversationId, [m], optimistic.id);
              setState((s) => ({ ...s, phase: "retrieving" }));
            },
            onContext: (sources) => setState((s) => ({ ...s, phase: "generating", sources })),
            onDelta: (text) => setState((s) => ({ ...s, phase: "generating", draft: s.draft + text })),
            onDone: (m) => {
              appendMessages(qc, conversationId, [m]);
              bumpConversationInLists(qc, conversationId, m.created_at, 2);
            },
            onError: (err) => {
              streamError = err.message;
            },
          },
          controller.signal,
        );
        setState(streamError ? { ...IDLE, error: streamError } : IDLE);
        void qc.invalidateQueries({ queryKey: chatKeys.all });
        void qc.invalidateQueries({ queryKey: ["usage"] });
        return outcome.assistantMessage;
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        if (!userPersisted) {
          qc.setQueryData<Conversation>(key, (old) =>
            old ? { ...old, messages: old.messages.filter((m) => m.id !== optimistic.id) } : old,
          );
        }
        setState(aborted ? IDLE : { ...IDLE, error: errorMessage(e) });
        // o backend pode ter persistido a mensagem de erro/parcial: sincroniza
        void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: chatKeys.all });
        if (aborted) return null;
        throw e;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [conversationId, key, qc],
  );

  const clearError = React.useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { state, send, stop, clearError, isStreaming: state.phase !== "idle" };
}

export function useSendFeedback(conversationId: string) {
  const qc = useQueryClient();
  const key = chatKeys.detail(conversationId);
  return useMutation({
    mutationFn: ({ messageId, rating, comment }: { messageId: string; rating: 1 | -1; comment?: string }) =>
      chatApi.feedback(messageId, { rating, comment }),
    onSuccess: (msg) => {
      qc.setQueryData<Conversation>(key, (old) =>
        old ? { ...old, messages: old.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) } : old,
      );
      void qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export function useRetrievalEvidence(messageId: string | null) {
  return useQuery({
    queryKey: chatKeys.evidence(messageId ?? ""),
    queryFn: ({ signal }) => chatApi.retrieval(messageId!, signal),
    enabled: !!messageId,
    staleTime: 5 * 60_000,
  });
}
