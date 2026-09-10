/**
 * Posicao de um cliente num fundo quando o fundo MUDA no meio do caminho.
 *
 * Na adaptacao a Resolucao CVM 175 um fundo pode trocar de CNPJ ou virar subclasse de outro. A
 * ferramenta detecta a mudanca e o cliente informa o fundo novo pelo Sininho; a resposta vira um
 * movimento "Mudança de Fundo" DENTRO da mesma posicao (mesmo codigo de custodia). Assim a linha
 * da carteira, o custo e o ganho acumulado continuam, e nada aparece como dinheiro entrando ou
 * saindo.
 *
 * Tudo que le a posicao de fundo precisa entender esse movimento: o saldo (boleta), a custodia
 * (syncEngine) e a serie de cotas (motor). As regras moram aqui para as tres leituras nao
 * divergirem. O servidor tem uma copia em `supabase/functions/_shared/mudancaDeFundo.ts`.
 */

export const TIPO_MUDANCA_DE_FUNDO = "Mudança de Fundo";
const ENTRADAS = ["Aplicação", "Aplicação Inicial"];

export interface MovimentoDeFundo {
  fundo_id: string | null;
  data: string;
  data_cotizacao?: string | null;
  tipo_movimentacao: string;
  quantidade?: number | string | null;
  valor?: number | string | null;
  preco_unitario?: number | string | null;
  created_at?: string | null;
}

export const dataEfetiva = (m: { data: string; data_cotizacao?: string | null }) => m.data_cotizacao || m.data;

function ordenar<T extends MovimentoDeFundo>(movs: T[]): T[] {
  return [...movs].sort((a, b) =>
    dataEfetiva(a).localeCompare(dataEfetiva(b)) || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

/**
 * Fundo e saldo de cotas de UMA posicao (um codigo de custodia) na data.
 *
 * "Mudança de Fundo" SUBSTITUI o saldo em vez de somar: e a quantidade que o cliente tem no
 * fundo novo, que pode diferir da antiga quando houve fator de conversao.
 */
export function posicaoNaData(movs: MovimentoDeFundo[], ateISO: string): { fundoId: string | null; saldo: number } {
  const ordenados = ordenar(movs);
  let fundoId = ordenados.find((m) => m.fundo_id)?.fundo_id ?? null;
  let saldo = 0;
  for (const m of ordenados) {
    if (dataEfetiva(m) > ateISO) break;
    let qtd = m.quantidade != null ? Number(m.quantidade) : null;
    if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
    if (qtd == null || !Number.isFinite(qtd)) continue;
    if (m.tipo_movimentacao === TIPO_MUDANCA_DE_FUNDO) {
      if (m.fundo_id) fundoId = m.fundo_id;
      saldo = qtd;
    } else if (ENTRADAS.includes(m.tipo_movimentacao)) {
      saldo += qtd;
    } else {
      saldo -= qtd;
    }
  }
  if (Math.abs(saldo) < 1e-8) saldo = 0;
  return { fundoId, saldo };
}

/** De quando a quando cada fundo alimentou a posicao. O primeiro trecho comeca em "". */
export function trechosDaPosicao(movs: MovimentoDeFundo[]): { desde: string; fundoId: string }[] {
  const ordenados = ordenar(movs);
  const inicial = ordenados.find((m) => m.fundo_id)?.fundo_id;
  if (!inicial) return [];
  const trechos = [{ desde: "", fundoId: inicial }];
  for (const m of ordenados) {
    if (m.tipo_movimentacao !== TIPO_MUDANCA_DE_FUNDO || !m.fundo_id) continue;
    trechos.push({ desde: dataEfetiva(m), fundoId: m.fundo_id });
  }
  return trechos;
}

/**
 * A serie de cotas da posicao, costurada pelos trechos: antes da mudanca, a cota do fundo
 * antigo; a partir dela, a do novo.
 *
 * A costura NAO ajusta valor. Se houve fator de conversao a serie da um salto na data da
 * mudanca, e quem absorve o salto e o motor, que troca a quantidade de cotas no mesmo dia.
 */
export function cotasCosturadas(
  trechos: { desde: string; fundoId: string }[],
  cotasPorFundo: Map<string, { data: string; valor_cota: number }[]>,
): { data: string; valor_cota: number }[] {
  const out: { data: string; valor_cota: number }[] = [];
  trechos.forEach((t, i) => {
    const fim = trechos[i + 1]?.desde;
    for (const c of cotasPorFundo.get(t.fundoId) ?? []) {
      if (c.data >= t.desde && (!fim || c.data < fim)) out.push(c);
    }
  });
  return out.sort((a, b) => a.data.localeCompare(b.data));
}
