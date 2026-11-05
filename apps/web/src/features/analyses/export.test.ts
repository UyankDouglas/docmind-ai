import { describe, expect, it, vi, afterEach } from "vitest";
import { mockFetch } from "@/test/utils";
import { downloadAnalysisExport, downloadConversationExport, filenameFromDisposition } from "./export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("filenameFromDisposition", () => {
  it("lê filename simples, filename* codificado e usa fallback", () => {
    expect(filenameFromDisposition('attachment; filename="resumo.md"', "x.md")).toBe("resumo.md");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''compara%C3%A7%C3%A3o.json", "x.json")).toBe("comparação.json");
    expect(filenameFromDisposition(null, "fallback.md")).toBe("fallback.md");
  });
});

function stubDownload() {
  const createObjectURL = vi.fn(() => "blob:docmind/1");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { createObjectURL, revokeObjectURL, click };
}

describe("downloadAnalysisExport", () => {
  it("chama o endpoint com o formato e dispara o download com o nome do Content-Disposition", async () => {
    const { createObjectURL, click } = stubDownload();
    const fetchMock = mockFetch((url) => {
      if (url.includes("/analyses/an-1/export?format=md")) {
        return new Response("# Resumo", { status: 200, headers: { "Content-Type": "text/markdown", "Content-Disposition": 'attachment; filename="resumo-geral.md"' } });
      }
      return new Response(null, { status: 404 });
    });
    const name = await downloadAnalysisExport("an-1", "md");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/analyses/an-1/export?format=md");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(name).toBe("resumo-geral.md");
  });

  it("exporta conversas em JSON com nome de fallback quando não há cabeçalho", async () => {
    stubDownload();
    mockFetch((url) => {
      if (url.includes("/conversations/c-1/export?format=json")) return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(null, { status: 404 });
    });
    const name = await downloadConversationExport("c-1", "json", "conversa-c1");
    expect(name).toBe("conversa-c1.json");
  });
});
