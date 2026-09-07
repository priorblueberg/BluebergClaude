// Coleta os precos indicativos de debentures do mercado secundario publicados pela ANBIMA.
//
// Fonte: https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/db{DDMMAA}.txt
// Arquivo publico, sem login, ~1.290 papeis por dia, encoding latin-1, campos separados por "@".
//
// A FONTE OSCILA, E O 404 NAO SIGNIFICA "NAO EXISTE"
// --------------------------------------------------
// Medido em 06/09/2026: o arquivo de 04/09 respondeu 200 de forma consistente, depois 404 em
// 15 tentativas seguidas ao longo de minutos, e voltou a 200 logo depois - da maquina local e
// tambem do IP da edge function, ao mesmo tempo. O padrao acompanha a intensidade das
// requisicoes: rajada leva a bloqueio, pausa libera. Por isso esta funcao e deliberadamente
// LENTA - um dia por vez, com pausa entre eles e retentativa espacada. Ir rapido nao coleta
// mais, coleta menos.
//
// A JANELA DA FONTE E CURTA
// -------------------------
// A ANBIMA guarda cerca de 6 meses de arquivos. O que nao for coletado dentro da janela se
// perde. Duas consequencias no desenho:
//   1. Gravamos o arquivo INTEIRO, todos os ~1.290 papeis, e nao so os que estao em custodia:
//      um papel cadastrado no mes que vem vai precisar do preco de hoje, e hoje nao volta.
//   2. Varremos a janela toda a cada execucao, e nao a partir do ultimo dia gravado. Um dia que
//      falhou precisa ser reencontrado depois; partindo de max(data)+1 ele viraria um buraco
//      permanente assim que o dia seguinte gravasse.
//
// Body opcional: { "maxDias": 10, "desde": "2026-03-02", "recarregar": false }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs";

const MAX_DIAS_PADRAO = 10;
const JANELA_DIAS = 200;        // a fonte cobre ~6 meses; varremos um pouco mais
const PAUSA_ENTRE_DIAS = 2000;
const TENTATIVAS = 3;
const ESPERA_RETRY = 15000;     // 15s, depois 30s
const TETO_MS = 120000;         // para antes de estourar o tempo da function

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── parsing ──────────────────────────────────────────────────────────

