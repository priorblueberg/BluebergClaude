import { describe, it, expect } from "vitest";
import { resgateTotalDeMovs } from "./syncEngine";

const mov = (data: string, tipo: string) => ({ codigo_custodia: "1", data, tipo_movimentacao: tipo });

describe("resgateTotalDeMovs", () => {
  it("sem resgate total, quem encerra é o vencimento", () => {
    const movs = [mov("2024-01-03", "Aplicação Inicial"), mov("2025-06-10", "Resgate")];
    expect(resgateTotalDeMovs(movs, "2027-01-15")).toBe("2027-01-15");
    expect(resgateTotalDeMovs(movs, null)).toBeNull();
  });

  it("vale o resgate total mais recente", () => {
    const movs = [
      mov("2024-01-03", "Aplicação Inicial"),
      mov("2024-08-01", "Resgate Total"),
      mov("2025-03-05", "Resgate Total"),
    ];
    expect(resgateTotalDeMovs(movs, "2027-01-15")).toBe("2025-03-05");
  });

  it("aplicação depois do resgate total reabre a posição", () => {
    const movs = [
      mov("2024-01-03", "Aplicação Inicial"),
      mov("2024-08-01", "Resgate Total"),
      mov("2024-09-10", "Aplicação"),
    ];
    expect(resgateTotalDeMovs(movs, "2027-01-15")).toBe("2027-01-15");
  });

  it("aplicação ANTES do resgate total não reabre nada", () => {
    const movs = [
      mov("2024-01-03", "Aplicação Inicial"),
      mov("2024-05-02", "Aplicação"),
      mov("2024-08-01", "Resgate Total"),
    ];
    expect(resgateTotalDeMovs(movs, "2027-01-15")).toBe("2024-08-01");
  });

  it("posição sem movimentação nenhuma", () => {
    expect(resgateTotalDeMovs([], "2027-01-15")).toBe("2027-01-15");
  });
});
