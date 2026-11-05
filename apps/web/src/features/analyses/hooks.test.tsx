import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient, jsonResponse, mockFetch } from "@/test/utils";
import type { Analysis } from "@/types/api";
import { ANALYSIS_POLL_MS, analysisRefetchInterval, useAnalysis } from "./hooks";

function makeAnalysis(over: Partial<Analysis> = {}): Analysis {
  return {
    id: "an-1",
    kind: "summary",
    summary_type: "general",
    status: "running",
    title: "Resumo geral — contrato.pdf",
    document_ids: ["d1"],
    documents: [{ id: "d1", name: "contrato.pdf", label: null }],
    question: null,
    result: null,
    error_message: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    created_at: "2026-11-05T10:00:00Z",
    started_at: null,
    finished_at: null,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("analysisRefetchInterval", () => {
  it("faz polling a cada 2,5 s enquanto a análise está ativa e para quando termina", () => {
    expect(analysisRefetchInterval(undefined)).toBe(false);
    expect(analysisRefetchInterval(makeAnalysis({ status: "queued" }))).toBe(ANALYSIS_POLL_MS);
    expect(analysisRefetchInterval(makeAnalysis({ status: "running" }))).toBe(2500);
    expect(analysisRefetchInterval(makeAnalysis({ status: "succeeded" }))).toBe(false);
    expect(analysisRefetchInterval(makeAnalysis({ status: "failed" }))).toBe(false);
    expect(analysisRefetchInterval(makeAnalysis({ status: "cancelled" }))).toBe(false);
  });
});

describe("useAnalysis", () => {
  it("continua buscando enquanto está em processamento e para ao concluir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    const fetchMock = mockFetch((url) => {
      if (url.includes("/analyses/an-1")) {
        calls += 1;
        return jsonResponse(makeAnalysis({ status: calls < 2 ? "running" : "succeeded" }));
      }
      return jsonResponse({}, { status: 404 });
    });
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAnalysis("an-1"), { wrapper });

    await waitFor(() => expect(result.current.data?.status).toBe("running"));
    await vi.advanceTimersByTimeAsync(ANALYSIS_POLL_MS + 100);
    await waitFor(() => expect(result.current.data?.status).toBe("succeeded"));
    const callsAfterDone = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ANALYSIS_POLL_MS * 2);
    expect(fetchMock.mock.calls.length).toBe(callsAfterDone); // sem novas buscas após concluir
  });

  it("não busca sem id", () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAnalysis(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
