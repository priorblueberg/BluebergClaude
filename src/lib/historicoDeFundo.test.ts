import { describe, expect, it } from "vitest";
import { primeiraSaidaSemSaldo } from "./posicaoDeFundo";

const mov = (id: string, data: string, tipo: string, quantidade: number, valor = 0) => ({
  id, fundo_id: "f1", data, data_cotizacao: data, tipo_movimentacao: tipo, quantidade, valor,
  created_at: "2026-09-12T10:00:00Z",
});

describe("saída posterior sem saldo", () => {
  const base = [mov("ap", "2024-05-08", "Aplicação Inicial", 1000), mov("res", "2025-01-02", "Resgate", 800)];

  it("histórico coerente: nenhuma", () => {
    expect(primeiraSaidaSemSaldo(base)).toBeNull();
  });

  it("aplicação editada para menos deixa o resgate posterior sem saldo", () => {
    const editada = base.map((m) => (m.id === "ap" ? { ...m, quantidade: 500 } : m));
    expect(primeiraSaidaSemSaldo(editada)).toEqual({ id: "res", data: "2025-01-02", tipo: "Resgate", quantidade: 800, saldo: 500 });
  });

  it("aplicação excluída deixa o resgate posterior sem saldo", () => {
    expect(primeiraSaidaSemSaldo(base.filter((m) => m.id !== "ap"))?.id).toBe("res");
  });

  it("resgate retroativo que consome o saldo de um resgate posterior", () => {
    const movs = [...base, mov("retro", "2024-10-01", "Resgate", 300)];
    expect(primeiraSaidaSemSaldo(movs)).toEqual({ id: "res", data: "2025-01-02", tipo: "Resgate", quantidade: 800, saldo: 700 });
  });

  it("come-cotas também é conferido; resgate total nunca falta", () => {
    expect(primeiraSaidaSemSaldo([mov("ap", "2024-05-08", "Aplicação Inicial", 10), mov("cc", "2024-05-31", "Come-Cotas", 11)])?.tipo)
      .toBe("Come-Cotas");
    expect(primeiraSaidaSemSaldo([mov("ap", "2024-05-08", "Aplicação Inicial", 10), mov("rt", "2025-01-02", "Resgate Total", 999)]))
      .toBeNull();
  });
});
