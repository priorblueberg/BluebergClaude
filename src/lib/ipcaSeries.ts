import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "./fetchAllRows";
import { construirFatoresIpcaDiarios, type IpcaCompetencia, type IpcaProjecao } from "./ipcaEngine";

/**
 * Carga das series de IPCA e montagem dos fatores diarios por titulo.
 *
 * O fator depende do DIA DO VENCIMENTO do papel (e a data de aniversario), entao
 * guardamos um mapa por dia do mes: dois titulos que vencem no mesmo dia compartilham
 * o mesmo fator, e uma carteira inteira costuma usar poucos dias distintos.
 */
let _cache: { competencias: IpcaCompetencia[]; projecao: IpcaProjecao[] } | null = null;
const _porDia = new Map<number, Map<string, number>>();

export function limparCacheIpca() {
  _cache = null;
  _porDia.clear();
}

export async function carregarSeriesIpca() {
  if (_cache) return _cache;
  const [comp, proj] = await Promise.all([
    fetchAllRows((de, ate) => supabase
      .from("historico_ipca")
      .select("competencia, numero_indice, variacao_mensal")
      .order("competencia")
      .range(de, ate)),
    fetchAllRows((de, ate) => supabase
      .from("historico_ipca_projecao")
      .select("competencia, variacao_projetada, data_referencia")
      .order("data_referencia")
      .range(de, ate)),
  ]);

  // Da projecao vale a leitura mais recente de cada competencia.
  const maisRecente = new Map<string, IpcaProjecao>();
  for (const p of (proj as any[])) {
    maisRecente.set(p.competencia, {
      competencia: p.competencia,
      variacao_projetada: Number(p.variacao_projetada),
    });
  }

  _cache = {
    competencias: (comp as any[]).map((c) => ({
      competencia: c.competencia,
      numero_indice: c.numero_indice == null ? null : Number(c.numero_indice),
      variacao_mensal: c.variacao_mensal == null ? null : Number(c.variacao_mensal),
    })),
    projecao: [...maisRecente.values()],
  };
  return _cache;
}

/**
 * Fatores diarios de IPCA para um titulo. Devolve undefined quando o papel nao e
 * indexado ao IPCA, para o motor seguir pelo caminho de sempre.
 */
export async function fatoresIpcaSeNecessario(
  indexador: string | null | undefined,
  vencimento: string | null | undefined,
  calendario: { data: string; dia_util: boolean }[]
): Promise<Map<string, number> | undefined> {
  if (!indexador || !indexador.includes("IPCA") || !vencimento) return undefined;

  const dia = Number(vencimento.slice(8, 10));
  if (!dia) return undefined;

  const emCache = _porDia.get(dia);
  if (emCache) return emCache;

  const { competencias, projecao } = await carregarSeriesIpca();
  const fatores = construirFatoresIpcaDiarios({
    diaAniversario: dia,
    calendario,
    competencias,
    projecao,
  });
  _porDia.set(dia, fatores);
  return fatores;
}

export type SeriesIpca = Awaited<ReturnType<typeof carregarSeriesIpca>>;

/**
 * Versao sincrona, para as telas que rodam o motor dentro de um laco: carregue as
 * series uma vez com `carregarSeriesIpca()` e passe aqui. Devolve undefined quando
 * o papel nao e indexado ao IPCA.
 */
export function fatoresIpcaDoTitulo(
  series: SeriesIpca | null,
  indexador: string | null | undefined,
  vencimento: string | null | undefined,
  calendario: { data: string; dia_util: boolean }[]
): Map<string, number> | undefined {
  if (!series || !indexador || !indexador.includes("IPCA") || !vencimento) return undefined;

  const dia = Number(vencimento.slice(8, 10));
  if (!dia) return undefined;

  const emCache = _porDia.get(dia);
  if (emCache) return emCache;

  const fatores = construirFatoresIpcaDiarios({
    diaAniversario: dia,
    calendario,
    competencias: series.competencias,
    projecao: series.projecao,
  });
  _porDia.set(dia, fatores);
  return fatores;
}

/** true quando vale a pena pagar a leitura das series de IPCA. */
export function algumIndexadoAoIpca(produtos: { indexador?: string | null }[]): boolean {
  return produtos.some((p) => (p.indexador || "").includes("IPCA"));
}
