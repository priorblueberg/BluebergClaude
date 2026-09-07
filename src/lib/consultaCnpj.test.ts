import { describe, it, expect } from "vitest";
import { cnpjValido, formatarCnpj, soDigitos } from "./consultaCnpj";

/**
 * A validacao local existe para separar "voce digitou errado" de "essa empresa nao existe".
 * Sem ela, um digito trocado vira 404 da API e a mensagem manda o usuario procurar a empresa,
 * quando o que ele precisa e conferir o numero.
 */
describe("cnpjValido", () => {
  it("aceita CNPJ real, com ou sem mascara", () => {
    // COMGAS, o emissor da debenture que motivou tudo isto.
    expect(cnpjValido("61856571000117")).toBe(true);
    expect(cnpjValido("61.856.571/0001-17")).toBe(true);
    // Klabin, emissora de CRA.
    expect(cnpjValido("89637490000145")).toBe(true);
  });

  it("recusa digito verificador trocado", () => {
    expect(cnpjValido("61856571000118")).toBe(false);
    expect(cnpjValido("61856571000127")).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(cnpjValido("6185657100011")).toBe(false);
    expect(cnpjValido("618565710001177")).toBe(false);
    expect(cnpjValido("")).toBe(false);
  });

  it("recusa a sequencia repetida, que passa na conta do DV", () => {
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
  });
});

describe("formatarCnpj", () => {
  it("aplica a mascara conforme o usuario digita", () => {
    expect(formatarCnpj("61")).toBe("61");
    expect(formatarCnpj("61856")).toBe("61.856");
    expect(formatarCnpj("61856571")).toBe("61.856.571");
    expect(formatarCnpj("618565710001")).toBe("61.856.571/0001");
    expect(formatarCnpj("61856571000117")).toBe("61.856.571/0001-17");
  });

  it("ignora o que nao e digito e nao passa de 14", () => {
    expect(formatarCnpj("61.856.571/0001-17")).toBe("61.856.571/0001-17");
    expect(formatarCnpj("61856571000117999")).toBe("61.856.571/0001-17");
  });
});

describe("soDigitos", () => {
  it("limpa a mascara", () => {
    expect(soDigitos("61.856.571/0001-17")).toBe("61856571000117");
    expect(soDigitos("")).toBe("");
  });
});
