import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { authKeys } from "@/features/auth/hooks";
import type { Invitation, Member, UserMe } from "@/types/api";
import { MembersPanel } from "./MembersPanel";

const me: UserMe = {
  id: "u1",
  name: "Ana",
  email: "ana@example.com",
  created_at: "2026-01-01T00:00:00Z",
  workspace: { id: "w1", name: "Workspace", slug: "w", role: "admin" },
};
const members: Member[] = [
  { user_id: "u1", name: "Ana", email: "ana@example.com", role: "admin", joined_at: "2026-01-01T00:00:00Z" },
  { user_id: "u2", name: "Bruno", email: "bruno@example.com", role: "viewer", joined_at: "2026-02-01T00:00:00Z" },
];
const invitation: Invitation = {
  id: "i1",
  email: "nova@example.com",
  role: "editor",
  status: "pending",
  invited_by: { id: "u1", name: "Ana" },
  created_at: "2026-11-04T00:00:00Z",
  expires_at: "2026-11-11T00:00:00Z",
  accepted_at: null,
  accept_url: "http://localhost:5173/invite/abc123",
};

function setup(handler: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(handler);
  const { client } = renderWithProviders(<MembersPanel />);
  client.setQueryData(authKeys.me, me);
  return { fetchMock, client };
}

describe("MembersPanel", () => {
  it("altera papel e remove membro com confirmação", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const { fetchMock } = setup((url, init) => {
      if (url.endsWith("/workspaces/current/members/u2") && init?.method === "PATCH") return jsonResponse({ ...members[1], role: "editor" });
      if (url.endsWith("/workspaces/current/members/u2") && init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/workspaces/current/members")) return jsonResponse({ items: members });
      if (url.includes("/workspaces/current/invitations")) return jsonResponse({ items: [] });
      return jsonResponse(me);
    });
    expect(await screen.findByText("bruno@example.com")).toBeInTheDocument();
    // o próprio usuário não pode se remover
    expect(screen.getByRole("button", { name: "Remover Ana" })).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox", { name: "Papel de Bruno" }));
    await userEvent.click(await screen.findByRole("option", { name: "Editor" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH" && String(c[0]).endsWith("/members/u2"))).toBe(true));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ role: "editor" });

    await userEvent.click(screen.getByRole("button", { name: "Remover Bruno" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/perderá o acesso imediato/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remover membro" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE" && String(c[0]).endsWith("/members/u2"))).toBe(true));
  });

  it("convida por e-mail e mostra o link de aceite; lista e revoga convites pendentes", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const pending: Invitation[] = [];
    const { fetchMock } = setup((url, init) => {
      if (url.endsWith("/workspaces/current/invitations") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { email: string; role: string };
        const created = { ...invitation, email: body.email, role: body.role as Invitation["role"] };
        pending.push(created);
        return jsonResponse(created, { status: 201 });
      }
      if (url.endsWith("/workspaces/current/invitations/i1") && init?.method === "DELETE") {
        pending.length = 0;
        return new Response(null, { status: 204 });
      }
      if (url.includes("/workspaces/current/invitations")) return jsonResponse({ items: pending });
      if (url.includes("/workspaces/current/members")) return jsonResponse({ items: members });
      return jsonResponse(me);
    });
    await screen.findByText("bruno@example.com");
    expect(screen.getByText("Nenhum convite pendente.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Convidar/ }));
    await userEvent.type(await screen.findByLabelText("E-mail"), "nova@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Enviar convite" }));
    expect(await screen.findByLabelText("Link de aceite")).toHaveValue("http://localhost:5173/invite/abc123");
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post![1]!.body))).toEqual({ email: "nova@example.com", role: "editor" });
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));

    const list = await screen.findByRole("list", { name: "Convites pendentes" });
    expect(within(list).getByText("nova@example.com")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Revogar convite de nova@example.com" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE" && String(c[0]).endsWith("/invitations/i1"))).toBe(true));
  });
});
