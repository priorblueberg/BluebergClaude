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

/** Quantas datas precisam concordar na mesma razao para que ela seja tratada como FATOR, e nao
 *  como coincidencia. Tres e o minimo que distingue padrao de acaso. */
const MIN_PARA_FATOR = 3;

/** Quanto a diferenca pode se mexer sem que um descarte deixe de valer. Apertado de proposito:
 *  o descarte foi decidido sobre um numero especifico, e numero diferente e caso diferente. */
const TOL_DESCARTE = 0.0001;

const mediana = (xs: number[]) => {
  if (!xs.length) return 1;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

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

        // Achados ja investigados e descartados para este papel. Ver a tabela para o porque
        // de cada um - e para a trava que faz o descarte expirar se o numero mudar.
        const { data: descartesDoPapel } = await db.from("auditoria_descartes")
          .select("data_ex, tipo, diferenca, motivo, evidencia, descartado_em")
          .eq("ticker", ticker);
        const descartes = new Map<string, Record<string, unknown>>();
        for (const d of (descartesDoPapel ?? []) as Record<string, unknown>[]) {
          descartes.set(`${d.data_ex}|${d.tipo}`, d);
        }

        const [brapi, yahoo, b3] = await Promise.all([
          daBrapi(ticker).catch(() => null),
          doYahoo(ticker).catch(() => null),
          isin ? daB3(isin).catch(() => null) : Promise.resolve(null),
        ]);

        const achados: Record<string, unknown>[] = [];

        // ── 1. valor: soma das nossas parcelas x total do Yahoo na mesma data-ex ────────────
        // O PAREAMENTO acontece antes de qualquer julgamento, porque duas correcoes so sao
        // possiveis olhando o conjunto - e nenhuma delas e "afrouxar a tolerancia".
        //
        // Afrouxar seria o remedio errado. A tolerancia ja foi generosa uma vez, em 08/09/2026,
        // e escondeu 12 das 14 divergencias reais de ITSA4. O que se faz aqui e RETIRAR a parte
        // sistematica e manter a resolucao fina sobre o que sobra.
        const pares: { dataEx: string; nossa: { total: number; parcelas: number; manuais: number }; bruto: number }[] = [];
        /** Os grupos de razao formados. Exposto de proposito: e o que explica por que
  *  certas datas foram normalizadas em vez de acusadas. */
        let diagGrupos: unknown = null;

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
            pares.push({ dataEx, nossa, bruto });
          }
          for (const y of [...yahoo.keys()].sort()) {
            if (y >= desde && !usadas.has(y)) {
              achados.push({
                tipo: "so_no_yahoo", data_ex: y, yahoo: +(yahoo.get(y) ?? 0).toFixed(8),
                nota: "data-ex do Yahoo sem correspondente nosso",
              });
            }
          }

          // ── O que e FATOR e o que e BURACO ──────────────────────────────────────────────
          //
          // O Yahoo entrega o provento AJUSTADO pelos eventos posteriores, e desfazemos esse
          // ajuste com os NOSSOS fatores. Quando o fator implicito dele difere do nosso, as
          // datas erram pela MESMA razao - e a auditoria acusava uma divergencia por data,
          // afogando as reais.
          //
          // Medido em ITSA4 em 09/09/2026, isolando evento a evento:
          //
          //   evento        nosso fator   fator implicito do Yahoo
          //   19/12/2025    1,02          1,020000     (identico)
          //   03/12/2024    1,05          1,054618
          //   28/11/2023    1,05          1,054450
          //
          // Nenhum dos dois esta errado: sao fatores de coisas diferentes. O nosso e de
          // QUANTIDADE (5 acoes por 100, que e contratual); o dele e de PRECO, que precisa
          // incluir tambem as subscricoes do aumento de capital.
          //
          // O RESIDUO E UM DEGRAU, NAO UMA CONSTANTE, e essa e a parte que erra quem tenta
          // corrigir com uma normalizacao global: cada evento acrescenta a sua discrepancia,
          // entao as datas anteriores a 2023 erram por 1,0087, as de 2024 por 1,0044 e as de
          // 2025 por nada. Uma mediana unica cai no meio do degrau e nao detecta nada - foi o
          // que aconteceu na primeira versao desta correcao.
          //
          // Por isso: AGRUPAR as razoes. Grupo com pelo menos MIN_PARA_FATOR datas na mesma
          // razao e fator; data que destoa do grupo continua sendo divergencia, com a mesma
          // resolucao de antes. E o oposto de afrouxar a tolerancia - que ja foi tentado em
          // 08/09/2026 e escondeu 12 das 14 divergencias reais deste mesmo papel.
          const comRazao = pares.filter((p) => p.bruto > 0 && p.nossa.total > 0)
            .map((p) => ({ ...p, razao: p.nossa.total / p.bruto }))
            .sort((a, b) => a.razao - b.razao);

          // O agrupamento compara com o PRIMEIRO elemento do grupo, nao com a mediana corrente.
          //
          // Isso nao e detalhe: com a mediana, o grupo cresce e a referencia sobe junto, entao
          // uma sequencia densa vai sendo encadeada indefinidamente. Foi o que aconteceu na
          // primeira tentativa, em 09/09/2026 - as razoes de ITSA4 iam de 1,0000 a 1,0087 em
          // passos menores que a tolerancia, e as 41 datas viraram UM grupo de mediana 1,0044.
          // Como 0,44% fica abaixo da tolerancia, nada foi tratado como fator e as 13 datas
          // continuaram aparecendo uma a uma - exatamente o que esta correcao existe para
          // resolver.
          //
          // Ancorando no primeiro, a largura do grupo nunca passa de TOL_REL.
          const grupos: { razao: number; datas: string[]; razoes: number[] }[] = [];
          for (const p of comRazao) {
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && Math.abs(p.razao / ultimo.razoes[0] - 1) <= TOL_REL) {
              ultimo.datas.push(p.dataEx);
              ultimo.razoes.push(p.razao);
              ultimo.razao = mediana(ultimo.razoes);
            } else {
              grupos.push({ razao: p.razao, datas: [p.dataEx], razoes: [p.razao] });
            }
          }

          // Fator aplicado a cada data: o do seu grupo, quando o grupo e grande o bastante e
          // destoa de 1. Nas demais, 1 - ou seja, nada muda.
          diagGrupos = grupos.map((g) => ({ razao: +g.razao.toFixed(6), n: g.datas.length }));
          const fatorDaData = new Map<string, number>();
          // O que identifica um fator e a CONSISTENCIA entre muitas datas, nao a distancia
          // dele para 1. Um grupo de 26 datas na mesma razao exata e um fator ainda que a razao
          // seja 1,0044 - e em ITSA4 ela e: e a discrepancia da bonificacao de 03/12/2024, onde
          // o Yahoo usa 1,054618 e nos usamos 1,05.
          //
          // Exigir distancia maior que a tolerancia deixava esse degrau de fora, e ele reaparecia
          // como 0,0042 de diferenca sem explicacao na reconciliacao.
          //
          // O risco assumido: se varias datas tivessem o MESMO erro real, ele seria normalizado
          // junto. Por isso a linha de fator e sempre reportada, com quantas datas ela cobre -
          // para que a normalizacao seja visivel e questionavel, nao silenciosa.
          for (const g of grupos) {
            const ehFator = g.datas.length >= MIN_PARA_FATOR;
            for (const d of g.datas) fatorDaData.set(d, ehFator ? g.razao : 1);
            if (ehFator && Math.abs(g.razao - 1) > 1e-4) {
              achados.push({
                tipo: "fator_divergente",
                esperado: true,
                razao: +g.razao.toFixed(6),
                datas_no_grupo: g.datas.length,
                de: g.datas.slice().sort()[0],
                ate: g.datas.slice().sort()[g.datas.length - 1],
                nota: `${g.datas.length} datas com a MESMA razao entre nos e o Yahoo. Nao e `
                    + "provento faltando: o nosso fator e de quantidade, o dele de preco "
                    + "(inclui subscricao). Estas datas ja estao normalizadas por esta razao.",
              });
            }
          }

          for (const { dataEx, nossa, bruto } of pares) {
            const esperado = bruto * (fatorDaData.get(dataEx) ?? 1);
            const dif = esperado - nossa.total;
            if (Math.abs(dif) > Math.max(TOL_ABS, TOL_REL * nossa.total)) {
              achados.push({
                tipo: dif > 0 ? "falta_em_nos" : "sobra_em_nos",
                data_ex: dataEx,
                nosso: +nossa.total.toFixed(8),
                yahoo: +esperado.toFixed(8),
                diferenca: +dif.toFixed(8),
                parcelas_nossas: nossa.parcelas,
                nota: dif > 0
                  ? "o Yahoo tem mais - provavel parcela faltando na nossa base"
                  : "temos mais que o Yahoo - pode ser furo DELE (ja aconteceu em PETR4)",
              });
            }
          }

          // ── Reconciliacao do total ──────────────────────────────────────────────────────
          //
          // Responde "esta faltando dinheiro?" antes de "em que data?", e essa e a pergunta que
          // importa. As duas fontes podem ATRIBUIR o mesmo dinheiro a datas diferentes sem que
          // nada esteja faltando.
          //
          // O caso concreto e a PETR4: ela arquiva a correcao pela Selic sob data-ex PROPRIA (as
          // linhas RENDIMENTO de abril, todo ano), enquanto o Yahoo a devolve para a data-ex
          // original da declaracao. Por data aparecem "faltas" de 1 a 2%; a soma da janela diz
          // se falta dinheiro de verdade. Discutivelmente o nosso esta mais certo - a correcao
          // e um evento proprio, com data-ex propria.
          //
          // A soma percorre TUDO na janela, nao so as datas pareadas: somar so o que casou
          // deixaria de fora justamente a data da correcao, que e o que se quer explicar. E
          // data-ex futura fica de fora dos dois lados - nos ja temos o declarado, e o Yahoo so
          // publica quando ocorre.
          // A soma do lado do Yahoo sai dos PARES, nao das datas dele.
          //
          // O pareamento tolera ate TOL_DIAS de diferenca entre as duas fontes, e o fator esta
          // indexado pela data NOSSA. Percorrer as datas do Yahoo faria a normalizacao escapar
          // justamente nos pares em que as datas nao coincidem - e o total voltaria a nao
          // fechar, por um motivo que nao tem nada a ver com provento faltando.
          //
          // As datas do Yahoo que nao paream entram sem fator: nao ha par de onde tira-lo, e
          // elas ja aparecem na lista como `so_no_yahoo`.
          let totalNosso = 0;
          for (const [d, a] of porDataNossa) if (d <= hoje) totalNosso += a.total;

          let totalYahoo = 0;
          for (const { dataEx, bruto } of pares) {
            if (dataEx > hoje) continue;
            totalYahoo += bruto * (fatorDaData.get(dataEx) ?? 1);
          }
          for (const [d, v] of yahoo) {
            if (d < desde || d > hoje || usadas.has(d)) continue;
            totalYahoo += v * fatorDesde(d);
          }

          // O veredito NAO e "bate / nao bate", e sim "a lista explica o total?".
          //
          // A diferenca importa: um teto de 0,5% sobre a soma da janela e frouxo demais para
          // uma parcela pequena. Em ITSA4 a diferenca total ficou em 0,0193 contra um teto de
          // 0,0196 - "bateria" por 3 milesimos, com uma parcela faltando de verdade. Dizer
          // "esta tudo certo" ali seria repetir, na conta do total, o mesmo erro da tolerancia
          // generosa que ja escondeu 12 divergencias deste papel em 08/09/2026.
          //
          // Entao compara-se o total com a SOMA DO QUE FOI LISTADO. Se batem, a lista da conta
          // do buraco. Se o total e maior, ha algo que nao esta na lista - e e ai que se olha.
          const difTotal = totalYahoo - totalNosso;
          const somaListada = achados
            .filter((a) => a.tipo === "falta_em_nos" || a.tipo === "sobra_em_nos")
            .reduce((acc, a) => acc + Number(a.diferenca ?? 0), 0);
          const sobra = difTotal - somaListada;
          // O resto e comparado com o TOTAL, nao com a diferenca.
          //
          // Ele nao e uma unica sobra: e a soma dos residuos de todas as datas que ficaram
          // ABAIXO da tolerancia individual e por isso nao entraram na lista. Cada um e menor
          // que TOL_REL do seu valor, entao a soma e limitada por TOL_REL do total - essa e a
          // escala certa. Em ITSA4 sao 0,0089 sobre 3,93, ou 0,23%: ruido da aproximacao pela
          // mediana, nao dinheiro.
          //
          // E continua apertado onde importa: uma parcela faltando de verdade aparece na lista e
          // e SUBTRAIDA antes deste teste, entao ela nao se esconde aqui.
          const explicado = Math.abs(sobra) <= Math.max(TOL_ABS, TOL_REL * Math.max(totalNosso, 1e-9));

          achados.push({
            tipo: "reconciliacao",
            esperado: explicado,
            nosso: +totalNosso.toFixed(8),
            yahoo: +totalYahoo.toFixed(8),
            diferenca_total: +difTotal.toFixed(8),
            soma_das_datas_listadas: +somaListada.toFixed(8),
            nao_explicado: +sobra.toFixed(8),
            nota: explicado
              ? "as datas listadas explicam a diferenca total da janela"
              : "a diferenca total NAO e explicada pelas datas listadas - ha algo fora da lista",
          });
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

        // ── Aplicacao dos descartes ────────────────────────────────────────────────────
        //
        // O achado descartado SAI DA CONTAGEM mas NAO some: vai para uma secao propria, com o
        // motivo e a evidencia. Sumir seria supressao silenciosa - o mesmo erro da tolerancia
        // generosa, com outro nome.
        //
        // E o descarte so vale se o NUMERO continuar o mesmo. Mudou, ele volta a ser divergencia
        // viva e o relatorio diz que o descarte caducou: o que foi investigado foi aquele caso,
        // com aquele valor, e nao a data.
        const vivos: Record<string, unknown>[] = [];
        const descartados: Record<string, unknown>[] = [];

        for (const a of achados) {
          const d = descartes.get(`${a.data_ex}|${a.tipo}`);
          if (!d) { vivos.push(a); continue; }

          const antes = d.diferenca === null || d.diferenca === undefined ? null : Number(d.diferenca);
          const agora = a.diferenca === undefined ? null : Number(a.diferenca);
          const mesmoNumero = antes === null || agora === null
            ? antes === agora
            : Math.abs(agora - antes) <= TOL_DESCARTE;

          if (mesmoNumero) {
            descartados.push({ ...a, motivo: d.motivo, evidencia: d.evidencia, descartado_em: d.descartado_em });
          } else {
            vivos.push({
              ...a,
              descarte_caducou: true,
              diferenca_no_descarte: antes,
              nota: `havia um descarte para esta data (${d.motivo}), mas a diferenca mudou de `
                  + `${antes} para ${agora}. O descarte nao vale mais - e outro caso.`,
            });
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
          grupos_de_razao: diagGrupos,
          // O contador ignora o que ja foi classificado como esperado: um numero que sobe por
          // causa de provento futuro treina quem le a ignorar o numero.
          divergencias: vivos.filter((a) => !a.esperado).length,
          achados: vivos,
          // Visiveis de proposito, fora da contagem. Quem le precisa poder discordar do descarte.
          descartados,
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
