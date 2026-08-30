import { describe, it, expect } from "vitest";
import { construirFatoresIpcaDiarios } from "./ipcaEngine";

/**
 * Feriados nacionais + moveis. 24/12 e 31/12 sao dias uteis aqui, como no
 * calendario_dias_uteis do banco.
 */
function feriados(ano: number): Set<string> {
  const A = ano % 19, B = Math.floor(ano / 100), C = ano % 100;
  const D = Math.floor(B / 4), E = B % 4, F = Math.floor((B + 8) / 25);
  const G = Math.floor((B - F + 1) / 3), H = (19 * A + B - D - G + 15) % 30;
  const I = Math.floor(C / 4), K = C % 4, L = (32 + 2 * E + 2 * I - H - K) % 7;
  const M = Math.floor((A + 11 * H + 22 * L) / 451);
  const pascoa = Date.UTC(ano, Math.floor((H + L - 7 * M + 114) / 31) - 1, ((H + L - 7 * M + 114) % 31) + 1);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const s = new Set<string>();
  for (const [m, d] of [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [11, 20], [12, 25]]) {
    s.add(iso(Date.UTC(ano, m - 1, d)));
  }
  for (const off of [-48, -47, -2, 60]) s.add(iso(pascoa + off * 86400000));
  return s;
}

function calendario(de: string, ate: string) {
  const fer = new Set<string>();
  for (let a = Number(de.slice(0, 4)) - 1; a <= Number(ate.slice(0, 4)) + 1; a++) {
    for (const f of feriados(a)) fer.add(f);
  }
  const out: { data: string; dia_util: boolean }[] = [];
  for (let t = Date.parse(de + "T00:00:00Z"); t <= Date.parse(ate + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t);
    const data = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    out.push({ data, dia_util: dow >= 1 && dow <= 5 && !fer.has(data) });
  }
  return out;
}

const COMPETENCIAS = [
  ["2024-08", 6966.5], ["2024-09", 6997.15], ["2024-10", 7036.33], ["2024-11", 7063.77],
  ["2024-12", 7100.5], ["2025-01", 7111.86], ["2025-02", 7205.03], ["2025-03", 7245.38],
  ["2025-04", 7276.54], ["2025-05", 7295.46], ["2025-06", 7312.97], ["2025-07", 7331.98],
  ["2025-08", 7323.91], ["2025-09", 7359.06], ["2025-10", 7365.68], ["2025-11", 7378.94],
  ["2025-12", 7403.29], ["2026-01", 7427.72], ["2026-02", 7479.71], ["2026-03", 7545.53],
  ["2026-04", 7596.09], ["2026-05", 7640.15], ["2026-06", 7652.37], ["2026-07", 7657.73],
].map(([competencia, numero_indice]) => ({ competencia: competencia as string, numero_indice: numero_indice as number }));

const PROJECAO = [{ competencia: "2026-08", variacao_projetada: -0.28 }];

const CAL = calendario("2024-11-01", "2026-10-31");
const DIAS_UTEIS = CAL.filter((c) => c.dia_util).map((c) => c.data);

/** PU do titulo: 1000 x fator IPCA acumulado x juros DU/252, desde 02/01/2025. */
function pu(diaAniversario: number, dataCalculo: string, taxaAA = 6) {
  const fatores = construirFatoresIpcaDiarios({
    diaAniversario, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
  });
  const inicio = "2025-01-02";
  const dias = DIAS_UTEIS.filter((d) => d > inicio && d <= dataCalculo);
  const ipca = dias.reduce((acc, d) => acc * (fatores.get(d) ?? 1), 1);
  const juros = Math.pow(1 + taxaAA / 100, dias.length / 252);
  return 1000 * ipca * juros;
}

