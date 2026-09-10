import { describe, expect, it } from "vitest";
import { fatorDaB3 } from "./eventosDaB3.ts";
import {
  dataExPossiveis,
  degrausDeAjuste,
  duplicados,
  mesmoFator,
  reconciliarEventos,
} from "./reconciliacaoEventos.ts";

/** Pregoes de fachada, so para a janela de data-ex ter onde procurar o dia seguinte. */
const PREGOES = [
  "2024-02-05", "2024-02-06", "2024-02-07", "2024-02-08",
  "2024-04-16", "2024-04-17", "2024-04-18",
  "2025-12-17", "2025-12-18", "2025-12-19",
];

const nosso = (
  dataEx: string, tipo: string, fator: number, jaRefletidoNoPreco = false, fonte = "brapi",
) => ({ dataEx, tipo, fator, jaRefletidoNoPreco, fonte });
const b3 = (dataDeclarada: string, tipo: string, fator: number) =>
  ({ dataDeclarada, tipo, fator });

// ── A conversao do `factor` ────────────────────────────────────────────────────────────────
// Cada caso e um evento que ja estava conferido na base em 09/09/2026. Sao os numeros que
// separam "percentual de acoes novas" de "razao pronta", e trocar as duas nao produz um erro
// pequeno: produz posicao em outra ordem de grandeza.
describe("fator da B3", () => {
  it("le bonificacao e desdobramento como percentual de acoes novas", () => {
    expect(fatorDaB3("BONIFICACAO", 20)).toBe(1.2);          // GGBR4 17/04/2024
    expect(fatorDaB3("BONIFICACAO", 10)).toBeCloseTo(1.1, 10); // BBDC4 18/04/2022
    expect(fatorDaB3("BONIFICACAO", 1)).toBeCloseTo(1.01, 10); // KLBN11 17/12/2025
    expect(fatorDaB3("BONIFICACAO", 50)).toBe(1.5);          // USIM5 29/04/2008
    expect(fatorDaB3("DESDOBRAMENTO", 100)).toBe(2);         // PETR4 25/04/2008
    expect(fatorDaB3("DESDOBRAMENTO", 400)).toBe(5);         // KLBN11 24/03/2014
    expect(fatorDaB3("DESDOBRAMENTO", 4900)).toBe(50);       // BBDC4 08/06/2009
    expect(fatorDaB3("DESDOBRAMENTO", 1100)).toBe(12);       // MELI34 21/10/2020
  });

  it("le grupamento como razao pronta, nao como percentual", () => {
    expect(fatorDaB3("GRUPAMENTO", 0.02)).toBe(0.02);   // BBDC4 08/06/2009
    expect(fatorDaB3("GRUPAMENTO", 0.01)).toBe(0.01);   // PETR4 21/06/2000
    expect(fatorDaB3("GRUPAMENTO", 0.005)).toBe(0.005); // USIM5 01/02/1999
    expect(fatorDaB3("GRUPAMENTO", 0.001)).toBe(0.001); // GGBR4 30/04/2003
  });

  it("recusa factor que nao produz fator positivo", () => {
    expect(fatorDaB3("GRUPAMENTO", 0)).toBeNull();
    expect(fatorDaB3("BONIFICACAO", -200)).toBeNull();
    expect(fatorDaB3("BONIFICACAO", NaN)).toBeNull();
  });
});

describe("tolerancia do fator", () => {
  // PETR4 1994: a B3 publica 33,333333333 (-> 1,33333333333) e a BRAPI publica 1,3333334.
  it("funde a dizima truncada de formas diferentes pelas duas fontes", () => {
    expect(mesmoFator(1.3333334, fatorDaB3("BONIFICACAO", 33.333333333)!)).toBe(true);
  });

  it("nao funde bonificacao de 1% com uma de 2%", () => {
    expect(mesmoFator(1.01, 1.02)).toBe(false);
  });

  // A tolerancia e relativa: num desdobramento 50:1 a mesma dizima erra 50 vezes mais em
  // valor absoluto, e continua sendo o mesmo evento.
  it("acompanha a escala do fator", () => {
    expect(mesmoFator(50.00002, 50)).toBe(true);
    expect(mesmoFator(50.1, 50)).toBe(false);
  });
});

describe("data-ex possivel a partir do lastDatePrior", () => {
  it("aceita tanto o dia declarado quanto o pregao seguinte", () => {
    expect(dataExPossiveis("2025-12-17", PREGOES)).toEqual(["2025-12-17", "2025-12-18"]);
  });

  // KLBN11: o desdobramento 5:1 foi declarado em 24/03/2014 e a nossa data-ex e 25/03/2014,
  // mas a serie de precos comeca em 02/01/2023. Perguntar "qual o pregao seguinte" a uma serie
  // que nem chega la devolve o primeiro dia dela, e o evento que TEMOS nao casa.
  it("fora do alcance da serie, usa dias de calendario em vez do primeiro pregao dela", () => {
    const candidatos = dataExPossiveis("2014-03-24", PREGOES);
    expect(candidatos).toContain("2014-03-25");
    expect(candidatos).not.toContain(PREGOES[0]);
  });

  it("depois do fim da serie, tambem cai no calendario", () => {
    expect(dataExPossiveis("2026-12-31", PREGOES)).toContain("2027-01-01");
  });
});

