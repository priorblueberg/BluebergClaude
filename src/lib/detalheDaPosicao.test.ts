import { describe, expect, it } from "vitest";
import { dadosDaPosicao, tabelaDeRentabilidade, ultimoAte } from "./detalheDaPosicao";

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

  it("sem série, sem tabela", () => {
    expect(tabelaDeRentabilidade([], [])).toEqual([]);
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
