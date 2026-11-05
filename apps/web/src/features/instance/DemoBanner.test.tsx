import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { DemoBanner } from "./DemoBanner";

const demo = {
  demo_mode: true,
  registration_enabled: true,
  demo_samples_available: true,
  demo_notice: "Demonstração pública com documentos fictícios. Não envie documentos reais nem dados pessoais.",
};

describe("DemoBanner", () => {
  afterEach(() => window.localStorage.clear());

  it("exibe o aviso da demonstração vindo do servidor", async () => {
    mockFetch(() => jsonResponse(demo));
    renderWithProviders(<DemoBanner />);
    expect(await screen.findByTestId("demo-banner")).toHaveTextContent("Não envie documentos reais");
    expect(screen.queryByRole("button", { name: /ocultar/i })).not.toBeInTheDocument();
  });

  it("não aparece fora do modo demonstração", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ...demo, demo_mode: false, demo_notice: null }));
    renderWithProviders(<DemoBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("demo-banner")).not.toBeInTheDocument();
  });

  it("pode ser ocultado dentro do app", async () => {
    mockFetch(() => jsonResponse(demo));
    renderWithProviders(<DemoBanner dismissible />);
    await userEvent.click(await screen.findByRole("button", { name: /ocultar aviso/i }));
    expect(screen.queryByTestId("demo-banner")).not.toBeInTheDocument();
  });
});
