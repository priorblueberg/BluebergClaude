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

/** Datas em que o IBGE divulgou cada competencia (API v3 do IBGE, produto 9256). */
const PUBLICACAO: Record<string, string> = {
  "2024-08": "2024-09-10", "2024-09": "2024-10-09", "2024-10": "2024-11-08",
  "2024-11": "2024-12-10", "2024-12": "2025-01-10", "2025-01": "2025-02-11",
  "2025-02": "2025-03-12", "2025-03": "2025-04-11", "2025-04": "2025-05-09",
  "2025-05": "2025-06-10", "2025-06": "2025-07-10", "2025-07": "2025-08-12",
  "2025-08": "2025-09-10", "2025-09": "2025-10-09", "2025-10": "2025-11-11",
  "2025-11": "2025-12-10", "2025-12": "2026-01-09", "2026-01": "2026-02-10",
  "2026-02": "2026-03-12", "2026-03": "2026-04-10", "2026-04": "2026-05-12",
  "2026-05": "2026-06-12", "2026-06": "2026-07-10", "2026-07": "2026-08-11",
};

const COMPETENCIAS = [
  ["2024-08", 6966.5], ["2024-09", 6997.15], ["2024-10", 7036.33], ["2024-11", 7063.77],
  ["2024-12", 7100.5], ["2025-01", 7111.86], ["2025-02", 7205.03], ["2025-03", 7245.38],
  ["2025-04", 7276.54], ["2025-05", 7295.46], ["2025-06", 7312.97], ["2025-07", 7331.98],
  ["2025-08", 7323.91], ["2025-09", 7359.06], ["2025-10", 7365.68], ["2025-11", 7378.94],
  ["2025-12", 7403.29], ["2026-01", 7427.72], ["2026-02", 7479.71], ["2026-03", 7545.53],
  ["2026-04", 7596.09], ["2026-05", 7640.15], ["2026-06", 7652.37], ["2026-07", 7657.73],
].map(([competencia, numero_indice]) => ({
  competencia: competencia as string,
  numero_indice: numero_indice as number,
  data_publicacao: PUBLICACAO[competencia as string] ?? null,
}));


/**
 * Projecoes ANBIMA, pela data de COLETA (a ANBIMA marca "validade" no dia util
 * seguinte, mas o Gorila ja usa a projecao no dia da coleta - ver secao 22 do vault).
 * A coleta acontece duas vezes ao mes: na divulgacao do IPCA fechado, por volta do dia
 * 10, e na do IPCA-15, por volta do dia 26.
 */
