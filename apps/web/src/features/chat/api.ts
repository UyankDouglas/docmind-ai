import { apiFetch, http } from "@/services/api";
import type { Conversation, ConversationSummary, Message, RetrievalEvidence, SendMessageResponse } from "@/types/api";

export interface ScopeInput {
  document_ids?: string[];
  collection_ids?: string[];
}
export type ConversationScopeInput = { title?: string } & ScopeInput;
export type SendMessageInput = { content: string } & ScopeInput;

export const chatApi = {
  list: (q?: string, signal?: AbortSignal) =>
    http.get<{ items: ConversationSummary[] }>("/conversations", q ? { q } : undefined, signal),
  get: (id: string, signal?: AbortSignal) => http.get<Conversation>(`/conversations/${id}`, undefined, signal),
  create: (input: ConversationScopeInput) => http.post<Conversation>("/conversations", input),
  update: (id: string, input: ConversationScopeInput) =>
    http.patch<Conversation>(`/conversations/${id}`, input),
  remove: (id: string) => http.delete(`/conversations/${id}`),
  send: (id: string, input: SendMessageInput, signal?: AbortSignal) =>
    http.post<SendMessageResponse>(`/conversations/${id}/messages`, input, signal),
  /** Resposta bruta do endpoint SSE (o chamador lê o corpo como stream). */
  stream: (id: string, input: SendMessageInput, signal?: AbortSignal) =>
    apiFetch(`/conversations/${id}/messages/stream`, {
      method: "POST",
      body: input,
      signal,
      headers: { Accept: "text/event-stream" },
    }),
  feedback: (messageId: string, input: { rating: 1 | -1; comment?: string }) =>
    http.post<Message>(`/messages/${messageId}/feedback`, input),
  retrieval: (messageId: string, signal?: AbortSignal) =>
    http.get<RetrievalEvidence>(`/messages/${messageId}/retrieval`, undefined, signal),
};
