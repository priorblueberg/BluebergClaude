// Mantem as series diarias de mercado completas ate hoje (D0), sem esperar a fonte publicar.
//
// Generaliza o que foi feito para o CDI em 05/09/2026. A regra, definida pelo Daniel: enquanto
// nao houver divulgacao nova, repetimos o valor do dia anterior; quando o dado oficial sair,
// ele substitui (ou confirma) a estimativa.
//
// Por que isso muda numero: os MOTORES ja repetiam o dado que falta na hora do calculo
// (`ultimaCota` no fundo, `prevCdiDiario` na renda fixa). Quem perdia o dia era o BENCHMARK,
// que acumula linha a linha - um dia ausente e um dia a menos de composicao. Foi assim que o
// CDI acumulado saia 0,07 pp abaixo do Gorila: exatamente um dia util a 13,9%.
//
// SO DIA UTIL e preenchido, e isso e deliberado. Em 08/09/2026 cogitou-se estender ao fim de
// semana para o seletor de periodo alcancar D0 num sabado, e a ideia foi descartada pelo
// Daniel: a linha seria inerte (o motor de curva percorre o calendario, que ja marca sabado
// como nao-util) e perigosa, porque `buildCdiSeries` acumula o benchmark linha a linha filtrando
// por `dia_util`. Uma linha de sabado gravada com `dia_util = true` - o valor fixo que esta
// funcao usa - faria o benchmark compor o fim de semana e inflar a rentabilidade em silencio.
// O seletor alcanca D0 pelo lado dos motores, que percorrem o calendario ate a data de calculo.
//
// Cada serie roda isolada, em quatro etapas, e NENHUMA delas abre buraco se falhar:
//   1. busca na fonte a partir do ultimo dia CONFIRMADO (a leitura filtra `provisorio = false`,
//      entao os dias estimados sao reconsultados sem precisar apaga-los antes)
//   2. grava o oficial por cima (upsert por data: a estimativa do mesmo dia vira oficial)
//   3. completa os dias uteis restantes ate hoje repetindo o ultimo valor, como provisorio
//   4. so entao apaga as estimativas que sobraram fora da janela nova
//
// ATE 11/09/2026 A ORDEM ERA OUTRA: apagava as provisorias primeiro. Uma falha na gravacao
// seguinte deixava a serie sem os dias estimados ate a rodada seguinte. Aconteceu as 14h de
// 11/09: o upsert do CDI de 10/09 recebeu 504 Gateway Timeout e o CDI ficou parado em 09/09 com o
// benchmark das laminas dois dias curto. Os 504 do gateway caem na virada de minuto em que varios
// crons disparam juntos, sempre na PRIMEIRA chamada ao banco de uma funcao recem-iniciada - e o
// CDI e a primeira serie do loop. Por isso, alem da ordem, toda escrita e leitura tem retentativa.
//
// Esta funcao e a autoridade das 7 series diarias. O `daily-market-sync` fica so com o
// calendario. Cotas de fundo NAO entram aqui - ver a nota no fim do arquivo.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Secret compartilhado entre as edge functions. Vai no header, nunca na URL. */
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

// ---------- datas ----------
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtBR = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const parseISO = (s: string) => new Date(s + "T12:00:00");

function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function holidays(year: number): Set<string> {
  const s = new Set<string>();
  for (const [m, d] of [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [11, 20], [12, 25]])
    s.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  const e = easter(year);
  s.add(toISO(addDays(e, -48))); // 2a de Carnaval
  s.add(toISO(addDays(e, -47))); // 3a de Carnaval
  s.add(toISO(addDays(e, -2)));  // Sexta-feira Santa
  s.add(toISO(addDays(e, 60)));  // Corpus Christi
  return s;
}

