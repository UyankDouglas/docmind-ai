import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { authKeys } from "@/features/auth/hooks";
import type { UserMe, WorkspaceMembership } from "@/types/api";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const me: UserMe = {
  id: "u1",
  name: "Ana",
  email: "ana@example.com",
  created_at: "2026-01-01T00:00:00Z",
  workspace: { id: "w1", name: "Workspace de Ana", slug: "ana", role: "admin" },
};
const memberships: WorkspaceMembership[] = [
  { id: "w1", name: "Workspace de Ana", slug: "ana", role: "admin", is_current: true },
  { id: "w2", name: "Jurídico", slug: "juridico", role: "viewer", is_current: false },
];

describe("WorkspaceSwitcher", () => {
  it("lista workspaces, troca pela API, limpa o cache e navega para o início", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    let current: UserMe = me;
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/workspaces/switch") && init?.method === "POST") {
        current = { ...me, workspace: { id: "w2", name: "Jurídico", slug: "juridico", role: "viewer" } };
        return jsonResponse(current);
      }
      if (url.endsWith("/workspaces")) return jsonResponse({ items: memberships });
      if (url.endsWith("/auth/me")) return jsonResponse(current);
      return jsonResponse({ items: [] });
    });
    const { client } = renderWithProviders(
      <Routes>
        <Route path="/documents" element={<WorkspaceSwitcher />} />
        <Route path="/" element={<p>Dashboard do novo workspace</p>} />
      </Routes>,
      { route: "/documents" },
    );
    client.setQueryData(authKeys.me, me);
    client.setQueryData(["documents", "list"], { items: [1] });

    await userEvent.click(screen.getByRole("button", { name: "Trocar de workspace" }));
    const item = await screen.findByRole("menuitem", { name: /Jurídico/ });
    expect(screen.getByRole("menuitem", { name: /Workspace de Ana/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(item);

    await waitFor(() => expect(screen.getByText("Dashboard do novo workspace")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post![1]!.body))).toEqual({ workspace_id: "w2" });
    // cache antigo descartado (o usuário é recarregado de /auth/me já no novo workspace)
    expect(client.getQueryData(["documents", "list"])).toBeUndefined();
    expect(current.workspace.id).toBe("w2");
  });
});
