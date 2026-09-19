/**
 * A data de uma operacao de renda variavel: o que o calendario deixa escolher e a mensagem que
 * aparece embaixo do campo.
 *
 * Mesma convencao que os fundos ganharam em 11/09/2026 e que a boleta de acoes nao recebeu na
 * epoca (ela e de 07/09 e a refatoracao veio depois): nada de alerta vermelho nem de aviso so ao
 * cadastrar. A data errada se explica embaixo do proprio campo, e o calendario ja nao deixa
 * escolher o que seria recusado.
 *
 * Funcao pura de proposito: a boleta busca os dados (dia util, fechamento e saldo na data) e passa
 * para ca, e a regra fica testavel sem banco.
 */
import { ehFimDeSemana } from "@/lib/validacaoDataFundo";

export const MSG_DATA_INVALIDA = "Data inválida";
export const MSG_ANTES_DO_CALCULO = "Data anterior a 02/01/2023, início do cálculo da ferramenta";
export const MSG_SEM_FECHAMENTO = "Fechamento ainda não divulgado nessa data";
export const MSG_SEM_CUSTODIA = "Não há custódia registrada na data selecionada";

const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");

/** "Papel deslistado: a última negociação foi em dd/mm/aaaa." */
export const msgAposDeslistagem = (ultimoPregao: string) =>
  `Papel deslistado: a última negociação foi em ${fmt(ultimoPregao)}`;

/**
 * Janela do calendario. Comeca no piso da ferramenta (02/01/2023) e termina no teto de calculo,
 * ja rebaixado pela boleta quando o papel foi deslistado antes disso.
 */
export function janelaDoCalendarioDaAcao(
  piso: string,
  teto: string | null | undefined,
): { min: string; max: string | null } {
  return { min: piso, max: teto ?? null };
}

/**
 * Mensagem embaixo da data, ou null. A ordem importa: a primeira regra que falha é a que aparece.
 *
 * `undefined` quer dizer "ainda carregando" e não gera mensagem; `null` quer dizer "carregado e
 * não existe" (não é dia útil, não há fechamento na data, não há custódia).
 */
export function mensagemDaDataDaAcao(e: {
  data: string;
  piso: string;
  /** Última data com dado fechado para lançar operação. */
  teto: string | null | undefined;
  /** Último pregão do papel, quando ele foi deslistado. */
  ultimoPregaoDoPapel: string | null | undefined;
  diaUtil: boolean | null | undefined;
  ehVenda: boolean;
  /** Saldo em ações na data; null quando não há posição. */
  saldoNaData: number | null | undefined;
}): string | null {
  if (!e.data) return null;

  // Fim de semana e feriado: nao ha pregao nesses dias. O fim de semana a regra pega sozinha; o
  // feriado so o calendario do banco sabe, e chega aqui como `diaUtil: false`.
  if (ehFimDeSemana(e.data) || e.diaUtil === false) return MSG_DATA_INVALIDA;

  if (e.data < e.piso) return MSG_ANTES_DO_CALCULO;

  // O papel deslistado tem teto proprio, e ele explica melhor que "fechamento nao divulgado".
  if (e.ultimoPregaoDoPapel && e.data > e.ultimoPregaoDoPapel) return msgAposDeslistagem(e.ultimoPregaoDoPapel);

  if (e.teto && e.data > e.teto) return MSG_SEM_FECHAMENTO;

  // Venda sem posicao na data: o motor aceitaria a posicao negativa e ela seguiria "rendendo".
  if (e.ehVenda && e.saldoNaData !== undefined && (e.saldoNaData === null || e.saldoNaData <= 1e-8))
    return MSG_SEM_CUSTODIA;

  return null;
}
