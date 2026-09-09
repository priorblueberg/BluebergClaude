// Auditoria de proventos: cruza BRAPI, Yahoo e B3 e lista onde elas discordam.
//
//   POST { }                      audita todos os papeis ativos
//   POST { ticker: "PETR4" }      audita um
//   POST { desde: "2022-01-01" }  muda a janela (padrao: 2022-01-01)
//
// NAO GRAVA NADA. So relata. Essa e a decisao central desta funcao: uma auditoria que corrige
// sozinha esconde o problema que deveria expor, e "corrigir" aqui significaria eleger uma fonte
// como verdade - o que a medicao abaixo mostra ser errado.
//
// ── Por que tres fontes, e por que nenhuma manda ────────────────────────────────────────────
//
// Medido em 08/09/2026, em tres papeis. As duas fontes principais tem furo, em lugares
// diferentes:
//
//   KLBN11 16/12/2025  a Klabin declarou R$ 0,91/unit em 4 parcelas. A BRAPI tinha UMA.
//   PETR4  22/11/2022  temos 4 parcelas somando 3,34890. O YAHOO tem 1,748708 - falta a
//                      parcela de 1,600192 nele. Aqui nos estamos certos.
//   ITSA4  05/03/2025  o Yahoo tem exatamente o DOBRO do nosso. Falta parcela nossa.
//
// A propria IA da brapi confirmou que isso e estrutural, nao bug de um papel: "publica cada
// parcela paga (...) nao projeta o calendario futuro anunciado no fato relevante (...) a
// disponibilidade varia por ativo". Ou seja: nao existe fonte completa. O que tem valor e a
// DIVERGENCIA entre elas.
//
// Cada fonte entra pelo que sabe melhor:
//
//   BRAPI  historico longo, parcela a parcela, com data de pagamento. E a nossa base.
//   Yahoo  UMA linha por data-ex, com o TOTAL. E o detector: comparar a soma das nossas
//          parcelas com o total dele acha buraco sem precisar saber quantas deveriam existir.
//   B3     janela curta e recente, mas com o calendario DECLARADO - inclusive parcelas ainda
//          nao pagas, que e exatamente o que falta na BRAPI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = { "User-Agent": "Mozilla/5.0" };
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

const soData = (s: unknown) => (s ? String(s).slice(0, 10) : null);
const dias = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/** Tolerancias. A de data existe porque as fontes divergem em ate 2 dias na data-ex do mesmo
 *  provento; a de valor absorve arredondamento de casas decimais entre elas.
 *
 *  O piso absoluto e MINUSCULO de proposito. A primeira versao usava meio centavo por acao
 *  (0,005) e isso engoliu divergencia real: ITSA4 tinha 14 datas-ex divergindo -0,9% e a
 *  auditoria mostrou 2, porque os proventos dele sao de 0,02/acao e a diferenca ficava em
 *  0,0002 - abaixo do piso. **Tolerancia generosa numa auditoria e pior que auditoria nenhuma**,
 *  porque devolve "esta tudo certo" sobre um dado que nao foi conferido. O piso serve so para
 *  ruido de arredondamento na ultima casa; quem manda e o relativo. */
const TOL_DIAS = 3;
const TOL_REL = 0.005;   // 0,5%
const TOL_ABS = 0.00001; // so arredondamento de casa decimal

async function pegaJson(url: string, comToken = false) {
  const h: Record<string, string> = { ...UA };
  if (comToken && BRAPI_TOKEN) h.Authorization = `Bearer ${BRAPI_TOKEN}`;
  const r = await fetch(url, { headers: h });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.split("?")[0]}`);
  return await r.json();
}

/** BRAPI: parcela a parcela. */
async function daBrapi(ticker: string) {
  const j = await pegaJson(`https://brapi.dev/api/v2/stocks/dividends?symbols=${ticker}`, true);
  const dd = j?.results?.[0]?.data ?? {};
  return ((dd.cashDividends ?? []) as Record<string, unknown>[]).map((x) => ({
    data_ex: soData(x.exDate) ?? soData(x.lastDatePrior),
    valor: Number(x.rate),
    pagamento: soData(x.paymentDate),
  })).filter((p) => p.data_ex && Number.isFinite(p.valor) && p.valor > 0);
}

/** Yahoo: UMA linha por data-ex com o total - e AJUSTADA pelos eventos posteriores.
 *
 *  O ajuste precisa ser desfeito antes de comparar, multiplicando de volta pelo fator dos
 *  eventos com data-ex posterior. Sem isso, todo papel com bonificacao no periodo apareceria
 *  divergente - e a divergencia seria a nossa conta, nao o dado. */
