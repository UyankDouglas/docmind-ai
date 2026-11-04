import { describe, expect, it } from "vitest";
import { parseJsonData, readSse, SseParser } from "./sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("SseParser", () => {
  it("separa eventos por linha em branco e junta múltiplas linhas data", () => {
    const p = new SseParser();
    const out = p.push('event: delta\ndata: {"text":\ndata: "olá"}\n\nevent: done\ndata: {"a":1}\n\n');
    expect(out).toEqual([
      { event: "delta", data: '{"text":\n"olá"}' },
      { event: "done", data: '{"a":1}' },
    ]);
    expect(parseJsonData(out[0]!.data)).toEqual({ text: "olá" });
  });

  it("ignora comentários de heartbeat e campos id/retry", () => {
    const p = new SseParser();
    const out = p.push(": ping\n\nid: 7\nretry: 1000\nevent: context\ndata: {}\n\n: ping\n");
    expect(out).toEqual([{ event: "context", data: "{}" }]);
  });

  it("acumula pedaços parciais (chunk cortado no meio da linha) e lida com CRLF", () => {
    const p = new SseParser();
    expect(p.push("event: del")).toEqual([]);
    expect(p.push("ta\r\ndata: {\"text\":\"a\"}\r\n")).toEqual([]);
    expect(p.push("\r\n")).toEqual([{ event: "delta", data: '{"text":"a"}' }]);
  });

  it("flush entrega evento pendente sem linha em branco final", () => {
    const p = new SseParser();
    p.push('event: done\ndata: {"x":1}');
    expect(p.flush()).toEqual([{ event: "done", data: '{"x":1}' }]);
  });

  it("usa 'message' quando não há event:", () => {
    const p = new SseParser();
    expect(p.push("data: hi\n\n")).toEqual([{ event: "message", data: "hi" }]);
  });
});

describe("readSse", () => {
  it("itera eventos de um ReadableStream com bytes multi-chunk", async () => {
    const body = streamOf(["event: a\ndata: 1\n\nevent: b\nda", "ta: 2\n\n: ping\n", "event: c\ndata: 3"]);
    const got: string[] = [];
    for await (const m of readSse(body)) got.push(`${m.event}=${m.data}`);
    expect(got).toEqual(["a=1", "b=2", "c=3"]);
  });

  it("parseJsonData devolve null para JSON inválido", () => {
    expect(parseJsonData("{nope")).toBeNull();
  });
});
