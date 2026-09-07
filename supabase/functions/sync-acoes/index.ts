// Precos, proventos e eventos corporativos de acoes.
//
// Uma funcao so, com dois modos, porque cadastrar um papel novo e manter os antigos em dia sao
// a MESMA operacao com janelas diferentes - separar em duas viraria duas copias da mesma
// leitura, e neste projeto copia sempre divergiu:
//
//   POST { ticker: "PETR4" }  -> cadastra o papel e traz a serie inteira desde o inicio
//   POST { }                  -> atualiza todos os papeis ativos a partir do ultimo dia que temos
//
// Duas fontes, de proposito:
//
//   Yahoo Finance  -> preco diario, EVENTOS CORPORATIVOS, e o fallback de provento
//   BRAPI          -> proventos, com tipo (DIVIDENDO/JCP) e data de pagamento
//
// A BRAPI e a preferida para PROVENTO porque separa DIVIDENDO de JCP e traz a data de
// pagamento; o Yahoo entrega so o total do dia, sem tipo.
//
// Ja para EVENTO CORPORATIVO a fonte e o YAHOO, por dois motivos medidos em ITSA4 (07/09/2026):
//
//   - Cobertura: o Yahoo lista 12 bonificacoes desde 2009; a BRAPI, 3 desde 2023. Sem as 9
//     antigas, quem comprou antes de 2023 fica com a quantidade errada.
//   - Data: os `stockDividends` da BRAPI vem com `exDate` nulo, entao caimos no
//     `lastDatePrior` - que e a ultima data COM direito, o dia ANTERIOR a data-ex. A mesma
//     bonificacao aparece como 18/12/2025 na BRAPI e 19/12/2025 no Yahoo. Um dia de desvio
//     erra a quantidade de quem operou exatamente nesse intervalo.
//
// Cada fonte no que faz melhor, em vez de uma so para tudo.
//
// Sem token a BRAPI so atende o sandbox - PETR4, MGLU3, VALE3 e ITUB4 - e responde 401 no
// resto (medido em 07/09/2026, e confirmado na documentacao dela). Por isso:
//
//   1. `BRAPI_TOKEN` (secret da funcao, nunca no codigo). Vai no header Authorization, que e
//      o que a propria BRAPI recomenda: na query string o token vaza para o historico do
//      navegador e para o log do servidor.
//   2. Se a BRAPI falhar - sem token, plano vencido, API fora - o provento vem do YAHOO.
//      Perde-se o tipo e a data de pagamento, nao o valor. O calculo do P&L nao usa o tipo
//      (o JCP entra bruto, como no Gorila), entao a carteira continua correta.
//
// Uma diferenca de convencao entre as duas, que o fallback precisa desfazer: o Yahoo AJUSTA o
// provento historico pelos splits posteriores e a BRAPI da o nominal da epoca. A tabela guarda
// sempre o NOMINAL, entao o valor do Yahoo e multiplicado de volta pelo fator antes de gravar.
//
// Medido em 07/09/2026 com PETR4: somando os proventos da BRAPI por data-ex, as duas fontes
// batem na sexta casa em 6 de 7 datas. A setima (23/12/2025) diverge em R$ 0,0089 por acao.
// Por isso `conferir_com_yahoo` existe: ele nao corrige nada, so RELATA a diferenca. Uma fonte
// vigiando a outra vale mais do que escolher uma e confiar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Sufixo da B3 no Yahoo. */
const SUFIXO_B3 = ".SA";
const UA = { "User-Agent": "Mozilla/5.0" };

/** Sem token sao 20 requisicoes por minuto e poucos tickers; com token, tudo. */
const BRAPI = "https://brapi.dev/api/quote";
/** Endpoint dedicado a proventos e eventos corporativos. */
const BRAPI_V2 = "https://brapi.dev/api/v2/stocks/dividends";
/** Secret da funcao. Vai no header, nunca na URL - query string vaza em log de proxy. */
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

type Cotacao = {
  ticker: string; data: string; fechamento: number;
  abertura: number | null; maxima: number | null; minima: number | null; volume: number | null;
};

