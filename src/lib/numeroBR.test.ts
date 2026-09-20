import { describe, it, expect } from "vitest";
import { formatarQuantidadeBR, parseQuantidade, parseQuantidadeMascarada } from "./numeroBR";

describe("parseQuantidade", () => {
  it("lê a vírgula como decimal e os pontos como milhar", () => {
    expect(parseQuantidade("1.234,56")).toBe(1234.56);
    expect(parseQuantidade("62,81135294")).toBe(62.81135294);
    expect(parseQuantidade("1.445,74369355")).toBe(1445.74369355);
  });

  it("um ponto sozinho é decimal: 0.5 cota não vira 5", () => {
    expect(parseQuantidade("0.5")).toBe(0.5);
    expect(parseQuantidade("62.81135294")).toBe(62.81135294);
  });

  it("vários pontos são milhar", () => {
    expect(parseQuantidade("1.234.567")).toBe(1234567);
  });

  it("número inteiro simples", () => {
    expect(parseQuantidade("1234")).toBe(1234);
  });

  it("em branco devolve null, não zero", () => {
    expect(parseQuantidade("")).toBeNull();
    expect(parseQuantidade("   ")).toBeNull();
    expect(parseQuantidade(null)).toBeNull();
    expect(parseQuantidade(undefined)).toBeNull();
  });

  it("texto sem número devolve null", () => {
    expect(parseQuantidade("abc")).toBeNull();
  });
});

describe("formatarQuantidadeBR", () => {
  it("põe ponto no milhar", () => {
    expect(formatarQuantidadeBR("1300")).toBe("1.300");
    expect(formatarQuantidadeBR("1234567")).toBe("1.234.567");
    expect(formatarQuantidadeBR("100")).toBe("100");
  });
  it("mantém a vírgula enquanto se digita o decimal", () => {
    expect(formatarQuantidadeBR("1300,")).toBe("1.300,");
    expect(formatarQuantidadeBR("1300,5")).toBe("1.300,5");
  });
  it("ignora o que não é dígito nem vírgula, inclusive o ponto digitado", () => {
    expect(formatarQuantidadeBR("1.300")).toBe("1.300");
    expect(formatarQuantidadeBR("abc12x")).toBe("12");
  });
  it("limita as casas decimais", () => {
    expect(formatarQuantidadeBR("1,123456789")).toBe("1,12345678");
  });
  it("vazio continua vazio", () => {
    expect(formatarQuantidadeBR("")).toBe("");
  });
});

describe("parseQuantidadeMascarada", () => {
  it("ponto é sempre milhar", () => {
    expect(parseQuantidadeMascarada("1.300")).toBe(1300);
    expect(parseQuantidadeMascarada("1.234.567")).toBe(1234567);
  });
  it("vírgula é sempre decimal", () => {
    expect(parseQuantidadeMascarada("1.300,5")).toBe(1300.5);
    expect(parseQuantidadeMascarada("0,25")).toBe(0.25);
  });
  it("é o oposto do parseQuantidade no caso ambíguo", () => {
    expect(parseQuantidade("1.300")).toBe(1.3);
    expect(parseQuantidadeMascarada("1.300")).toBe(1300);
  });
  it("vazio vira null", () => {
    expect(parseQuantidadeMascarada("")).toBeNull();
    expect(parseQuantidadeMascarada("  ")).toBeNull();
  });
});
