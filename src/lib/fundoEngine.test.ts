import { describe, it, expect } from "vitest";
import { calcularFundoDiario, fundoRowsToDailyRows } from "./fundoEngine";
import { calcularCarteiraRendaFixa } from "./carteiraRendaFixaEngine";

/**
 * Os números esperados foram gerados pelo motor de fundos do vault
 * (`_engine/fundoEngine.mjs`), que é a referência já validada contra os
 * informes dos fundos. Este teste trava o port em TS nesses valores.
 */
function cenario() {
  const calendario: { data: string; dia_util: boolean }[] = [];
  const cotas: { data: string; valor_cota: number }[] = [];
  let cota = 10;
  const d0 = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 40; i++) {
    const dt = new Date(d0);
    dt.setUTCDate(d0.getUTCDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getUTCDay();
    const util = dow !== 0 && dow !== 6;
    calendario.push({ data: iso, dia_util: util });
    if (util) {
      cota = cota * 1.0005;
      cotas.push({ data: iso, valor_cota: Number(cota.toFixed(8)) });
    }
  }
  return {
    dataInicio: "2026-01-01",
    dataCalculo: "2026-02-09",
    calendario,
    cotas,
    movimentacoes: [
      { data: "2026-01-02", tipo: "Aplicação", valor: 100000 },
      { data: "2026-01-15", tipo: "Aplicação", valor: 50000 },
      { data: "2026-01-30", tipo: "Come-Cotas", valor: 300 },
      { data: "2026-02-05", tipo: "Resgate", valor: 40000 },
    ],
    fundo: { dias_cotizacao_aplicacao: 0, dias_cotizacao_resgate: 0 },
  };
}

describe("fundoEngine", () => {
  it("reproduz o motor do vault no centavo", () => {
    const rows = calcularFundoDiario(cenario());
    const ult = rows[rows.length - 1];

    expect(rows.length).toBe(40);
    expect(ult.data).toBe("2026-02-09");
    expect(ult.saldoCotas).toBeCloseTo(10984.56855721, 6);
    expect(ult.saldoBruto).toBeCloseTo(111393.95, 2);
    expect(ult.valorInvestido).toBeCloseTo(110120.33, 2);
    expect(ult.ganhoAcumulado).toBeCloseTo(1693.95, 2);
    expect(ult.rentabilidadeAcumuladaPct).toBeCloseTo(0.013081576153452845, 10);
    expect(ult.rentabilidadeAcumuladaMWPct).toBeCloseTo(0.012913263103053962, 10);
  });

  it("come-cotas sai de cotas, não de dinheiro novo", () => {
    const base = cenario();
    const semComeCotas = {
      ...base,
      movimentacoes: base.movimentacoes.filter((m) => m.tipo !== "Come-Cotas"),
    };
    const comRows = calcularFundoDiario(base);
    const semRows = calcularFundoDiario(semComeCotas);
    const com = comRows[comRows.length - 1];
    const sem = semRows[semRows.length - 1];

    // Menos cotas depois do come-cotas, mas o ganho acumulado ate ali e o mesmo
    // criterio: quem paga IR nao perde a rentabilidade que ja tinha corrido.
    expect(com.saldoCotas).toBeLessThan(sem.saldoCotas);
    expect(com.rentabilidadeAcumuladaPct).toBeCloseTo(sem.rentabilidadeAcumuladaPct, 10);
  });

  it("resgate que zera a posicao encerra o custo", () => {
    const base = cenario();
    const soAplicacao = [{ data: "2026-01-02", tipo: "Aplicação", valor: 100000 }];
    const semResgate = calcularFundoDiario({ ...base, movimentacoes: soAplicacao });
    const naVespera = semResgate.find((r) => r.data === "2026-02-05")!;

    const rows = calcularFundoDiario({
      ...base,
      movimentacoes: [
        ...soAplicacao,
        { data: "2026-02-05", tipo: "Resgate", valor: naVespera.saldoBruto, qtd_cotas: naVespera.saldoCotas },
      ],
    });
    const ult = rows[rows.length - 1];
    expect(ult.saldoCotas).toBe(0);
    expect(ult.valorInvestido).toBe(0);
  });

  it("as linhas alimentam o motor de carteira", () => {
    const base = cenario();
    const rows = calcularFundoDiario(base);
    const carteira = calcularCarteiraRendaFixa({
      productRows: [fundoRowsToDailyRows(rows)],
      calendario: base.calendario,
      dataInicio: base.dataInicio,
      dataCalculo: base.dataCalculo,
    });
    const ult = carteira[carteira.length - 1];

    // Consolidado de um fundo so tem que devolver o mesmo patrimonio e ganho.
    expect(ult.liquido).toBeCloseTo(111393.95, 2);
    expect(ult.rentAcumuladaRS).toBeCloseTo(1693.95, 2);
  });
});
