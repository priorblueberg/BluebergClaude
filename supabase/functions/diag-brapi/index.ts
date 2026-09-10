// Diagnostico da BRAPI: mede o que ela realmente entrega, usando o token que esta no secret.
// Nao grava nada. So relata.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

async function pega(url: string) {
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
  if (BRAPI_TOKEN) headers.Authorization = `Bearer ${BRAPI_TOKEN}`;
  const r = await fetch(url, { headers });
  const txt = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(txt); } catch { /* resposta nao-JSON */ }
  return { status: r.status, json: j as Record<string, unknown> | null, cru: txt.slice(0, 400) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const ticker = String(body?.ticker ?? "PETR4").toUpperCase().trim();
  const desde = String(body?.desde ?? "2026-01-01");
  const out: Record<string, unknown> = { ticker, token_configurado: BRAPI_TOKEN.length > 0 };

  // Payload CRU dos proventos. A pergunta e se a BRAPI traz mais linhas do que gravamos - o
  // indice unico e (ticker, tipo, valor, data_ex, data_pagamento), entao duas parcelas iguais
  // no mesmo pagamento colapsariam em uma sem deixar rastro.
  try {
    const r = await pega(`https://brapi.dev/api/v2/stocks/dividends?symbols=${ticker}`);
    const res = (r.json?.results as Record<string, unknown>[] | undefined)?.[0];
    const bloco = (res?.data ?? res) as Record<string, unknown> | undefined;
    const cash = (bloco?.cashDividends ?? []) as Record<string, unknown>[];
    const recentes = cash.filter((d) => String(d.exDate ?? "") >= desde);
    out.dividends = {
      status: r.status,
      chaves_do_bloco: bloco ? Object.keys(bloco) : null,
      total_cashDividends: cash.length,
      qtd_recentes: recentes.length,
      recentes_na_integra: recentes,
    };
  } catch (e) {
    out.dividends = { erro: String(e) };
  }

  // ── Identidade do papel ────────────────────────────────────────────────────────────────────
  //
  // Duas perguntas diferentes, e a distincao importa quando um ticker muda:
  //
  //   resolve  qual e o codigo ATUAL deste papel
  //   renames  que codigos ele ja teve
  //
  // O caso que motivou incluir isto aqui: FICT3 virou FASA3 em agosto de 2026, e o catalogo da
  // BRAPI passou a listar OS DOIS como ativos, com o novo sem nome nenhum. Saber o que cada
  // endpoint responde e o que separa "a fonte nao sabe" de "a fonte sabe e nos ignoramos".
  for (const [rotulo, url] of [
    ["resolve", `https://brapi.dev/api/v2/tickers/resolve?symbols=${ticker}`],
    ["renames", `https://brapi.dev/api/v2/tickers/renames?symbols=${ticker}`],
  ] as const) {
    try {
      const r = await pega(url);
      out[rotulo] = { status: r.status, resposta: r.json ?? r.cru };
    } catch (e) {
      out[rotulo] = { erro: String(e) };
    }
  }

  // Existe cotacao para este codigo hoje? E o teste mais direto de "o ticker esta vivo".
  try {
    const r = await pega(`https://brapi.dev/api/quote/${ticker}`);
    const res = (r.json?.results as Record<string, unknown>[] | undefined)?.[0];
    out.quote = {
      status: r.status,
      nome_longo: res?.longName ?? null,
      nome_curto: res?.shortName ?? null,
      preco: res?.regularMarketPrice ?? null,
      erro: (r.json?.error as unknown) ?? null,
    };
  } catch (e) {
    out.quote = { erro: String(e) };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
