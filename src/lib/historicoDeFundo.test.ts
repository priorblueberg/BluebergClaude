import { describe, expect, it } from "vitest";
import { ajustarMovimentosDerivados, primeiraSaidaSemSaldo, TIPO_MUDANCA_DE_FUNDO } from "./posicaoDeFundo";

const cotaEm = (d: string) => ({ "2025-01-02": 3 } as Record<string, number>)[d] ?? null;

const mov = (id: string, data: string, tipo: string, quantidade: number, valor = 0, extra: Record<string, unknown> = {}) => ({
  id, fundo_id: "f1", data, data_cotizacao: data, tipo_movimentacao: tipo, quantidade, valor,
  created_at: "2026-09-12T10:00:00Z", ...extra,
});

describe("Mudança de Fundo acompanha o histórico pelo fator de conversão", () => {
  const mudanca = mov("mud", "2024-10-01", TIPO_MUDANCA_DE_FUNDO, 1500, 4500, {
    fundo_id: "f2", preco_unitario: 3, fator_conversao: 1.5,
  });

  it("já exata: nada muda", () => {
    expect(ajustarMovimentosDerivados([mov("ap", "2024-05-08", "Aplicação Inicial", 1000), mudanca], cotaEm)).toEqual([]);
  });

  it("aplicação anterior lançada depois: a quantidade no fundo novo passa a ser saldo x fator", () => {
    const movs = [mov("ap", "2024-05-08", "Aplicação Inicial", 1000), mov("retro", "2024-07-01", "Aplicação", 200), mudanca];
    expect(ajustarMovimentosDerivados(movs, cotaEm)).toEqual([{ id: "mud", quantidade: 1800, valor: 5400, preco_unitario: 3 }]);
  });

  it("sem fator guardado, a mudança fica como está", () => {
    const semFator = { ...mudanca, fator_conversao: null };
    const movs = [mov("ap", "2024-05-08", "Aplicação Inicial", 1000), mov("retro", "2024-07-01", "Aplicação", 200), semFator];
    expect(ajustarMovimentosDerivados(movs, cotaEm)).toEqual([]);
  });

  it("resgate total depois da mudança leva a quantidade recalculada", () => {
    const movs = [
      mov("ap", "2024-05-08", "Aplicação Inicial", 1000),
      mov("retro", "2024-07-01", "Aplicação", 200),
      mudanca,
      mov("rt", "2025-01-02", "Resgate Total", 1500, 4500),
    ];
    expect(ajustarMovimentosDerivados(movs, cotaEm)).toEqual([
      { id: "mud", quantidade: 1800, valor: 5400, preco_unitario: 3 },
      { id: "rt", quantidade: 1800, valor: 5400, preco_unitario: 3 },
    ]);
  });
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

  it("mudança de fundo com fator converte o saldo antes de conferir", () => {
    const movs = [
      mov("ap", "2024-05-08", "Aplicação Inicial", 1000),
      mov("mud", "2024-10-01", TIPO_MUDANCA_DE_FUNDO, 1500, 4500, { fundo_id: "f2", preco_unitario: 3, fator_conversao: 1.5 }),
      mov("res", "2025-01-02", "Resgate", 1400),
    ];
    expect(primeiraSaidaSemSaldo(movs)).toBeNull();
    expect(primeiraSaidaSemSaldo(movs.map((m) => (m.id === "ap" ? { ...m, quantidade: 900 } : m)))?.saldo).toBe(1350);
  });
});