describe("reconciliacao de eventos contra a B3", () => {
  it("nao acha nada quando o evento bate no dia declarado", () => {
    // GGBR4: a B3 manda 17/04/2024 e a nossa data-ex e 17/04/2024.
    const r = reconciliarEventos(
      [nosso("2024-04-17", "BONIFICACAO", 1.2)],
      [b3("2024-04-17", "BONIFICACAO", 1.2)],
      PREGOES,
    );
    expect(r.faltantes).toEqual([]);
    expect(r.sobrando).toEqual([]);
  });

  it("nao acha nada quando o evento bate no pregao SEGUINTE ao declarado", () => {
    // KLBN11: a B3 manda 17/12/2025 e a nossa data-ex e 18/12/2025. E o mesmo evento, e uma
    // auditoria que reclamasse disso tocaria em metade dos eventos do mercado.
    const r = reconciliarEventos(
      [nosso("2025-12-18", "BONIFICACAO", 1.01)],
      [b3("2025-12-17", "BONIFICACAO", 1.01)],
      PREGOES,
    );
    expect(r.faltantes).toEqual([]);
  });

  it("acha o evento declarado que a nossa base nao tem", () => {
    // O caso que se repete: a BRAPI perde o evento novo e ninguem percebe. Foi assim com
    // ITSA4 11/11/2022 e KLBN11 07/05/2024, os dois cadastrados a mao depois do Gorila.
    const r = reconciliarEventos([], [b3("2025-12-17", "BONIFICACAO", 1.01)], PREGOES);
    expect(r.faltantes).toHaveLength(1);
    expect(r.faltantes[0].datas_ex_possiveis).toEqual(["2025-12-17", "2025-12-18"]);
  });

  it("nao casa evento de tipo diferente com o mesmo fator", () => {
    const r = reconciliarEventos(
      [nosso("2024-04-17", "DESDOBRAMENTO", 1.2)],
      [b3("2024-04-17", "BONIFICACAO", 1.2)],
      PREGOES,
    );
    expect(r.faltantes).toHaveLength(1);
    expect(r.sobrando).toHaveLength(1);
  });

  it("nao deixa um evento declarado consumir dois iguais nossos", () => {
    // BBDC4 tem sete bonificacoes de 1,10 em anos diferentes. Casar por chave (tipo, fator)
    // faria duas colapsarem numa; a contagem por data e o que impede.
    const r = reconciliarEventos(
      [nosso("2024-04-17", "BONIFICACAO", 1.1), nosso("2025-12-18", "BONIFICACAO", 1.1)],
      [b3("2024-04-17", "BONIFICACAO", 1.1)],
      PREGOES,
    );
    expect(r.faltantes).toEqual([]);
    expect(r.sobrando).toHaveLength(1);
    expect(r.sobrando[0].dataEx).toBe("2025-12-18");
  });

  it("marca o faltante anterior ao piso sem esconde-lo", () => {
    // Evento antigo continua importando: ele converte o preco historico em unidades de hoje.
    const r = reconciliarEventos([], [b3("2014-03-24", "DESDOBRAMENTO", 5)], PREGOES, "2023-01-02");
    expect(r.faltantes[0].abaixo_do_piso).toBe(true);
  });

  // A B3 devolve o ULTIMO evento de cada rotulo, nao o historico. Entao "temos mais que ela" e
  // o caso NORMAL - se isso virasse alarme, ele tocaria em todo papel com mais de um evento.
  it("nao trata como defeito o evento antigo que a B3 nao repete", () => {
    const r = reconciliarEventos(
      [nosso("2023-11-28", "BONIFICACAO", 1.05), nosso("2025-12-19", "BONIFICACAO", 1.02)],
      [b3("2025-12-18", "BONIFICACAO", 1.02)],
      PREGOES,
    );
    expect(r.faltantes).toEqual([]);
    expect(r.sobrando.map((e) => e.dataEx)).toEqual(["2023-11-28"]);
  });
});

