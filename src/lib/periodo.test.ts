import { describe, it, expect } from "vitest";
import {
  limiteISO, periodoDoPreset, janelaDaLamina, aplicarJanela, deBR, fmtBR,
} from "./periodo";
import { buildCdiSeries, buildIbovespaSeries } from "./cdiCalculations";

/** 01/09/2026, uma terça. O teto é D0, o próprio dia. */
const HOJE = new Date(2026, 8, 1, 12, 0, 0);

describe("teto D0", () => {
  it("o limite e o proprio dia, como no Gorila", () => {
    expect(limiteISO(HOJE)).toBe("2026-09-01");
  });

  it("nenhum atalho passa do limite", () => {
    for (const p of ["30d", "12m", "mesAtual", "anoAtual", "mesAnterior", "anoAnterior", "inicio"] as const) {
      expect(periodoDoPreset(p, HOJE).fim <= "2026-09-01").toBe(true);
    }
  });
});

describe("atalhos, na convencao do Gorila", () => {
  it("30 dias conta 30 dias corridos para tras", () => {
    // Batido com o Gorila em 01/09/2026: "30 dias" = 02/08/2026 - 01/09/2026.
    expect(periodoDoPreset("30d", HOJE)).toMatchObject({ inicio: "2026-08-02", fim: "2026-09-01" });
  });

  it("12 meses volta um ano", () => {
    expect(periodoDoPreset("12m", HOJE)).toMatchObject({ inicio: "2025-09-01", fim: "2026-09-01" });
  });

  it("mes atual vai do dia 1 ate hoje", () => {
    expect(periodoDoPreset("mesAtual", HOJE)).toMatchObject({ inicio: "2026-09-01", fim: "2026-09-01" });
    expect(periodoDoPreset("mesAtual", new Date(2026, 8, 15, 12))).toMatchObject({ inicio: "2026-09-01", fim: "2026-09-15" });
  });

  it("ano atual comeca em 1o de janeiro", () => {
    expect(periodoDoPreset("anoAtual", HOJE)).toMatchObject({ inicio: "2026-01-01", fim: "2026-09-01" });
  });

  it("mes anterior e o mes fechado inteiro", () => {
    // Medido no Gorila em 01/09/2026: 01/08/2026 - 31/08/2026.
    expect(periodoDoPreset("mesAnterior", HOJE)).toMatchObject({ inicio: "2026-08-01", fim: "2026-08-31" });
  });

  it("ano anterior e o ano fechado inteiro", () => {
    expect(periodoDoPreset("anoAnterior", HOJE)).toMatchObject({ inicio: "2025-01-01", fim: "2025-12-31" });
  });

  it("desde o inicio deixa a ponta inicial em aberto", () => {
    expect(periodoDoPreset("inicio", HOJE)).toMatchObject({ inicio: null, fim: "2026-09-01" });
  });
});

