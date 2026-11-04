import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { MAX_UPLOAD_BYTES, UploadDropzone, validateFile } from "./UploadDropzone";

describe("validateFile", () => {
  it("rejeita arquivos que não são PDF", () => {
    expect(validateFile(new File(["x"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toMatch(/apenas arquivos pdf/i);
    expect(validateFile(new File(["x"], "nota.txt", { type: "text/plain" }))).toMatch(/apenas arquivos pdf/i);
  });
  it("aceita PDF dentro do limite e rejeita acima", () => {
    expect(validateFile(new File(["%PDF-1.4"], "ok.pdf", { type: "application/pdf" }))).toBeNull();
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "grande.pdf", { type: "application/pdf" });
    expect(validateFile(big)).toMatch(/excede o limite/i);
  });
});

describe("UploadDropzone", () => {
  it("não envia arquivos não-PDF e mostra o motivo", async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    renderWithProviders(<UploadDropzone />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const file = new File(["hello"], "planilha.xlsx", { type: "application/vnd.ms-excel" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("planilha.xlsx")).toBeInTheDocument();
    expect(screen.getByText(/apenas arquivos pdf/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/documents/upload"))).toBe(false);
  });

  it("envia PDF válido via multipart para /documents/upload", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch(() =>
      jsonResponse({ id: "d1", name: "ok.pdf", status: "uploaded" }, { status: 202 }),
    );
    renderWithProviders(<UploadDropzone />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "ok.pdf", { type: "application/pdf" })] } });

    expect(await screen.findByLabelText("Enviado")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/documents/upload"));
    expect(call).toBeDefined();
    expect(call![1]?.body).toBeInstanceOf(FormData);
    expect((call![1]?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});
