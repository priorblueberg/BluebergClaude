import { describe, it, expect } from "vitest";
import {
  dataBaseDoDeposito, calcularPoupancaDiario, buildPoupancaLotesFromMovs, montarLotesPersistidos,
} from "./poupancaEngine";

/**
 * Referencia: quatro depositos de R$ 10.000,00 cadastrados no GorilaVIEW em 06/09/2026 e lidos
 * na tela de Posicoes com data de calculo 03/09/2026. Os valores abaixo sao os dele.
 *
 * O que os quatro juntos provam: a data-base e o dia do deposito, EXCETO nos dias 29, 30 e 31,
 * que vao para o dia 1o do mes seguinte. O caso do dia 28 fecha a fronteira pelo outro lado.
 */
const GORILA = {
  dia15: { deposito: "2025-01-15", esperado: 11337.58 },
  dia31: { deposito: "2025-01-31", esperado: 11340.18 },
  bissexto: { deposito: "2024-02-29", esperado: 12086.14 },
  dia28: { deposito: "2025-02-28", esperado: 11264.94 },
};

describe("dataBaseDoDeposito", () => {
  it("dias 1 a 28 mantem o proprio dia", () => {
    expect(dataBaseDoDeposito("2025-01-15")).toBe("2025-01-15");
    expect(dataBaseDoDeposito("2025-02-28")).toBe("2025-02-28");
    expect(dataBaseDoDeposito("2025-01-01")).toBe("2025-01-01");
  });

  it("dias 29, 30 e 31 vao para o dia 1o do mes seguinte", () => {
    expect(dataBaseDoDeposito("2025-01-29")).toBe("2025-02-01");
    expect(dataBaseDoDeposito("2025-01-30")).toBe("2025-02-01");
    expect(dataBaseDoDeposito("2025-01-31")).toBe("2025-02-01");
  });

  it("29 de fevereiro em ano bissexto tambem vai para o dia 1o", () => {
    expect(dataBaseDoDeposito("2024-02-29")).toBe("2024-03-01");
  });

  it("dezembro vira o ano", () => {
    expect(dataBaseDoDeposito("2025-12-31")).toBe("2026-01-01");
    expect(dataBaseDoDeposito("2025-12-28")).toBe("2025-12-28");
  });
});