/**
 * Data local do pregao a partir do timestamp do Yahoo.
 *
 * O timestamp e o instante de ABERTURA em UTC. Somar o gmtoffset antes de cortar a string
 * traz a data como ela e no fuso da bolsa - sem isso, um pregao que abre 10h em Sao Paulo
 * (13h UTC) continua caindo no dia certo, mas qualquer bolsa a leste de Greenwich nao.
 */
function dataLocal(ts: number, gmtoffset: number): string {
  return new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);
}

async function yahoo(ticker: string, desde: string | null) {
  const inicio = desde ? Math.floor(new Date(desde + "T00:00:00Z").getTime() / 1000) : 0;
  const fim = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}${SUFIXO_B3}`
    + `?period1=${inicio}&period2=${fim}&interval=1d&events=div%2Csplit`;

  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status} para ${ticker}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`Yahoo nao conhece o ticker ${ticker}`);

  const meta = res.meta ?? {};
  const off = Number(meta.gmtoffset ?? 0);
  const ts: number[] = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0] ?? {};

  const cotacoes: Cotacao[] = [];
  for (let i = 0; i < ts.length; i++) {
    const fech = q.close?.[i];
    // Dia sem negocio vem como null. Nao inventamos preco aqui: quem preenche buraco e o
    // carry-forward na leitura, e ele marca `provisorio` para a estimativa nao virar oficial.
    if (fech == null) continue;
    cotacoes.push({
      ticker, data: dataLocal(ts[i], off), fechamento: Number(fech),
      abertura: q.open?.[i] ?? null, maxima: q.high?.[i] ?? null,
      minima: q.low?.[i] ?? null, volume: q.volume?.[i] ?? null,
    });
  }

  const divs: Record<string, { amount: number }> = res.events?.dividends ?? {};
  const porDataEx = new Map<string, number>();
  for (const [k, v] of Object.entries(divs)) porDataEx.set(dataLocal(Number(k), off), v.amount);

  // Os splits vinham na resposta e eram jogados fora. Sem eles o fallback grava provento com
  // fator 1 e o motor nao aplica desdobramento nenhum - numa ITSA4, que tem 8, a quantidade
  // sai errada e o provento historico junto.
  const sp: Record<string, { numerator: number; denominator: number }> = res.events?.splits ?? {};
  const splitsYahoo = Object.entries(sp).map(([k, v]) => ({
    ticker,
    // O Yahoo nao diz se foi desdobramento, grupamento ou bonificacao - so a razao. Fator > 1
    // aumenta a quantidade, < 1 reduz; e o que o motor precisa saber.
    tipo: Number(v.numerator) >= Number(v.denominator) ? "DESDOBRAMENTO" : "GRUPAMENTO",
    fator: Number(v.numerator) / Number(v.denominator),
    data_ex: dataLocal(Number(k), off),
    fonte: "yahoo",
  })).filter((e) => Number.isFinite(e.fator) && e.fator > 0);

  return {
    cotacoes,
    splitsYahoo,
    nome: meta.longName || meta.shortName || ticker,
    moeda: meta.currency ?? "BRL",
    bolsa: meta.exchangeName ?? null,
    dividendosYahoo: porDataEx,
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

const soData = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);

async function brapi(ticker: string) {
  const headers: Record<string, string> = { ...UA };
  if (BRAPI_TOKEN) headers.Authorization = `Bearer ${BRAPI_TOKEN}`;

  // Endpoint v2, dedicado a proventos. O v1 (`/api/quote?dividends=true`) devolvia so 3
  // eventos corporativos de ITSA4; segundo a documentacao, o historico completo vem por aqui
  // no plano Pro (o Startup cobre 12 meses). Se o v2 falhar, cai no v1 - a estrutura muda de
  // `results[].data` para `results[].dividendsData`, entao lemos as duas.
  let dd: Record<string, unknown[]> = {};
  let via = "v2";
  const r2 = await fetch(`${BRAPI_V2}?symbols=${ticker}`, { headers });
  if (r2.ok) {
    const j2 = await r2.json();
    dd = (j2?.results?.[0]?.data ?? j2?.results?.[0]?.dividendsData ?? {}) as typeof dd;
  }
  if (!dd || !((dd.cashDividends?.length ?? 0) + (dd.stockDividends?.length ?? 0))) {
    via = "v1";
    const r = await fetch(`${BRAPI}/${ticker}?dividends=true`, { headers });
    if (!r.ok) throw new Error(`BRAPI HTTP ${r.status} para ${ticker} (v2 HTTP ${r2.status})`);
    const j = await r.json();
    dd = (j?.results?.[0]?.dividendsData ?? {}) as typeof dd;
  }

  const proventos = (dd.cashDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    tipo: TIPO_PROVENTO[String(x.label ?? "").toUpperCase().trim()] ?? "OUTRO",
    valor: Number(x.rate),
    // Alguns anuncios antigos vem sem data-ex; `lastDatePrior` e a ultima data COM direito,
    // entao a data-ex e o pregao seguinte. Guardamos lastDatePrior como aproximacao e a
    // marcamos pela fonte, em vez de descartar o provento.
    data_ex: soData(x.exDate as string) ?? soData(x.lastDatePrior as string),
    data_pagamento: soData(x.paymentDate as string),
    fonte: "brapi",
  })).filter((p: { valor: number }) => Number.isFinite(p.valor) && p.valor > 0);

  const eventos = (dd.stockDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    tipo: TIPO_EVENTO[String(x.label ?? "").toUpperCase().trim()] ?? null,
    fator: Number(x.factor),
    data_ex: soData(x.exDate as string) ?? soData(x.lastDatePrior as string),
    fonte: "brapi",
  })).filter((e: { tipo: string | null; fator: number }) => e.tipo && Number.isFinite(e.fator) && e.fator > 0);

  return { proventos, eventos, via };
}

/**
 * Proventos a partir do Yahoo, para quando a BRAPI nao responde.
 *
 * O Yahoo da o total do dia ja AJUSTADO pelos splits posteriores; a tabela guarda o nominal da
 * epoca. Entao multiplicamos de volta pelo fator - sem isso, um provento anterior a um
 * desdobramento 2:1 entraria pela metade e o motor, que ja converte nominal para unidades de
 * hoje, o dividiria de novo.
 *
 * Sem tipo (fica OUTRO) e sem data de pagamento. Nenhum dos dois entra no calculo do P&L.
 */
function proventosDoYahoo(
  ticker: string,
  yahooPorData: Map<string, number>,
  eventos: { fator: number; data_ex: string | null }[],
) {
  const fatorDepoisDe = (data: string) =>
    eventos.reduce((f, e) => (e.data_ex && e.data_ex > data ? f * e.fator : f), 1);
  return [...yahooPorData.entries()].map(([data_ex, valorAjustado]) => ({
    ticker,
    tipo: "OUTRO",
    valor: valorAjustado * fatorDepoisDe(data_ex),
    data_ex,
    data_pagamento: null,
    fonte: "yahoo",
  })).filter((p) => Number.isFinite(p.valor) && p.valor > 0);
}

/**
 * Compara o total por data-ex das duas fontes. Nao corrige nada: relata.
 *
 * As duas usam convencoes DIFERENTES para provento anterior a um desdobramento. O Yahoo
 * ajusta retroativamente (divide pelos splits que vieram depois); a BRAPI da o valor nominal
 * da epoca. Em PETR4 isso aparece como uma razao de exatamente 2,0 em toda a serie anterior
 * a abril/2008, e de 8,0 antes de 2005 - nao e erro de fonte, e convencao.
 *
 * Nos ficamos com o NOMINAL, porque o motor guarda a quantidade real em cada data e aplica os
 * desdobramentos na linha do tempo; o ajustado do Yahoo so fecharia com quantidade tambem
 * ajustada. Entao aqui reajustamos o Yahoo pelo fator acumulado dos splits POSTERIORES a data
 * do provento, e so depois comparamos. Sem isso o comparador vira ruido e ninguem olha mais
 * para ele - que e a pior coisa que pode acontecer com um alarme.
 */
function conferirComYahoo(
  proventos: { valor: number; data_ex: string | null }[],
  yahooPorData: Map<string, number>,
  eventos: { fator: number; data_ex: string | null }[] = [],
) {
  const somaBrapi = new Map<string, number>();
  for (const p of proventos) {
    if (!p.data_ex) continue;
    somaBrapi.set(p.data_ex, (somaBrapi.get(p.data_ex) ?? 0) + p.valor);
  }
  const fatorDepoisDe = (data: string) =>
    eventos.reduce((f, e) => (e.data_ex && e.data_ex > data ? f * e.fator : f), 1);

  const divergencias: { data: string; brapi: number; yahoo_reajustado: number; dif: number }[] = [];
  for (const [data, y] of yahooPorData) {
    const b = somaBrapi.get(data) ?? 0;
    const yy = y * fatorDepoisDe(data);
    const dif = Math.abs(b - yy);
    // Tolerancia relativa: o Yahoo arredonda o ajustado, e reajustar amplifica o arredondamento.
    if (dif > Math.max(0.0005, Math.abs(b) * 0.01)) {
      divergencias.push({ data, brapi: +b.toFixed(6), yahoo_reajustado: +yy.toFixed(6), dif: +dif.toFixed(6) });
    }
  }
  return divergencias.sort((a, b) => a.data.localeCompare(b.data));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // `{ db: { schema } }` nao e detalhe: sem ele o cliente aponta para `public`, as tabelas
  // nao existem la, e o upsert volta com erro que ninguem le - foi o que aconteceu na
  // primeira versao, que reportou 6.697 cotacoes gravadas com o banco vazio.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const pedido = String(body?.ticker ?? "").toUpperCase().trim();

    let alvos: { ticker: string; desde: string | null }[];

    if (pedido) {
      // Cadastro: serie inteira, desde o primeiro pregao que a fonte tiver.
      alvos = [{ ticker: pedido, desde: null }];
    } else {
      const { data: papeis } = await db.from("cadastro_de_acoes")
        .select("ticker").eq("ativo", true);
      if (!papeis?.length) {
        return new Response(JSON.stringify({ ok: true, aviso: "nenhum papel cadastrado" }),
          { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      // Reprocessa a partir de alguns dias antes do ultimo que temos: o Yahoo revisa o
      // fechamento do dia depois do encerramento, e um preco provisorio precisa poder virar
      // oficial no dia seguinte.
      alvos = [];
      for (const p of papeis) {
        const { data: ult } = await db.from("cotacoes_acoes")
          .select("data").eq("ticker", p.ticker).order("data", { ascending: false }).limit(1);
        const base = ult?.[0]?.data as string | undefined;
        const desde = base
          ? new Date(new Date(base + "T00:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10)
          : null;
        alvos.push({ ticker: p.ticker, desde });
      }
    }

    const relatorio: Record<string, unknown>[] = [];

    for (const alvo of alvos) {
      try {
        const y = await yahoo(alvo.ticker, alvo.desde);

        // Todo upsert e conferido: um relatorio que conta o array em memoria em vez do que
        // entrou no banco e pior que nenhum relatorio - ele afirma sucesso e some com o erro.
        const exigir = (etapa: string, error: { message: string } | null) => {
          if (error) throw new Error(`${etapa}: ${error.message}`);
        };

        if (pedido) {
          exigir("cadastro_de_acoes", (await db.from("cadastro_de_acoes").upsert(
            { ticker: alvo.ticker, nome: y.nome, moeda: y.moeda, bolsa: y.bolsa, ativo: true },
            { onConflict: "ticker" },
          )).error);
        }

        // Lotes: 6.697 pregoes de PETR4 num payload so estouram o limite do PostgREST.
        const LOTE = 1000;
        for (let i = 0; i < y.cotacoes.length; i += LOTE) {
          exigir("cotacoes_acoes", (await db.from("cotacoes_acoes").upsert(
            y.cotacoes.slice(i, i + LOTE).map((c) => ({ ...c, provisorio: false })),
            { onConflict: "ticker,data" },
          )).error);
        }

        // EVENTO CORPORATIVO vem sempre do Yahoo - ver o cabecalho: mais completo e com a
        // data-ex correta. Nao depende de a BRAPI responder.
        const eventos = y.splitsYahoo;

        // PROVENTO: a BRAPI e a preferida (tipo + data de pagamento). Se ela falhar, vem do
        // Yahoo - melhor uma carteira certa sem o rotulo do que uma carteira sem provento.
        let proventos: Record<string, unknown>[];
        let fonteProvento = "brapi";
        let diagnosticoBrapi = "";
        try {
          const rb = await brapi(alvo.ticker);
          proventos = rb.proventos;
          // Medicao, nao uso: quantos eventos a BRAPI conhece por este endpoint, para decidir
          // com dado se ela pode substituir o Yahoo como fonte de evento corporativo.
          diagnosticoBrapi = `${rb.via}: ${rb.proventos.length} proventos, ${rb.eventos.length} eventos`;
        } catch (eBrapi) {
          fonteProvento = `yahoo (brapi falhou: ${eBrapi instanceof Error ? eBrapi.message : eBrapi})`;
          proventos = proventosDoYahoo(alvo.ticker, y.dividendosYahoo, eventos);
        }
        const b = { proventos, eventos };

        // UMA fonte por ticker, sempre.
        //
        // O indice unico inclui o `tipo`, e o Yahoo grava OUTRO onde a BRAPI grava JCP: para o
        // banco sao linhas diferentes, mas e o MESMO dinheiro. Deixar as duas conviverem faz o
        // motor somar o provento duas vezes - medido em ITSA4, onde 2026-03-20 apareceu como
        // `yahoo/OUTRO=0,116` e `brapi/JCP=0,116` lado a lado.
        //
        // Por isso, ao gravar de uma fonte, os registros da outra saem. Roda ANTES do insert
        // para nao existir um instante com as duas no banco.
        const fonteAtual = fonteProvento.startsWith("yahoo") ? "yahoo" : "brapi";
        exigir("limpeza de proventos da outra fonte", (await db.from("proventos_acoes")
          .delete().eq("ticker", alvo.ticker).neq("fonte", fonteAtual)).error);
        // Evento e sempre do Yahoo: o que veio da BRAPI em cargas anteriores sai, senao a
        // mesma bonificacao fica duas vezes (em datas com um dia de diferenca) e o motor
        // multiplica a quantidade duas vezes.
        exigir("limpeza de eventos da BRAPI", (await db.from("eventos_corporativos_acoes")
          .delete().eq("ticker", alvo.ticker).neq("fonte", "yahoo")).error);

        if (b.proventos.length) {
          exigir("proventos_acoes", (await db.from("proventos_acoes").upsert(b.proventos, {
            onConflict: "ticker,tipo,valor,data_ex,data_pagamento", ignoreDuplicates: true,
          })).error);
        }
        if (b.eventos.length) {
          exigir("eventos_corporativos_acoes", (await db.from("eventos_corporativos_acoes").upsert(b.eventos, {
            onConflict: "ticker,tipo,fator,data_ex", ignoreDuplicates: true,
          })).error);
        }

        // Conferencia final contra o BANCO, nao contra o array que acabamos de montar.
        const { count: gravadas } = await db.from("cotacoes_acoes")
          .select("*", { count: "exact", head: true }).eq("ticker", alvo.ticker);
        const { count: gravProv } = await db.from("proventos_acoes")
          .select("*", { count: "exact", head: true }).eq("ticker", alvo.ticker);
        const { count: gravEvt } = await db.from("eventos_corporativos_acoes")
          .select("*", { count: "exact", head: true }).eq("ticker", alvo.ticker);

        relatorio.push({
          ticker: alvo.ticker,
          nome: y.nome,
          cotacoes_lidas: y.cotacoes.length,
          cotacoes_no_banco: gravadas ?? null,
          primeira: y.cotacoes[0]?.data ?? null,
          ultima: y.cotacoes.at(-1)?.data ?? null,
          fonte_do_provento: fonteProvento,
          brapi_diagnostico: diagnosticoBrapi || "n/a",
          proventos_lidos: b.proventos.length,
          proventos_no_banco: gravProv ?? null,
          // Se estes dois divergirem, sobrou registro de outra fonte ou de outra carga - foi
          // assim que a duplicacao de ITSA4 apareceu.
          confere: b.proventos.length === (gravProv ?? -1) ? "ok" : "ATENCAO: lido != gravado",
          eventos_lidos: b.eventos.length,
          eventos_no_banco: gravEvt ?? null,
          divergencias_brapi_x_yahoo: fonteProvento === "brapi"
            ? conferirComYahoo(b.proventos as never, y.dividendosYahoo, b.eventos as never)
            : "n/a - provento veio do proprio Yahoo",
        });
      } catch (e) {
        relatorio.push({ ticker: alvo.ticker, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, relatorio }, null, 2),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