describe("fator de IPCA na convencao do Gorila", () => {
  // Medidos na tela do Gorila em 30/08/2026, dois CDB IPCA+6% aplicados em
  // 02/01/2025 (R$ 10.000, PU de emissao 1.000), identicos exceto pelo vencimento.
  const GORILA: [string, number, number][] = [
    // data          venc. 08/01/2029   venc. 22/01/2029
    ["2026-08-07", 1189.504, 1190.956],
    ["2026-08-10", 1189.807, 1191.318],
    ["2026-08-14", 1191.079, 1192.767],
    ["2026-08-17", 1191.394, 1193.129],
    ["2026-08-21", 1192.655, 1194.580],
    ["2026-08-24", 1192.971, 1194.896],
    ["2026-08-25", 1193.287, 1195.212],
  ];

  it("reproduz o PU dos dois titulos com dois decimos por mil de folga", () => {
    for (const [data, alvoA, alvoB] of GORILA) {
      expect(Math.abs(pu(8, data) - alvoA), `venc dia 08 em ${data}`).toBeLessThan(0.2);
      expect(Math.abs(pu(22, data) - alvoB), `venc dia 22 em ${data}`).toBeLessThan(0.2);
    }
  });

  /**
   * Este e o teste que importa: com o ciclo delimitado pelas datas de aniversario
   * NOMINAIS, o erro contra o Gorila para de crescer dentro do ciclo e vira um
   * deslocamento fixo. Enquanto o ciclo era delimitado pelas datas adiadas para dia
   * util, o erro do titulo de vencimento 22 ia de -0,045 a -0,083 ao longo de agosto.
   *
   * Um viés fixo se investiga; um drift indica que o fator diario esta errado.
   */
  it("nao acumula erro dentro do ciclo", () => {
    // 07 a 21/08/2026: o titulo de vencimento 22 esta o tempo todo no ciclo de junho
    const noCicloDeJunho = GORILA.slice(0, 5).map(([data, , alvoB]) => pu(22, data) - alvoB);
    const amplitude = Math.max(...noCicloDeJunho) - Math.min(...noCicloDeJunho);
    expect(amplitude).toBeLessThan(0.01);

    // e o de vencimento 08, que entrou no ciclo de julho em 10/08
    const noCicloDeJulho = GORILA.slice(1).map(([data, alvoA]) => pu(8, data) - alvoA);
    expect(Math.max(...noCicloDeJulho) - Math.min(...noCicloDeJulho)).toBeLessThan(0.02);
  });

  it("o titulo com vencimento no dia 22 vira o ciclo entre 21 e 24 de agosto", () => {
    // 22/08/2026 caiu num sabado: o aniversario vale em 24/08. Antes disso o ciclo
    // distribui o IPCA de junho (0,16%); depois, o de julho (0,07%).
    const f = construirFatoresIpcaDiarios({
      diaAniversario: 22, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
    });
    // Em vez de fixar o dut na mao, conto os dias que compartilham o mesmo fator:
    // sao exatamente os dias uteis do ciclo. Elevado a esse expoente, o fator diario
    // tem que devolver a variacao do mes.
    const duDoCiclo = (fator: number) =>
      [...f.values()].filter((v) => Math.abs(v - fator) < 1e-12).length;
    const f21 = f.get("2026-08-21")!;
    const f25 = f.get("2026-08-25")!;
    expect(Math.pow(f21, duDoCiclo(f21))).toBeCloseTo(7652.37 / 7640.15, 8); // junho/2026
    expect(Math.pow(f25, duDoCiclo(f25))).toBeCloseTo(7657.73 / 7652.37, 8); // julho/2026
    expect(f21).toBeGreaterThan(f25);
  });

  it("o aniversario e o dia do vencimento, nao o dia 15", () => {
    const d8 = construirFatoresIpcaDiarios({
      diaAniversario: 8, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
    });
    const d22 = construirFatoresIpcaDiarios({
      diaAniversario: 22, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
    });
    // em 17/08 os dois estao em ciclos diferentes, entao os fatores diarios diferem
    expect(d8.get("2026-08-17")).not.toBeCloseTo(d22.get("2026-08-17")!, 6);
  });

  /**
   * Titulos IPCA+0% cadastrados no Gorila em 30/08/2026. Sem spread o PU e o fator
   * do IPCA puro, entao estes valores testam a correcao sozinha, sem o ruido dos
   * juros. Seis papeis, cinco deles variando so o dia do vencimento (logo, a posicao
   * da compra dentro do ciclo inicial) e um comprado no proprio dia do aniversario.
   *
   * Tres batem exato. Os tres que sobram sao o residuo conhecido: aniversario 8 e 15
   * (cujo aniversario de dezembro/2024 caiu num domingo) e o 31, que ainda esbarra
   * nos meses curtos. Ver a secao 15 de `_knowledge/ipca-metodologia-gorila.md`.
   */
  describe("VNA puro, sem spread (titulos IPCA+0%)", () => {
    const vna = (diaAniversario: number, inicio: string, dataCalculo: string) => {
      const fatores = construirFatoresIpcaDiarios({
        diaAniversario, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
      });
      return 1000 * DIAS_UTEIS
        .filter((d) => d > inicio && d <= dataCalculo)
        .reduce((acc, d) => acc * (fatores.get(d) ?? 1), 1);
    };

    // [dia do vencimento, compra, VNA no Gorila em 24/08/2026, folga aceita]
    const CASOS: [number, string, number, number][] = [
      [20, "2025-01-02", 1086.069, 0.001],   // exato
      [25, "2025-01-02", 1086.465, 0.001],   // exato
      [10, "2025-02-10", 1078.066, 0.001],   // exato: compra no proprio aniversario
      [8,  "2025-01-02", 1084.568, 0.05],
      [15, "2025-01-02", 1085.443, 0.10],
      [31, "2025-01-02", 1086.708, 0.25],    // meses curtos, o pior caso
    ];

    it.each(CASOS)("vencimento dia %i comprado em %s", (dia, compra, alvo, folga) => {
      expect(Math.abs(vna(dia, compra, "2026-08-24") - alvo)).toBeLessThan(folga);
    });

    it("bate no centavo quando a compra cai no dia do aniversario", () => {
      // sem ciclo inicial parcial, a formula reproduz o Gorila exatamente
      expect(vna(10, "2025-02-10", "2026-08-24")).toBeCloseTo(1078.066, 2);
    });
  });
});
