import { describe, it, expect } from "vitest";
import { DATA_MINIMA_CARTEIRA, foraDaJanela } from "./validacaoBoleta";

/**
 * A data minima da carteira e o ULTIMO DIA UTIL DO ANO ANTERIOR ao primeiro ano coberto pelas
 * series, e nao o primeiro dia do ano coberto.
 *
 * A razao e de uso, nao tecnica: quem ja tinha papel antes lanca o saldo como aplicacao inicial
 * nesse dia, e a posicao entra no ano novo ja rentabilizando desde o primeiro dia util. Era
 * assim quando o piso era 2024 - o CDI comecava em 29/12/2023, nao em 02/01/2024.
 *
 * Quando as series recuaram para aceitar titulos de 2023 (07/09/2026), a data desceu junto para
 * 30/12/2022. Sem este teste, um recuo futuro das series poderia parar em 02/01 e tirar do
 * usuario a vespera que ele precisa - sem quebrar nada, so impedindo o lancamento.
 */
describe("DATA_MINIMA_CARTEIRA", () => {
  const TETO = "2026-09-03"; // uma data de calculo qualquer, so para fechar a janela

  it("e o ultimo dia util de 2022", () => {
    expect(DATA_MINIMA_CARTEIRA).toBe("2022-12-30");
    // 30/12/2022 caiu numa sexta; 31/12 foi sabado.
    expect(new Date(DATA_MINIMA_CARTEIRA + "T12:00:00").getDay()).toBe(5);
  });

  it("aceita a operacao no proprio dia minimo", () => {
    expect(foraDaJanela(DATA_MINIMA_CARTEIRA, TETO)).toBeNull();
  });

  it("aceita o primeiro dia util de 2023, que e o ano que passou a ser coberto", () => {
    expect(foraDaJanela("2023-01-02", TETO)).toBeNull();
  });

  it("recusa o dia anterior, e diz por que", () => {
    const erro = foraDaJanela("2022-12-29", TETO);
    expect(erro).toContain("30/12/2022");
  });

  it("continua recusando o que passa do teto de calculo", () => {
    expect(foraDaJanela("2026-09-04", TETO)).toContain("03/09/2026");
  });
});