/** "1.084,413875" -> 1084.413875 ; "--", "N/D" e vazio -> null */
function num(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || s === "--" || s.toUpperCase() === "N/D") return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "02/10/2030" -> "2030-10-02" */
function paraISO(v: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "2026-09-04" -> "040926" (o nome do arquivo e DDMMAA) */
function nomeArquivo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y.slice(2)}`;
}

type Linha = Record<string, unknown>;

/**
 * 3 linhas de preambulo (titulo, vazia, cabecalho) e 15 campos por registro.
 * O cabecalho e localizado pelo conteudo, nao pela posicao, para nao quebrar se a ANBIMA
 * mudar o preambulo.
 */
function parse(txt: string, dataRef: string): Linha[] {
  const linhas = txt.split("\n").map((l) => l.replace(/\r$/, ""));

  let inicio = linhas.findIndex((l) => l.startsWith("Código@Nome@"));
  if (inicio < 0) inicio = linhas.findIndex((l) => l.split("@").length >= 15) - 1;

  const out: Linha[] = [];
  for (const l of linhas.slice(inicio + 1)) {
    const p = l.split("@");
    if (p.length < 15 || !p[0].trim()) continue;

    out.push({
      codigo: p[0].trim(),
      data: dataRef,
      nome: p[1].trim() || null,
      vencimento: paraISO(p[2]),
      indexador: p[3].trim() || null,
      taxa_compra: num(p[4]),
      taxa_venda: num(p[5]),
      taxa_indicativa: num(p[6]),
      desvio_padrao: num(p[7]),
      pu: num(p[10]),
      percent_pu_par: num(p[11]),
      duration: num(p[12]),
      percent_reune: num(p[13]),
      referencia_ntnb: paraISO(p[14]),
      provisorio: false,
    });
  }
  return out;
}

/** Uma tentativa. null quando o servidor respondeu 404 ou devolveu pagina de erro. */
async function tentar(iso: string): Promise<Linha[] | null> {
  const resp = await fetch(`${BASE}/db${nomeArquivo(iso)}.txt`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`ANBIMA respondeu ${resp.status}`);

  const txt = new TextDecoder("windows-1252").decode(await resp.arrayBuffer());
  if (!txt.startsWith("ANBIMA")) return null;

  const linhas = parse(txt, iso);
  return linhas.length ? linhas : null;
}

/** Null so depois de esgotar as tentativas: ai sim e feriado ou data fora da janela. */
async function buscarDia(iso: string): Promise<Linha[] | null> {
  let ultimoErro: Error | null = null;
  for (let i = 0; i < TENTATIVAS; i++) {
    if (i > 0) await espera(ESPERA_RETRY * i);
    try {
      const linhas = await tentar(iso);
      if (linhas) return linhas;
    } catch (e) {
      ultimoErro = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (ultimoErro) throw ultimoErro;
  return null;
}

// ── handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const inicio = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } },
    );

    let body: { maxDias?: number; desde?: string; recarregar?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // cron chama sem corpo
    }
    const maxDias = Math.max(1, Math.min(60, body.maxDias ?? MAX_DIAS_PADRAO));

    const hoje = new Date().toISOString().slice(0, 10);
    const desde = body.desde ??
      (() => {
        const d = new Date(hoje + "T12:00:00");
        d.setDate(d.getDate() - JANELA_DIAS);
        return d.toISOString().slice(0, 10);
      })();

    // ── dias uteis da janela ─────────────────────────────────────────
    const { data: cal, error: errCal } = await supabase
      .from("calendario_dias_uteis")
      .select("data")
      .gte("data", desde)
      .lte("data", hoje)
      .eq("dia_util", true)
      .order("data", { ascending: false }); // do mais recente para o mais antigo

    if (errCal) throw new Error(`calendario: ${errCal.message}`);
    let dias = (cal ?? []).map((c: { data: string }) => c.data);

    // ── tirar os que ja temos (paginado: o PostgREST corta em 1000) ──
    if (!body.recarregar && dias.length) {
      const ja = new Set<string>();
      for (let de = 0; ; de += 1000) {
        const { data: p } = await supabase
          .from("precos_debentures")
          .select("data")
          .gte("data", dias[dias.length - 1])
          .lte("data", dias[0])
          .range(de, de + 999);
        if (!p?.length) break;
        p.forEach((r: { data: string }) => ja.add(r.data));
        if (p.length < 1000) break;
      }
      dias = dias.filter((d) => !ja.has(d));
    }

    const faltavam = dias.length;
    dias = dias.slice(0, maxDias);

    if (!dias.length) {
      return json({ success: true, mensagem: "nenhum dia novo", desde, ate: hoje });
    }

    // ── baixar, um por vez ───────────────────────────────────────────
    let comDado = 0;
    let gravadas = 0;
    const semArquivo: string[] = [];
    const falhas: Record<string, string> = {};
    let interrompido: string | null = null;

    for (const dia of dias) {
      if (Date.now() - inicio > TETO_MS) {
        interrompido = `teto de tempo em ${dia}`;
        break;
      }

      let linhas: Linha[] | null = null;
      try {
        linhas = await buscarDia(dia);
      } catch (e) {
        falhas[dia] = e instanceof Error ? e.message : String(e);
        continue;
      }

      if (!linhas) {
        semArquivo.push(dia);
        continue;
      }

      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase
          .from("precos_debentures")
          .upsert(linhas.slice(i, i + 500), { onConflict: "codigo,data" });
        if (error) throw new Error(`gravacao ${dia}: ${error.message}`);
      }
      comDado++;
      gravadas += linhas.length;

      await espera(PAUSA_ENTRE_DIAS);
    }

    return json({
      success: true,
      dias_gravados: comDado,
      linhas_gravadas: gravadas,
      dias_sem_arquivo: semArquivo.length,
      dias_ainda_faltando: Math.max(0, faltavam - comDado),
      segundos: Math.round((Date.now() - inicio) / 1000),
      ...(semArquivo.length ? { sem_arquivo: semArquivo } : {}),
      ...(Object.keys(falhas).length ? { falhas } : {}),
      ...(interrompido ? { interrompido } : {}),
    });
  } catch (error) {
    console.error("daily-debentures-sync:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "erro desconhecido",
      },
      500,
    );
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
