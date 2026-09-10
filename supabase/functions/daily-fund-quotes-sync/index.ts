// Sync das cotas de fundos, da CVM para `cotas_fundos`.
//
//   POST { }                                       rotina diaria: olha 3 meses para tras
//   POST { desde: "2023-01-02" }                    BACKFILL: varre desde a data pedida (nunca antes do piso)
//   POST { desde: "2023-01-01", ate: "2023-12-31" } backfill fatiado, para nao estourar o tempo
//
// O `daily-market-sync` cobre CDI e series do BCB, mas nao as cotas de fundo, que vem do
// informe diario da CVM. Sem esta rotina a serie ficava no ultimo backfill manual: em
// 05/09/2026 as cotas paravam em 01/09 e os cinco fundos da carteira apareciam R$ 1.127,75
// abaixo do Gorila - dado velho, nao erro de conta.
//
// A leitura do zip remoto e a mesma da `cadastrar-fundo`, mas aqui o informe do mes e
// baixado UMA vez e filtrado para todos os CNPJs juntos. Idempotente (upsert por
// fundo_id+data).
//
// NAO existe carry-forward de cota aqui, de proposito. Medido em 05/09/2026: o Gorila tambem
// nao repete nem projeta cota de fundo - ele espera a real, fundo a fundo (naquele dia ele
// tinha 04/09 de tres dos cinco e repetia 03/09 nos outros dois, igual a nos). Repetir ou
// estimar aqui nos afastaria dele, nao aproximaria.
//
// ── O modo backfill, e por que ele precisou de DOIS destravamentos ───────────────────────────
//
// A rotina diaria tem duas travas que existem para ela ser barata de rodar de hora em hora, e
// as duas impedem o backfill:
//
//   1. o piso de JANELA_MESES, que impede varrer mais que 3 meses;
//   2. o filtro `l.data <= f.ultima`, que descarta tudo ANTERIOR a ultima cota conhecida - e
//      backfill e exatamente preencher o que vem antes.
//
// Passar `desde` desliga as duas. Sem isso, chamar a funcao para preencher 2023 nao traria
// nada e nao daria erro: ela responderia "0 inseridas" e pareceria que a CVM e que nao tinha o
// dado. Esse e o pior tipo de falha - a que devolve sucesso.
//
// `ate` existe porque cada informe mensal tem ~11 MB e a leitura e sequencial: varrer quatro
// anos de uma vez pode estourar o tempo da edge function. Fatiar por ano e o uso normal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const JANELA_MESES = 3;
/** Data inicial da ferramenta. Backfill pedido antes dela comeca nela: cota anterior nao e usada. */
const PISO_SERIE = "2023-01-02";
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const competencia = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

function campo(linha: string, n: number): string {
  let ini = 0;
  for (let k = 0; k < n; k++) { const p = linha.indexOf(";", ini); if (p < 0) return ""; ini = p + 1; }
  const fim = linha.indexOf(";", ini);
  return fim < 0 ? linha.slice(ini) : linha.slice(ini, fim);
}

async function faixa(url: string, range: string): Promise<Response> {
  const r = await fetch(url, { headers: { Range: range } });
  if (r.status !== 206 && r.status !== 200) throw new Error(`Range ${range} HTTP ${r.status}`);
  return r;
}

/** Abre um membro do zip remoto por Range, sem materializar o arquivo inteiro. */
async function membroRemoto(url: string, escolher: (n: string) => boolean): Promise<ReadableStream<string>> {
  const rod = new Uint8Array(await (await faixa(url, "bytes=-4096")).arrayBuffer());
  const dvR = new DataView(rod.buffer, rod.byteOffset, rod.byteLength);
  let e = rod.length - 22;
  while (e >= 0 && dvR.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip sem diretorio central");
  const cdTam = dvR.getUint32(e + 12, true), cdIni = dvR.getUint32(e + 16, true);
  const cd = new Uint8Array(await (await faixa(url, `bytes=${cdIni}-${cdIni + cdTam - 1}`)).arrayBuffer());
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  let p = 0;
  while (p < cd.length && dv.getUint32(p, true) === 0x02014b50) {
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const metodo = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), off = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nl));
    if (escolher(nome)) {
      if (metodo !== 8) throw new Error(`${nome}: membro nao esta em deflate`);
      const cab = new Uint8Array(await (await faixa(url, `bytes=${off}-${off + 29}`)).arrayBuffer());
      const dvC = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
      const ini = off + 30 + dvC.getUint16(26, true) + dvC.getUint16(28, true);
      const corpo = await faixa(url, `bytes=${ini}-${ini + csize - 1}`);
      return corpo.body!.pipeThrough(new DecompressionStream("deflate-raw"))
        .pipeThrough(new TextDecoderStream("iso-8859-1")) as ReadableStream<string>;
    }
    p += 46 + nl + el + cl;
  }
  throw new Error("membro nao encontrado no zip");
}

async function percorrerCsv(stream: ReadableStream<string>, aoLer: (l: string, i: Map<string, number>) => void) {
  let resto = "";
  let idx: Map<string, number> | null = null;
  for await (const pedaco of stream as unknown as AsyncIterable<string>) {
    const partes = (resto + pedaco).split("\n");
    resto = partes.pop() ?? "";
    for (const linha of partes) {
      const limpa = linha.replace(/[\r]$/, "");
      if (!idx) { idx = new Map(limpa.split(";").map((c, i) => [c.trim().toUpperCase(), i] as const)); continue; }
      aoLer(limpa, idx);
    }
  }
  if (resto && idx) aoLer(resto.replace(/[\r]$/, ""), idx);
}

