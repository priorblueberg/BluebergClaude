/**
 * A série do Ibovespa, para as telas que precisam dela só como benchmark do gráfico.
 *
 * O `useCarteiraRF` já busca o Ibovespa junto do resto da carteira, e faz sentido lá: ele monta
 * uma tela inteira numa leitura só. As demais telas de carteira (fundos, ações, moedas) e a
 * análise individual não buscavam, e por isso o gráfico delas não tinha o benchmark. Este hook
 * existe para elas, e não para substituir aquele.
 *
 * O cache é de módulo, no mesmo espírito do resto do projeto: a série é a mesma para todas as
 * telas e não muda dentro da sessão, então trocar de carteira não deve refazer a leitura.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PontoIbovespa {
  data: string;
  pontos: number;
}

let cache: PontoIbovespa[] | null = null;
let emVoo: Promise<PontoIbovespa[]> | null = null;

async function buscar(): Promise<PontoIbovespa[]> {
  const linhas: PontoIbovespa[] = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("historico_ibovespa")
      .select("data, pontos")
      .order("data")
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = (data ?? []) as PontoIbovespa[];
    linhas.push(...lote);
    // O PostgREST corta a resposta, então parar no primeiro lote curto e não no primeiro vazio:
    // sem isto a série viria truncada e o benchmark ficaria mais curto que a carteira.
    if (lote.length < PAGINA) break;
  }
  return linhas;
}

export function useIbovespa(): PontoIbovespa[] {
  const [pontos, setPontos] = useState<PontoIbovespa[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    let vivo = true;
    emVoo = emVoo ?? buscar();
    emVoo
      .then((linhas) => {
        cache = linhas;
        if (vivo) setPontos(linhas);
      })
      .catch((e) => {
        // Benchmark ausente não derruba a tela: o gráfico fica sem a linha do Ibovespa.
        console.error("Ibovespa não carregou", e);
        emVoo = null;
      });
    return () => { vivo = false; };
  }, []);

  return pontos;
}
