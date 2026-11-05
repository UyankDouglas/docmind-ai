import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { AuditEntry, Member } from "@/types/api";
import { AuditPanel } from "./AuditPanel";

const entries: AuditEntry[] = [
  {
    id: "a1",
    action: "document.upload",
    user: { id: "u1", name: "Ana", email: "ana@example.com" },
    target_type: "document",
    target_id: "11111111-2222-3333-4444-555555555555",
    ip_address: "10.0.0.1",
    details: { size_bytes: 1234, mime_type: "application/pdf" },
    created_at: "2026-11-04T12:00:00Z",
  },
  { id: "a2", action: "user.login", user: null, target_type: null, target_id: null, ip_address: null, details: {}, created_at: "2026-11-03T12:00:00Z" },
];
const members: Member[] = [{ user_id: "u1", name: "Ana", email: "ana@example.com", role: "admin", joined_at: "2026-01-01T00:00:00Z" }];

describe("AuditPanel", () => {
  it("lista registros, expande detalhes e aplica filtros nos query params", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/workspaces/current/members")) return jsonResponse({ items: members });
      if (url.includes("/audit")) {
        const u = new URL(url, "http://localhost");
        const action = u.searchParams.get("action");
        const items = action ? entries.filter((e) => e.action === action) : entries;
        return jsonResponse({ items, total: items.length, page: 1, page_size: 25 });
      }
      return jsonResponse({});
    });
    renderWithProviders(<AuditPanel />);
    expect(await screen.findByText("document.upload")).toBeInTheDocument();
    expect(screen.getByText("user.login")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Mostrar detalhes" }));
    expect(screen.getByTestId("audit-details")).toHaveTextContent('"size_bytes": 1234');

    await userEvent.type(screen.getByLabelText("Ação"), "document.upload");
    await waitFor(() => expect(screen.queryByText("user.login")).not.toBeInTheDocument());
    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/audit?")).at(-1)![0]);
    const params = new URL(last, "http://localhost").searchParams;
    expect(params.get("action")).toBe("document.upload");
    expect(params.get("page")).toBe("1");
    expect(params.get("page_size")).toBe("25");
  });

  it("exporta CSV com os filtros atuais e dispara o download", async () => {
    const createUrl = vi.fn(() => "blob:audit");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchMock = mockFetch((url) => {
      if (url.includes("/workspaces/current/members")) return jsonResponse({ items: members });
      if (url.includes("/audit/export")) {
        return new Response("id,action\n", { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="auditoria.csv"' } });
      }
      if (url.includes("/audit")) return jsonResponse({ items: entries, total: 2, page: 1, page_size: 25 });
      return jsonResponse({});
    });
    renderWithProviders(<AuditPanel />);
    await screen.findByText("document.upload");
    await userEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/audit/export"));
    expect(new URL(String(exportCall![0]), "http://localhost").searchParams.get("format")).toBe("csv");
    expect(createUrl).toHaveBeenCalled();
  });
});
