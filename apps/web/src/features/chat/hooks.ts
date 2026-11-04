import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation, ConversationSummary, Message } from "@/types/api";
import { chatApi, type ConversationScopeInput, type ScopeInput } from "./api";

export const chatKeys = {
  all: ["conversations"] as const,
  list: ["conversations", "list"] as const,
  detail: (id: string) => ["conversations", "detail", id] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.list,
    queryFn: ({ signal }) => chatApi.list(signal),
    select: (d) => d.items,
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
      void qc.invalidateQueries({ queryKey: chatKeys.list });
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
      void qc.invalidateQueries({ queryKey: chatKeys.list });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chatApi.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: chatKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: chatKeys.list });
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

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const key = chatKeys.detail(conversationId);
  return useMutation({
    mutationFn: (input: { content: string } & ScopeInput) => chatApi.send(conversationId, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Conversation>(key);
      const optimistic = optimisticUserMessage(input.content);
      qc.setQueryData<Conversation>(key, (old) =>
        old ? { ...old, messages: [...old.messages, optimistic] } : old,
      );
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (res, _v, ctx) => {
      qc.setQueryData<Conversation>(key, (old) => {
        if (!old) return old;
        const withoutOptimistic = old.messages.filter((m) => m.id !== ctx?.optimisticId);
        return {
          ...old,
          updated_at: res.assistant_message.created_at,
          message_count: withoutOptimistic.length + 2,
          messages: [...withoutOptimistic, res.user_message, res.assistant_message],
        };
      });
      qc.setQueryData<{ items: ConversationSummary[] }>(chatKeys.list, (old) => {
        if (!old) return old;
        return {
          items: old.items
            .map((c) =>
              c.id === conversationId
                ? { ...c, updated_at: res.assistant_message.created_at, message_count: c.message_count + 2 }
                : c,
            )
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        };
      });
      void qc.invalidateQueries({ queryKey: chatKeys.list });
      void qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
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
    },
  });
}
