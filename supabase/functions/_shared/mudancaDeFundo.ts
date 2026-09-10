/**
 * Mudanca na composicao do fundo: DETECTAR, nunca inferir.
 *
 * Na adaptacao a Resolucao CVM 175 fundos trocaram de CNPJ ou viraram subclasse de outro fundo
 * no meio da serie. O Kinea Advisory (39.586.835/0001-00) virou a Subclasse II da classe
 * 39.586.858/0001-15 em 11/04/2025, e nenhum arquivo da CVM registra a ligacao - ela so existe
 * nos numeros (cota, patrimonio e cotistas do dia seguinte).
 *
 * Medido em mar-mai/2025: de 713 series que pararam, so 14 tinham um sucessor inequivoco. O
 * resto era divisao em subclasses (so o cotista sabe em qual caiu), absorcao com fator de
 * conversao (so o extrato traz a quantidade nova) ou liquidacao. Por isso a decisao de
 * 10/09/2026: a ferramenta detecta que a serie mudou e PERGUNTA ao cliente. Nada aqui tenta
 * adivinhar para onde o fundo foi.
 *
 * Arquivo puro, sem Deno nem Supabase, para rodar no vitest.
 */

export type SinalDeMudanca = "cota_zero" | "virou_subclasses" | "serie_parou";

export interface Mudanca {
  sinal: SinalDeMudanca;
  ultimaCotaEm: string;
  evidencias: Record<string, unknown>;
}

/**
 * Dias uteis sem cota, contados ate a data de referencia, que fazem uma serie contar como parada.
 *
 * Feriado nao conta porque so dia util entra na conta, e o atraso normal da CVM ja foi descontado
 * na referencia. Cinco dias uteis e uma semana inteira sem publicacao num fundo aberto, que tem
 * obrigacao de informe diario.
 */
export const DIAS_UTEIS_SEM_COTA = 5;

/**
 * Linhas com cota zero depois da ultima cota valida para contar como mudanca.
 *
 * Uma so nao basta: a CVM ja publicou cota zero isolada por erro (Trend, 18/07/2024), e no dia
 * seguinte a serie seguiu normal. O fundo cancelado, ao contrario, repete o zero por semanas.
 */
export const MIN_LINHAS_COTA_ZERO = 2;

/** Quantos dias uteis a CVM costuma levar para publicar a cota do dia. */
export const DIAS_UTEIS_DE_ATRASO_DA_CVM = 2;

/**
 * Ultima data em que a CVM ja deveria ter publicado a cota de um fundo em dia.
 *
 * E o penultimo dia util antes de hoje: a cota de ontem pode nao ter saido ainda e isso nao e
 * sinal de nada.
 */
export function dataDeReferencia(diasUteis: string[], hojeISO: string): string | null {
  const antes = diasUteis.filter((d) => d < hojeISO).sort();
  return antes.length >= DIAS_UTEIS_DE_ATRASO_DA_CVM ? antes[antes.length - DIAS_UTEIS_DE_ATRASO_DA_CVM] : null;
}

export function detectarMudanca(e: {
  /** Ultima cota POSITIVA do fundo que ja temos. */
  ultimaCotaEm: string | null;
  /** Ver `dataDeReferencia`. */
  referencia: string | null;
  /** Dias uteis ordenados, cobrindo pelo menos de `ultimaCotaEm` ate `referencia`. */
  diasUteis: string[];
  /** Datas em que o proprio fundo apareceu no informe com cota zero. */
  datasComCotaZero?: string[];
  /** Subclasses que o CNPJ passou a publicar, para fundo acompanhado SEM subclasse. */
  subclassesNovas?: string[];
}): Mudanca | null {
  const ultima = e.ultimaCotaEm;
  const referencia = e.referencia;
  if (!ultima || !referencia) return null;

  const zeros = [...new Set((e.datasComCotaZero ?? []).filter((d) => d > ultima))].sort();
  if (zeros.length >= MIN_LINHAS_COTA_ZERO) {
    return {
      sinal: "cota_zero",
      ultimaCotaEm: ultima,
      evidencias: { primeira_cota_zero: zeros[0], linhas_com_cota_zero: zeros.length },
    };
  }

  const subclasses = [...new Set((e.subclassesNovas ?? []).filter(Boolean))].sort();
  if (subclasses.length) {
    return { sinal: "virou_subclasses", ultimaCotaEm: ultima, evidencias: { subclasses } };
  }

  const semCota = e.diasUteis.filter((d) => d > ultima && d <= referencia).length;
  if (semCota >= DIAS_UTEIS_SEM_COTA) {
    return {
      sinal: "serie_parou",
      ultimaCotaEm: ultima,
      evidencias: { dias_uteis_sem_cota: semCota, referencia },
    };
  }
  return null;
}

// ── Posicao do cliente num fundo ─────────────────────────────────────────────────────────────
//
// Copia de `src/lib/posicaoDeFundo.ts` (a edge function nao importa de `src/`). Qualquer ajuste
// numa precisa ir na outra; os dois lados tem teste com os mesmos casos.

/** Movimento que registra a resposta do cliente: a posicao passa a ser do fundo `fundo_id`. */
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

const efetiva = (m: MovimentoDeFundo) => m.data_cotizacao || m.data;

/**
 * Fundo e saldo de cotas de UMA posicao (um codigo de custodia) na data.
 *
 * "Mudanca de Fundo" SUBSTITUI o saldo em vez de somar: e a quantidade que o cliente tem no
 * fundo novo, que pode diferir da antiga quando houve fator de conversao.
 */
export function posicaoNaData(movs: MovimentoDeFundo[], ateISO: string): { fundoId: string | null; saldo: number } {
  const ordenados = [...movs].sort((a, b) =>
    efetiva(a).localeCompare(efetiva(b)) || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  let fundoId = ordenados.find((m) => m.fundo_id)?.fundo_id ?? null;
  let saldo = 0;
  for (const m of ordenados) {
    if (efetiva(m) > ateISO) break;
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
