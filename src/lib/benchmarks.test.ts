import { describe, it, expect } from "vitest";
import { buildCdiSeries, buildIbovespaSeries, buildPrefixadoSeries } from "./cdiCalculations";

describe("serie do Ibovespa recortada na janela", () => {
  // A serie chega desde o inicio da carteira porque os motores por produto precisam dela
  // inteira. O grafico, nao: pegar o primeiro ponto do array como base acumulava desde o
  // comeco E injetava pontos anteriores a janela, esticando o eixo X.
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
    expect(s.get("2026-08-31")).toBeCloseTo(10, 4);
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

describe("primeiro ponto e granularidade do grafico de rentabilidade", () => {
  // Pedido do Daniel em 2026-09-01: o grafico comeca no dia da primeira aplicacao da
  // carteira, nao num ponto ancora no dia anterior, e so tem dia util.
  const registros = [
    { data: "2026-08-27", taxa_anual: 13.9, dia_util: true },
    { data: "2026-08-28", taxa_anual: 13.9, dia_util: true },
    { data: "2026-08-29", taxa_anual: 13.9, dia_util: false }, // sabado
    { data: "2026-08-31", taxa_anual: 13.9, dia_util: true },
  ];

  it("o primeiro ponto e o proprio inicio, nao o dia anterior", () => {
    const s = buildCdiSeries(registros, "2026-08-27", "2026-08-31");
    expect(s[0].data).toBe("2026-08-27");
    expect(s.some((p) => p.data < "2026-08-27")).toBe(false);
  });

  it("nao entra dia nao util", () => {
    const s = buildCdiSeries(registros, "2026-08-27", "2026-08-31");
    expect(s.map((p) => p.data)).toEqual(["2026-08-27", "2026-08-28", "2026-08-31"]);
  });

  it("o benchmark ja rende no primeiro dia (D0), diferente do produto", () => {
    const s = buildCdiSeries(registros, "2026-08-27", "2026-08-31");
    expect(s[0].cdi_acumulado).toBeCloseTo((Math.pow(1.139, 1 / 252) - 1) * 100, 4);
  });

  it("no prefixado o primeiro ponto vale 0%, porque o titulo nao rende D0", () => {
    const dias = [
      { data: "2026-08-27", dia_util: true },
      { data: "2026-08-28", dia_util: true },
      { data: "2026-08-29", dia_util: false },
      { data: "2026-08-31", dia_util: true },
    ];
    const s = buildPrefixadoSeries(dias, 12, "2026-08-27", "2026-08-31");
    expect(s.map((p) => p.data)).toEqual(["2026-08-27", "2026-08-28", "2026-08-31"]);
    expect(s[0].cdi_acumulado).toBe(0);
    expect(s[1].cdi_acumulado).toBeCloseTo((Math.pow(1.12, 1 / 252) - 1) * 100, 4);
  });
});