const PROJECAO = [
  ["2024-11", 0.33, "2024-11-26"], ["2024-12", 0.54, "2024-12-27"],
  ["2025-01", 0.16, "2025-01-24"], ["2025-02", 1.29, "2025-02-25"],
  ["2025-03", 0.55, "2025-03-27"], ["2025-04", 0.42, "2025-04-25"],
  ["2025-05", 0.34, "2025-05-27"], ["2025-06", 0.19, "2025-06-26"],
  ["2025-07", 0.36, "2025-07-25"],
  ["2025-08", -0.12, "2025-08-12"], ["2025-08", -0.13, "2025-08-26"],
  ["2025-09", 0.61, "2025-09-10"], ["2025-09", 0.54, "2025-09-25"],
  ["2025-10", 0.21, "2025-10-09"], ["2025-10", 0.15, "2025-10-24"],
  ["2025-11", 0.23, "2025-11-11"], ["2025-11", 0.20, "2025-11-26"],
  ["2025-12", 0.43, "2025-12-10"], ["2025-12", 0.34, "2025-12-23"],
  ["2026-01", 0.36, "2026-01-09"], ["2026-01", 0.33, "2026-01-27"],
  ["2026-02", 0.45, "2026-02-10"], ["2026-02", 0.64, "2026-02-27"],
  ["2026-03", 0.30, "2026-03-12"], ["2026-03", 0.71, "2026-03-26"],
  ["2026-04", 0.68, "2026-04-10"], ["2026-04", 0.67, "2026-04-28"],
  ["2026-05", 0.50, "2026-05-12"], ["2026-05", 0.50, "2026-05-27"],
  ["2026-06", 0.34, "2026-06-12"], ["2026-06", 0.33, "2026-06-25"],
  ["2026-07", 0.23, "2026-07-10"], ["2026-07", 0.05, "2026-07-28"],
  ["2026-08", -0.20, "2026-08-11"], ["2026-08", -0.28, "2026-08-26"],
].map(([competencia, variacao_projetada, data_referencia]) => ({
  competencia: competencia as string,
  variacao_projetada: variacao_projetada as number,
  data_referencia: data_referencia as string,
}));

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
   * Cinco batem exato. Os que sobram sao o residuo conhecido: aniversario 8 e 15
   * (cujo aniversario de dezembro/2024 caiu num domingo) e o 31, que ainda esbarra
   * nos meses curtos. Ver a secao 15 de `_knowledge/ipca-metodologia-gorila.md`.
   */
  describe("VNA puro, sem spread (titulos IPCA+0%)", () => {
    const vna = (diaAniversario: number, inicio: string, dataCalculo: string) => {
      const fatores = construirFatoresIpcaDiarios({
        diaAniversario, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
        dataInicio: inicio,
      });
      return 1000 * DIAS_UTEIS
        .filter((d) => d > inicio && d <= dataCalculo)
        .reduce((acc, d) => acc * (fatores.get(d) ?? 1), 1);
    };

    // [dia do vencimento, compra, VNA no Gorila em 24/08/2026, folga aceita]
    const CASOS: [number, string, number, number][] = [
      [20, "2025-01-02", 1086.069, 0.001],   // exato
      [25, "2025-01-02", 1086.465, 0.001],   // exato
      [10, "2025-02-10", 1078.066, 0.001],
      [8,  "2025-01-02", 1084.568, 0.001],
      [15, "2025-01-02", 1085.443, 0.001],
      [31, "2025-01-02", 1086.708, 0.001],
      // Comprados no proprio dia do aniversario, em maio/2025. Abril foi divulgado em
      // 09/05: o de dia 8 comprou na vespera e corrige o primeiro ciclo; o de dia 15
      // comprou depois, com o indice ja publico, e nao corrige.
      [8,  "2025-05-08", 1056.560, 0.001],
      [15, "2025-05-15", 1051.784, 0.001],
      // Comprados em cima do aniversario de julho/2025, com junho ja divulgado desde
      // 10/07: os tres ficam deslocados um mes.
      [29, "2025-07-29", 1047.110, 0.001],
      [30, "2025-07-30", 1047.197, 0.001],
      [31, "2025-07-31", 1047.118, 0.001],
      // Aniversario 11, comprado no proprio aniversario um dia DEPOIS de o IPCA de maio
      // sair (10/06/2025): nao desloca, porque o corte e o dia 15.
      [11, "2025-06-11", 1051.951, 0.001],
    ];

    it.each(CASOS)("vencimento dia %i comprado em %s", (dia, compra, alvo, folga) => {
      expect(Math.abs(vna(dia, compra, "2026-08-24") - alvo)).toBeLessThan(folga);
    });

    it("bate no centavo quando a compra cai no dia do aniversario", () => {
      // sem ciclo inicial parcial, a formula reproduz o Gorila exatamente
      expect(vna(10, "2025-02-10", "2026-08-24")).toBeCloseTo(1078.066, 2);
      expect(vna(8, "2025-05-08", "2026-08-24")).toBeCloseTo(1056.560, 2);
    });

    /**
     * O corte do deslocamento e o DIA 15, nao a data de divulgacao do IPCA.
     *
     * Este papel foi cadastrado no Gorila em 30/08/2026 para separar as duas
     * explicacoes: aniversario 11, comprado em 11/06/2025 - um dia depois de o IPCA de
     * maio ser divulgado (10/06). Pela regra da divulgacao ele deveria deslocar; pela
     * regra do dia 15, nao. Medido no Gorila em tres datas, e o Gorila nao deslocou.
     */
    it("nao desloca quando o aniversario e antes do dia 15", () => {
      // 11/08/2025: dois ciclos cheios, maio (0,26%) e junho (0,24%). Com deslocamento
      // seriam junho e julho - que dao quase o mesmo, entao esta data nao separa.
      expect(vna(11, "2025-06-11", "2025-08-11") * 10).toBeCloseTo(10050.07, 2);
      // 11/09/2025 separa: sem deslocamento 10.076,19, com deslocamento 10.038,99.
      expect(vna(11, "2025-06-11", "2025-09-11") * 10).toBeCloseTo(10076.19, 2);
      // e 14 meses depois continua batendo no centavo
      expect(vna(11, "2025-06-11", "2026-08-24") * 10).toBeCloseTo(10519.51, 2);
    });

    /**
     * A serie historica de um ciclo aberto segue a projecao ANBIMA vigente em cada dia,
     * e o Gorila reprecifica o ciclo inteiro quando ela muda. Medido no Gorila em
     * 30/08/2026 sobre o CDB de vencimento 15/12/2025 - o ponto que o Daniel achou
     * investigando dia a dia. Ver a secao 22 do vault.
     *
     * Papel de aniversario 15 comprado em 15/05/2025: deslocado, entao o ciclo que
     * comeca em 15/11/2025 carrega a competencia de novembro/2025.
     */
    it("segue a projecao vigente em cada dia do ciclo aberto", () => {
      const fatores = construirFatoresIpcaDiarios({
        diaAniversario: 15, calendario: CAL, competencias: COMPETENCIAS,
        projecao: PROJECAO, dataInicio: "2025-05-15",
      });
      const doCiclo = DIAS_UTEIS.filter((d) => d > "2025-11-15" && d <= "2025-12-15");
      const implicita = (ate: string) => {
        const ate_ = doCiclo.filter((d) => d <= ate);
        const acumulado = ate_.reduce((a, d) => a * (fatores.get(d) ?? 1), 1);
        return (Math.pow(acumulado, doCiclo.length / ate_.length) - 1) * 100;
      };
      expect(implicita("2025-11-25")).toBeCloseTo(0.23, 3);   // projecao coletada em 11/11
      expect(implicita("2025-11-26")).toBeCloseTo(0.20, 3);   // revisada no dia do IPCA-15
      expect(implicita("2025-12-09")).toBeCloseTo(0.20, 3);   // vespera do IPCA fechado
      expect(implicita("2025-12-12")).toBeCloseTo(0.18, 3);   // oficial, divulgado em 10/12
    });

    /**
     * O teste que fixa a regra do deslocamento. Em 29/08/2025, um mes depois da
     * compra, os tres papeis comprados em 29, 30 e 31 de julho de 2025 marcam
     * 1.002,599 no Gorila - a variacao de JULHO cheia (0,2599%). A convencao normal
     * (mes M-1) daria a de junho, 0,2400%, ou seja 1.002,400.
     */
    it("desloca um mes quando a compra cai num aniversario ja divulgado", () => {
      for (const [dia, compra] of [[29, "2025-07-29"], [30, "2025-07-30"], [31, "2025-07-31"]] as const) {
        expect(vna(dia, compra, "2025-08-29")).toBeCloseTo(1002.599, 2);
      }
      // O de dia 31 so fecha cheio porque o ciclo em que o papel nasce nao conta o dia
      // do aniversario no denominador - ali nao ha ciclo anterior para emendar.
      // e os que compraram na vespera da divulgacao seguem na convencao normal
      expect(vna(8, "2025-05-08", "2025-08-29")).toBeCloseTo(1011.202, 2);
      expect(vna(10, "2025-02-10", "2025-08-29")).toBeCloseTo(1031.669, 2);
    });
  });
});