async function doYahoo(ticker: string) {
  const j = await pegaJson(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA`
    + "?period1=1609459200&period2=2000000000&interval=1d&events=div");
  const ev = (j?.chart?.result?.[0]?.events?.dividends ?? {}) as Record<string, { amount: number }>;
  const porData = new Map<string, number>();
  for (const k of Object.keys(ev)) {
    const d = new Date(Number(k) * 1000).toISOString().slice(0, 10);
    porData.set(d, (porData.get(d) ?? 0) + Number(ev[k].amount));
  }
  return porData;
}

/** B3: o calendario declarado, filtrado pelo ISIN EXATO do papel.
 *
 *  Filtrar por ISIN, e nao por empresa, evita uma armadilha: a B3 publica por CLASSE (ON, PN),
 *  com `rate` por ACAO. Uma unit e composta de varias acoes (KLBN11 = 1 ON + 4 PN), entao casar
 *  valores exigiria conhecer a composicao de cada unit. Em vez de inventar essa conversao, esta
 *  funcao devolve vazio quando a B3 nao publica para aquele ISIN, e a auditoria diz que nao
 *  cobre - honesto e verificavel.
 *
 *  O emissor sai dos caracteres 3 a 6 do ISIN (BRPETRACNPR6 -> PETR). Isso e a estrutura do
 *  ISIN brasileiro, nao um palpite sobre o formato do ticker. */
async function daB3(isin: string) {
  const emissor = isin.slice(2, 6);
  const p = btoa(JSON.stringify({ issuingCompany: emissor, language: "pt-br" }));
  const j = await pegaJson("https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy"
    + `/CompanyCall/GetListedSupplementCompany/${p}`);
  const d = Array.isArray(j) ? j[0] : j;
  const br = (s: unknown) => { // "15/12/2025" -> "2025-12-15"
    const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  return ((d?.cashDividends ?? []) as Record<string, unknown>[])
    .filter((x) => String(x.isinCode ?? x.assetIssued ?? "") === isin)
    .map((x) => ({
      data_ex: br(x.lastDatePrior),
      valor: Number(String(x.rate ?? "").replace(",", ".")),
      pagamento: br(x.paymentDate),
    }))
    .filter((x) => x.data_ex);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const um = String(body?.ticker ?? "").toUpperCase().trim();
    const desde = String(body?.desde ?? "2022-01-01");
    const hoje = new Date().toISOString().slice(0, 10);

    const { data: papeis } = await db.from("cadastro_de_acoes")
      .select("ticker, isin").eq("ativo", true);
    const alvos = (papeis ?? []).filter((p: { ticker: string }) => !um || p.ticker === um);
    if (!alvos.length) {
      return new Response(JSON.stringify({ ok: true, aviso: "nenhum papel a auditar" }, null, 2),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const relatorio: Record<string, unknown>[] = [];

    for (const papel of alvos) {
      const ticker = papel.ticker as string;
      const isin = (papel.isin ?? null) as string | null;
      try {
        // A NOSSA base e o que esta GRAVADO, nao o que a fonte devolve agora - inclui o que foi
        // cadastrado a mao, que e justamente o que uma auditoria contra a fonte nao enxergaria.
        const { data: nossos } = await db.from("proventos_acoes")
          .select("data_ex, valor, data_pagamento, fonte")
          .eq("ticker", ticker).gte("data_ex", desde);
        const { data: eventos } = await db.from("eventos_corporativos_acoes")
          .select("data_ex, fator").eq("ticker", ticker);

        const fatorDesde = (d: string) => (eventos ?? []).reduce(
          (f: number, e: Record<string, unknown>) =>
            String(e.data_ex) > d ? f * Number(e.fator) : f, 1);

        const porDataNossa = new Map<string, { total: number; parcelas: number; manuais: number }>();
        for (const p of (nossos ?? []) as Record<string, unknown>[]) {
          const k = String(p.data_ex);
          const a = porDataNossa.get(k) ?? { total: 0, parcelas: 0, manuais: 0 };
          a.total += Number(p.valor);
          a.parcelas++;
          if (p.fonte === "manual") a.manuais++;
          porDataNossa.set(k, a);
        }

        const [brapi, yahoo, b3] = await Promise.all([
          daBrapi(ticker).catch(() => null),
          doYahoo(ticker).catch(() => null),
          isin ? daB3(isin).catch(() => null) : Promise.resolve(null),
        ]);

        const achados: Record<string, unknown>[] = [];

        // ── 1. valor: soma das nossas parcelas x total do Yahoo na mesma data-ex ────────────
        if (yahoo) {
          const usadas = new Set<string>();
          for (const [dataEx, nossa] of [...porDataNossa].sort()) {
            const cand = [...yahoo.keys()]
              .filter((y) => !usadas.has(y) && dias(y, dataEx) <= TOL_DIAS);
            if (!cand.length) {
              // Data-ex no futuro sem par no Yahoo e o esperado, nao um achado: ele publica o
              // provento quando ele ocorre, e nos ja temos o declarado. Marcado como esperado
              // para nao virar ruido permanente na lista.
              achados.push({
                tipo: "so_em_nos", data_ex: dataEx, nosso: +nossa.total.toFixed(8),
                esperado: dataEx > hoje,
                nota: dataEx > hoje
                  ? "data-ex futura: normal o Yahoo ainda nao ter"
                  : "data-ex que temos e o Yahoo nao tem",
              });
              continue;
            }
            cand.forEach((c) => usadas.add(c));
            const bruto = cand.reduce((s, c) => s + (yahoo.get(c) ?? 0), 0) * fatorDesde(dataEx);
            const dif = bruto - nossa.total;
            if (Math.abs(dif) > Math.max(TOL_ABS, TOL_REL * nossa.total)) {
              achados.push({
                tipo: dif > 0 ? "falta_em_nos" : "sobra_em_nos",
                data_ex: dataEx,
                nosso: +nossa.total.toFixed(8),
                yahoo: +bruto.toFixed(8),
                diferenca: +dif.toFixed(8),
                parcelas_nossas: nossa.parcelas,
                nota: dif > 0
                  ? "o Yahoo tem mais - provavel parcela faltando na nossa base"
                  : "temos mais que o Yahoo - pode ser furo DELE (ja aconteceu em PETR4)",
              });
            }
          }
          for (const y of [...yahoo.keys()].sort()) {
            if (y >= desde && !usadas.has(y)) {
              achados.push({
                tipo: "so_no_yahoo", data_ex: y, yahoo: +(yahoo.get(y) ?? 0).toFixed(8),
                nota: "data-ex do Yahoo sem correspondente nosso",
              });
            }
          }
        }

        // ── 2. contagem: parcelas declaradas na B3 x parcelas que temos ─────────────────────
        // Aqui a comparacao e por CONTAGEM, nao por valor: a B3 publica por classe e em rate
        // por acao, entao o valor so casaria com conversao. Contar parcelas na mesma data-ex ja
        // pega o caso que motivou tudo isto (KLBN11: 4 declaradas, 1 na base).
        if (b3 && b3.length) {
          const porDataB3 = new Map<string, number>();
          for (const p of b3) {
            const k = String(p.data_ex);
            porDataB3.set(k, (porDataB3.get(k) ?? 0) + 1);
          }
          for (const [dataEx, qtdB3] of [...porDataB3].sort()) {
            if (dataEx < desde) continue;
            const casada = [...porDataNossa.keys()].find((d) => dias(d, dataEx) <= TOL_DIAS);
            const nossas = casada ? porDataNossa.get(casada)!.parcelas : 0;
            if (nossas < qtdB3) {
              achados.push({
                tipo: "parcelas_faltando", data_ex: dataEx,
                declaradas_b3: qtdB3, na_nossa_base: nossas,
                pagamentos_b3: b3.filter((x) => x.data_ex === dataEx).map((x) => x.pagamento).sort(),
                nota: "a B3 declara mais parcelas do que temos gravadas",
              });
            }
          }
        }

        relatorio.push({
          ticker,
          isin,
          fontes: {
            brapi: brapi ? `${brapi.length} parcelas` : "FALHOU",
            yahoo: yahoo ? `${yahoo.size} datas-ex` : "FALHOU",
            b3: !isin
              ? "sem ISIN cadastrado"
              : b3 === null
              ? "FALHOU"
              : b3.length
              ? `${b3.length} parcelas declaradas`
              : "nao cobre este ISIN (unit nao aparece: a B3 publica por classe)",
          },
          datas_ex_auditadas: porDataNossa.size,
          // O contador ignora o que ja foi classificado como esperado: um numero que sobe por
          // causa de provento futuro treina quem le a ignorar o numero.
          divergencias: achados.filter((a) => !a.esperado).length,
          achados,
        });
      } catch (e) {
        relatorio.push({ ticker, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    const total = relatorio.reduce((s, r) => s + (Number(r.divergencias) || 0), 0);
    return new Response(JSON.stringify({
      ok: true, janela: `${desde} em diante`, divergencias_no_total: total, relatorio,
    }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
