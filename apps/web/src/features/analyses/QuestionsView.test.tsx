import { describe, expect, it, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation, useParams } from "react-router";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { Analysis } from "@/types/api";
import { QuestionsView } from "./DocumentAnalysesPanel";

const analysis: Analysis = {
  id: "q-1",
  kind: "questions",
  summary_type: null,
  status: "succeeded",
  title: "Perguntas sugeridas — contrato.pdf",
  document_ids: ["d1"],
  documents: [{ id: "d1", name: "contrato.pdf", label: null }],
  question: null,
  result: {
    content: "",
    sources: [],
    coverage: { chunks_used: 3, chunks_total: 3, tokens_used: 800, strategy: "single_pass", parts: 1, complete: true },
    limitations: [],
    questions: ["Qual é o prazo de aviso prévio para cancelamento?", "Qual é o valor mensal?"],
  },
  error_message: null,
  model: "fake-llm-v1",
  prompt_tokens: 800,
  completion_tokens: 60,
  latency_ms: 500,
  created_at: "2026-11-05T10:00:00Z",
  started_at: null,
  finished_at: null,
};

function ChatProbe() {
  const { conversationId } = useParams();
  const location = useLocation();
  const state = location.state as { firstMessage?: string } | null;
  return (
    <div data-testid="chat-probe">
      {conversationId}:{state?.firstMessage}
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("QuestionsView", () => {
  it("ao clicar numa pergunta cria uma conversa restrita ao documento e navega com a pergunta", async () => {
    const posted: unknown[] = [];
    mockFetch((url, init) => {
      if (url.includes("/auth/csrf")) return jsonResponse({ csrf_token: "t" });
      if (url.endsWith("/conversations") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return jsonResponse({ id: "conv-9", title: "Nova conversa", created_at: "", updated_at: "", message_count: 0, document_ids: ["d1"], collection_ids: [], messages: [] }, { status: 201 });
      }
      return jsonResponse({}, { status: 404 });
    });

    renderWithProviders(
      <Routes>
        <Route path="/documents/:id" element={<QuestionsView analysis={analysis} documentId="d1" />} />
        <Route path="/chat/:conversationId" element={<ChatProbe />} />
      </Routes>,
      { route: "/documents/d1" },
    );

    const chips = screen.getByLabelText("Perguntas sugeridas");
    expect(chips).toHaveTextContent("Qual é o valor mensal?");
    await userEvent.click(screen.getByRole("button", { name: "Qual é o prazo de aviso prévio para cancelamento?" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ document_ids: ["d1"], collection_ids: [] });
    expect(await screen.findByTestId("chat-probe")).toHaveTextContent("conv-9:Qual é o prazo de aviso prévio para cancelamento?");
  });

  it("informa quando não há perguntas utilizáveis", () => {
    renderWithProviders(<QuestionsView analysis={{ ...analysis, result: { ...analysis.result!, questions: [] } }} documentId="d1" />);
    expect(screen.getByText(/não devolveu perguntas utilizáveis/)).toBeInTheDocument();
  });
});
