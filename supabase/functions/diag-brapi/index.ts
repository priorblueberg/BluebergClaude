// Diagnostico da BRAPI: mede o que ela realmente entrega, usando o token que esta no secret.
//
// Existe porque a pergunta "da para usar so a BRAPI?" nao se responde lendo documentacao nem
// perguntando para a IA dela - se responde chamando os endpoints e contando o que volta. E o
// token nao pode sair do ambiente para um teste manual, entao o teste vem ate ele.
//
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
  return { status: r.status, json: j as Record<string, unknown> | null, cru: txt.slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const ticker = String(body?.ticker ?? "PETR4").toUpperCase().trim();
  const out: Record<string, unknown> = { ticker, token_configurado: BRAPI_TOKEN.length > 0 };

  // 1) Serie historica completa: cobre desde quando?
  try {
    const r = await pega(`https://brapi.dev/api/v2/stocks/historical?symbols=${ticker}&range=max&interval=1d`);
    const res = (r.json?.results as Record<string, unknown>[] | undefined)?.[0];
    const hist = (res?.historicalDataPrice ?? res?.data ?? res?.history) as Record<string, unknown>[] | undefined;
    out.historical = {
      status: r.status,
      chaves_do_resultado: res ? Object.keys(res) : null,
      pregoes: hist?.length ?? null,
      primeiro: hist?.[0] ?? null,
      ultimo: hist?.at(-1) ?? null,
      amostra_bruta: hist ? null : r.cru,
    };
  } catch (e) {
    out.historical = { erro: String(e) };
  }

  // 2) A janela do desdobramento de PETR4 em setembro/2005. Se o preco cair perto de 4x de um
  //    pregao para o outro, o evento existe na serie mesmo sem constar em stockDividends -
  //    e ai da para deduzir o split do proprio preco.
  try {
    const r = await pega(`https://brapi.dev/api/v2/stocks/historical?symbols=${ticker}`
      + `&startDate=2005-08-25&endDate=2005-09-15&interval=1d&sortOrder=asc`);
    const res = (r.json?.results as Record<string, unknown>[] | undefined)?.[0];
    const hist = (res?.historicalDataPrice ?? res?.data ?? res?.history) as Record<string, unknown>[] | undefined;
    out.janela_split_2005 = {
      status: r.status,
      pontos: hist?.length ?? null,
      serie: hist?.map((d) => ({ data: d.date ?? d.data, fech: d.close ?? d.fechamento })) ?? r.cru,
    };
  } catch (e) {
    out.janela_split_2005 = { erro: String(e) };
  }

  // 3) O dicionario da API menciona algum campo de split fora de stockDividends?
  try {
    const r = await pega(`https://brapi.dev/api/v2/dictionary?search=split`);
    out.dicionario_split = { status: r.status, amostra: r.cru };
  } catch (e) {
    out.dicionario_split = { erro: String(e) };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
