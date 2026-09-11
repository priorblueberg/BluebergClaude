import { describe, expect, it } from "vitest";
import { buildCdiSeries } from "./cdiCalculations";
import { dadosDaPosicao, montarGraficoETabela, serieDoProduto, tabelaDeRentabilidade, ultimoAte } from "./detalheDaPosicao";
import { metricasDoProdutoNaJanela } from "./janelaDoProduto";
import type { DailyRow } from "./rendaFixaEngine";

describe("tabela de rentabilidade da posição", () => {
  // Dezembro rende 1% (acumulado 1,00%) e janeiro mais 1% sobre isso (acumulado 2,01%).
  const serie = [
    { data: "2025-12-01", pct: 0 },
    { data: "2025-12-31", pct: 1 },
    { data: "2026-01-15", pct: 1.5 },
    { data: "2026-01-30", pct: 2.01 },
  ];
  const cdi = [
    { data: "2025-12-01", cdi_acumulado: 0.05 },
    { data: "2025-12-31", cdi_acumulado: 0.5 },
    { data: "2026-01-30", cdi_acumulado: 1.505 },
  ];

  it("mês sai do acumulado no fim do mês contra o fim do mês anterior", () => {
    const [ano2026, ano2025] = tabelaDeRentabilidade(serie, cdi);
    expect(ano2026.year).toBe(2026);
    expect(ano2026.rentabilidadeMonths[0]).toBe(1);
    expect(ano2026.cdiMonths[0]).toBe(1);
    expect(ano2025.rentabilidadeMonths[11]).toBe(1);
    expect(ano2025.cdiMonths[11]).toBe(0.5);
  });

  it("o ano fecha no acumulado, sem meses fora da posição", () => {
    const [ano2026, ano2025] = tabelaDeRentabilidade(serie, cdi);
    expect(ano2026.rentNoAno).toBe(1);
    expect(ano2026.rentAcumulado).toBe(2.01);
    expect(ano2025.rentabilidadeMonths.slice(0, 11).every((v) => v === null)).toBe(true);
  });

  it("% do CDI com todas as casas, e não com os valores já arredondados", () => {
    // Março de 2026 do SulAmérica: cota 1,2130% e CDI 1,2121%. Arredondados, dariam 100,00%.
    const [ano] = tabelaDeRentabilidade(
      [{ data: "2026-02-27", pct: 0 }, { data: "2026-03-31", pct: 1.213 }],
      [{ data: "2026-02-27", cdi_acumulado: 0 }, { data: "2026-03-31", cdi_acumulado: 1.2121 }],
    );
    expect(ano.rentabilidadeMonths[2]).toBe(1.21);
    expect(ano.cdiMonths[2]).toBe(1.21);
    expect(ano.percentualCdiMonths?.[2]).toBe(100.07);
  });

  it("sem série, sem tabela", () => {
    expect(tabelaDeRentabilidade([], [])).toEqual([]);
  });
});

describe("janela do produto", () => {
  // A cota saiu até 08/09; em 09 e 10/09 o fundo fica parado e o CDI anda.
  const cdiRecords = ["2026-09-08", "2026-09-09", "2026-09-10"].map((data) => ({ data, taxa_anual: 14.9, dia_util: true }));
  const serie = [
    { data: "2026-09-08", pct: 0.05 },
    { data: "2026-09-09", pct: 0.05 },
    { data: "2026-09-10", pct: 0.05 },
  ];

  it("o CDI e o gráfico param na última cota divulgada", () => {
    const r = montarGraficoETabela({
      serie, cdiRecords, ibovespa: [], inicio: "2026-09-08", fim: "2026-09-10", ultimaDataDoProduto: "2026-09-08",
    });
    const ateACota = buildCdiSeries(cdiRecords, "2026-09-08", "2026-09-08");
    expect(r.grafico.map((p) => p.data)).toEqual(["2026-09-08"]);
    expect(r.cdiAcumuladoPct).toBe(ateACota[ateACota.length - 1].cdi_acumulado);
  });

  it("sem data do produto (renda fixa), vale o fim informado", () => {
    const r = montarGraficoETabela({ serie, cdiRecords, ibovespa: [], inicio: "2026-09-08", fim: "2026-09-10" });
    expect(r.grafico.map((p) => p.data)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
  });
});

describe("dados da posição", () => {
  it("último preço é o mais recente até a data", () => {
    const serie = [{ data: "2026-09-04", valor: 1 }, { data: "2026-09-08", valor: 2 }, { data: "2026-09-10", valor: 3 }];
    expect(ultimoAte(serie, "2026-09-09")).toEqual({ data: "2026-09-08", valor: 2 });
  });

  it("preço médio é valor investido dividido pela quantidade", () => {
    expect(dadosDaPosicao(379136.16, 26856.80127955, null).precoMedio).toBeCloseTo(14.11695143, 7);
    expect(dadosDaPosicao(0, 0, null).precoMedio).toBeNull();
  });
});

describe("série da gaveta", () => {
  // Aplica 1.000 na segunda, rende 10 na terça e 10,10 na quarta; sábado e domingo ficam fora.
  const linha = (data: string, liquido: number, aplicacoes: number, ganhoDiario: number) =>
    ({ data, diaUtil: true, liquido, liquido2: liquido, aplicacoes, ganhoDiario }) as unknown as DailyRow;
  const linhas = [
    linha("2026-09-07", 1000, 1000, 0),
    linha("2026-09-08", 1010, 0, 10),
    linha("2026-09-09", 1020.1, 0, 10.1),
  ];
  const calendario = [
    { data: "2026-09-07", dia_util: true },
    { data: "2026-09-08", dia_util: true },
    { data: "2026-09-09", dia_util: true },
    { data: "2026-09-12", dia_util: false },
  ];

  it("fecha com a rentabilidade da linha da lâmina", () => {
    const serie = serieDoProduto(linhas, calendario, "2026-09-07", "2026-09-09");
    const linhaDaLamina = metricasDoProdutoNaJanela(linhas, calendario, "2026-09-07", "2026-09-09");
    expect(serie.at(-1)!.pct).toBeCloseTo(linhaDaLamina.rentabilidade, 10);
    expect(serie.at(-1)!.pct).toBeCloseTo(2.01, 10);
  });

  it("para no fim do período do produto", () => {
    expect(serieDoProduto(linhas, calendario, "2026-09-07", "2026-09-08").map((p) => p.data)).toEqual(["2026-09-07", "2026-09-08"]);
  });
});
