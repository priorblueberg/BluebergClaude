import { describe, it, expect } from "vitest";
import { calcularAcoesDiario, IR_JCP, type EventoCorporativo, type Provento } from "./acoesEngine";

/** Calendario com todos os dias; `dia_util` marca segunda a sexta. */
function calendarioEntre(de: string, ate: string) {
  const dias: { data: string; dia_util: boolean }[] = [];
  const d = new Date(de + "T00:00:00Z");
  const fim = new Date(ate + "T00:00:00Z");
  while (d <= fim) {
    const dow = d.getUTCDay();
    dias.push({ data: d.toISOString().slice(0, 10), dia_util: dow !== 0 && dow !== 6 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

/** Serie de precos constante, para isolar o efeito de cada evento. */
function precoFixo(de: string, ate: string, valor: number) {
  return calendarioEntre(de, ate).filter((c) => c.dia_util).map((c) => ({ data: c.data, fechamento: valor }));
}

function precos(pares: [string, number][]) {
  return pares.map(([data, fechamento]) => ({ data, fechamento }));
}

const rodar = (o: Partial<Parameters<typeof calcularAcoesDiario>[0]> & {
  precos: { data: string; fechamento: number }[];
  movimentacoes: Parameters<typeof calcularAcoesDiario>[0]["movimentacoes"];
  dataInicio: string; dataCalculo: string;
}) => calcularAcoesDiario({
  calendario: calendarioEntre(o.dataInicio, o.dataCalculo),
  proventos: [], eventos: [],
  ...o,
});

const ultimo = <T>(a: T[]) => a[a.length - 1];

describe("posicao basica", () => {
  it("quantidade sai do valor dividido pelo preco quando nao e informada", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precoFixo("2026-01-05", "2026-01-09", 20),
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000 }],
    });
    expect(ultimo(rows).quantidade).toBeCloseTo(100, 8);
    expect(ultimo(rows).valorPosicao).toBeCloseTo(2000, 2);
  });

  it("a quantidade informada manda, e o preco medio sai dela", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precoFixo("2026-01-05", "2026-01-09", 20),
      // 100 acoes por R$ 2.010,00 = R$ 20,10 de preco medio (R$ 10 de corretagem)
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100, custos: 10 }],
    });
    expect(ultimo(rows).quantidade).toBeCloseTo(100, 8);
    expect(ultimo(rows).valorInvestido).toBeCloseTo(2010, 2);
    expect(ultimo(rows).custoMedio).toBeCloseTo(20.1, 6);
    // A posicao vale o preco de mercado, nao o custo: 100 x 20.
    expect(ultimo(rows).valorPosicao).toBeCloseTo(2000, 2);
  });

  it("o ganho de preco e quantidade x variacao", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-07",
      precos: precos([["2026-01-05", 20], ["2026-01-06", 22], ["2026-01-07", 22]]),
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 }],
    });
    expect(rows.find((r) => r.data === "2026-01-06")!.ganhoPreco).toBeCloseTo(200, 2);
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(200, 2);
    expect(ultimo(rows).rentabilidadeAcumuladaPct).toBeCloseTo(0.10, 8);
  });
});

/**
 * O teste que mais importa: desdobramento nao cria nem destroi dinheiro. A posicao vale
 * exatamente o mesmo no dia anterior e no dia do evento - o que muda e so a contagem.
 */
describe("desdobramento, grupamento e bonificacao", () => {
  const split2x1: EventoCorporativo[] = [{ tipo: "DESDOBRAMENTO", fator: 2, data_ex: "2026-01-07" }];

  it("um 2 para 1 dobra a quantidade e nao mexe no valor da posicao", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      // O preco de mercado cai pela metade no dia do desdobramento; e o mesmo dinheiro.
      precos: precos([["2026-01-05", 20], ["2026-01-06", 20], ["2026-01-07", 10], ["2026-01-08", 10]]),
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 }],
      eventos: split2x1,
    });
    const antes = rows.find((r) => r.data === "2026-01-06")!;
    const depois = rows.find((r) => r.data === "2026-01-07")!;

    expect(antes.quantidade).toBeCloseTo(200, 8);   // ja em unidades de hoje
    expect(depois.quantidade).toBeCloseTo(200, 8);
    expect(antes.valorPosicao).toBeCloseTo(2000, 2);
    expect(depois.valorPosicao).toBeCloseTo(2000, 2);
    // E o mais importante: o evento nao aparece como ganho nenhum.
    expect(depois.ganhoDiario).toBeCloseTo(0, 6);
    expect(ultimo(rows).rentabilidadeAcumuladaPct).toBeCloseTo(0, 8);
  });

  it("quem compra DEPOIS do evento nao e afetado por ele", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precos([["2026-01-05", 20], ["2026-01-06", 20], ["2026-01-07", 10],
                      ["2026-01-08", 10], ["2026-01-09", 10]]),
      movimentacoes: [{ data: "2026-01-08", tipo: "Compra", valor: 1000, quantidade: 100 }],
      eventos: split2x1,
    });
    expect(ultimo(rows).quantidade).toBeCloseTo(100, 8);
    expect(ultimo(rows).valorPosicao).toBeCloseTo(1000, 2);
  });

  it("grupamento de 1 para 10 reduz a quantidade e preserva o valor", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: precos([["2026-01-05", 2], ["2026-01-06", 2], ["2026-01-07", 20], ["2026-01-08", 20]]),
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 1000 }],
      eventos: [{ tipo: "GRUPAMENTO", fator: 0.1, data_ex: "2026-01-07" }],
    });
    expect(ultimo(rows).quantidade).toBeCloseTo(100, 8);
    expect(ultimo(rows).valorPosicao).toBeCloseTo(2000, 2);
    expect(ultimo(rows).rentabilidadeAcumuladaPct).toBeCloseTo(0, 8);
  });
});

