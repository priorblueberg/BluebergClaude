import { describe, expect, it } from "vitest";
import { calcularFundoDiario, TIPO_MUDANCA_DE_FUNDO } from "./fundoEngine";
import { cotasCosturadas, trechosDaPosicao } from "./posicaoDeFundo";

// Cotas reais da passagem do Kinea: Advisory ate 10/04/2025, Subclasse II a partir de 11/04/2025.
const calendario = ["2025-04-09", "2025-04-10", "2025-04-11", "2025-04-14"].map((data) => ({ data, dia_util: true }));
const cotasPorFundo = new Map([
  ["advisory", [{ data: "2025-04-09", valor_cota: 1.5271147 }, { data: "2025-04-10", valor_cota: 1.5267928 }]],
  ["subclasse-ii", [{ data: "2025-04-11", valor_cota: 1.5302534 }, { data: "2025-04-14", valor_cota: 1.532315 }]],
]);

type Mov = { fundo_id: string; data: string; tipo_movimentacao: string; quantidade: number; valor: number };

function rodar(movs: Mov[], cotas = cotasPorFundo) {
  return calcularFundoDiario({
    dataInicio: "2025-04-09",
    dataCalculo: "2025-04-14",
    calendario,
    cotas: cotasCosturadas(trechosDaPosicao(movs), cotas),
    movimentacoes: movs.map((m) => ({ data: m.data, tipo: m.tipo_movimentacao, valor: m.valor, qtd_cotas: m.quantidade })),
  });
}

const aplicacao: Mov = { fundo_id: "advisory", data: "2025-04-09", tipo_movimentacao: "Aplicação Inicial", quantidade: 1000, valor: 1527.1147 };
const mudanca: Mov = { fundo_id: "subclasse-ii", data: "2025-04-11", tipo_movimentacao: TIPO_MUDANCA_DE_FUNDO, quantidade: 1000, valor: 1526.7928 };

describe("motor de fundos com mudanca de fundo", () => {
  it("1:1 (Kinea): a posicao segue como se fosse um fundo so", () => {
    const rows = rodar([aplicacao, mudanca]);
    const dia = rows.find((r) => r.data === "2025-04-11")!;
    expect(dia.saldoCotas).toBe(1000);
    // Nao e dinheiro entrando nem saindo.
    expect(dia.aplicacoes).toBe(0);
    expect(dia.resgatesBrutos).toBe(0);
    expect(dia.ganhoDiario).toBeCloseTo(1000 * (1.5302534 - 1.5267928), 8);
    expect(dia.valorInvestido).toBeCloseTo(1527.1147, 6);
    // A rentabilidade acumulada e a razao das cotas das duas pontas, sem degrau na costura.
    expect(rows.at(-1)!.rentabilidadeAcumuladaPct).toBeCloseTo(1.532315 / 1.5271147 - 1, 12);
  });

  it("com fator de conversao a quantidade muda, mas valor e rentabilidade nao saltam", () => {
    // O fundo novo tem cota 100x maior: o cliente passa a ter 10 cotas no lugar de 1000.
    const cotas100 = new Map(cotasPorFundo);
    cotas100.set("subclasse-ii", cotasPorFundo.get("subclasse-ii")!.map((c) => ({ ...c, valor_cota: c.valor_cota * 100 })));
    const rows = rodar([aplicacao, { ...mudanca, quantidade: 10 }], cotas100);
    const dia = rows.find((r) => r.data === "2025-04-11")!;
    expect(dia.saldoCotas).toBe(10);
    expect(dia.saldoBruto).toBeCloseTo(10 * 153.02534, 6);
    expect(dia.ganhoDiario).toBeCloseTo(1000 * (1.5302534 - 1.5267928), 6);
    expect(rows.at(-1)!.rentabilidadeAcumuladaPct).toBeCloseTo(1.532315 / 1.5271147 - 1, 10);
    expect(rows.at(-1)!.rentabilidadeAcumuladaMWPct).toBeCloseTo(1.532315 / 1.5271147 - 1, 10);
  });

  it("sem posicao na data da mudanca nada acontece", () => {
    const rows = rodar([{ ...mudanca }]);
    expect(rows.every((r) => r.saldoCotas === 0)).toBe(true);
  });
});