/**
 * Quando o papel entra no MEIO de um ciclo, o acumulado tem de ser contado a partir da
 * COMPRA. Se for contado da abertura do ciclo, o fator do dia em que o indice troca
 * (revisao da projecao ou saida do oficial) desfaz a projecao tambem dos dias em que o
 * papel ainda nao existia, e sobra um residuo permanente.
 *
 * Assinatura no Gorila: o papel bate no centavo ate a vespera da divulgacao, da um degrau
 * unico no dia dela e congela. Medido em quatro CDBs, com residuos de R$ 0,10 a R$ 0,44
 * numa posicao de R$ 10.000. Exemplo do IPCA+2,50% comprado em 05/05/2025, cujo ciclo
 * abre em 01/05: exato ate 08/05, degrau em 09/05 (divulgacao do IPCA de abril).
 */
describe("entrada no meio do ciclo", () => {
  const CICLO_ABRE = "2025-05-01", COMPRA = "2025-05-05";
  const fatores = construirFatoresIpcaDiarios({
    diaAniversario: 1, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
    dataInicio: COMPRA,
  });
  const doCiclo = DIAS_UTEIS.filter((d) => d > CICLO_ABRE && d <= "2025-06-01");
  const acum = (ate: string) =>
    doCiclo.filter((d) => d > COMPRA && d <= ate).reduce((a, d) => a * (fatores.get(d) ?? 1), 1);

  it("no fim do ciclo o papel aplica exatamente a fracao dele, nao a do ciclo inteiro", () => {
    // abril/2025 = 7276,54 / 7245,38. Divulgado em 09/05, dentro do ciclo.
    const fatorAbril = 7276.54 / 7245.38;
    const nDoPapel = doCiclo.filter((d) => d > COMPRA).length;
    const dut = doCiclo.length;
    expect(acum("2025-06-01")).toBeCloseTo(Math.pow(fatorAbril, nDoPapel / dut), 12);
  });

  it("o degrau da divulgacao nao carrega os dias anteriores a compra", () => {
    // 09/05/2025 e o dia da divulgacao de abril. O salto do dia tem de valer so para o
    // pedaco do papel; antes da correcao ele desfazia a projecao desde 01/05.
    const antes = acum("2025-05-08");
    const depois = acum("2025-05-09");
    const fatorAbril = 7276.54 / 7245.38;
    const dut = doCiclo.length;
    const n8 = doCiclo.filter((d) => d > COMPRA && d <= "2025-05-08").length;
    const n9 = n8 + 1;
    // No dia da divulgacao o acumulado inteiro do papel passa a valer pelo indice oficial
    expect(depois).toBeCloseTo(Math.pow(fatorAbril, n9 / dut), 12);
    expect(depois).toBeGreaterThan(antes);
  });

  it("papel comprado no proprio aniversario nao muda de comportamento", () => {
    const f = construirFatoresIpcaDiarios({
      diaAniversario: 1, calendario: CAL, competencias: COMPETENCIAS, projecao: PROJECAO,
      dataInicio: CICLO_ABRE,
    });
    const fatorAbril = 7276.54 / 7245.38;
    const prod = doCiclo.reduce((a, d) => a * (f.get(d) ?? 1), 1);
    expect(prod).toBeCloseTo(fatorAbril, 12);
  });
});
