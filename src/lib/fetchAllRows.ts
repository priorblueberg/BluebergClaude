/**
 * Consulta paginada.
 *
 * O PostgREST devolve no maximo 1000 linhas por requisicao e NAO avisa que
 * truncou: a resposta chega com 200 e menos dados do que existe. Series longas
 * (calendario de dias uteis, cotas de fundos, CDI diario) passam desse teto, e
 * o motor calculava em cima de uma serie cortada - saldo velho, ganho zerado e
 * fundo com posicao recente aparecendo com patrimonio zero.
 *
 * Uso:
 *   const cotas = await fetchAllRows((de, ate) =>
 *     supabase.from("cotas_fundos").select("*").order("data").range(de, ate));
 */
const PAGINA = 1000;

export async function fetchAllRows<T = any>(
  construir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await construir(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = data || [];
    tudo.push(...lote);
    if (lote.length < PAGINA) return tudo;
  }
}
