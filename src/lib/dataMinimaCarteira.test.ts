import { describe, it, expect } from "vitest";
import { DATA_MINIMA_CARTEIRA, foraDaJanela } from "./validacaoBoleta";

/**
 * A data minima da carteira e o ULTIMO PREGAO DO ANO ANTERIOR ao primeiro ano coberto pelas
 * series, e nao o primeiro dia do ano coberto.
 *
 * A razao e de uso, nao tecnica: quem ja tinha papel antes lanca o saldo como aplicacao inicial
 * nesse dia, e a posicao entra no ano novo ja rentabilizando desde o primeiro dia util. Era
 * assim quando o piso era 2024 - o CDI comecava em 29/12/2023, nao em 02/01/2024.
 *
 * Quando as series recuaram para aceitar titulos de 2023 (07/09/2026), a data desceu junto para
 * 29/12/2022. Sem este teste, um recuo futuro das series poderia parar em 02/01 e tirar do
 * usuario a vespera que ele precisa - sem quebrar nada, so impedindo o lancamento.
 *
 * E o dia do MERCADO, nao o do banco. A B3 encerra o ano um dia util antes do calendario
 * bancario: em 2022 o ultimo pregao foi 29/12 e o BCB ainda publicou CDI em 30/12; em 2023,
 * ultimo pregao em 28/12 e CDI ate 29/12. O extrato da corretora fecha no pregao, e a data do
 * mercado e a MENOR das duas - entao escolher ela permite as duas.
 */
describe("DATA_MINIMA_CARTEIRA", () => {
  const TETO = "2026-09-03"; // uma data de calculo qualquer, so para fechar a janela

  it("e o ultimo pregao de 2022", () => {
    expect(DATA_MINIMA_CARTEIRA).toBe("2022-12-29");
    // 29/12/2022 caiu numa quinta; a B3 nao operou na sexta, 30/12.
    expect(new Date(DATA_MINIMA_CARTEIRA + "T12:00:00").getDay()).toBe(4);
  });

  it("aceita a operacao no proprio dia minimo", () => {
    expect(foraDaJanela(DATA_MINIMA_CARTEIRA, TETO)).toBeNull();
  });

  it("aceita tambem 30/12/2022, dia util bancario com CDI publicado", () => {
    expect(foraDaJanela("2022-12-30", TETO)).toBeNull();
  });

  it("aceita o primeiro dia util de 2023, que e o ano que passou a ser coberto", () => {
    expect(foraDaJanela("2023-01-02", TETO)).toBeNull();
  });

  it("recusa o dia anterior, e diz por que", () => {
    const erro = foraDaJanela("2022-12-28", TETO);
    expect(erro).toContain("29/12/2022");
  });

  it("continua recusando o que passa do teto de calculo", () => {
    expect(foraDaJanela("2026-09-04", TETO)).toContain("03/09/2026");
  });
});
