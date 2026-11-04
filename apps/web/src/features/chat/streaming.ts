import { ApiError, isApiError } from "@/services/api";
import { parseJsonData, readSse } from "@/lib/sse";
import type { ChatStreamEvent, Message, SendMessageResponse, StreamSource } from "@/types/api";
import { chatApi, type SendMessageInput } from "./api";

export interface StreamHandlers {
  onUserMessage?: (message: Message) => void;
  onContext?: (sources: StreamSource[]) => void;
  onDelta?: (text: string) => void;
  onDone?: (message: Message) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export interface StreamOutcome {
  /** "stream" quando veio por SSE; "sync" quando houve fallback ao endpoint síncrono */
  transport: "stream" | "sync";
  userMessage: Message | null;
  assistantMessage: Message | null;
}

function isEventStream(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

function toEvent(event: string, data: string): ChatStreamEvent | null {
  const parsed = parseJsonData<unknown>(data);
  if (parsed === null || typeof parsed !== "object") return null;
  switch (event) {
    case "user_message":
      return { event, data: parsed as Message };
    case "context":
      return { event, data: parsed as { sources: StreamSource[] } };
    case "delta":
      return { event, data: parsed as { text: string } };
    case "done":
      return { event, data: parsed as { assistant_message: Message } };
    case "error":
      return { event, data: parsed as { code: string; message: string } };
    default:
      return null;
  }
}

async function sendSync(
  conversationId: string,
  input: SendMessageInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  const res = await chatApi.send(conversationId, input, signal);
  handlers.onUserMessage?.(res.user_message);
  handlers.onDone?.(res.assistant_message);
  return { transport: "sync", userMessage: res.user_message, assistantMessage: res.assistant_message };
}

/**
 * Envia a pergunta pelo endpoint de streaming (SSE via POST) e despacha os eventos.
 * Se o servidor não responder com `text/event-stream` (ou o endpoint não existir), usa o endpoint síncrono.
 * O texto de `delta` é rascunho: só `done` traz a mensagem final com citações validadas.
 */
export async function streamMessage(
  conversationId: string,
  input: SendMessageInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await chatApi.stream(conversationId, input, signal);
  } catch (e) {
    if (isApiError(e) && (e.status === 404 || e.status === 405 || e.status === 501)) {
      return sendSync(conversationId, input, handlers, signal);
    }
    throw e;
  }

  if (!isEventStream(res) || !res.body) {
    // Alguns proxies entregam a resposta inteira como JSON: aceita se for o formato síncrono
    const text = await res.text();
    const json = parseJsonData<Partial<SendMessageResponse>>(text);
    if (json?.user_message && json.assistant_message) {
      handlers.onUserMessage?.(json.user_message);
      handlers.onDone?.(json.assistant_message);
      return { transport: "sync", userMessage: json.user_message, assistantMessage: json.assistant_message };
    }
    return sendSync(conversationId, input, handlers, signal);
  }

  let userMessage: Message | null = null;
  let assistantMessage: Message | null = null;
  let errored = false;

  for await (const raw of readSse(res.body, signal)) {
    const ev = toEvent(raw.event, raw.data);
    if (!ev) continue;
    switch (ev.event) {
      case "user_message":
        userMessage = ev.data;
        handlers.onUserMessage?.(ev.data);
        break;
      case "context":
        handlers.onContext?.(ev.data.sources ?? []);
        break;
      case "delta":
        handlers.onDelta?.(ev.data.text ?? "");
        break;
      case "done":
        assistantMessage = ev.data.assistant_message;
        handlers.onDone?.(ev.data.assistant_message);
        break;
      case "error":
        errored = true;
        handlers.onError?.(ev.data);
        break;
    }
    if (assistantMessage || errored) break;
  }

  if (!assistantMessage && !errored) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new ApiError(0, "stream_incomplete", "A resposta foi interrompida antes de ser concluída.");
  }
  return { transport: "stream", userMessage, assistantMessage };
}