// ── O degrau de ajuste ─────────────────────────────────────────────────────────────────────
//
// Os numeros de BBDC4 sao os medidos em 09/09/2026: preco nominal da B3 contra a nossa serie,
// nas datas em que a B3 publica o fechamento da vespera de cada provento.
describe("degrau de ajuste contra o preco nominal da B3", () => {
  const serieBBDC = new Map([
    ["2023-12-21", 14.3917], ["2024-01-02", 13.9583], ["2024-02-01", 12.7667],
    ["2024-03-01", 13.8], ["2024-04-01", 14.13], ["2024-05-02", 13.84],
  ]);
  const ancorasBBDC = [
    { data: "2023-12-21", precoNominal: 17.27 }, { data: "2024-01-02", precoNominal: 16.75 },
    { data: "2024-02-01", precoNominal: 15.32 }, { data: "2024-03-01", precoNominal: 13.8 },
    { data: "2024-04-01", precoNominal: 14.13 }, { data: "2024-05-02", precoNominal: 13.84 },
  ];

  it("nao reclama quando a marca esta certa", () => {
    const r = degrausDeAjuste(ancorasBBDC, serieBBDC, [
      nosso("2024-02-07", "BONIFICACAO", 1.2, true),
    ]);
    expect(r.ancoras_usadas).toBe(6);
    expect(r.divergencias).toEqual([]);
  });

  // O caso REAL do BBDC4 em 09/09/2026: a serie vem ajustada por 1,20 e o evento esta marcado
  // como nao refletido, porque a medicao dentro do sync leu um bico de preco em 07/02/2024
  // como se fosse o degrau. Com a marca errada o motor divide o preco uma segunda vez.
  it("acha a marca `ja_refletido_no_preco` invertida", () => {
    const r = degrausDeAjuste(ancorasBBDC, serieBBDC, [
      nosso("2024-02-07", "BONIFICACAO", 1.2, false),
    ]);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].degrau_medido).toBeCloseTo(1.2, 3);
    expect(r.divergencias[0].degrau_esperado).toBe(1);
    expect(r.divergencias[0].diagnostico).toContain("precisa virar true");
  });

  it("acha o evento que a fonte embutiu no preco e a base nao tem", () => {
    const r = degrausDeAjuste(ancorasBBDC, serieBBDC, []);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].diagnostico).toContain("NAO tem");
  });

  it("acha a marca em true sobre uma serie que e nominal", () => {
    const serie = new Map([["2024-03-01", 13.8], ["2024-04-01", 14.13]]);
    const ancoras = [
      { data: "2024-03-01", precoNominal: 13.8 }, { data: "2024-04-01", precoNominal: 14.13 },
    ];
    const r = degrausDeAjuste(ancoras, serie, [nosso("2024-03-15", "BONIFICACAO", 1.2, true)]);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].diagnostico).toContain("nominal");
  });

  // GGBR4 22/03/2023: as duas series sao nominais, a razao fica lisa em 1,2000 atravessando a
  // data-ex e nao ha degrau para medir. Este teste existe para fixar o LIMITE do detector - se
  // um dia ele passar a "achar" isto, e porque virou heuristica de queda de preco.
  it("nao inventa evento onde as duas series sao nominais", () => {
    const serie = new Map([["2023-03-14", 22.5417], ["2023-05-15", 20.35]]);
    const ancoras = [
      { data: "2023-03-14", precoNominal: 27.05 }, { data: "2023-05-15", precoNominal: 24.42 },
    ];
    const r = degrausDeAjuste(ancoras, serie, []);
    expect(r.divergencias).toEqual([]);
    expect(r.razao_inicial).toBeCloseTo(1.2, 4);
  });

  it("com menos de duas ancoras nao mede, e diz que nao mediu", () => {
    const r = degrausDeAjuste(
      [{ data: "2024-03-01", precoNominal: 13.8 }], new Map([["2024-03-01", 13.8]]), [],
    );
    expect(r.ancoras_usadas).toBe(1);
    expect(r.divergencias).toEqual([]);
  });

  it("ignora ancora sem pregao correspondente na nossa serie", () => {
    const r = degrausDeAjuste(
      [...ancorasBBDC, { data: "2024-06-03", precoNominal: 12.75 }],
      serieBBDC,
      [nosso("2024-02-07", "BONIFICACAO", 1.2, true)],
    );
    expect(r.ancoras_usadas).toBe(6);
  });
});

describe("duplicado na propria base", () => {
  // PETR4 25/04/2008: duas linhas do mesmo desdobramento, uma marcada como ja refletida no
  // preco e a outra nao. O motor obedece a uma das duas e ninguem sabe qual.
  it("acha a copia e diz que as marcas discordam", () => {
    const r = duplicados([
      nosso("2008-04-25", "DESDOBRAMENTO", 2, false),
      nosso("2008-04-25", "DESDOBRAMENTO", 2, true),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].copias).toBe(2);
    expect(r[0].marcas_divergentes).toBe(true);
  });

  it("nao confunde dois eventos iguais em datas diferentes", () => {
    // BBDC4 tem sete bonificacoes de 1,10. Repetir o fator nao e duplicata.
    expect(duplicados([
      nosso("2020-04-14", "BONIFICACAO", 1.1),
      nosso("2021-04-19", "BONIFICACAO", 1.1),
    ])).toEqual([]);
  });

  it("nao confunde grupamento e desdobramento no mesmo dia", () => {
    // BBDC4 08/06/2009: um grupamento de 0,02 e um desdobramento de 50 no mesmo pregao. Sao
    // dois eventos de verdade, e o produto deles e 1.
    expect(duplicados([
      nosso("2009-06-08", "GRUPAMENTO", 0.02),
      nosso("2009-06-08", "DESDOBRAMENTO", 50),
    ])).toEqual([]);
  });
});