describe("proventos", () => {
  const compra100 = [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 }];
  /** Preco cai de 20 para 19 na data-ex justamente porque o dividendo de R$ 1,00 saiu. */
  const serieComQueda = precos([["2026-01-05", 20], ["2026-01-06", 20], ["2026-01-07", 19], ["2026-01-08", 19]]);

  it("dividendo entra como ganho no dia-ex, sem mexer na quantidade", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo: "DIVIDENDO", valor: 1, data_ex: "2026-01-07", data_pagamento: "2026-03-20" }],
    });
    const ex = rows.find((r) => r.data === "2026-01-07")!;
    expect(ex.proventoBruto).toBeCloseTo(100, 2);
    expect(ex.proventoLiquido).toBeCloseTo(100, 2);   // dividendo nao tem IR
    expect(ex.quantidade).toBeCloseTo(100, 8);
    // A queda de preco (-100) e o dividendo (+100) se anulam: o dia foi neutro.
    expect(ex.ganhoPreco).toBeCloseTo(-100, 2);
    expect(ex.ganhoDiario).toBeCloseTo(0, 2);
  });

  it("sem o provento, o dia-ex viraria uma perda que nao existiu", () => {
    const semProvento = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
    });
    expect(ultimo(semProvento).rentabilidadeAcumuladaPct).toBeCloseTo(-0.05, 8);

    const comProvento = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo: "DIVIDENDO", valor: 1, data_ex: "2026-01-07" }],
    });
    // Com o provento somado de volta, a rentabilidade fica em zero, que e a verdade.
    expect(ultimo(comProvento).rentabilidadeAcumuladaPct).toBeCloseTo(0, 8);
  });

  it("JCP entra liquido de 15% de IR; dividendo nao", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo: "JCP", valor: 1, data_ex: "2026-01-07" }],
    });
    const ex = rows.find((r) => r.data === "2026-01-07")!;
    expect(ex.proventoBruto).toBeCloseTo(100, 2);
    expect(ex.proventoLiquido).toBeCloseTo(100 * (1 - IR_JCP), 2);
    expect(IR_JCP).toBe(0.15);
  });

  it("desligar o IR do JCP devolve o bruto", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo: "JCP", valor: 1, data_ex: "2026-01-07" }],
      descontarIrDoJcp: false,
    });
    expect(rows.find((r) => r.data === "2026-01-07")!.proventoLiquido).toBeCloseTo(100, 2);
  });

  it("quem nao tinha a acao na data-ex nao recebe nada", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precos([["2026-01-05", 20], ["2026-01-06", 20], ["2026-01-07", 19],
                      ["2026-01-08", 19], ["2026-01-09", 19]]),
      movimentacoes: [{ data: "2026-01-08", tipo: "Compra", valor: 1900, quantidade: 100 }],
      proventos: [{ tipo: "DIVIDENDO", valor: 1, data_ex: "2026-01-07" }],
    });
    expect(ultimo(rows).proventoAcumulado).toBeCloseTo(0, 6);
  });

  /**
   * O provento e por acao da EPOCA. Se a quantidade foi multiplicada pelo desdobramento e o
   * valor por acao nao for dividido pelo mesmo fator, o total recebido dobra junto - dinheiro
   * do nada. Este teste existe para travar exatamente isso.
   */
  it("provento anterior a um desdobramento nao dobra junto com a quantidade", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precos([["2026-01-05", 20], ["2026-01-06", 19], ["2026-01-07", 19],
                      ["2026-01-08", 9.5], ["2026-01-09", 9.5]]),
      movimentacoes: [{ data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 }],
      // R$ 1,00 por acao quando havia 100 acoes = R$ 100,00. O split vem DEPOIS.
      proventos: [{ tipo: "DIVIDENDO", valor: 1, data_ex: "2026-01-06" }],
      eventos: [{ tipo: "DESDOBRAMENTO", fator: 2, data_ex: "2026-01-08" }],
    });
    expect(ultimo(rows).proventoAcumulado).toBeCloseTo(100, 2);
    expect(ultimo(rows).quantidade).toBeCloseTo(200, 8);
  });
});

describe("venda", () => {
  it("venda parcial reduz quantidade e baixa o custo pelo medio", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precos([["2026-01-05", 20], ["2026-01-06", 20], ["2026-01-07", 25],
                      ["2026-01-08", 25], ["2026-01-09", 25]]),
      movimentacoes: [
        { data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 },
        { data: "2026-01-07", tipo: "Venda", valor: 1250, quantidade: 50 },
      ],
    });
    const fim = ultimo(rows);
    expect(fim.quantidade).toBeCloseTo(50, 8);
    expect(fim.valorInvestido).toBeCloseTo(1000, 2);  // metade do custo saiu
    expect(fim.valorPosicao).toBeCloseTo(1250, 2);
  });

  it("venda total zera a posicao", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-09",
      precos: precoFixo("2026-01-05", "2026-01-09", 20),
      movimentacoes: [
        { data: "2026-01-05", tipo: "Compra", valor: 2000, quantidade: 100 },
        { data: "2026-01-08", tipo: "Venda", valor: 2000, quantidade: 100 },
      ],
    });
    expect(ultimo(rows).quantidade).toBeCloseTo(0, 8);
    expect(ultimo(rows).valorPosicao).toBeCloseTo(0, 2);
    expect(ultimo(rows).valorInvestido).toBeCloseTo(0, 2);
  });
});
