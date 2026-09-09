import { describe, it, expect } from "vitest";
import { DATA_MINIMA_CARTEIRA, foraDaJanela } from "./validacaoBoleta";

/**
 * A data minima da carteira e o PRIMEIRO DIA UTIL DE 2023: 02/01/2023, uma segunda-feira.
 *
 * A ferramenta calcula de 2023 em diante, e nada pode ser lancado antes disso - em nenhum
 * produto. Decisao do Daniel em 08/09/2026.
 *
 * A regra anterior, que durou menos de um dia, era o ultimo dia util BANCARIO de 2022 (30/12),
 * para que quem ja tinha papel lancasse o saldo de abertura na vespera e entrasse o ano novo ja
 * rentabilizando. Ela foi abandonada porque fazia a ferramenta calcular num ano que ela nao
 * cobre so para acomodar o saldo inicial. Saldo anterior a 2023 tera um caminho proprio, ainda
 * a definir - e ate la a recusa aqui e intencional, nao uma limitacao a contornar.
 *
 * Este teste trava as DUAS pontas. Que o piso nao RECUE para 2022 de novo por acidente, e que
 * nao AVANCE para depois do primeiro dia util: avancar tiraria do usuario justamente o dia em
 * que ele abre a carteira no comeco da serie, sem quebrar nada e sem aviso.
 */
describe("DATA_MINIMA_CARTEIRA", () => {
  const TETO = "2026-09-03"; // uma data de calculo qualquer, so para fechar a janela

  it("e o primeiro dia util de 2023", () => {
    expect(DATA_MINIMA_CARTEIRA).toBe("2023-01-02");
    // 01/01/2023 caiu num domingo, entao a segunda 02/01 e o primeiro dia util do ano.
    expect(new Date(DATA_MINIMA_CARTEIRA + "T12:00:00").getDay()).toBe(1);
  });

  it("aceita a operacao no proprio dia minimo", () => {
    expect(foraDaJanela(DATA_MINIMA_CARTEIRA, TETO)).toBeNull();
  });

  it("NAO aceita 30/12/2022, o piso antigo: 2022 saiu da janela da ferramenta", () => {
    expect(foraDaJanela("2022-12-30", TETO)).not.toBeNull();
  });

  it("NAO aceita 29/12/2022, ultimo pregao de 2022", () => {
    expect(foraDaJanela("2022-12-29", TETO)).not.toBeNull();
  });

  it("recusa a virada do ano, e diz por que", () => {
    const erro = foraDaJanela("2022-12-31", TETO);
    expect(erro).toContain("02/01/2023");
  });

  it("continua recusando o que passa do teto de calculo", () => {
    expect(foraDaJanela("2026-09-04", TETO)).toContain("03/09/2026");
  });

  /**
   * A recusa acima nao e sobre a data ser "invalida": e sobre a fonte ainda nao ter publicado
   * aquele dia. Consultar rentabilidade em D0 com dado provisorio e permitido; LANCAR contra
   * ele nao, porque a consulta se corrige sozinha quando o oficial chega e a operacao gravada
   * nao. A mensagem precisa dizer isso, senao o usuario le como bug.
   */
  it("explica que o teto e falta de dado divulgado, nao data invalida", () => {
    const erro = foraDaJanela("2026-09-04", TETO)!;
    expect(erro).toContain("Ainda não há dado divulgado");
    expect(erro).toContain("04/09/2026"); // a data que ele tentou
  });
});
