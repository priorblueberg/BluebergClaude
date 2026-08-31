import { supabase } from "@/integrations/supabase/client";

/**
 * Ancora unica de data para TODAS as laminas.
 *
 * `controle_de_carteiras.data_calculo` e carimbo de quando aquela carteira foi recalculada
 * pela ultima vez, nao ate onde existe dado de mercado. Como cada carteira e recalculada
 * num dia diferente, elas ficavam em datas diferentes: em 31/08/2026 a renda fixa estava
 * em 31/08 e fundos/moedas em 24/08. O consolidado pediu 31/08, fundos e moedas nao tinham
 * linha para aquele dia e voltaram zerados - R$ 4,13 mi no lugar de R$ 6,24 mi - enquanto
 * o ganho acumulado deles continuava no total.
 *
 * A funcao `invest.horizonte_de_mercado` devolve o ultimo dia em que TODAS as series que a
 * carteira do usuario consome ja tem dado (CDI, cotas dos fundos abertos, cotacao das
 * moedas abertas). Posicao ja resgatada nao conta.
 */
export async function carregarHorizonteDeMercado(userId: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("horizonte_de_mercado", { p_user: userId });
  if (error) {
    console.error("horizonte_de_mercado:", error.message ?? error);
    return null;
  }
  return typeof data === "string" ? data : null;
}

export interface JanelaDaCarteira {
  data_calculo: string | null;
  data_limite?: string | null;
  resgate_total?: string | null;
}

/**
 * Substitui o carimbo de recalculo pelo horizonte de mercado, sem passar do fim da propria
 * carteira: uma carteira toda resgatada para no resgate, nao no horizonte.
 *
 * Nao e um `min` com o `data_calculo` armazenado de proposito. Se fosse, a carteira que
 * ficou para tras (fundos em 24/08) continuaria para tras e o consolidado quebraria igual.
 */
export function ancorarNoMercado<T extends JanelaDaCarteira>(
  cart: T | null | undefined,
  horizonte: string | null,
): T | null {
  if (!cart) return null;
  // Carteira sem data_calculo e carteira nao iniciada: quem chama trata esse caso.
  if (!horizonte || !cart.data_calculo) return cart;
  const fim = [horizonte, cart.resgate_total, cart.data_limite]
    .filter((d): d is string => !!d)
    .sort()[0];
  return { ...cart, data_calculo: fim };
}
