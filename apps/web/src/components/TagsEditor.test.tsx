import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TagsEditor, normalizeTag } from "./TagsEditor";

describe("TagsEditor", () => {
  it("normaliza tags (minúsculas, espaços) e ignora duplicadas", () => {
    expect(normalizeTag("  Contrato   Novo ")).toBe("contrato novo");
    const onChange = vi.fn();
    render(<TagsEditor value={["juridico"]} onChange={onChange} />);
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, { target: { value: "JURIDICO" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Fiscal," } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledWith(["juridico", "fiscal,"]);
  });

  it("remove pelo botão do chip e com Backspace no campo vazio", () => {
    const onChange = vi.fn();
    render(<TagsEditor value={["a", "b"]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Remover tag a"));
    expect(onChange).toHaveBeenCalledWith(["b"]);
    fireEvent.keyDown(screen.getByLabelText("Tags"), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
  });

  it("oferece sugestões não selecionadas", () => {
    const onChange = vi.fn();
    render(<TagsEditor value={["a"]} onChange={onChange} suggestions={["a", "b"]} />);
    expect(screen.queryByText("+ a")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("+ b"));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });
});
