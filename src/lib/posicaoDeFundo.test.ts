import { describe, expect, it } from "vitest";
import { cotasCosturadas, posicaoNaData, TIPO_MUDANCA_DE_FUNDO, trechosDaPosicao } from "./posicaoDeFundo";

// Operacoes reais do Kinea do Daniel (extrato XP): o Advisory ate 10/04/2025 e a Subclasse II
// depois. A quantidade da mudanca aqui e ilustrativa.
const movs = [
  { fundo_id: "advisory", data: "2023-12-29", tipo_movimentacao: "Aplicação Inicial", quantidade: 110439.98299791 },
  { fundo_id: "advisory", data: "2024-12-11", tipo_movimentacao: "Resgate", quantidade: 39849.20529394 },
  { fundo_id: "subclasse-ii", data: "2025-04-11", tipo_movimentacao: TIPO_MUDANCA_DE_FUNDO, quantidade: 70000 },
  { fundo_id: "subclasse-ii", data: "2025-04-23", tipo_movimentacao: "Resgate", quantidade: 48605.24652808 },
];

describe("posicao de fundo com mudanca", () => {
  it("antes da mudanca a posicao e do fundo antigo", () => {
    const p = posicaoNaData(movs, "2025-04-10");
    expect(p.fundoId).toBe("advisory");
    expect(p.saldo).toBeCloseTo(70590.77770397, 8);
  });

  it("a mudanca troca o fundo e SUBSTITUI o saldo", () => {
    const p = posicaoNaData(movs, "2025-04-11");
    expect(p.fundoId).toBe("subclasse-ii");
    expect(p.saldo).toBe(70000);
    expect(posicaoNaData(movs, "2025-04-23").saldo).toBeCloseTo(21394.75347192, 8);
  });

  it("a ordem de chegada dos movimentos nao importa", () => {
    expect(posicaoNaData([...movs].reverse(), "2025-04-23").saldo).toBeCloseTo(21394.75347192, 8);
  });

  it("posicao sem mudanca e so soma e subtrai", () => {
    expect(posicaoNaData(movs.slice(0, 2), "2026-01-01")).toEqual({ fundoId: "advisory", saldo: 70590.77770397 });
  });
});

describe("serie costurada", () => {
  const cotas = new Map([
    ["advisory", [
      { data: "2025-04-09", valor_cota: 1.5271147 },
      { data: "2025-04-10", valor_cota: 1.5267928 },
      { data: "2025-04-11", valor_cota: 0 },
    ]],
    ["subclasse-ii", [
      { data: "2025-04-10", valor_cota: 9.99 },
      { data: "2025-04-11", valor_cota: 1.5302534 },
      { data: "2025-04-14", valor_cota: 1.532315 },
    ]],
  ]);

  it("usa o fundo antigo antes da mudanca e o novo a partir dela", () => {
    const serie = cotasCosturadas(trechosDaPosicao(movs), cotas);
    expect(serie).toEqual([
      { data: "2025-04-09", valor_cota: 1.5271147 },
      { data: "2025-04-10", valor_cota: 1.5267928 },
      { data: "2025-04-11", valor_cota: 1.5302534 },
      { data: "2025-04-14", valor_cota: 1.532315 },
    ]);
  });

  it("sem mudanca devolve a serie do proprio fundo", () => {
    expect(cotasCosturadas(trechosDaPosicao(movs.slice(0, 2)), cotas)).toHaveLength(3);
  });
});
