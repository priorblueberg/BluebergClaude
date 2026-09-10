/**
 * Próximo código de custódia livre da conta.
 *
 * O código é sequencial POR CONTA, não por portfólio: é a chave que liga `movimentacoes` a
 * `custodia` (único por user_id + codigo_custodia). Desde os portfólios (10/09/2026) a RLS só
 * mostra o portfólio em uso, então contar os códigos pelo cliente enxergaria parte deles e o ativo
 * novo podia nascer com o código de uma posição de outro portfólio. A conta sai do banco
 * (`invest.proximo_codigo_custodia`), que enxerga a conta inteira.
 *
 * Antes disso a leitura já precisava ser paginada, porque o PostgREST corta em 1000 linhas sem
 * avisar e o maior código ficava de fora. No banco esse corte não existe. A faixa nova começa em
 * 100; abaixo disso ficaram códigos legados.
 */
import { supabase } from "@/integrations/supabase/client";

export async function proximoCodigoCustodia(): Promise<string> {
  const { data, error } = await supabase.rpc("proximo_codigo_custodia");
  if (error || !data) throw new Error(error?.message ?? "Não foi possível gerar o código de custódia.");
  return data;
}
