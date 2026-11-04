import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "@/test/utils";
import type { Conversation, Message, SendMessageResponse } from "@/types/api";
import { streamMessage } from "./streaming";
import { chatKeys, useStreamMessage } from "./hooks";

function message(partial: Partial<Message>): Message {
  return {
    id: "m",
    role: "assistant",
    content: "",
    created_at: "2026-11-04T12:00:00Z",
    status: "ok",
    citations: [],
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    feedback: null,
    ...partial,
  };
}

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function ev(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const userMsg = message({ id: "u1", role: "user", content: "pergunta" });
const finalMsg = message({
  id: "a1",
  content: "Resposta validada [1]",
  citations: [
    {
      id: "c1",
      index: 1,
      chunk_id: "ch1",
      document_id: "d1",
      document_name: "Doc.pdf",
      page_start: 2,
      page_end: 2,
      section_title: null,
      snippet: "…",
      location_type: "page",
      location_label: "Página 2",
      mime_type: "application/pdf",
    },
  ],
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal("fetch", fn);
  document.cookie = "docmind_csrf=token-teste";
  return fn;
}

describe("streamMessage", () => {
  it("despacha user_message, context, delta e done na ordem", async () => {
    stubFetch(() =>
      sse([
        ev("user_message", userMsg),
        ev("context", { sources: [{ index: 1, chunk_id: "ch1", document_id: "d1", document_name: "Doc.pdf", location_label: "Página 2", location_type: "page", mime_type: "application/pdf", snippet: "x" }] }),
        ": ping\n",
        ev("delta", { text: "Resposta " }),
        ev("delta", { text: "rascunho [1][9]" }),
        ev("done", { assistant_message: finalMsg }),
      ]),
    );
    const calls: string[] = [];
    const out = await streamMessage("conv", { content: "pergunta" }, {
      onUserMessage: (m) => calls.push(`user:${m.id}`),
      onContext: (s) => calls.push(`context:${s.length}`),
      onDelta: (t) => calls.push(`delta:${t}`),
      onDone: (m) => calls.push(`done:${m.id}`),
    });
    expect(calls).toEqual(["user:u1", "context:1", "delta:Resposta ", "delta:rascunho [1][9]", "done:a1"]);
    expect(out.transport).toBe("stream");
    expect(out.assistantMessage?.content).toBe("Resposta validada [1]");
  });

  it("usa o endpoint síncrono quando a resposta não é text/event-stream", async () => {
    const sync: SendMessageResponse = { user_message: userMsg, assistant_message: finalMsg };
    const fetchMock = stubFetch((url) => (url.endsWith("/messages/stream") ? jsonResponse({ unexpected: true }) : jsonResponse(sync)));
    const done = vi.fn();
    const out = await streamMessage("conv", { content: "p" }, { onDone: done });
    expect(out.transport).toBe("sync");
    expect(done).toHaveBeenCalledWith(finalMsg);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/conversations/conv/messages"))).toBe(true);
  });

  it("faz fallback quando o endpoint de streaming responde 404", async () => {
    const sync: SendMessageResponse = { user_message: userMsg, assistant_message: finalMsg };
    stubFetch((url) =>
      url.endsWith("/messages/stream")
        ? jsonResponse({ error: { code: "not_found", message: "x" } }, { status: 404 })
        : jsonResponse(sync),
    );
    const out = await streamMessage("conv", { content: "p" }, {});
    expect(out.transport).toBe("sync");
  });

  it("propaga o evento error e falha quando o stream termina sem done", async () => {
    stubFetch(() => sse([ev("user_message", userMsg), ev("error", { code: "llm_failed", message: "Provedor falhou" })]));
    const onError = vi.fn();
    const out = await streamMessage("conv", { content: "p" }, { onError });
    expect(onError).toHaveBeenCalledWith({ code: "llm_failed", message: "Provedor falhou" });
    expect(out.assistantMessage).toBeNull();

    stubFetch(() => sse([ev("user_message", userMsg), ev("delta", { text: "x" })]));
    await expect(streamMessage("conv", { content: "p" }, {})).rejects.toMatchObject({ code: "stream_incomplete" });
  });
});

describe("useStreamMessage", () => {
  const baseConversation: Conversation = {
    id: "conv",
    title: "t",
    created_at: "2026-11-04T12:00:00Z",
    updated_at: "2026-11-04T12:00:00Z",
    message_count: 0,
    document_ids: [],
    collection_ids: [],
    messages: [],
  };

  function setup() {
    // gcTime > 0: sem observers, o cache da conversa não pode ser descartado durante o teste
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } } });
    client.setQueryData(chatKeys.detail("conv"), baseConversation);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ...renderHook(() => useStreamMessage("conv"), { wrapper }) };
  }

  it("mantém o rascunho fora do cache e substitui por done", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(enc.encode(ev("user_message", userMsg)));
        c.enqueue(enc.encode(ev("delta", { text: "Rascunho parcial" })));
        await gate;
        c.enqueue(enc.encode(ev("done", { assistant_message: finalMsg })));
        c.close();
      },
    });
    stubFetch(() => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const { result, client } = setup();
    let promise: Promise<Message | null> = Promise.resolve(null);
    act(() => {
      promise = result.current.send({ content: "pergunta" });
    });
    await waitFor(() => expect(result.current.state.draft).toBe("Rascunho parcial"));
    expect(result.current.isStreaming).toBe(true);
    const during = client.getQueryData<Conversation>(chatKeys.detail("conv"))!;
    expect(during.messages.map((m) => m.id)).toEqual(["u1"]); // só a mensagem do usuário persistida; rascunho não entra

    release();
    await act(async () => {
      await promise;
    });
    const after = client.getQueryData<Conversation>(chatKeys.detail("conv"))!;
    expect(after.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(after.messages[1]!.content).toBe("Resposta validada [1]");
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.draft).toBe("");
  });

  it("expõe o erro do evento error e termina o streaming", async () => {
    stubFetch(() => sse([ev("user_message", userMsg), ev("error", { code: "llm_failed", message: "Provedor falhou" })]));
    const { result } = setup();
    await act(async () => {
      await result.current.send({ content: "pergunta" });
    });
    expect(result.current.state.error).toBe("Provedor falhou");
    expect(result.current.isStreaming).toBe(false);
  });
});
