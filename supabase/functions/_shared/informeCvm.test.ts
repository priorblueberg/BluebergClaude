import { describe, expect, it } from "vitest";
import { ehRegimeNovo, ficaComNova } from "./informeCvm.ts";

describe("linha repetida no informe diario da CVM", () => {
  it("reconhece os dois regimes", () => {
    expect(ehRegimeNovo("CLASSES - FIF")).toBe(true);
    expect(ehRegimeNovo("CLASSE FIF/FAPI")).toBe(true);
    expect(ehRegimeNovo("FI")).toBe(false);
    expect(ehRegimeNovo("FAPI")).toBe(false);
  });

  it("troca a linha do regime antigo pela do novo, venha na ordem que vier", () => {
    expect(ficaComNova("FI", "CLASSES - FIF")).toBe(true);
    expect(ficaComNova("CLASSES - FIF", "FI")).toBe(false);
    expect(ficaComNova("FAPI", "CLASSE FIF/FAPI")).toBe(true);
  });

  it("entre duas do mesmo regime fica a primeira", () => {
    expect(ficaComNova("FI", "FI")).toBe(false);
    expect(ficaComNova("CLASSES - FIF", "CLASSES - FIF")).toBe(false);
  });
});
