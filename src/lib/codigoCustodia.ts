/**
 * Próximo código de custódia livre do usuário.
 *
 * A boleta calculava isso lendo os códigos existentes numa consulta sem
 * paginação. O PostgREST devolve no máximo 1000 linhas e não avisa que cortou,
 * então, passando desse volume, o maior código ficava de fora e o ativo novo
 * nascia com um código JÁ EM USO - duas posições diferentes colapsando numa
 * custódia só. Aqui a leitura é paginada e o máximo sai do conjunto inteiro.
 *
 * Ordenar no banco não resolveria: `codigo_custodia` é texto, e em texto "99"
 * vem depois de "1000".
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";

/** Primeiro código da faixa nova; abaixo disso ficaram códigos legados. */
const PISO = 99;

export async function proximoCodigoCustodia(userId: string): Promise<string> {
  const linhas = await fetchAllRows<{ codigo_custodia: string | null }>((de, ate) =>
    supabase
      .from("movimentacoes")
      .select("codigo_custodia")
      .eq("user_id", userId)
      .not("codigo_custodia", "is", null)
      .range(de, ate),
  );

  const maior = linhas.reduce((mx, r) => {
    const n = Number(r.codigo_custodia);
    return Number.isFinite(n) && n > mx ? n : mx;
  }, PISO);

  return String(maior + 1);
}