/** Dias uteis em (depois, hoje]. Nenhuma destas series existe em fim de semana ou feriado. */
function diasUteisApos(depois: string, hoje: Date): string[] {
  const fer = new Set<string>();
  for (let y = parseISO(depois).getFullYear(); y <= hoje.getFullYear(); y++) holidays(y).forEach((h) => fer.add(h));
  const out: string[] = [];
  for (let c = addDays(parseISO(depois), 1); toISO(c) <= toISO(hoje); c = addDays(c, 1)) {
    const iso = toISO(c), dow = c.getDay();
    if (dow === 0 || dow === 6 || fer.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

// ---------- series ----------
// `extras` sao colunas fixas da tabela que precisam ir junto no insert.
type Serie = { tabela: string; coluna: string; sgs?: number; extras?: Record<string, unknown> };

const SERIES: Serie[] = [
  { tabela: "historico_cdi", coluna: "taxa_anual", sgs: 4389, extras: { dia_util: true } },
  { tabela: "historico_selic", coluna: "taxa_anual", sgs: 432 },
  { tabela: "historico_tr", coluna: "taxa_mensal", sgs: 226 },
  { tabela: "historico_poupanca_rendimento", coluna: "rendimento_mensal", sgs: 195 },
  { tabela: "historico_dolar", coluna: "cotacao_venda", sgs: 1 },
  { tabela: "historico_euro", coluna: "cotacao_venda", sgs: 21619 },
  { tabela: "historico_ibovespa", coluna: "pontos" }, // fonte BRAPI, tratada a parte
];

/** Busca oficial no SGS do BCB. Devolve as linhas prontas, ja marcadas como confirmadas. */
async function oficialSgs(s: Serie, de: Date, ate: Date): Promise<{ rows: Record<string, unknown>[]; nota: string }> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.sgs}/dados?formato=json`
    + `&dataInicial=${fmtBR(de)}&dataFinal=${fmtBR(ate)}`;
  const resp = await fetch(url);
  // O SGS responde 404 (nao 200 com lista vazia) quando nao ha dado no intervalo. E o caso
  // normal enquanto o BCB nao publicou o dia - nao e falha.
  if (resp.status === 404) return { rows: [], nota: "sem dado novo" };
  if (!resp.ok) return { rows: [], nota: `HTTP ${resp.status}` };
  const arr = await resp.json() as { data: string; valor: string }[];
  if (!arr.length) return { rows: [], nota: "sem dado novo" };
  const rows = arr.map((r) => {
    const [dd, mm, yy] = r.data.split("/");
    return { data: `${yy}-${mm}-${dd}`, [s.coluna]: parseFloat(r.valor), ...(s.extras ?? {}), provisorio: false };
  });
  return { rows, nota: `confirmou ${rows.length} dia(s)` };
}

/**
 * Ibovespa pela BRAPI. So pregao ja fechado (<= ontem) entra como oficial.
 *
 * A fonte era o Yahoo ate 08/09/2026. A troca nao foi por convencao - indice nao sofre ajuste
 * por split, entao o problema que tirou o Yahoo das ACOES nao se aplica aqui. Foi por
 * CONFIABILIDADE: em 06/09/2026 o Yahoo devolveu 110.031 pontos para o ultimo pregao de 2022,
 * quando o fechamento do ano foi 109.734. O erro so apareceu porque alguem conferiu a mao.
 *
 * Com a troca, bolsa inteira - cotacao de papel e indice - passa a vir de uma fonte so.
 */
async function oficialIbov(de: Date, hoje: Date): Promise<{ rows: Record<string, unknown>[]; nota: string }> {
  if (!BRAPI_TOKEN) return { rows: [], nota: "BRAPI_TOKEN nao configurado" };

  // `range=3mo` cobre com folga a distancia entre o ultimo dia confirmado e hoje, e o recorte
  // fino fica no filtro abaixo. Pedir por data exata nao e uma opcao: o endpoint aceita faixas
  // nomeadas, nao intervalos.
  const url = "https://brapi.dev/api/v2/stocks/historical"
    + "?symbols=%5EBVSP&range=3mo&interval=1d&sortOrder=asc";
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Authorization: `Bearer ${BRAPI_TOKEN}` },
  });
  if (!resp.ok) return { rows: [], nota: `BRAPI HTTP ${resp.status}` };

  const res = (await resp.json())?.results?.[0];
  const itens = (res?.data?.historicalDataPrice ?? res?.historicalDataPrice ?? []) as Record<string, unknown>[];
  if (!Array.isArray(itens) || !itens.length) return { rows: [], nota: "sem dado novo" };

  // A barra do dia corrente e parcial: fica de fora do oficial. Se o dia precisar de valor, ele
  // entra como provisorio na etapa 3.
  const limite = toISO(addDays(hoje, -1));
  const desde = toISO(de);
  const fer = new Set<string>(), anos = new Set<number>();
  const rows: Record<string, unknown>[] = [];

  for (const it of itens) {
    if (it.close == null || it.date == null) continue;
    // A BRAPI devolve epoch em segundos, no fuso da B3 (UTC-3).
    const d = new Date((Number(it.date) - 10800) * 1000);
    const iso = toISO(d), dow = d.getDay();
    if (!anos.has(d.getFullYear())) { anos.add(d.getFullYear()); holidays(d.getFullYear()).forEach((h) => fer.add(h)); }
    if (iso < desde || iso > limite || dow === 0 || dow === 6 || fer.has(iso)) continue;
    rows.push({ data: iso, pontos: Math.round(Number(it.close) * 100) / 100, provisorio: false });
  }

  return rows.length ? { rows, nota: `confirmou ${rows.length} dia(s)` } : { rows: [], nota: "sem dado novo" };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chamada ao banco com retentativa em falha de gateway ou de rede (502, 503, 504, timeout).
 * Erro de dado (constraint, coluna) nao e retentado: repetir nao muda o resultado.
 */
async function noBanco<T>(
  etapa: string,
  chamada: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const esperas = [1000, 3000, 6000];
  for (let tentativa = 0; ; tentativa++) {
    const { data, error } = await chamada();
    if (!error) return data;
    const transitorio = /gateway|timeout|timed out|50[234]|fetch failed|connection|network/i.test(error.message);
    if (!transitorio || tentativa >= esperas.length) throw new Error(`${etapa}: ${error.message}`);
    await esperar(esperas[tentativa]);
  }
}

async function rodarSerie(sb: SupabaseClient, s: Serie, hoje: Date) {
  const t = () => sb.schema("invest").from(s.tabela);
  const relato: Record<string, unknown> = {};

  const ultimo = async () => (await noBanco("ultima", () => t().select(`data, ${s.coluna}`)
    .eq("provisorio", false).order("data", { ascending: false }).limit(1).maybeSingle())) as
    Record<string, unknown> | null;

  // 1. fonte oficial, a partir do ultimo dia confirmado
  const antes = await ultimo();
  if (!antes) return { ...relato, erro: "serie vazia, precisa de carga inicial" };

  const inicio = addDays(parseISO(String(antes.data)), 1);
  if (toISO(inicio) <= toISO(hoje)) {
    const { rows, nota } = s.sgs
      ? await oficialSgs(s, inicio, hoje)
      : await oficialIbov(inicio, hoje);
    relato.fonte = nota;
    // 2. grava o oficial por cima da estimativa do mesmo dia
    if (rows.length) await noBanco("upsert oficial", () => t().upsert(rows, { onConflict: "data" }));
  } else relato.fonte = "nada a buscar";

  // 3. repete o ultimo valor confirmado nos dias uteis que faltam
  const base = await ultimo();
  if (!base) return { ...relato, erro: "serie ficou vazia" };
  const valor = Number(base[s.coluna]);
  const faltando = diasUteisApos(String(base.data), hoje);
  if (faltando.length) {
    const linhas = faltando.map((data) => ({ data, [s.coluna]: valor, ...(s.extras ?? {}), provisorio: true }));
    await noBanco("upsert provisorio", () => t().upsert(linhas, { onConflict: "data" }));
  }

  // 4. apaga as estimativas que ficaram fora da janela nova (dia que a fonte confirmou, ou que
  //    deixou de ser dia util). Se esta etapa falhar, sobra uma estimativa a mais, nunca um dia a menos.
  const provisorias = await noBanco("provisorias", () => t().select("data").eq("provisorio", true)) as { data: string }[] | null;
  const sobras = (provisorias ?? []).map((r) => r.data).filter((d) => !faltando.includes(d));
  if (sobras.length) await noBanco("limpeza", () => t().delete().eq("provisorio", true).in("data", sobras));
  relato.removidas = sobras;

  return { ...relato, ultimoOficial: base.data, valorRepetido: valor, provisorios: faltando };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const hoje = new Date();
  const saida: Record<string, unknown> = {};

  // Uma serie que quebra nao pode derrubar as outras: cada uma no seu try/catch.
  for (const s of SERIES) {
    try { saida[s.tabela] = await rodarSerie(sb, s, hoje); }
    catch (e) { saida[s.tabela] = { erro: String((e as Error).message ?? e) }; }
  }
  return json(saida);
});

// Nota sobre cotas de fundo: ficaram DE FORA de proposito. O motor de fundo ja repete a
// `ultimaCota` no calculo, e ainda marca o dia como estimado para nao fabricar variacao - o que
// gravar uma cota estimada na tabela NAO faria. Alem de nao mexer em numero, a gravacao
// acrescentaria o risco de congelar a serie se a limpeza falhasse. O atraso das cotas vem da
// CVM e fecha sozinho pelo `daily-fund-quotes-sync`.
