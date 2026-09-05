/**
 * A posicao esta encerrada, ou apenas negativa?
 *
 * Saldo negativo NAO e encerramento: e inconsistencia. Acontece quando uma saida e maior do
 * que a posicao comportava - tipicamente sobra de uma aplicacao excluida, deixando o resgate
 * sem lastro.
 *
 * A regra anterior era `encerrado = cadastro || saldo < 0.005`, que jogava o negativo no
 * mesmo balaio do zero e exibia R$ 0,00 com o selo "Liquidado". Um papel com um resgate de
 * R$ 55 mil contra uma aplicacao de R$ 10 mil ficava indistinguivel de um papel normalmente
 * liquidado, e o rombo so aparecia no total da carteira.
 *
 * O comportamento aqui e o do Gorila, medido em 05/09/2026: uma venda orfa de R$ 11.000
 * apareceu na tela dele como -R$ 11.326,29, com a posicao ainda listada - nao como zero.
 */
export interface SituacaoDaPosicao {
  /** Saldo abaixo de zero: a posicao esta inconsistente, nao encerrada. */
  negativa: boolean;
  /** Posicao encerrada de verdade: zerada ou marcada como tal no cadastro. */
  encerrada: boolean;
  /** Valor a exibir: zero quando encerrada, o saldo real nos demais casos. */
  valorExibido: number;
}

/** Tolerancia de centavo, a mesma que o motor usa para considerar um saldo zerado. */
const EPS = 0.005;

export function situacaoDaPosicao(saldo: number, encerradaNoCadastro: boolean): SituacaoDaPosicao {
  const negativa = saldo < -EPS;
  const encerrada = !negativa && (encerradaNoCadastro || saldo < EPS);
  return { negativa, encerrada, valorExibido: encerrada ? 0 : saldo };
}
