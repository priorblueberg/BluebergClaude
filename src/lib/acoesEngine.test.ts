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

  /**
   * Por padrao o JCP entra BRUTO, para bater com o Gorila - ele exibe sem a retencao.
   * Medido em 07/09/2026 numa posicao de 1.000 PETR4: JSCP de R$ 202,50, que e 0,202504 x
   * 1.000 sem desconto nenhum.
   */
  it("por padrao o JCP entra BRUTO, como o Gorila mostra", () => {
    const rows = rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo: "JCP", valor: 1, data_ex: "2026-01-07" }],
    });
    const ex = rows.find((r) => r.data === "2026-01-07")!;
    expect(ex.proventoBruto).toBeCloseTo(100, 2);
    expect(ex.proventoLiquido).toBeCloseTo(100, 2);
  });

  it("ligando o desconto, o JCP sai liquido de 15% e o dividendo nao muda", () => {
    const comIr = (tipo: "JCP" | "DIVIDENDO") => rodar({
      dataInicio: "2026-01-05", dataCalculo: "2026-01-08",
      precos: serieComQueda, movimentacoes: compra100,
      proventos: [{ tipo, valor: 1, data_ex: "2026-01-07" }],
      descontarIrDoJcp: true,
    }).find((r) => r.data === "2026-01-07")!;
    expect(comIr("JCP").proventoLiquido).toBeCloseTo(100 * (1 - IR_JCP), 2);
    expect(comIr("DIVIDENDO").proventoLiquido).toBeCloseTo(100, 2);
    expect(IR_JCP).toBe(0.15);
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

describe("o custo e o preco PAGO, nao o fechamento do dia", () => {
  // Caso real, medido contra o GorilaVIEW em 09/09/2026. Antes desta regra o motor media o
  // ganho a partir do fechamento do dia da compra, e a diferenca entre o preco praticado e
  // esse fechamento sumia.
  const compra100 = (data: string, precoPago: number) => [
    { data, tipo: "Compra", valor: precoPago * 100, quantidade: 100 },
  ];

  it("comprar ACIMA do fechamento ja nasce com prejuizo no mesmo dia", () => {
    // USIM5: 100 acoes a 7,80 num dia que fechou a 7,03. Sao R$ 77,00 pagos a mais.
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 7.03]]),
      movimentacoes: compra100("2023-01-02", 7.8),
    });
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(-77, 6);
    expect(ultimo(rows).valorPosicao).toBeCloseTo(703, 6);
    expect(ultimo(rows).valorInvestido).toBeCloseTo(780, 6);
  });

  it("comprar ABAIXO do fechamento ja nasce com lucro no mesmo dia", () => {
    // PETR4: 100 acoes a 22,00 num dia que fechou a 22,92.
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 22.92]]),
      movimentacoes: compra100("2023-01-02", 22),
    });
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(92, 6);
  });

  it("a rentabilidade do dia da compra e fechamento sobre preco pago", () => {
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 7.03]]),
      movimentacoes: compra100("2023-01-02", 7.8),
    });
    // 7,03 / 7,80 - 1 = -9,872%
    expect(ultimo(rows).rentabilidadeAcumuladaPct).toBeCloseTo(7.03 / 7.8 - 1, 8);
  });

  it("comprar EXATAMENTE no fechamento nao gera ganho nem perda no dia", () => {
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 10]]),
      movimentacoes: compra100("2023-01-02", 10),
    });
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(0, 8);
    expect(ultimo(rows).rentabilidadeAcumuladaPct).toBeCloseTo(0, 8);
  });

  it("o custo da operacao entra como perda imediata", () => {
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 10]]),
      movimentacoes: [{ data: "2023-01-02", tipo: "Compra", valor: 1000, quantidade: 100, custos: 15 }],
    });
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(-15, 6);
  });

  it("vender ACIMA do fechamento realiza o ganho no dia da venda", () => {
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-04",
      precos: precos([["2023-01-02", 10], ["2023-01-03", 10], ["2023-01-04", 10]]),
      movimentacoes: [
        { data: "2023-01-02", tipo: "Compra", valor: 1000, quantidade: 100 },
        { data: "2023-01-04", tipo: "Venda", valor: 1100, quantidade: 100 },
      ],
    });
    // Comprou e vendeu com o mercado parado em 10,00, mas vendeu a 11,00.
    expect(ultimo(rows).ganhoAcumulado).toBeCloseTo(100, 6);
  });

  it("o ganho de execucao NAO altera o valor da posicao", () => {
    const rows = rodar({
      dataInicio: "2023-01-02", dataCalculo: "2023-01-02",
      precos: precos([["2023-01-02", 7.03]]),
      movimentacoes: compra100("2023-01-02", 7.8),
    });
    // A posicao vale quantidade x fechamento, sempre. O preco pago afeta o GANHO, nao o valor.
    expect(ultimo(rows).valorPosicao).toBeCloseTo(100 * 7.03, 6);
  });
});
