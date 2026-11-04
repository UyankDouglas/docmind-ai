import { http } from "@/services/api";

export interface ScopeInput {
  document_ids?: string[];
  collection_ids?: string[];
}
export type ConversationScopeInput = { title?: string } & ScopeInput;
import type { Conversation, ConversationSummary, Message, SendMessageResponse } from "@/types/api";

export const chatApi = {
  list: (signal?: AbortSignal) => http.get<{ items: ConversationSummary[] }>("/conversations", undefined, signal),
  get: (id: string, signal?: AbortSignal) => http.get<Conversation>(`/conversations/${id}`, undefined, signal),
  create: (input: ConversationScopeInput) => http.post<Conversation>("/conversations", input),
  update: (id: string, input: ConversationScopeInput) =>
    http.patch<Conversation>(`/conversations/${id}`, input),
  remove: (id: string) => http.delete(`/conversations/${id}`),
  send: (id: string, input: { content: string } & ScopeInput, signal?: AbortSignal) =>
    http.post<SendMessageResponse>(`/conversations/${id}/messages`, input, signal),
  feedback: (messageId: string, input: { rating: 1 | -1; comment?: string }) =>
    http.post<Message>(`/messages/${messageId}/feedback`, input),
};
