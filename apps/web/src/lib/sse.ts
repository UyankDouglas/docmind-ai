/**
 * Parser de Server-Sent Events (text/event-stream) para uso com `fetch` + `ReadableStream`.
 *
 * - Eventos são separados por linha em branco.
 * - Linhas `event:` definem o nome; linhas `data:` são concatenadas com "\n" (JSON pode vir em várias).
 * - Linhas iniciadas por ":" são comentários (heartbeat `: ping`) e são ignoradas.
 * - `id:` e `retry:` são aceitos e ignorados.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = "";
  private event = "";
  private dataLines: string[] = [];

  /** Alimenta o parser com um pedaço de texto e devolve os eventos completos encontrados. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const out: SseMessage[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const msg = this.processLine(line);
      if (msg) out.push(msg);
    }
    return out;
  }

  /** Finaliza o stream: devolve um evento pendente sem linha em branco final. */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer) {
      const msg = this.processLine(this.buffer);
      this.buffer = "";
      if (msg) out.push(msg);
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private processLine(line: string): SseMessage | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null; // comentário / heartbeat
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.event = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      default:
        // id, retry e campos desconhecidos são ignorados
        break;
    }
    return null;
  }

  private dispatch(): SseMessage | null {
    if (this.dataLines.length === 0 && !this.event) return null;
    const msg: SseMessage = { event: this.event || "message", data: this.dataLines.join("\n") };
    this.event = "";
    this.dataLines = [];
    return msg;
  }
}

/** Lê um corpo de resposta SSE e emite cada evento. Cancela a leitura se o `signal` abortar. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const msg of parser.push(decoder.decode(value, { stream: true }))) yield msg;
    }
    for (const msg of parser.push(decoder.decode())) yield msg;
    for (const msg of parser.flush()) yield msg;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/** Faz o parse seguro do JSON de um evento; devolve `null` quando inválido. */
export function parseJsonData<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
