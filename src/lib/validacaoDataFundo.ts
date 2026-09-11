/**
 * A data de uma operacao de fundo (aplicacao, resgate e come-cotas): o que o calendario deixa
 * escolher e a mensagem que aparece embaixo do campo.
 *
 * Pedido do Daniel em 11/09/2026: nada de alerta vermelho nem de aviso ao cadastrar. A data errada
 * se explica embaixo do proprio campo, e o calendario ja nao deixa escolher o que seria recusado.
 *
 * Funcao pura de proposito: a boleta busca os dados (limites da serie, dia util, cota e saldo na
 * data) e passa para ca, e a regra fica testavel sem banco.
 */

export const MSG_DATA_INVALIDA = "Data inválida";
export const MSG_ANTES_DO_FUNDO = "Data anterior a constituição do fundo";
export const MSG_ANTES_DO_CALCULO = "Data anterior a 02/01/2023, início do cálculo da ferramenta";
export const MSG_COTA_NAO_DIVULGADA = "Valor da cota ainda não divulgado";
export const MSG_SEM_CUSTODIA = "Não há custódia registrada na data selecionada";

/** Primeira e última cota da série do fundo na base, e o início dele no cadastro da CVM. */
export interface LimitesDoFundo {
  primeiraCota: string | null;
  ultimaCota: string | null;
  inicioDoFundo: string | null;
}

export function ehFimDeSemana(dataISO: string): boolean {
  const dia = new Date(dataISO + "T12:00:00").getDay();
  return dia === 0 || dia === 6;
}

/**
 * Janela do calendario: começa no piso da ferramenta (02/01/2023) ou na primeira cota, se o fundo
 * nasceu depois; termina na ultima cota divulgada. `max` null enquanto a serie nao foi lida.
 */
export function janelaDoCalendarioDoFundo(
  limites: LimitesDoFundo | null,
  piso: string,
): { min: string; max: string | null } {
  const primeira = limites?.primeiraCota ?? null;
  return {
    min: primeira && primeira > piso ? primeira : piso,
    max: limites?.ultimaCota ?? null,
  };
}

/**
 * Mensagem embaixo da data, ou null. A ordem importa: a primeira regra que falha é a que aparece.
 *
 * `undefined` quer dizer "ainda carregando" e não gera mensagem; `null` quer dizer "carregado e não
 * existe" (não há cota na data, não há saldo na data, não é dia útil).
 */
export function mensagemDaDataDoFundo(e: {
  data: string;
  piso: string;
  limites: LimitesDoFundo | null | undefined;
  diaUtil: boolean | null | undefined;
  cotaNaData: number | null | undefined;
  ehSaida: boolean;
  saldoNaData: number | null | undefined;
}): string | null {
  if (!e.data) return null;

  // Fim de semana e feriado: não há cota nem movimentação nesses dias.
  if (ehFimDeSemana(e.data) || e.diaUtil === false) return MSG_DATA_INVALIDA;

  const primeira = e.limites?.primeiraCota ?? null;
  if (e.data < e.piso) return primeira && primeira > e.piso ? MSG_ANTES_DO_FUNDO : MSG_ANTES_DO_CALCULO;
  if (primeira && e.data < primeira) return MSG_ANTES_DO_FUNDO;

  if (e.limites && (!e.limites.ultimaCota || e.data > e.limites.ultimaCota)) return MSG_COTA_NAO_DIVULGADA;
  // Dia útil dentro da série sem cota publicada (buraco da CVM, como o BTG Hedge em julho/2026).
  if (e.cotaNaData === null) return MSG_COTA_NAO_DIVULGADA;

  if (e.ehSaida && e.saldoNaData === null) return MSG_SEM_CUSTODIA;
  return null;
}
