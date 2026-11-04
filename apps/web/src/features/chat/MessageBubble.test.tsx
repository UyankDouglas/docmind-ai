import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/utils";
import type { Citation, Message } from "@/types/api";
import { MessageBubble } from "./MessageBubble";

const citation: Citation = {
  id: "c1",
  index: 1,
  chunk_id: "ch1",
  document_id: "d1",
  document_name: "Contrato.pdf",
  page_start: 8,
  page_end: 8,
  section_title: null,
  snippet: "O prazo para cancelamento é de 30 dias…",
};

function msg(partial: Partial<Message>): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "O contrato prevê **30 dias** para cancelamento [1].",
    created_at: "2026-03-01T12:00:00Z",
    status: "ok",
    citations: [citation],
    model: "modelo-x",
    prompt_tokens: 100,
    completion_tokens: 20,
    latency_ms: 1200,
    feedback: null,
    ...partial,
  };
}

describe("MessageBubble", () => {
  it("renderiza marcadores [n] como chips clicáveis e lista as fontes com página", async () => {
    const onCitation = vi.fn();
    renderWithProviders(<MessageBubble message={msg({})} onCitationClick={onCitation} />);

    expect(screen.getByText("30 dias")).toBeInTheDocument();
    const chip = screen.getByTestId("citation-chip-1");
    expect(chip).toHaveAccessibleName("Fonte 1: Contrato.pdf — Página 8");
    await userEvent.click(chip);
    expect(onCitation).toHaveBeenCalledWith(citation);

    const source = screen.getByTestId("citation-source-1");
    expect(source).toHaveTextContent("Contrato.pdf — Página 8");
    await userEvent.click(source);
    expect(onCitation).toHaveBeenCalledTimes(2);
  });

  it("não transforma em chip um marcador sem fonte correspondente", () => {
    renderWithProviders(<MessageBubble message={msg({ content: "Texto [7] sem fonte.", citations: [] })} />);
    expect(screen.queryByTestId("citation-chip-7")).not.toBeInTheDocument();
    expect(screen.getByText("[7]")).toBeInTheDocument();
    expect(screen.queryByText("Fontes")).not.toBeInTheDocument();
  });

  it("exibe aviso distinto para no_evidence", () => {
    renderWithProviders(
      <MessageBubble
        message={msg({ status: "no_evidence", citations: [], content: "Não encontrei informações suficientes nos documentos selecionados para responder com segurança." })}
      />,
    );
    expect(screen.getByTestId("no-evidence")).toBeInTheDocument();
    expect(screen.getByText(/não encontrei informações suficientes/i)).toBeInTheDocument();
  });

  it("exibe aviso distinto para ai_unavailable e oculta feedback", () => {
    renderWithProviders(
      <MessageBubble message={msg({ status: "ai_unavailable", citations: [], content: "IA indisponível." })} onFeedback={vi.fn()} />,
    );
    expect(screen.getByTestId("ai-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resposta útil" })).not.toBeInTheDocument();
  });

  it("dispara feedback positivo/negativo", async () => {
    const onFeedback = vi.fn();
    renderWithProviders(<MessageBubble message={msg({})} onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole("button", { name: "Resposta útil" }));
    expect(onFeedback).toHaveBeenCalledWith("m1", 1);
    await userEvent.click(screen.getByRole("button", { name: "Resposta não útil" }));
    expect(onFeedback).toHaveBeenCalledWith("m1", -1);
  });
});
