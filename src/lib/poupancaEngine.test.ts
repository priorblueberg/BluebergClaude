import { describe, it, expect } from "vitest";
import { dataBaseDoDeposito, calcularPoupancaDiario, buildPoupancaLotesFromMovs } from "./poupancaEngine";

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
