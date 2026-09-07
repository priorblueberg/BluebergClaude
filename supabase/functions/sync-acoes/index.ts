// Precos, proventos e eventos corporativos de acoes. Fonte unica: BRAPI.
//
// Dois modos, porque cadastrar um papel novo e manter os antigos em dia sao a MESMA operacao
// com janelas diferentes - separar em duas viraria duas copias da mesma leitura, e neste
// projeto copia sempre divergiu:
//
//   POST { ticker: "PETR4" }  -> cadastra o papel e traz a serie inteira que a fonte tiver
//   POST { }                  -> atualiza todos os papeis ativos
//
// ── Por que so a BRAPI, e por que o Yahoo saiu ──────────────────────────────────────────────
//
// O Yahoo era a fonte de preco ate 07/09/2026, quando a comparacao dia a dia das duas series
// (2022 em diante) mostrou o problema:
//
//               precos iguais    precos diferentes
//   PETR4            1.150               19
//   ITSA4              175              994
//
// PETR4 batia porque nao tem split desde 2008. ITSA4 divergia em quase tudo, e os 175 dias que
// batiam eram exatamente os POSTERIORES a 19/12/2025, data do ultimo desdobramento. Em
// 03/01/2022: BRAPI 9,02 e Yahoo 7,2293.
//
// Ou seja: o `close` do Yahoo vem AJUSTADO por splits; o da BRAPI vem NOMINAL. O motor foi
// construido para nominal - ele proprio converte para "unidades de hoje" dividindo pelo fator
// dos eventos posteriores. Alimentado com preco ja ajustado, ele dividia duas vezes: o valor
// de hoje saia certo (fator 1) e todo o historico e a rentabilidade saiam errados.
//
// Por isso tambem NAO ha fallback para o Yahoo. Um fallback que grava noutra convencao e pior
// do que nenhum: a carteira continuaria "funcionando", com o historico silenciosamente torto.
// Se a BRAPI cair, esta funcao falha e diz que falhou.
//
// ── A janela de excecao ─────────────────────────────────────────────────────────────────────
//
// A cobertura de `stockDividends` da BRAPI tem furos: em ITSA4 falta a bonificacao de
// 11/11/2022 (fator 1,10). Esses casos entram a mao na tabela com `fonte = 'manual'`, e o
// sync NUNCA os apaga - so limpa o que ele mesmo gravou. Sem essa protecao, a proxima rodada
// desfaria a correcao e o erro voltaria em silencio.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = { "User-Agent": "Mozilla/5.0" };
const BRAPI_HIST = "https://brapi.dev/api/v2/stocks/historical";
const BRAPI_DIV = "https://brapi.dev/api/v2/stocks/dividends";
/** Secret da funcao. Vai no header, nunca na URL - a propria BRAPI recomenda, porque na query
 *  string o token vaza para o historico do navegador e para o log do servidor. */
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

/** Fuso da B3. O `date` da BRAPI e epoch em segundos. */
const OFFSET_B3 = -10800;
const dataDe = (epochSeg: number) => new Date((epochSeg + OFFSET_B3) * 1000).toISOString().slice(0, 10);

function cabecalhos() {
  const h: Record<string, string> = { ...UA };
  if (BRAPI_TOKEN) h.Authorization = `Bearer ${BRAPI_TOKEN}`;
  return h;
}

async function pedir(url: string) {
  const r = await fetch(url, { headers: cabecalhos() });
  if (!r.ok) throw new Error(`BRAPI HTTP ${r.status} em ${url.split("?")[0]}`);
  return await r.json();
}

/** Razao social do papel. O endpoint historical nao traz - so o de cotacao. */
async function nomeDoPapel(ticker: string): Promise<string> {
  try {
    const j = await pedir(`https://brapi.dev/api/quote/${ticker}`);
    const r = j?.results?.[0];
    return r?.longName || r?.shortName || ticker;
  } catch {
    return ticker;
  }
}

