import { describe, it, expect } from "vitest";
import { parseQuantidade } from "./numeroBR";

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
