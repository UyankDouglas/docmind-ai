import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { Collection } from "@/types/api";
import { CollectionsPanel } from "./CollectionsPanel";

const base: Collection = {
  id: "c1",
  name: "Contratos",
  description: null,
  color: "#8B5CF6",
  document_count: 3,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T00:00:00Z",
};

describe("CollectionsPanel", () => {
  it("lista coleções com contagem e cria uma nova", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const items: Collection[] = [base];
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/collections") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { name: string };
        const created = { ...base, id: "c2", name: body.name, document_count: 0 };
        items.push(created);
        return jsonResponse(created, { status: 201 });
      }
      if (url.includes("/collections")) return jsonResponse({ items });
      return jsonResponse({ items: [], total: 0, page: 1, page_size: 20 });
    });
    renderWithProviders(<CollectionsPanel canManage />);
    expect(await screen.findByText("Contratos")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Nova coleção" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Políticas");
    await userEvent.click(screen.getByRole("button", { name: "Criar coleção" }));

    const nav = screen.getByRole("navigation", { name: "Lista de coleções" });
    await waitFor(() => expect(within(nav).getByText("Políticas")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ name: "Políticas" });
  });

  it("valida nome curto e mostra erro da API (409)", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    mockFetch((url, init) => {
      if (init?.method === "POST") return jsonResponse({ error: { code: "collection_exists", message: "Já existe uma coleção com esse nome." } }, { status: 409 });
      if (url.includes("/collections")) return jsonResponse({ items: [base] });
      return jsonResponse({});
    });
    renderWithProviders(<CollectionsPanel canManage />);
    await screen.findByText("Contratos");
    await userEvent.click(screen.getByRole("button", { name: "Nova coleção" }));
    await userEvent.type(screen.getByLabelText("Nome"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Criar coleção" }));
    expect(await screen.findByText(/2 a 80 caracteres/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome"), "Contratos");
    await userEvent.click(screen.getByRole("button", { name: "Criar coleção" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma coleção com esse nome.");
  });

  it("renomeia e exclui com confirmação informando que os documentos são mantidos", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "PATCH") return jsonResponse({ ...base, name: "Contratos 2026" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/collections")) return jsonResponse({ items: [base] });
      return jsonResponse({});
    });
    renderWithProviders(<CollectionsPanel canManage />);
    await screen.findByText("Contratos");

    await userEvent.click(screen.getByRole("button", { name: "Ações da coleção Contratos" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Renomear/ }));
    const name = screen.getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Contratos 2026");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH" && String(c[0]).endsWith("/collections/c1"))).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Ações da coleção Contratos" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Excluir/ }));
    expect(await screen.findByText(/não serão excluídos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Excluir coleção" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE" && String(c[0]).endsWith("/collections/c1"))).toBe(true));
  });

  it("sem permissão de gestão não mostra ações", async () => {
    mockFetch(() => jsonResponse({ items: [base] }));
    renderWithProviders(<CollectionsPanel canManage={false} />);
    await screen.findByText("Contratos");
    expect(screen.queryByRole("button", { name: "Nova coleção" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ações da coleção/ })).not.toBeInTheDocument();
  });
});
