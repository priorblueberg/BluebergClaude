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

  // ── A serie AJUSTADA denuncia evento que a fonte nao declara? ───────────────────────────────
  //
  // Pergunta desta medicao: o motor de ajuste da BRAPI e alimentado pela MESMA lista de
  // `stockDividends` que ela publica, ou por outra? Se for outra, a razao adjustedClose/close
  // tem um degrau em cada evento que ele conhece - inclusive nos que a lista nao traz. Seria um
  // detector gratuito para o caso GGBR4 22/03/2023, que nenhuma fonte declara.
  //
  // Nao interpreta nada: devolve os degraus medidos, para a conclusao sair do numero.
  try {
    const r = await pega(
      `https://brapi.dev/api/v2/stocks/historical?symbols=${ticker}`
      + "&range=max&interval=1d&sortOrder=asc",
    );
    const res = (r.json?.results as Record<string, unknown>[] | undefined)?.[0];
    const itens = ((res?.data as Record<string, unknown> | undefined)?.historicalDataPrice
                ?? res?.historicalDataPrice ?? []) as Record<string, unknown>[];
    out.chaves_historico = itens.length ? Object.keys(itens[0]) : (res ? Object.keys(res) : null);
    const serie = itens
      .map((d) => ({
        data: new Date(Number(d.date) * 1000).toISOString().slice(0, 10),
        close: Number(d.close),
        ajustado: d.adjustedClose == null ? null : Number(d.adjustedClose),
      }))
      .filter((d) => Number.isFinite(d.close) && d.close > 0 && d.data >= desde);

    const comAjuste = serie.filter((d) => d.ajustado != null && Number.isFinite(d.ajustado!));
    const degraus: Record<string, unknown>[] = [];
    for (let i = 1; i < comAjuste.length; i++) {
      const a = comAjuste[i - 1].ajustado! / comAjuste[i - 1].close;
      const b = comAjuste[i].ajustado! / comAjuste[i].close;
      if (a <= 0 || b <= 0) continue;
      const passo = a / b;
      // 0,2% e o piso do arredondamento do proprio campo. Abaixo disso e ruido de duas casas.
      if (Math.abs(passo - 1) > 0.002) {
        degraus.push({
          de: comAjuste[i - 1].data, para: comAjuste[i].data,
          razao_antes: +a.toFixed(6), razao_depois: +b.toFixed(6), degrau: +passo.toFixed(6),
        });
      }
    }
    out.serie_ajustada = {
      status: r.status,
      pregoes: serie.length,
      com_adjustedClose: comAjuste.length,
      // Se este for zero, o campo nao vem e a ideia inteira morre aqui.
      degraus_da_razao: degraus,
    };
  } catch (e) {
    out.serie_ajustada = { erro: String(e) };
  }

  // ── Grafia do nome: a fonte muda a escrita sozinha? ─────────────────────────────────────────
  //
  // A proposta de detectar renomeacao comparando o nome devolvido com o gravado so vale se a
  // grafia for ESTAVEL quando nada acontece. Isto colhe o nome dos endpoints de uma vez para
  // que a comparacao com o que esta no banco seja feita fora daqui.
  try {
    const lista = String(body?.tickers ?? "").toUpperCase().split(",")
      .map((t: string) => t.trim()).filter(Boolean);
    if (lista.length) {
      // Os DOIS endpoints, no mesmo instante. A `sync-acoes` le o nome do historico (modo lote,
      // que e o da intradiaria) e o cadastro guarda o que veio de la; a pergunta e se a grafia
      // e a mesma coisa em toda a API ou se ela ja varia de porta para porta. Se variar, o nome
      // nao serve de sinal de renomeacao nem em teoria.
      const papeis: Record<string, unknown>[] = [];
      for (let i = 0; i < lista.length; i += 20) {
        const lote = lista.slice(i, i + 20);
        const [q, h] = await Promise.all([
          pega(`https://brapi.dev/api/quote/${lote.join(",")}`),
          pega(`https://brapi.dev/api/v2/stocks/historical?symbols=${lote.join(",")}`
             + "&range=5d&interval=1d&sortOrder=asc"),
        ]);
        const leia = (r: { json: Record<string, unknown> | null }) =>
          ((r.json?.results as Record<string, unknown>[] | undefined) ?? []).map((x) => {
            const d = (x.data ?? x) as Record<string, unknown>;
            return {
              symbol: String(x.symbol ?? d.symbol ?? ""),
              requested: String(x.requestedSymbol ?? d.requestedSymbol ?? ""),
              longName: (x.longName ?? d.longName ?? null) as string | null,
            };
          });
        const hist = new Map(leia(h).map((x) => [x.symbol || x.requested, x]));
        for (const x of leia(q)) {
          const chave = x.symbol || x.requested;
          const hh = hist.get(chave);
          papeis.push({
            pedido: lote.find((t: string) => t === chave || t === x.requested) ?? null,
            symbol_devolvido: x.symbol || null,
            requestedSymbol: x.requested || null,
            quote_longName: x.longName,
            historico_symbol: hh?.symbol ?? null,
            historico_longName: hh?.longName ?? null,
          });
        }
        out.chaves_quote = ((q.json?.results as Record<string, unknown>[] | undefined) ?? [])
          .slice(0, 1).map((x) => Object.keys(x));
        out.chaves_hist = ((h.json?.results as Record<string, unknown>[] | undefined) ?? [])
          .slice(0, 1).map((x) => Object.keys(x));
      }
      const pedidos = new Set(lista);
      out.nomes = {
        pedidos: lista.length,
        respondidos: papeis.length,
        // O sinal que interessa: pedi X e a fonte respondeu Y.
        symbol_diferente_do_pedido: papeis.filter((x) =>
          x.symbol_devolvido && !pedidos.has(String(x.symbol_devolvido))),
        nao_responderam: lista.filter((t: string) =>
          !papeis.some((p) => p.symbol_devolvido === t || p.requestedSymbol === t)),
        papeis,
      };
    }
  } catch (e) {
    out.nomes = { erro: String(e) };
  }

  // Cru, sem interpretacao: `requestedSymbol`, `symbol` e `changed` sao campos de TOPO da
  // resposta em lote do historico - a mesma que a intradiaria consome.
  try {
    const lista = String(body?.cru ?? "").toUpperCase().split(",")
      .map((t: string) => t.trim()).filter(Boolean);
    if (lista.length) {
      const r = await pega(`https://brapi.dev/api/v2/stocks/historical?symbols=${lista.join(",")}`
        + "&range=5d&interval=1d&sortOrder=asc");
      out.cru = ((r.json?.results as Record<string, unknown>[] | undefined) ?? []).map((x) => {
        const d = (x.data ?? {}) as Record<string, unknown>;
        return {
          requestedSymbol: x.requestedSymbol ?? null,
          symbol: x.symbol ?? null,
          changed: x.changed ?? null,
          chaves_de_topo: Object.keys(x),
          chaves_de_data: Object.keys(d),
          longName_em_data: d.longName ?? null,
        };
      });
    }
  } catch (e) {
    out.cru = { erro: String(e) };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
