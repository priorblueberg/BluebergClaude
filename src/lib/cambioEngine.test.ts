import { describe, it, expect } from "vitest";
import { calcularCambioDiario, cambioRowsToDailyRows } from "./cambioEngine";
import { calcularCarteiraRendaFixa } from "./carteiraRendaFixaEngine";

/** Cinco dias úteis com a cotação subindo de 5,00 para 5,50. */
function cenario() {
  const dias = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
  return {
    dataInicio: dias[0],
    dataCalculo: dias[4],
    calendario: dias.map((d) => ({ data: d, dia_util: true })),
    cotacoes: [5.0, 5.1, 5.2, 5.4, 5.5].map((c, i) => ({ data: dias[i], cotacao: c })),
  };
}

describe("cambioEngine", () => {
  it("compra converte reais em moeda pela cotação do dia", () => {
    const base = cenario();
    const rows = calcularCambioDiario({
      ...base,
      movimentacoes: [{ data: "2026-03-02", tipo: "Compra", valor: 10000 }],
    });
    const ult = rows[rows.length - 1];

    expect(rows[0].saldoMoeda).toBeCloseTo(2000, 8); // 10.000 / 5,00
    expect(ult.saldoMoeda).toBeCloseTo(2000, 8);
    expect(ult.saldoReais).toBeCloseTo(11000, 2); // 2.000 x 5,50
    expect(ult.ganhoAcumulado).toBeCloseTo(1000, 2);
    expect(ult.valorInvestido).toBeCloseTo(10000, 2);
    expect(ult.rentabilidadeAcumuladaPct).toBeCloseTo(0.1, 8); // só variação cambial
  });

  it("venda parcial baixa custo médio e mantém o ganho já corrido", () => {
    const base = cenario();
    const rows = calcularCambioDiario({
      ...base,
      movimentacoes: [
        { data: "2026-03-02", tipo: "Compra", valor: 10000 },
        { data: "2026-03-06", tipo: "Venda", valor: 5500, quantidade: 1000 },
      ],
    });
    const ult = rows[rows.length - 1];

    expect(ult.saldoMoeda).toBeCloseTo(1000, 8);
    expect(ult.saldoReais).toBeCloseTo(5500, 2);
    expect(ult.valorInvestido).toBeCloseTo(5000, 2); // 1.000 x custo médio de 5,00
    expect(ult.ganhoAcumulado).toBeCloseTo(1000, 2);
  });

  it("venda total encerra a posição e pode dar prejuízo", () => {
    const dias = ["2026-03-02", "2026-03-03", "2026-03-04"];
    const rows = calcularCambioDiario({
      dataInicio: dias[0],
      dataCalculo: dias[2],
      calendario: dias.map((d) => ({ data: d, dia_util: true })),
      cotacoes: [{ data: dias[0], cotacao: 6.0 }, { data: dias[1], cotacao: 5.5 }, { data: dias[2], cotacao: 5.4 }],
      movimentacoes: [
        { data: dias[0], tipo: "Compra", valor: 6000 },
        { data: dias[2], tipo: "Venda", valor: 5400, quantidade: 1000 },
      ],
    });
    const ult = rows[rows.length - 1];

    expect(ult.saldoMoeda).toBe(0);
    expect(ult.valorInvestido).toBe(0);
    expect(ult.ganhoAcumulado).toBeCloseTo(-600, 2);
  });

  it("entra no motor de carteira como qualquer outra posição", () => {
    const base = cenario();
    const rows = calcularCambioDiario({
      ...base,
      movimentacoes: [{ data: "2026-03-02", tipo: "Compra", valor: 10000 }],
    });
    const carteira = calcularCarteiraRendaFixa({
      productRows: [cambioRowsToDailyRows(rows)],
      calendario: base.calendario,
      dataInicio: base.dataInicio,
      dataCalculo: base.dataCalculo,
    });
    const ult = carteira[carteira.length - 1];

    expect(ult.liquido).toBeCloseTo(11000, 2);
    expect(ult.rentAcumuladaRS).toBeCloseTo(1000, 2);
  });
});