describe("janela da lamina", () => {
  const fim = "2026-08-31";

  it("desde o inicio usa o comeco da propria carteira", () => {
    const p = { inicio: null, fim, preset: "inicio" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2024-01-03", fim });
  });

  it("janela anterior a carteira e recortada no comeco dela, como no Gorila", () => {
    const p = { inicio: "2020-01-01", fim, preset: "custom" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2024-01-03", fim });
  });

  it("janela posterior ao comeco da carteira e respeitada", () => {
    const p = { inicio: "2026-01-01", fim, preset: "anoAtual" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2026-01-01", fim });
  });

  it("janela inteiramente antes da carteira nao existe", () => {
    const p = { inicio: "2020-01-01", fim: "2021-12-31", preset: "custom" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toBeNull();
  });
});

describe("aplicarJanela", () => {
  it("troca as duas pontas da carteira pela janela", () => {
    const cart = { data_inicio: "2024-01-03", data_calculo: "2026-08-27", nome: "Renda Fixa" };
    const p = { inicio: "2026-01-01", fim: "2026-08-31", preset: "anoAtual" as const };
    expect(aplicarJanela(cart, p)).toEqual({ ...cart, data_inicio: "2026-01-01", data_calculo: "2026-08-31" });
  });

  it("o fim NAO e recortado pelo fim da carteira: carteira encerrada continua no historico", () => {
    // Patrimonio zera, mas o ganho e a rentabilidade do periodo em que ela viveu ficam.
    const cart = { data_inicio: "2024-01-03", data_calculo: "2025-06-30" };
    const p = { inicio: null, fim: "2026-08-31", preset: "inicio" as const };
    expect(aplicarJanela(cart, p)).toEqual({ data_inicio: "2024-01-03", data_calculo: "2026-08-31" });
  });

  it("carteira nao iniciada passa direto", () => {
    const cart = { data_inicio: null, data_calculo: null };
    const p = { inicio: null, fim: "2026-08-31", preset: "inicio" as const };
    expect(aplicarJanela(cart, p)).toEqual(cart);
  });
});

describe("datas em dd/mm/aaaa", () => {
  it("ida e volta", () => {
    expect(deBR("31/08/2026")).toBe("2026-08-31");
    expect(fmtBR("2026-08-31")).toBe("31/08/2026");
  });

  it("recusa data que nao existe", () => {
    expect(deBR("31/02/2026")).toBeNull();
    expect(deBR("1/8/2026")).toBeNull();
    expect(deBR("abacaxi")).toBeNull();
  });
});

describe("serie do Ibovespa recortada na janela", () => {
  // A serie chega desde o inicio da carteira porque os motores por produto precisam dela
  // inteira. O grafico, nao: pegar o primeiro ponto do array como base acumulava desde
  // 2024 E injetava pontos anteriores a janela, esticando o eixo X de um periodo de
  // agosto/2026 de volta ate 02/01/2024.
  const pontos = [
    { data: "2024-01-02", pontos: 100 },
    { data: "2026-07-31", pontos: 180 },
    { data: "2026-08-03", pontos: 200 },
    { data: "2026-08-31", pontos: 220 },
    { data: "2026-09-01", pontos: 240 },
  ];

  it("nao devolve ponto fora da janela", () => {
    const s = buildIbovespaSeries(pontos, "2026-08-01", "2026-08-31");
    expect([...s.keys()]).toEqual(["2026-08-03", "2026-08-31"]);
  });

  it("rebaseia no primeiro pregao DENTRO da janela", () => {
    const s = buildIbovespaSeries(pontos, "2026-08-01", "2026-08-31");
    expect(s.get("2026-08-03")).toBe(0);
    expect(s.get("2026-08-31")).toBeCloseTo(10, 4); // 220/200
  });

  it("janela inteira usa o primeiro ponto de todos", () => {
    const s = buildIbovespaSeries(pontos, "2024-01-01");
    expect(s.get("2024-01-02")).toBe(0);
    expect(s.get("2026-09-01")).toBeCloseTo(140, 4);
  });

  it("janela sem pregao devolve serie vazia em vez de dividir por nada", () => {
    expect(buildIbovespaSeries(pontos, "2026-08-04", "2026-08-10").size).toBe(0);
    expect(buildIbovespaSeries([], "2024-01-01").size).toBe(0);
  });
});

describe("benchmark de CDI em dia sem publicacao", () => {
  /**
   * NAO acumula, e nao e simetrico com o produto. A regra e D+1 produto / D0 benchmark: o
   * titulo no dia D rende com o CDI de D-1, que ja existe, entao anda sem precisar da taxa
   * do proprio dia; o benchmark no dia D precisa da taxa de D.
   *
   * Medido no Gorila em 2026-09-01, dia util cujo CDI so sai em 02/09: o portfolio rendeu
   * 0,0292% e o CDI de setembro veio 0,000000% - zero exato. O acumulado dele, 38,6376%, e
   * a serie sem o dia repetido.
   */
  const registros = [
    { data: "2026-08-27", taxa_anual: 13.9, dia_util: true },
    { data: "2026-08-28", taxa_anual: 13.9, dia_util: true },
    { data: "2026-08-31", taxa_anual: 13.9, dia_util: true },
    // 01/09 e dia util, mas o CDI dele so sai em 02/09: nao entra na serie.
  ];

  it("o acumulado para no ultimo dia publicado", () => {
    const s = buildCdiSeries(registros, "2026-08-27", "2026-09-01");
    expect(s[s.length - 1].data).toBe("2026-08-31");
    const fator = Math.pow(1.139, 1 / 252);
    expect(s[s.length - 1].cdi_acumulado).toBeCloseTo((Math.pow(fator, 3) - 1) * 100, 4);
  });

  it("pedir ate uma data sem CDI nao inventa acumulo", () => {
    const ate31 = buildCdiSeries(registros, "2026-08-27", "2026-08-31");
    const ate01 = buildCdiSeries(registros, "2026-08-27", "2026-09-01");
    expect(ate01[ate01.length - 1].cdi_acumulado).toBe(ate31[ate31.length - 1].cdi_acumulado);
  });
});
