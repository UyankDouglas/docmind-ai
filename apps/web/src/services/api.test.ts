import { describe, expect, it, vi, beforeEach } from "vitest";
import { jsonResponse, mockFetch } from "@/test/utils";
import { ApiError, api, buildQuery, readCookie } from "./api";

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("cliente de API", () => {
  beforeEach(() => {
    clearCookies();
    vi.unstubAllGlobals();
  });

  it("injeta X-CSRF-Token em mutações a partir do cookie docmind_csrf", async () => {
    document.cookie = "docmind_csrf=token-123; path=/";
    const fetchMock = mockFetch(() => jsonResponse({ ok: true }));

    await api("/conversations", { method: "POST", body: { title: "x" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/conversations");
    expect(init?.credentials).toBe("include");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("token-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("busca /auth/csrf uma vez quando o cookie não existe antes de uma mutação", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/auth/csrf")) {
        document.cookie = "docmind_csrf=fresh; path=/";
        return jsonResponse({ csrf_token: "fresh" });
      }
      return jsonResponse({ id: "1" });
    });

    await api("/auth/login", { method: "POST", body: { email: "a@b.c", password: "x" } });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("/api/v1/auth/csrf");
    expect(urls[1]).toBe("/api/v1/auth/login");
    const headers = fetchMock.mock.calls[1]![1]?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("fresh");
  });

  it("não envia CSRF nem Content-Type JSON em GET", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ items: [] }));
    await api("/documents", { query: { page: 1, q: "", status: undefined } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/documents?page=1");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBeUndefined();
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("converte erros padronizados do backend em ApiError", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "document_not_found", message: "Documento não encontrado.", details: null } }, { status: 404 }),
    );
    const err = await api("/documents/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe("document_not_found");
    expect(apiErr.message).toBe("Documento não encontrado.");
  });

  it("usa mensagem padrão quando o corpo do erro não é JSON", async () => {
    mockFetch(() => new Response("gateway down", { status: 502 }));
    const err = (await api("/health").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBe("http_502");
    expect(err.message).toMatch(/indisponível/i);
  });

  it("trata falha de rede como ApiError com status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const err = (await api("/health").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(0);
    expect(err.code).toBe("network_error");
  });

  it("retorna undefined para 204", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(api("/documents/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("buildQuery ignora valores vazios e readCookie lê o cookie correto", () => {
    expect(buildQuery({ a: 1, b: "", c: null, d: undefined, e: "x y" })).toBe("?a=1&e=x+y");
    document.cookie = "foo=bar; path=/";
    expect(readCookie("foo")).toBe("bar");
    expect(readCookie("nope")).toBeNull();
  });
});