async function precos(ticker: string) {
  const j = await pedir(`${BRAPI_HIST}?symbols=${ticker}&range=max&interval=1d&sortOrder=asc`);
  const res = j?.results?.[0];
  const itens = res?.data?.historicalDataPrice ?? res?.historicalDataPrice ?? [];
  if (!Array.isArray(itens) || !itens.length) throw new Error(`sem serie historica para ${ticker}`);

  const cotacoes = itens
    .filter((d: Record<string, unknown>) => d.close != null)
    .map((d: Record<string, unknown>) => ({
      ticker,
      data: dataDe(Number(d.date)),
      // `close` NOMINAL, nao `adjustedClose`: o motor guarda a quantidade real de cada data e
      // faz o proprio ajuste. Gravar o ajustado aqui seria ajustar duas vezes.
      fechamento: Number(d.close),
      abertura: d.open != null ? Number(d.open) : null,
      maxima: d.high != null ? Number(d.high) : null,
      minima: d.low != null ? Number(d.low) : null,
      volume: d.volume != null ? Number(d.volume) : null,
      provisorio: false,
    }));

  return {
    cotacoes,
    nome: res?.longName || res?.shortName || await nomeDoPapel(ticker),
    moeda: res?.currency ?? "BRL",
  };
}

const TIPO_PROVENTO: Record<string, string> = {
  DIVIDENDO: "DIVIDENDO",
  JCP: "JCP",
  "JRS CAP PROPRIO": "JCP",
  "JUROS SOBRE CAPITAL PROPRIO": "JCP",
  RENDIMENTO: "RENDIMENTO",
};
const TIPO_EVENTO: Record<string, string> = {
  DESDOBRAMENTO: "DESDOBRAMENTO",
  GRUPAMENTO: "GRUPAMENTO",
  BONIFICACAO: "BONIFICACAO",
};

const soData = (s: unknown) => (s ? String(s).slice(0, 10) : null);