type Achado = { cnpj: string; sub: string; data: string; cota: number };

/** Le o informe do mes uma vez e devolve as cotas de todos os cnpjs pedidos. */
async function cotasDoMes(mes: string, cnpjs: Set<string>): Promise<Achado[]> {
  const url = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${mes}.zip`;
  if ((await fetch(url, { method: "HEAD" })).status === 404) return []; // mes nao publicado
  const out: Achado[] = [];
  await percorrerCsv(await membroRemoto(url, (n) => n.toLowerCase().endsWith(".csv")), (linha, idx) => {
    const iC = idx.get("CNPJ_FUNDO_CLASSE") ?? idx.get("CNPJ_FUNDO") ?? -1;
    const iD = idx.get("DT_COMPTC") ?? -1, iQ = idx.get("VL_QUOTA") ?? -1, iS = idx.get("ID_SUBCLASSE") ?? -1;
    if (iC < 0 || iD < 0 || iQ < 0) return;
    const cnpj = soDigitos(campo(linha, iC));
    if (!cnpjs.has(cnpj)) return;
    const cota = parseFloat(campo(linha, iQ));
    if (!Number.isFinite(cota) || cota <= 0) return;
    out.push({ cnpj, sub: iS >= 0 ? campo(linha, iS).trim() : "", data: campo(linha, iD).trim(), cota });
  });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const desdeBruto = typeof body?.desde === "string" ? body.desde.slice(0, 10) : null;
    const desdeParam = desdeBruto && desdeBruto < PISO_SERIE ? PISO_SERIE : desdeBruto;
    const ateParam = typeof body?.ate === "string" ? body.ate.slice(0, 10) : null;

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "invest" } });
    const { data: fundos, error: err } = await sb.from("cadastro_de_fundos")
      .select("id, nome_curto, cnpj_classe, cvm_id_subclasse").eq("ativo", true).eq("sincronizar_cotas", true);
    if (err) throw err;
    if (!fundos?.length) return json({ fundos: 0, inseridas: 0, detalhe: [] });

    const porCnpj = new Map<string, { id: string; nome: string; sub: string | null; ultima: string }>();
    for (const f of fundos) {
      const { data: u } = await sb.from("cotas_fundos").select("data").eq("fundo_id", f.id)
        .order("data", { ascending: false }).limit(1).maybeSingle();
      porCnpj.set(soDigitos(f.cnpj_classe), {
        id: f.id, nome: f.nome_curto ?? f.cnpj_classe, sub: f.cvm_id_subclasse, ultima: u?.data ?? "1900-01-01",
      });
    }

    // So baixa os meses que algum fundo realmente precisa. Com todos em dia isso e UM arquivo
    // em vez de tres (~7 MB no lugar de ~21), o que torna barato rodar de hora em hora - e a
    // janela de atraso contra o Gorila depende justamente de quao rapido pegamos a publicacao.
    //
    // No BACKFILL o piso e a data pedida, e nao JANELA_MESES: e essa a diferenca entre as duas
    // operacoes. Sem isso a funcao varreria so os ultimos 3 meses e responderia "0 inseridas"
    // para um pedido de 2023, parecendo que a CVM e que nao tinha o dado.
    const hoje = new Date();
    const fim = ateParam ? new Date(`${ateParam}T12:00:00`) : hoje;
    const piso = desdeParam
      ? new Date(`${desdeParam.slice(0, 7)}-01T12:00:00`)
      : new Date(hoje.getFullYear(), hoje.getMonth() - (JANELA_MESES - 1), 1);
    const maisAntiga = [...porCnpj.values()].reduce((a, f) => (f.ultima < a ? f.ultima : a), "9999-12-31");
    const desde = desdeParam ? piso
      : new Date(Number(maisAntiga.slice(0, 4)), Number(maisAntiga.slice(5, 7)) - 1, 1);
    const meses: string[] = [];
    for (let c = desde < piso ? piso : desde; c <= fim; c = new Date(c.getFullYear(), c.getMonth() + 1, 1))
      meses.push(competencia(c));

    const cnpjs = new Set(porCnpj.keys());
    const novasPorFundo = new Map<string, number>();
    let total = 0;
    for (const mes of meses) {
      const linhas = await cotasDoMes(mes, cnpjs);
      const lote: { fundo_id: string; data: string; valor_cota: number }[] = [];
      for (const l of linhas) {
        const f = porCnpj.get(l.cnpj)!;
        // Fundo com varias subclasses: so a escolhida, senao entra cota errada em silencio.
        if (f.sub && l.sub !== f.sub) continue;
        // No diario, pula o que ja passou; no backfill, o corte e a JANELA PEDIDA - senao nada
        // do passado entraria, que e justamente o que se quer preencher.
        if (desdeParam) {
          if (l.data < desdeParam) continue;
          if (ateParam && l.data > ateParam) continue;
        } else if (l.data <= f.ultima) continue;
        lote.push({ fundo_id: f.id, data: l.data, valor_cota: l.cota });
      }
      if (!lote.length) continue;
      const { error } = await sb.from("cotas_fundos").upsert(lote, { onConflict: "fundo_id,data" });
      if (error) throw error;
      for (const l of lote) novasPorFundo.set(l.fundo_id, (novasPorFundo.get(l.fundo_id) ?? 0) + 1);
      total += lote.length;
    }

    const detalhe = [...porCnpj.values()].map((f) => ({ fundo: f.nome, antes: f.ultima, gravadas: novasPorFundo.get(f.id) ?? 0 }));
    return json({ modo: desdeParam ? "backfill" : "diario", fundos: fundos.length, meses, gravadas: total, detalhe });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
