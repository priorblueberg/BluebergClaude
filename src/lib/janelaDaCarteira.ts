/**
 * A janela de análise de uma lâmina.
 *
 * Volta a ser o que sempre foi: começa no início da carteira (a primeira aplicação) e
 * termina na data de referência digitada no cabeçalho. O seletor de período com atalhos de
 * calendário foi retirado a pedido do Daniel em 2026-09-01; ficou só a ponta final.
 *
 * O fim NÃO é recortado pelo horizonte de mercado. Quando falta cotação do dia, os motores
 * repetem a do dia anterior (`ultimaCota` no fundo, `prevCdiDiario` na renda fixa), que é o
 * que o Gorila faz - por isso a data pode chegar em D0 e ainda ter número.
 */
export interface CarteiraComJanela {
  data_inicio: string | null;
  data_calculo: string | null;
}

export function ateAData<T extends CarteiraComJanela>(
  cart: T | null | undefined,
  dataReferenciaISO: string,
): T | null {
  if (!cart) return null;
  if (!cart.data_inicio) return cart;
  return { ...cart, data_calculo: dataReferenciaISO };
}
