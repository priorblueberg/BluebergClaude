import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Captura diaria da projecao ANBIMA para o IPCA.
 *
 * A pagina de "Projecoes IPCA e IGP-M" da ANBIMA e montada por JavaScript e o HTML
 * servido nao traz a tabela, entao nao da para raspar. A pagina de indicadores
 * (`/informacoes/indicadores/`) e HTML estatico simples, sai em latin-1, e publica os
 * mesmos numeros: a projecao vigente do mes corrente e o numero-indice do ultimo mes
 * fechado. E atualizada diariamente.
 *
 * O motor de IPCA escolhe a projecao pela DATA DE COLETA (a de validade que a ANBIMA
 * publica na outra pagina e um dia util depois). A data de atualizacao da pagina de
 * indicadores e a data de coleta - por isso ela vira `data_coleta` aqui.
 *
 * Ver as secoes 21, 22 e 32 de `_knowledge/ipca-metodologia-gorila.md` no vault.
 */

const URL_ANBIMA = "https://www.anbima.com.br/informacoes/indicadores/";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function competencia(mes: string, ano2: string): string {
  const m = MESES.indexOf(mes.toLowerCase()) + 1;
  return `20${ano2}-${String(m).padStart(2, "0")}`;
}

/** "7.657,73" -> 7657.73 */
function numeroBR(x: string): number {
  return Number(x.replace(/\./g, "").replace(",", "."));
}

/** Tira as tags e colapsa espacos, deixando os campos separados por "|". */
function achatar(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .replace(/\s+/g, " ")
    .replace(/(\| )+/g, "|")
    .replace(/\|+/g, "|");
}

interface Extraido {
  atualizacao: string | null;
  projecao: { competencia: string; variacao: number } | null;
  oficial: { competencia: string; numero_indice: number; variacao: number } | null;
}

export function extrair(html: string): Extraido {
  const t = achatar(html);
  // Os acentos chegam quebrados quando a pagina e lida como UTF-8, entao os regex usam
  // curingas no lugar das letras acentuadas.
  const mData = t.match(/ltima Atualiza[^:]*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const mProj = t.match(/IPCA\|\d+\|Proje.{1,4}o \((\w{3})\/(\d{2})\)\|(-?[\d.,]+)/);
  const mOfic = t.match(
    /IPCA \((\w{3})\/(\d{2})\)\|\d+\|N.{1,4}mero .{1,4}ndice\|([\d.,]+)\|Var % no m.{1,3}s\|(-?[\d.,]+)/
  );
  return {
    atualizacao: mData ? `${mData[3]}-${mData[2]}-${mData[1]}` : null,
    projecao: mProj
      ? { competencia: competencia(mProj[1], mProj[2]), variacao: numeroBR(mProj[3]) }
      : null,
    oficial: mOfic
      ? {
          competencia: competencia(mOfic[1], mOfic[2]),
          numero_indice: numeroBR(mOfic[3]),
          variacao: numeroBR(mOfic[4]),
        }
      : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const results: Record<string, unknown> = {};
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } }
    );

    const resp = await fetch(URL_ANBIMA, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; blueberg-sync/1.0)" },
    });
    if (!resp.ok) throw new Error(`ANBIMA respondeu ${resp.status}`);
    // A pagina sai em latin-1; ler como UTF-8 quebraria os numeros junto com os acentos.
    const html = new TextDecoder("iso-8859-1").decode(await resp.arrayBuffer());

    const { atualizacao, projecao, oficial } = extrair(html);
    results.atualizacao = atualizacao;

    if (!atualizacao) throw new Error("nao achei a data de atualizacao na pagina");

    // ── Projecao do mes corrente ───────────────────────────────────────
    if (projecao) {
      const { data: jaTem } = await supabase
        .from("historico_ipca_projecao")
        .select("competencia, variacao_projetada, data_coleta")
        .eq("competencia", projecao.competencia)
        .order("data_coleta", { ascending: false, nullsFirst: false })
        .limit(1);

      const ultima = jaTem?.[0];
      const mesmoValor = ultima && Number(ultima.variacao_projetada) === projecao.variacao;
      const mesmaData = ultima && ultima.data_coleta === atualizacao;

      if (mesmoValor && ultima) {
        // A ANBIMA so revisa duas vezes por mes; nos outros dias o numero se repete.
        results.projecao = `${projecao.competencia} inalterada em ${projecao.variacao}%`;
      } else if (mesmaData) {
        results.projecao = `${projecao.competencia} ja registrada em ${atualizacao}`;
      } else {
        const { error } = await supabase.from("historico_ipca_projecao").upsert(
          {
            competencia: projecao.competencia,
            variacao_projetada: projecao.variacao,
            fator_projetado: 1 + projecao.variacao / 100,
            fonte: "ANBIMA - pagina de indicadores (captura diaria)",
            data_referencia: atualizacao,
            data_coleta: atualizacao,
          },
          { onConflict: "competencia,data_referencia" }
        );
        if (error) throw error;
        results.projecao = `${projecao.competencia} = ${projecao.variacao}% (coleta ${atualizacao})`;
      }
    } else {
      results.projecao = "nao achei a projecao do IPCA na pagina";
    }

    // ── Numero-indice do ultimo mes fechado ────────────────────────────
    if (oficial) {
      const { data: jaTem } = await supabase
        .from("historico_ipca")
        .select("competencia, numero_indice")
        .eq("competencia", oficial.competencia)
        .limit(1);

      if (jaTem && jaTem.length > 0) {
        results.oficial = `${oficial.competencia} ja estava no banco`;
      } else {
        const { error } = await supabase.from("historico_ipca").upsert(
          {
            competencia: oficial.competencia,
            numero_indice: oficial.numero_indice,
            variacao_mensal: oficial.variacao,
            // A data de publicacao real vem do calendario do IBGE; aqui fica a data em
            // que o numero apareceu na ANBIMA, que e o dia da divulgacao ou o seguinte.
            data_publicacao: atualizacao,
          },
          { onConflict: "competencia" }
        );
        if (error) throw error;
        results.oficial = `${oficial.competencia} inserida: indice ${oficial.numero_indice}, var ${oficial.variacao}%`;
      }
    } else {
      results.oficial = "nao achei o numero-indice do IPCA na pagina";
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("anbima-ipca-sync:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        results,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
