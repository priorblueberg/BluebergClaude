import { describe, expect, it } from "vitest";
import { diasDeCotizacao } from "./fundoEngine";

// Prazos diferentes de proposito: com tudo em D+0 o erro de tipo nao aparece.
const prazos = { dias_cotizacao_aplicacao: 1, dias_cotizacao_resgate: 30 };

describe("prazo de cotização por tipo de movimentação", () => {
  it("aplicação inicial usa o prazo de aplicação, como a aplicação", () => {
    expect(diasDeCotizacao("Aplicação Inicial", prazos)).toBe(1);
    expect(diasDeCotizacao("Aplicação", prazos)).toBe(1);
  });

  it("resgates usam o prazo de resgate", () => {
    expect(diasDeCotizacao("Resgate", prazos)).toBe(30);
    expect(diasDeCotizacao("Resgate Total", prazos)).toBe(30);
  });

  it("come-cotas não tem prazo: é retenção na cota do próprio dia", () => {
    expect(diasDeCotizacao("Come-Cotas", prazos)).toBe(0);
  });

  it("fundo sem prazo cadastrado cotiza em D+0", () => {
    expect(diasDeCotizacao("Aplicação Inicial", null)).toBe(0);
    expect(diasDeCotizacao("Resgate", { dias_cotizacao_aplicacao: null, dias_cotizacao_resgate: null })).toBe(0);
  });
});
