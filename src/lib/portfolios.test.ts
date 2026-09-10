import { describe, expect, it } from "vitest";
import {
  LIMITE_DE_PORTFOLIOS, normalizarNomeDePortfolio, traduzirErroDePortfolio, validarNomeDePortfolio,
} from "./portfolios";

describe("nome de portfólio", () => {
  const existentes = [
    { id: "1", nome: "Testes Blueberg" },
    { id: "2", nome: "Pessoal XP" },
  ];

  it("normaliza os espaços antes de gravar", () => {
    expect(normalizarNomeDePortfolio("  Pessoal   XP ")).toBe("Pessoal XP");
  });

  it("recusa nome vazio", () => {
    expect(validarNomeDePortfolio("   ", existentes)).toBe("Informe um nome.");
  });

  it("recusa nome acima de 60 caracteres", () => {
    expect(validarNomeDePortfolio("a".repeat(61), existentes)).toMatch(/60 caracteres/);
    expect(validarNomeDePortfolio("a".repeat(60), existentes)).toBeNull();
  });

  it("duplicado não diferencia maiúsculas nem espaços, como o índice do banco", () => {
    expect(validarNomeDePortfolio(" pessoal   xp", existentes)).toBe("Já existe um portfólio com esse nome.");
  });

  it("ao renomear, o portfólio pode manter o próprio nome", () => {
    expect(validarNomeDePortfolio("PESSOAL XP", existentes, "2")).toBeNull();
    expect(validarNomeDePortfolio("Pessoal XP", existentes, "1")).toBe("Já existe um portfólio com esse nome.");
  });

  it("aceita nome novo", () => {
    expect(validarNomeDePortfolio("Pessoal Gorila", existentes)).toBeNull();
  });
});

describe("mensagens do banco", () => {
  it("índice único vira nome duplicado", () => {
    expect(traduzirErroDePortfolio({ code: "23505", message: "duplicate key" })).toBe("Já existe um portfólio com esse nome.");
  });

  it("mensagem dos gatilhos passa como veio", () => {
    expect(traduzirErroDePortfolio({ code: "P0001", message: `Limite de ${LIMITE_DE_PORTFOLIOS} portfólios por conta.` }))
      .toBe("Limite de 10 portfólios por conta.");
  });

  it("sem erro nem mensagem, texto genérico", () => {
    expect(traduzirErroDePortfolio(null)).toBe("Não foi possível concluir a operação.");
  });
});
