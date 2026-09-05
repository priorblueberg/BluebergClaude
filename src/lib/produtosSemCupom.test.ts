import { describe, it, expect } from "vitest";
import { opcoesPagamentoDoProduto, PAGAMENTO_OPTIONS, PRODUTOS_SEM_CUPOM } from "./rendaFixaEngine";

/**
 * Medido no Gorila em 05/09/2026 com 11 gemeos de um mesmo CDB: a boleta de LC, RDB, RDC e
 * DPGE nao tem o campo de periodicidade, e esses papeis ficam sem cupom nenhum. Deixar a
 * boleta oferecer "Trimestral" faria o nosso motor pagar juros que o Gorila nao paga.
 */
describe("periodicidade por produto", () => {
  it("os quatro produtos sem cupom so aceitam No Vencimento", () => {
    for (const p of PRODUTOS_SEM_CUPOM) {
      expect(opcoesPagamentoDoProduto(p)).toEqual(["No Vencimento"]);
    }
  });

  it("os produtos que pagam cupom mantem a lista completa", () => {
    for (const p of ["CDB", "LCI", "LCA", "LCD", "LF", "LFS", "LFSN", "LIG"]) {
      expect(opcoesPagamentoDoProduto(p)).toEqual(PAGAMENTO_OPTIONS);
    }
  });

  it("nao se importa com caixa nem espaco em volta", () => {
    expect(opcoesPagamentoDoProduto(" rdb ")).toEqual(["No Vencimento"]);
    expect(opcoesPagamentoDoProduto("dpge")).toEqual(["No Vencimento"]);
  });

  it("produto desconhecido ou vazio nao perde opcoes", () => {
    expect(opcoesPagamentoDoProduto(null)).toEqual(PAGAMENTO_OPTIONS);
    expect(opcoesPagamentoDoProduto("Debêntures")).toEqual(PAGAMENTO_OPTIONS);
  });
});