/** Calendario com TODOS os dias: a poupanca credita em dia nao util tambem. */
function calendarioEntre(de: string, ate: string) {
  const dias: { data: string; dia_util: boolean }[] = [];
  const d = new Date(de + "T00:00:00");
  const fim = new Date(ate + "T00:00:00");
  while (d <= fim) {
    const dow = d.getDay();
    dias.push({ data: d.toISOString().slice(0, 10), dia_util: dow !== 0 && dow !== 6 });
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

/**
 * Serie de rendimento fixa em 0,5% ao mes. Nao reproduz os numeros do Gorila (que dependem da
 * TR real de cada mes), mas isola a MECANICA: quantos creditos acontecem e em que datas.
 */
function serieFixa(de: string, ate: string, pct = 0.5) {
  return calendarioEntre(de, ate).map((c) => ({ data: c.data, rendimento_mensal: pct }));
}

function rodar(deposito: string, ate: string) {
  const movs = [{ data: deposito, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }];
  return calcularPoupancaDiario({
    dataInicio: deposito,
    dataCalculo: ate,
    calendario: calendarioEntre(deposito, ate),
    movimentacoes: movs,
    lotes: buildPoupancaLotesFromMovs(movs),
    selicRecords: [],
    poupancaRendimentoRecords: serieFixa("2023-01-01", ate),
  });
}

describe("calendario de creditos", () => {
  it("deposito no dia 15 credita todo dia 15, e nada antes", () => {
    const rows = rodar("2025-01-15", "2025-04-20");
    const comGanho = rows.filter((r) => r.ganhoDiario > 0.00001).map((r) => r.data);
    expect(comGanho).toEqual(["2025-02-15", "2025-03-15", "2025-04-15"]);
  });

  it("deposito no dia 31 credita todo dia 1o, e o primeiro credito pula um mes", () => {
    const rows = rodar("2025-01-31", "2025-04-20");
    const comGanho = rows.filter((r) => r.ganhoDiario > 0.00001).map((r) => r.data);
    // data-base 01/02; o primeiro aniversario e 01/03, nao 01/02
    expect(comGanho).toEqual(["2025-03-01", "2025-04-01"]);
  });

  it("deposito no dia 28 continua no dia 28 (a fronteira da regra)", () => {
    const rows = rodar("2025-02-28", "2025-05-30");
    const comGanho = rows.filter((r) => r.ganhoDiario > 0.00001).map((r) => r.data);
    expect(comGanho).toEqual(["2025-03-28", "2025-04-28", "2025-05-28"]);
  });

  it("29/02 de ano bissexto credita todo dia 1o", () => {
    const rows = rodar("2024-02-29", "2024-06-20");
    const comGanho = rows.filter((r) => r.ganhoDiario > 0.00001).map((r) => r.data);
    expect(comGanho).toEqual(["2024-04-01", "2024-05-01", "2024-06-01"]);
  });

  it("credita em domingo: 06/04/2025 e domingo e o rendimento cai nele", () => {
    const rows = rodar("2025-01-06", "2025-04-10");
    const domingo = rows.find((r) => r.data === "2025-04-06");
    expect(domingo?.diaUtil).toBe(false);
    expect(domingo!.ganhoDiario).toBeGreaterThan(0);
  });

  it("entre aniversarios o saldo nao se move", () => {
    const rows = rodar("2025-01-15", "2025-03-20");
    const entre = rows.filter((r) => r.data > "2025-02-15" && r.data < "2025-03-15");
    const valores = new Set(entre.map((r) => r.liquido.toFixed(8)));
    expect(valores.size).toBe(1);
  });
});

describe("composicao do rendimento", () => {
  it("dois creditos de 0,5% compoem, nao somam", () => {
    const rows = rodar("2025-01-15", "2025-03-15");
    const fim = rows[rows.length - 1];
    // 10000 x 1,005^2 = 10100,25 (soma simples daria 10100,00)
    expect(fim.liquido).toBeCloseTo(10100.25, 2);
  });

  it("nao credita nada antes do primeiro aniversario", () => {
    const rows = rodar("2025-01-15", "2025-02-14");
    const fim = rows[rows.length - 1];
    expect(fim.liquido).toBeCloseTo(10000, 2);
  });
});

/**
 * Contagem de creditos ate 03/09/2026, que e o que explica os valores do Gorila.
 * Cada caso confirma o numero de aniversarios que ele pagou.
 */
describe("numero de creditos ate 03/09/2026 (contra o Gorila)", () => {
  const casos: [string, string, number][] = [
    ["dia 15", GORILA.dia15.deposito, 19],
    ["dia 31", GORILA.dia31.deposito, 19],
    ["bissexto 29/02", GORILA.bissexto.deposito, 30],
    ["dia 28", GORILA.dia28.deposito, 18],
  ];
  for (const [nome, deposito, esperado] of casos) {
    it(`${nome} paga ${esperado} creditos`, () => {
      const rows = rodar(deposito, "2026-09-03");
      const creditos = rows.filter((r) => r.ganhoDiario > 0.00001).length;
      expect(creditos).toBe(esperado);
    });
  }
});

/**
 * Multiplos aportes e a ordem de consumo no resgate.
 *
 * Medido contra o Gorila em 06/09/2026 (poupanca BANCO INTER): aportes de R$ 5.000,00 em
 * 10/01/2025 e 20/02/2025, resgate de R$ 6.000,00 em 15/07/2025. Em 03/09/2026 ele fecha em
 * **R$ 4.753,83**. As tres hipoteses davam numeros distintos - FIFO R$ 4.753,83, LIFO
 * R$ 4.719,12 e pro-rata R$ 4.736,37 - e so o FIFO bate.
 *
 * O que faz o teste discriminar e os aniversarios DIFERENTES (dia 10 e dia 20): o lote que
 * sobrevive define quantos creditos ainda entram. Com aportes no mesmo dia, as tres hipoteses
 * empatariam e o teste nao provaria nada.
 */
describe("multiplos aportes e FIFO no resgate", () => {
  const movs = [
    { data: "2025-01-10", tipo_movimentacao: "Aplicação Inicial", valor: 5000 },
    { data: "2025-02-20", tipo_movimentacao: "Aplicação", valor: 5000 },
    { data: "2025-07-15", tipo_movimentacao: "Resgate", valor: 6000 },
  ];

  function rodarLotes(ate: string) {
    return calcularPoupancaDiario({
      dataInicio: "2025-01-10",
      dataCalculo: ate,
      calendario: calendarioEntre("2025-01-10", ate),
      movimentacoes: movs,
      lotes: buildPoupancaLotesFromMovs(movs),
      selicRecords: [],
      poupancaRendimentoRecords: serieFixa("2023-01-01", ate),
    });
  }

  it("cada aporte vira um lote com a sua propria data-base", () => {
    const lotes = buildPoupancaLotesFromMovs(movs);
    expect(lotes).toHaveLength(2);
    expect(lotes[0].dia_aniversario).toBe(10);
    expect(lotes[1].dia_aniversario).toBe(20);
  });

  /**
   * Os dois casos acima sao dias 10 e 20 - dentro da faixa 1 a 28, onde a data-base E o dia do
   * deposito. Eles nao exercitam a regra que existe: 29, 30 e 31 vao para o dia 1o do mes
   * seguinte.
   *
   * Essa lacuna deixou passar, ate 09/09/2026, um `syncPoupancaLotes` que gravava o dia CRU em
   * `poupanca_lotes.dia_aniversario`. Nao mudava numero, porque todo consumidor reconstroi os
   * lotes das movimentacoes e ignora a coluna - mas era dado gravado contradizendo a regra,
   * esperando o dia em que alguem confiasse nele.
   */
  it("deposito em 29, 30 e 31 tem data-base no dia 1o do mes seguinte", () => {
    const emDia = (data: string) =>
      buildPoupancaLotesFromMovs([{ data, tipo_movimentacao: "Aplicação", valor: 1000 }])[0];

    expect(emDia("2025-01-29").dia_aniversario).toBe(1);
    expect(emDia("2025-01-30").dia_aniversario).toBe(1);
    expect(emDia("2025-01-31").dia_aniversario).toBe(1);
    // Vira o ano junto: 31/12 tem data-base em 01/01 do ano seguinte.
    expect(emDia("2025-12-31").dia_aniversario).toBe(1);
    // A fronteira, medida contra o Gorila em 06/09/2026: 28 ainda e dia normal.
    expect(emDia("2025-02-28").dia_aniversario).toBe(28);
  });


  it("os dois lotes rendem nos seus proprios aniversarios", () => {
    const rows = rodarLotes("2025-04-30");
    const comGanho = rows.filter((r) => r.ganhoDiario > 0.00001).map((r) => r.data);
    expect(comGanho).toEqual([
      "2025-02-10", "2025-03-10", "2025-03-20", "2025-04-10", "2025-04-20",
    ]);
  });

  it("o resgate consome o lote MAIS ANTIGO primeiro (FIFO)", () => {
    const rows = rodarLotes("2026-09-03");
    const fim = rows[rows.length - 1];

    const f = 1.005;
    const saldoA = 5000 * Math.pow(f, 6);  // dia 10: creditos de 02 a 07/2025
    const saldoB = 5000 * Math.pow(f, 4);  // dia 20: creditos de 03 a 06/2025
    const resto = saldoA + saldoB - 6000;

    // FIFO: o lote A morre, o resto fica no B (dia 20), que ainda recebe 14 creditos.
    const fifo = resto * Math.pow(f, 14);
    // LIFO deixaria o resto no A (dia 10), com 13 creditos.
    const lifo = resto * Math.pow(f, 13);

    expect(fim.liquido).toBeCloseTo(fifo, 2);
    expect(Math.abs(fim.liquido - lifo)).toBeGreaterThan(1);
  });

  it("o saldo em maos no dia do resgate soma os dois lotes", () => {
    const rows = rodarLotes("2025-07-15");
    const dia = rows.find((r) => r.data === "2025-07-15")!;
    const f = 1.005;
    // antes do resgate: A com 6 creditos, B com 4
    const antes = 5000 * Math.pow(f, 6) + 5000 * Math.pow(f, 4);
    expect(dia.liquido).toBeCloseTo(antes - 6000, 2);
  });
});

/**
 * Rendimento REAL da poupanca por data-base (dias 1, 10 e 15), do BCB. So estes tres dias
 * porque sao as data-bases dos casos abaixo; os testes de mecanica usam a serie fixa.
 */
const SERIE_REAL: [string, number][] = [
  ["2024-02-01",0.5079], ["2024-02-10",0.5], ["2024-02-15",0.5668], ["2024-03-01",0.5333], ["2024-03-10",0.5809],
  ["2024-03-15",0.5522], ["2024-04-01",0.6028], ["2024-04-10",0.584], ["2024-04-15",0.5828], ["2024-05-01",0.5874],
  ["2024-05-10",0.549], ["2024-05-15",0.6149], ["2024-06-01",0.5367], ["2024-06-10",0.5925], ["2024-06-15",0.5401],
  ["2024-07-01",0.5743], ["2024-07-10",0.5752], ["2024-07-15",0.5748], ["2024-08-01",0.5711], ["2024-08-10",0.5673],
  ["2024-08-15",0.5712], ["2024-09-01",0.5678], ["2024-09-10",0.5728], ["2024-09-15",0.5697], ["2024-10-01",0.5982],
  ["2024-10-10",0.5816], ["2024-10-15",0.6081], ["2024-11-01",0.5652], ["2024-11-10",0.5661], ["2024-11-15",0.5663],
  ["2024-12-01",0.5826], ["2024-12-10",0.6078], ["2024-12-15",0.5958], ["2025-01-01",0.6698], ["2025-01-10",0.6493],
  ["2025-01-15",0.6719], ["2025-02-01",0.6331], ["2025-02-10",0.5743], ["2025-02-15",0.5745], ["2025-03-01",0.6097],
  ["2025-03-10",0.6741], ["2025-03-15",0.6708], ["2025-04-01",0.6697], ["2025-04-10",0.6449], ["2025-04-15",0.6441],
  ["2025-05-01",0.6721], ["2025-05-10",0.6725], ["2025-05-15",0.6744], ["2025-06-01",0.6707], ["2025-06-10",0.6728],
  ["2025-06-15",0.6708], ["2025-07-01",0.6767], ["2025-07-10",0.6751], ["2025-07-15",0.677], ["2025-08-01",0.6731],
  ["2025-08-10",0.6751], ["2025-08-15",0.6717], ["2025-09-01",0.6751], ["2025-09-10",0.675], ["2025-09-15",0.6749],
  ["2025-10-01",0.6767], ["2025-10-10",0.673], ["2025-10-15",0.6768], ["2025-11-01",0.6642], ["2025-11-10",0.6731],
  ["2025-11-15",0.665], ["2025-12-01",0.6751], ["2025-12-10",0.673], ["2025-12-15",0.6728], ["2026-01-01",0.6727],
  ["2026-01-10",0.6727], ["2026-01-15",0.6746], ["2026-02-01",0.6213], ["2026-02-10",0.6231], ["2026-02-15",0.6189],
  ["2026-03-01",0.6744], ["2026-03-10",0.674], ["2026-03-15",0.6721], ["2026-04-01",0.6687], ["2026-04-10",0.6305],
  ["2026-04-15",0.6683], ["2026-05-01",0.6695], ["2026-05-10",0.6717], ["2026-05-15",0.6698], ["2026-06-01",0.6718],
  ["2026-06-10",0.6734], ["2026-06-15",0.6731], ["2026-07-01",0.6738], ["2026-07-10",0.6703], ["2026-07-15",0.6739],
  ["2026-08-01",0.6701], ["2026-08-10",0.6718], ["2026-08-15",0.6451], ["2026-09-01",0.6698]
];

const serieReal = () => SERIE_REAL.map(([data, rendimento_mensal]) => ({ data, rendimento_mensal }));

function rodarCaso(
  movs: { data: string; tipo_movimentacao: string; valor: number }[],
  ate: string,
  resgateTotalCadastro: string | null = null,
) {
  const inicio = movs.map((m) => m.data).sort()[0];
  return calcularPoupancaDiario({
    dataInicio: inicio,
    dataCalculo: ate,
    calendario: calendarioEntre(inicio, ate),
    movimentacoes: movs,
    lotes: buildPoupancaLotesFromMovs(movs),
    selicRecords: [],
    poupancaRendimentoRecords: serieReal(),
    dataResgateTotal: resgateTotalCadastro,
  });
}

const ultimo = (rows: ReturnType<typeof rodarCaso>) => rows[rows.length - 1];

/**
 * "Resgate Total" nao e um resgate de R$ X, e um fechamento de posicao: o que sobra de um
 * aporte retroativo volta para a data-base do PRIMEIRO aporte, nao fica no lote sobrevivente.
 *
 * Os tres casos foram cadastrados no GorilaVIEW em 07/09/2026 e lidos na tela dele com data de
 * calculo 03/09/2026. Cada um: aporte inicial, "Vender tudo", e o aporte retroativo lancado
 * POR ULTIMO, com data anterior a venda.
 */
describe("Resgate Total fecha a posicao (medido no Gorila)", () => {
  it("Santander: 1o aporte em 29/02/2024 (data-base dia 1o) da R$ 5.101,37", () => {
    const rows = rodarCaso([
      { data: "2024-02-29", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2026-06-10", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate Total", valor: 12005.69 },
    ], "2026-09-03", "2026-08-20");
    expect(ultimo(rows).liquido).toBeCloseTo(5101.37, 2);
  });

  it("C6: 1o aporte em 31/01/2025 (data-base dia 1o) da R$ 5.101,37", () => {
    const rows = rodarCaso([
      { data: "2025-01-31", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2026-06-10", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate Total", valor: 11264.70 },
    ], "2026-09-03", "2026-08-20");
    expect(ultimo(rows).liquido).toBeCloseTo(5101.37, 2);
  });

  /**
   * O caso que DECIDE a regra. Nos dois de cima o 1o aporte cai no dia 1o pela regra 29/30/31,
   * entao "data-base do primeiro aporte" e "sempre dia 1o" dariam o mesmo numero. Aqui a
   * data-base e o dia 10, que nao credita entre 20/08 e 03/09: o saldo fica parado.
   * Se o residuo fosse para o dia 1o daria R$ 5.101,53 - e estaria errado.
   */
  it("NUBANK: 1o aporte em 10/01/2025 (data-base dia 10) da R$ 5.067,58, sem credito nenhum", () => {
    const rows = rodarCaso([
      { data: "2025-01-10", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2026-06-15", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate Total", valor: 11332.23 },
    ], "2026-09-03", "2026-08-20");
    expect(ultimo(rows).liquido).toBeCloseTo(5067.58, 2);

    const depoisDaVenda = rows.filter((r) => r.data > "2026-08-20" && r.ganhoDiario > 0.00001);
    expect(depoisDaVenda).toEqual([]);
  });

  it("o valor que o Gorila fixou no 'Vender tudo' e o saldo do 1o lote sozinho", () => {
    // Confirma a modelagem do lote pelo outro lado, antes do resultado final.
    const so1oLote = (data: string, ate: string) =>
      ultimo(rodarCaso([{ data, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }], ate)).liquido;
    expect(so1oLote("2024-02-29", "2026-08-20")).toBeCloseTo(12005.69, 2);
    expect(so1oLote("2025-01-31", "2026-08-20")).toBeCloseTo(11264.70, 2);
    expect(so1oLote("2025-01-10", "2026-08-20")).toBeCloseTo(11332.23, 2);
  });

  it("quando o resgate total zera mesmo, a posicao fecha em zero e a serie para ali", () => {
    const rows = rodarCaso([
      { data: "2025-01-10", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate Total", valor: 11332.23 },
    ], "2026-09-03", "2026-08-20");
    expect(ultimo(rows).liquido).toBeCloseTo(0, 2);
    expect(ultimo(rows).data).toBe("2026-08-20");
  });

  it("valor investido do residuo e o nominal liquido, como o Gorila exibe", () => {
    const rows = rodarCaso([
      { data: "2024-02-29", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2026-06-10", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate Total", valor: 12005.69 },
    ], "2026-09-03", "2026-08-20");
    expect(ultimo(rows).valorInvestido).toBeCloseTo(2994.31, 2);
  });
});

/**
 * O resgate PARCIAL continua FIFO por data - operacao diferente, regra diferente. Os dois
 * casos foram cadastrados no Gorila em 07/09/2026 exatamente para separar FIFO de LIFO, e no
 * segundo a ordem de lancamento e diferente da ordem cronologica de proposito.
 */
describe("Resgate parcial segue FIFO por data (medido no Gorila)", () => {
  it("BB: aporte retroativo, o mais antigo de todos, da R$ 8.985,14", () => {
    const rows = rodarCaso([
      { data: "2025-03-31", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
      { data: "2025-01-10", tipo_movimentacao: "Aplicação", valor: 6000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate", valor: 9000 },
    ], "2026-09-03");
    expect(ultimo(rows).liquido).toBeCloseTo(8985.14, 2);
  });

  it("Safra: retroativo no MEIO, lancamento fora da ordem, da R$ 8.790,79", () => {
    const rows = rodarCaso([
      { data: "2025-01-10", tipo_movimentacao: "Aplicação Inicial", valor: 5000 },
      { data: "2025-05-31", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2025-03-15", tipo_movimentacao: "Aplicação", valor: 5000 },
      { data: "2026-08-20", tipo_movimentacao: "Resgate", valor: 8000 },
    ], "2026-09-03");
    expect(ultimo(rows).liquido).toBeCloseTo(8790.79, 2);

    // A assinatura: so o lote de 31/05 (data-base dia 1o) sobrevive intacto e credita em 01/09.
    const credito = rows.find((r) => r.data === "2026-09-01");
    expect(credito!.ganhoDiario).toBeCloseTo(36.78, 2);
  });
});

/**
 * O lote como ele fica GRAVADO. Era aqui que a regra faltava.
 *
 * O bloco acima cobre `buildPoupancaLotesFromMovs`, que sempre soube da data-base. Quem nao
 * sabia era a montagem do `syncPoupancaLotes`, a UNICA que grava `poupanca_lotes` - e ela vivia
 * dentro de uma funcao que fala com o banco, fora do alcance de qualquer teste. Passou
 * despercebida ate 09/09/2026.
 *
 * Nao mudava numero: todo consumidor reconstroi os lotes das movimentacoes e ignora a coluna.
 * Mudava a VERDADE do que estava gravado, esperando alguem confiar nela.
 */
describe("montarLotesPersistidos", () => {
  const aplicar = (data: string, valor = 10000) =>
    ({ data, tipo_movimentacao: "Aplicação", valor });

  it("grava a data-base, nao o dia do deposito", () => {
    const lotes = montarLotesPersistidos([aplicar("2022-12-30")]);
    expect(lotes).toHaveLength(1);
    expect(lotes[0].dia_aniversario).toBe(1);
    expect(lotes[0].data_aplicacao).toBe("2022-12-30"); // a data em si nao muda
  });

  it("mantem o dia do deposito quando ele e 1 a 28", () => {
    expect(montarLotesPersistidos([aplicar("2023-01-02")])[0].dia_aniversario).toBe(2);
    expect(montarLotesPersistidos([aplicar("2025-02-28")])[0].dia_aniversario).toBe(28);
  });

  it("desconta o resgate por FIFO, do lote mais antigo para o mais novo", () => {
    const lotes = montarLotesPersistidos([
      aplicar("2025-01-10", 1000),
      aplicar("2025-02-10", 1000),
      { data: "2025-03-10", tipo_movimentacao: "Resgate", valor: 1500 },
    ]);
    // O primeiro lote zera e sai; o segundo fica com o que sobrou.
    expect(lotes).toHaveLength(1);
    expect(lotes[0].data_aplicacao).toBe("2025-02-10");
    expect(lotes[0].valor_atual).toBeCloseTo(500, 2);
  });

  it("some com o lote zerado, em vez de guardar linha morta", () => {
    const lotes = montarLotesPersistidos([
      aplicar("2025-01-10", 1000),
      { data: "2025-03-10", tipo_movimentacao: "Resgate Total", valor: 1000 },
    ]);
    expect(lotes).toHaveLength(0);
  });
});
