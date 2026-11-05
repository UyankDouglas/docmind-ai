import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { MAX_UPLOAD_BYTES, UploadDropzone, validateFile } from "./UploadDropzone";
import { maxUploadBytes, runWithConcurrency } from "./uploadQueue";

describe("validateFile", () => {
  it("aceita PDF, DOCX e TXT e rejeita outros formatos", () => {
    expect(validateFile(new File(["%PDF-1.4"], "ok.pdf", { type: "application/pdf" }))).toBeNull();
    expect(validateFile(new File(["PK"], "doc.docx"))).toBeNull();
    expect(validateFile(new File(["texto"], "nota.txt", { type: "text/plain" }))).toBeNull();
    expect(validateFile(new File(["x"], "planilha.xlsx", { type: "application/vnd.ms-excel" }))).toMatch(/formato não suportado/i);
    expect(validateFile(new File(["x"], "imagem.png", { type: "image/png" }))).toMatch(/formato não suportado/i);
  });
  it("rejeita vazio e acima do limite", () => {
    expect(validateFile(new File([], "vazio.pdf"))).toMatch(/vazio/i);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "grande.pdf", { type: "application/pdf" });
    expect(validateFile(big)).toMatch(/excede o limite/i);
  });
  it("usa o limite informado pelo servidor quando existe", () => {
    expect(maxUploadBytes(5)).toBe(5 * 1024 * 1024);
    expect(maxUploadBytes(undefined)).toBe(MAX_UPLOAD_BYTES);
    expect(maxUploadBytes(0)).toBe(MAX_UPLOAD_BYTES);
    const sixMb = new File([new Uint8Array(6 * 1024 * 1024)], "medio.pdf", { type: "application/pdf" });
    expect(validateFile(sixMb)).toBeNull();
    expect(validateFile(sixMb, maxUploadBytes(5))).toMatch(/excede o limite de 5/i);
  });
});

describe("runWithConcurrency", () => {
  it("nunca executa mais do que o limite em paralelo e não interrompe nos erros", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const items = [1, 2, 3, 4, 5, 6, 7];
    await runWithConcurrency(items, 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      if (n === 4) throw new Error("falha");
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 7]);
  });
});

function collectionsOrTags(url: string): Response | null {
  if (url.includes("/collections")) return jsonResponse({ items: [] });
  if (url.includes("/documents/tags")) return jsonResponse({ items: [] });
  return null;
}

describe("UploadDropzone", () => {
  it("não envia arquivos não suportados e mostra o motivo", async () => {
    const fetchMock = mockFetch((url) => collectionsOrTags(url) ?? jsonResponse({}));
    renderWithProviders(<UploadDropzone />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["hello"], "planilha.xlsx", { type: "application/vnd.ms-excel" })] } });

    expect(await screen.findByText("planilha.xlsx")).toBeInTheDocument();
    expect(screen.getByText(/formato não suportado/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/documents/upload"))).toBe(false);
  });

  it("envia no máximo 3 arquivos simultaneamente e registra erro por arquivo", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const fetchMock = mockFetch((url, init) => {
      const pre = collectionsOrTags(url);
      if (pre) return pre;
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          if (file.name === "ruim.pdf") {
            resolve(jsonResponse({ error: { code: "duplicate_document", message: "Arquivo já enviado." } }, { status: 409 }));
          } else {
            resolve(jsonResponse({ id: file.name, name: file.name, status: "uploaded" }, { status: 202 }));
          }
        });
      });
    });
    renderWithProviders(<UploadDropzone />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const files = ["a.pdf", "b.docx", "ruim.pdf", "d.txt", "e.pdf"].map((n) => new File(["%PDF-1.4 conteudo"], n));
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(resolvers.length).toBe(3));
    expect(peak).toBe(3);
    expect(screen.getAllByLabelText("Enviando")).toHaveLength(3);
    expect(screen.getAllByLabelText("Aguardando")).toHaveLength(2);

    while (resolvers.length) resolvers.shift()!();
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/documents/upload"))).toHaveLength(5));
    while (resolvers.length) resolvers.shift()!();

    await waitFor(() => expect(screen.getAllByLabelText("Enviado")).toHaveLength(4));
    expect(screen.getByLabelText("Erro")).toBeInTheDocument();
    expect(screen.getByText("Arquivo já enviado.")).toBeInTheDocument();
    expect(peak).toBe(3);
  });

  it("aplica coleção e tags do lote ao multipart", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url) => collectionsOrTags(url) ?? jsonResponse({ id: "d1", name: "ok.pdf", status: "uploaded" }, { status: 202 }));
    renderWithProviders(<UploadDropzone defaultCollectionId="c1" />);
    const tagsInput = screen.getByLabelText("Tags para os próximos envios");
    fireEvent.change(tagsInput, { target: { value: "Jurídico" } });
    fireEvent.keyDown(tagsInput, { key: "Enter" });
    fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [new File(["%PDF-1.4"], "ok.pdf", { type: "application/pdf" })] } });
    await screen.findByLabelText("Enviado");
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/documents/upload"));
    const form = call![1]?.body as FormData;
    expect(form.get("collection_id")).toBe("c1");
    expect(form.get("tags")).toBe("jurídico");
  });
});