async function proventosEEventos(ticker: string) {
  const j = await pedir(`${BRAPI_DIV}?symbols=${ticker}`);
  const dd = j?.results?.[0]?.data ?? j?.results?.[0]?.dividendsData ?? {};

  const proventos = (dd.cashDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    tipo: TIPO_PROVENTO[String(x.label ?? "").toUpperCase().trim()] ?? "OUTRO",
    valor: Number(x.rate),
    // Sem `exDate`, `lastDatePrior` e a ultima data COM direito - um dia antes da data-ex.
    // Guardamos como aproximacao em vez de descartar o provento.
    data_ex: soData(x.exDate) ?? soData(x.lastDatePrior),
    data_pagamento: soData(x.paymentDate),
    fonte: "brapi",
  })).filter((p: { valor: number }) => Number.isFinite(p.valor) && p.valor > 0);

  const eventos = (dd.stockDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    tipo: TIPO_EVENTO[String(x.label ?? "").toUpperCase().trim()] ?? null,
    fator: Number(x.factor),
    data_ex: soData(x.exDate) ?? soData(x.lastDatePrior),
    fonte: "brapi",
  })).filter((e: { tipo: string | null; fator: number }) =>
    e.tipo && Number.isFinite(e.fator) && e.fator > 0);

  return { proventos, eventos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // `{ db: { schema } }` nao e detalhe: sem ele o cliente aponta para `public`, as tabelas nao
  // existem la, e o upsert volta com erro que ninguem le - foi o que aconteceu na primeira
  // versao, que reportou 6.697 cotacoes gravadas com o banco vazio.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );

  try {
    if (!BRAPI_TOKEN) {
      return new Response(JSON.stringify({
        ok: false,
        erro: "BRAPI_TOKEN nao configurado. Sem ele a BRAPI so atende o sandbox "
            + "(PETR4, MGLU3, VALE3, ITUB4) e responde 401 no resto.",
      }, null, 2), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const pedido = String(body?.ticker ?? "").toUpperCase().trim();

    let tickers: string[];
    if (pedido) {
      tickers = [pedido];
    } else {
      const { data: papeis } = await db.from("cadastro_de_acoes").select("ticker").eq("ativo", true);
      if (!papeis?.length) {
        return new Response(JSON.stringify({ ok: true, aviso: "nenhum papel cadastrado" }),
          { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      tickers = papeis.map((p: { ticker: string }) => p.ticker);
    }

    const relatorio: Record<string, unknown>[] = [];

    for (const ticker of tickers) {
      try {
        const exigir = (etapa: string, error: { message: string } | null) => {
          if (error) throw new Error(`${etapa}: ${error.message}`);
        };

        const p = await precos(ticker);
        const pe = await proventosEEventos(ticker);

        if (pedido) {
          exigir("cadastro_de_acoes", (await db.from("cadastro_de_acoes").upsert(
            { ticker, nome: p.nome, moeda: p.moeda, ativo: true },
            { onConflict: "ticker" },
          )).error);
        }

        // A serie e SUBSTITUIDA, nao mesclada. Um upsert deixaria vivas as datas que a fonte
        // antiga tinha e a nova nao - foram 85 pregoes na migracao do Yahoo para a BRAPI, e
        // eles ficariam na convencao ANTIGA (ajustada por split) no meio dos nominais. Preco
        // de duas convencoes na mesma serie e o tipo de erro que nao aparece na tela: o total
        // continua plausivel e so a rentabilidade de alguns trechos sai torta.
        exigir("limpeza de cotacoes", (await db.from("cotacoes_acoes")
          .delete().eq("ticker", ticker)).error);

        // Lotes: 6.615 pregoes num payload so estouram o limite do PostgREST.
        const LOTE = 1000;
        for (let i = 0; i < p.cotacoes.length; i += LOTE) {
          exigir("cotacoes_acoes", (await db.from("cotacoes_acoes")
            .upsert(p.cotacoes.slice(i, i + LOTE), { onConflict: "ticker,data" })).error);
        }

        // Limpa o que ESTE sync gravou antes, para nao acumular linha de fonte antiga (o Yahoo
        // gravava `OUTRO` onde a BRAPI grava `JCP`: linhas distintas para o banco, o mesmo
        // dinheiro, e o motor somaria as duas).
        //
        // `neq("fonte", "manual")` e o que protege a janela de excecao: sem isso, a proxima
        // rodada apagaria a bonificacao cadastrada a mao e o erro voltaria em silencio.
        exigir("limpeza de proventos", (await db.from("proventos_acoes")
          .delete().eq("ticker", ticker).neq("fonte", "manual")).error);
        exigir("limpeza de eventos", (await db.from("eventos_corporativos_acoes")
          .delete().eq("ticker", ticker).neq("fonte", "manual")).error);

        if (pe.proventos.length) {
          exigir("proventos_acoes", (await db.from("proventos_acoes").upsert(pe.proventos,
            { onConflict: "ticker,tipo,valor,data_ex,data_pagamento", ignoreDuplicates: true })).error);
        }
        if (pe.eventos.length) {
          exigir("eventos_corporativos_acoes", (await db.from("eventos_corporativos_acoes")
            .upsert(pe.eventos, { onConflict: "ticker,tipo,fator,data_ex", ignoreDuplicates: true })).error);
        }

        // Conferencia contra o BANCO, nao contra o array que acabamos de montar: um relatorio
        // que conta a memoria afirma sucesso e some com o erro.
        const conta = async (tabela: string) => (await db.from(tabela)
          .select("*", { count: "exact", head: true }).eq("ticker", ticker)).count ?? -1;
        const [nCot, nProv, nEvt] = await Promise.all([
          conta("cotacoes_acoes"), conta("proventos_acoes"), conta("eventos_corporativos_acoes"),
        ]);
        const { data: manuais } = await db.from("eventos_corporativos_acoes")
          .select("data_ex, fator").eq("ticker", ticker).eq("fonte", "manual");

        relatorio.push({
          ticker,
          nome: p.nome,
          cotacoes_lidas: p.cotacoes.length,
          cotacoes_no_banco: nCot,
          primeira: p.cotacoes[0]?.data ?? null,
          ultima: p.cotacoes.at(-1)?.data ?? null,
          proventos_lidos: pe.proventos.length,
          proventos_no_banco: nProv,
          eventos_da_brapi: pe.eventos.length,
          eventos_manuais: manuais ?? [],
          eventos_no_banco: nEvt,
          confere: (pe.proventos.length === nProv && p.cotacoes.length === nCot)
            ? "ok" : "ATENCAO: lido != gravado",
        });
      } catch (e) {
        relatorio.push({ ticker, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, relatorio }, null, 2),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
