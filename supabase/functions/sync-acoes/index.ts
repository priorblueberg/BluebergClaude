// Precos, proventos e eventos corporativos de acoes. Fonte unica: BRAPI.
//
//   POST { ticker: "PETR4" }     cadastra o papel: serie desde 02/01/2023, proventos e eventos
//   POST { modo: "intradiario" } de hora em hora no pregao: so a barra de hoje, provisoria
//   POST { modo: "fechamento" }  apos o fechamento: janela de 1 mes, oficial
//   POST { }                     recarga completa de todos os papeis sincronizados
//
// ── Por que quatro caminhos e nao um ────────────────────────────────────────────────────────
//
// Cadastrar um papel e mante-lo em dia PARECEM a mesma operacao com janelas diferentes, e ate
// 08/09/2026 eram: uma rotina so, que apagava a serie inteira e regravava, gastando 4 a 5
// chamadas por papel.
//
// O que quebrou a equivalencia foi o catalogo. Desde 08/09/2026 o `cadastro_de_acoes` guarda os
// ~2.332 papeis da B3 para que a busca da boleta ache qualquer um pelo nome, e a serie de preco
// e carregada SOB DEMANDA - `sincronizar_cotacoes` marca quem ja passou por isso. Manter N
// papeis com o caminho de cadastro seria 4,5N chamadas e um `range=max` por papel por dia: com
// 2.332, ~10.500 chamadas e 35 minutos de execucao, que a edge function nao aguenta.
//
// Entao a MANUTENCAO virou lote (20 tickers por chamada, o teto do plano Pro) com janela curta,
// e o CADASTRO continuou por papel. A recarga completa sem `modo` ficou como esta, para forcar
// um reprocessamento quando for preciso.
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
// Ressalva medida em 08/09/2026, ao cadastrar KLBN11: "a BRAPI vem nominal" vale por PAPEL e
// por EPOCA, nao por fonte - e nem PETR4 escapa, nos eventos anteriores a 2008. Quando a serie
// ja embute o evento, ele fica marcado com `ja_refletido_no_preco` em `eventos_de_ativos`.
//
// ── A janela de excecao ─────────────────────────────────────────────────────────────────────
//
// A cobertura da BRAPI tem furos nos dois campos, e eles entram a mao com `fonte = 'manual'`:
//
//   stockDividends  ITSA4 nao tem a bonificacao de 11/11/2022 (1,10), KLBN11 nao tem a de
//                   07/05/2024 (1,10).
//   cashDividends   provento parcelado pode vir INCOMPLETO. Em KLBN11 havia 1 das 4 parcelas
//                   do dividendo de 16/12/2025.
//
// Sobre o segundo caso, a resposta da propria IA da brapi em 08/09/2026 (vale a pena guardar,
// porque muda o que se pode esperar da fonte):
//
//   "Nao e falha isolada de KLBN11. /api/v2/stocks/dividends publica cada parcela paga como um
//    item em data.cashDividends, ele nao projeta o calendario futuro anunciado no fato
//    relevante. Os dados vem de fontes abertas e publicas, como documentos da CVM (...), e a
//    disponibilidade varia por ativo. (...) cadastre as parcelas manualmente a partir do fato
//    relevante e reconsulte o endpoint depois. Quando as parcelas entram na cobertura, rate,
//    paymentDate, exDate e approvedOn refletem o valor declarado, mas o fato relevante
//    continua como fonte autoritativa."
//
// Ou seja: parcela faltando NAO e bug de um papel, e o comportamento normal da fonte, e o
// remedio que eles mesmos indicam e o cadastro manual. Nao vale so para KLBN11 - qualquer papel
// com provento parcelado pode estar incompleto, e isso NAO aparece na tela: a posicao continua
// certa e so a rentabilidade fica menor do que devia.
//
// O sync NUNCA apaga o que e manual - so limpa o que ele mesmo gravou. Sem essa protecao, a
// proxima rodada desfaria a correcao e o erro voltaria em silencio.
//
// ── Onde os eventos sao gravados ────────────────────────────────────────────────────────────
//
// Desde 08/09/2026 tudo vai para `invest.eventos_de_ativos`, a tabela canonica, com uma coluna
// `classe` (CAIXA / QUANTIDADE / DIREITO / IDENTIDADE). `proventos_acoes` e
// `eventos_corporativos_acoes` continuam existindo como VIEWS sobre ela, para o app nao mudar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = { "User-Agent": "Mozilla/5.0" };
const BRAPI_HIST = "https://brapi.dev/api/v2/stocks/historical";
const BRAPI_DIV = "https://brapi.dev/api/v2/stocks/dividends";
const BRAPI_TICK = "https://brapi.dev/api/v2/tickers";
/** Secret da funcao. Vai no header, nunca na URL - a propria BRAPI recomenda, porque na query
 *  string o token vaza para o historico do navegador e para o log do servidor. */
const BRAPI_TOKEN = Deno.env.get("BRAPI_TOKEN") ?? "";

/** Fuso da B3. O `date` da BRAPI e epoch em segundos. */
const OFFSET_B3 = -10800;

/** Data de hoje no fuso da B3. */
const hojeNaB3 = () => new Date(Date.now() + OFFSET_B3 * 1000).toISOString().slice(0, 10);

/**
 * A ferramenta calcula de 02/01/2023 em diante, e serie anterior a isso e peso morto.
 *
 * Nao e economia de estilo: com o catalogo da B3 aberto, qualquer um dos ~2.332 papeis pode ser
 * carregado. A serie COMPLETA da PETR4 tem 6.615 pregoes; a partir de 2023 sao ~920. A conta
 * multiplicada pelo catalogo e a diferenca entre 15 milhoes de linhas e 2 milhoes - num banco
 * Supabase Free cujo teto sao 500 MB.
 */
const PISO_SERIE = "2023-01-02";

/** Tickers por chamada. E o teto do plano Pro da BRAPI (o Startup aceita 10). */
const LOTE_TICKERS = 20;

/**
 * O client sempre aponta para o schema `invest`.
 *
 * Existe como funcao para que o TIPO possa ser derivado dela. `ReturnType<typeof createClient>`
 * assume o schema `public`, e passar o client de `invest` para um parametro tipado assim faz
 * todo nome de tabela virar `never` - o erro sai no upsert, longe da causa.
 */
function clienteInvest() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );
}
type Db = ReturnType<typeof clienteInvest>;

const emLotes = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const dataDe = (epochSeg: number) => new Date((epochSeg + OFFSET_B3) * 1000).toISOString().slice(0, 10);
const soData = (s: unknown) => (s ? String(s).slice(0, 10) : null);

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

/** ── Identidade do papel ──────────────────────────────────────────────────────────────────────
 *
 *  Ticker nao e identidade: a empresa troca de codigo e o historico anterior fica orfao sem que
 *  ninguem perceba - a posicao continua na tela e so o passado some. Num lote de dez tickers
 *  testado em 08/09/2026, SEIS eram renomeacoes reais (VVAR3->BHIA3, LAME4->AMER3,
 *  BIDI11->INBR32, SULA11->RDOR3, BRML3->ALOS3, GNDI3->HAPV3).
 *
 *  `resolve` devolve o codigo canonico de hoje a partir de qualquer codigo antigo. Cadastrar
 *  sempre pelo canonico e o que faz quem comprou VVAR3 em 2020 e quem compra BHIA3 hoje
 *  caírem no MESMO ativo, em vez de dois. */
async function resolverTicker(ticker: string) {
  try {
    const j = await pedir(`${BRAPI_TICK}/resolve?symbols=${ticker}`);
    const r = j?.results?.[0];
    return {
      canonico: String(r?.symbol ?? ticker).toUpperCase(),
      mudou: Boolean(r?.changed),
      desde: soData(r?.effectiveDate),
      status: r?.status ?? null,
    };
  } catch {
    // Resolver e uma melhoria, nao um pre-requisito: se o endpoint cair, segue com o ticker
    // pedido em vez de derrubar a sincronizacao inteira.
    return { canonico: ticker, mudou: false, desde: null, status: null };
  }
}

/** De->para de codigos antigos, para reconhecer um papel lancado com o codigo da epoca. */
async function renomeacoesDe(ticker: string) {
  try {
    const j = await pedir(`${BRAPI_TICK}/renames?symbols=${ticker}`);
    return (j?.results ?? []).map((r: Record<string, unknown>) => ({
      ticker_antigo: String(r.oldSymbol ?? "").toUpperCase(),
      ticker_atual: String(r.newSymbol ?? r.canonicalSymbol ?? "").toUpperCase(),
      data_efetiva: soData(r.effectiveDate),
      fonte: "brapi",
    })).filter((r: { ticker_antigo: string; ticker_atual: string }) =>
      r.ticker_antigo && r.ticker_atual && r.ticker_antigo !== r.ticker_atual);
  } catch {
    return [];
  }
}

/** ── SUBSCRICAO, e por que ela vem da B3 ─────────────────────────────────────────────────────
 *
 *  A brapi TEM o campo `subscriptions`, mas ele vem VAZIO - medido em 08/09/2026 nos quatro
 *  papeis do sandbox, todos com zero. A B3 tem os dados de verdade, entao aqui ela e a unica
 *  fonte possivel, nao uma preferencia.
 *
 *  O que uma subscricao guarda, e o que cada campo esconde:
 *
 *    percentage    % da posicao que se pode subscrever. NAO cabe em "0 a 100": OIBR em 2024 teve
 *                  443% e AMER teve 3.471% - recapitalizacoes com diluicao enorme.
 *    priceUnit     preco de exercicio. Pode ser praticamente ZERO: a AZUL em 2026 emitiu a
 *                  R$ 0,000001 e a R$ 0,00000000001, convertendo divida.
 *    assetIssued   o papel EMITIDO - e diferente do que da o direito. A AZUL deu direito sobre
 *                  BRAZULACNOR7 e emitiu BRAZULN05OR2. O que se recebe e um recibo de
 *                  subscricao, com codigo proprio, que so depois vira acao.
 *    tradingPeriod quando o direito negocia. O inicio dele E a data-ex: em todos os casos
 *                  medidos, e o pregao seguinte ao `lastDatePrior`. Melhor deriva-la daqui do
 *                  que somar um dia e torcer - `lastDatePrior` ja provou ser ambiguo nos eventos.
 *
 *  A B3 publica linhas com data de fachada ("01/01/1900 a 01/01/1900", subscricao em
 *  "31/12/9999") - a de PETR de 1974 e assim. Sao descartadas: data impossivel nao vira evento.
 *
 *  IMPORTANTE: o motor NAO aplica DIREITO. O resultado de uma subscricao depende do que o
 *  cliente fez - exercer, vender o direito ou deixar vencer - e isso o sistema nao tem como
 *  adivinhar. A view `eventos_corporativos_acoes` so expoe QUANTIDADE, entao DIREITO ja fica de
 *  fora por construcao. O que se guarda aqui sao os TERMOS, para que a posicao do cliente no
 *  recibo possa ser ligada ao evento que a originou. */
const B3_SUPPL = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall"
               + "/GetListedSupplementCompany/";

const dataBR = (s: unknown) => {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  // Data de fachada da B3. Fora dessa janela nao e evento, e sim preenchimento.
  return iso >= "1990-01-01" && iso <= "2100-01-01" ? iso : null;
};

async function subscricoesDaB3(ticker: string, isin: string | null) {
  if (!isin) return []; // sem ISIN nao ha como filtrar a classe certa dentro do emissor
  try {
    // O emissor sao os caracteres 3 a 6 do ISIN (BRPETRACNPR6 -> PETR): estrutura do ISIN
    // brasileiro, nao palpite sobre o formato do ticker.
    const r = await fetch(B3_SUPPL + btoa(JSON.stringify({
      issuingCompany: isin.slice(2, 6), language: "pt-br",
    })), { headers: UA });
    if (!r.ok) return [];
    const j = await r.json();
    const d = Array.isArray(j) ? j[0] : j;
    const num = (s: unknown) => {
      const n = Number(String(s ?? "").replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    return ((d?.subscriptions ?? []) as Record<string, unknown>[])
      .filter((x) => String(x.isinCode ?? "") === isin)
      .map((x) => {
        const [de, ate] = String(x.tradingPeriod ?? "").split(" a ");
        const inicio = dataBR(de);
        return {
          ticker, isin,
          classe: "DIREITO",
          tipo: "SUBSCRICAO",
          data_ex: inicio,
          negociacao_de: inicio,
          negociacao_ate: dataBR(ate),
          data_liquidacao: dataBR(x.subscriptionDate),
          data_aprovacao: dataBR(x.approvedOn),
          percentual: num(x.percentage),
          preco_exercicio: num(x.priceUnit),
          ativo_emitido: String(x.assetIssued ?? "") || null,
          fonte: "b3",
          evidencia: "B3 GetListedSupplementCompany; a brapi tem o campo subscriptions mas o "
                   + "devolve vazio. Data-ex = inicio do periodo de negociacao do direito.",
        };
      })
      // Sem data-ex nao ha evento: e o caso das linhas com periodo "01/01/1900 a 01/01/1900".
      .filter((s) => s.data_ex && s.percentual !== null);
  } catch {
    // A B3 fora do ar nao pode derrubar a sincronizacao de preco e provento, que e o essencial.
    return [];
  }
}

/** Marca como `provisorio` toda barra que AINDA NAO E UM FECHAMENTO. Sao dois casos, e o
 *  segundo custou uma correcao no mesmo dia em que o primeiro foi implementado.
 *
 *  1. BARRA HERDADA - repete a anterior INTEIRA (abertura, maxima, minima, fechamento E
 *     volume). Em dia sem pregao a BRAPI devolve a data assim mesmo, copiando a barra do ultimo
 *     pregao; aconteceu em 07/09/2026, com o volume repetido ao centavo. O criterio e a linha
 *     toda, nao o fechamento: 342 pontos da base fecham no mesmo preco do dia anterior por
 *     coincidencia legitima, e todos tem volume proprio.
 *
 *  2. BARRA DO DIA CORRENTE - o pregao ainda esta aberto. Este caso NAO e pego pelo criterio
 *     acima, e foi o furo: com o mercado rodando, a barra de hoje tem valores proprios, entao
 *     nao e copia de nada e passava como definitiva. Em 08/09/2026 as 14h13 a base tinha
 *     KLBN11 a 19,77 com `provisorio = false` - mas era o ultimo negocio, nao o fechamento, e
 *     o volume denunciava: 956.800 contra 3,4 a 6,8 milhoes dos dias completos.
 *
 *     O risco nao e cosmetico: se o sync nao rodar de novo depois das 18h, o preco das 14h fica
 *     gravado como se fosse o fechamento daquele dia, para sempre.
 *
 *     O criterio e a DATA, nao o horario: enquanto o dia nao virou, nao ha como afirmar que
 *     aquele numero e o fechamento. Comparar com um horario de fim de pregao seria pior -
 *     leilao se estende, ha sessoes especiais, e um horario fixo no codigo erra em silencio.
 *
 *  Nos dois casos o VALOR fica: repetir ou mostrar o ultimo negocio e o certo a exibir. O que
 *  muda e a marca - mesma convencao das series do BCB. Como a serie e substituida a cada
 *  rodada, ela se corrige sozinha quando o fechamento real chega. */
function marcarBarrasProvisorias(cotacoes: Record<string, unknown>[]) {
  // "Hoje" no fuso da B3, nao em UTC: perto da meia-noite os dois divergem, e a virada do dia
  // que interessa e a do pregao.
  const hojeB3 = new Date(Date.now() + OFFSET_B3 * 1000).toISOString().slice(0, 10);

  for (let i = 0; i < cotacoes.length; i++) {
    const h = cotacoes[i], a = i > 0 ? cotacoes[i - 1] : null;
    const herdada = a !== null
      && h.fechamento === a.fechamento && h.abertura === a.abertura && h.maxima === a.maxima
      && h.minima === a.minima && h.volume === a.volume;
    if (herdada || h.data === hojeB3) h.provisorio = true;
  }
}

type LinhaCotacao = {
  ticker: string;
  data: string;
  fechamento: number;
  abertura: number | null;
  maxima: number | null;
  minima: number | null;
  volume: number | null;
  provisorio: boolean;
};

/** Converte um item de `historicalDataPrice` numa linha da nossa tabela. */
function linhaDoHistorico(ticker: string, d: Record<string, unknown>): LinhaCotacao {
  return {
    ticker,
    data: dataDe(Number(d.date)),
    // `close` NOMINAL, nao `adjustedClose`: o motor guarda a quantidade real de cada data e faz
    // o proprio ajuste. Gravar o ajustado aqui seria ajustar duas vezes.
    fechamento: Number(d.close),
    abertura: d.open != null ? Number(d.open) : null,
    maxima: d.high != null ? Number(d.high) : null,
    minima: d.low != null ? Number(d.low) : null,
    volume: d.volume != null ? Number(d.volume) : null,
    provisorio: false,
  };
}

/**
 * MANUTENCAO DIARIA: fecha o dia dos papeis ja carregados, em lote.
 *
 * Diferente do caminho por ticker, que apaga a serie inteira e regrava. Aqui e upsert de uma
 * janela curta, por tres razoes:
 *
 * 1. `range=1mo` num lote de 20 tickers e UMA chamada. O caminho por ticker gasta 4 a 5 por
 *    papel; com o catalogo aberto isso nao escala.
 * 2. A janela de um mes CICATRIZA sozinha: feriado, rodada que falhou ou dia em que a fonte
 *    veio incompleta sao reescritos na proxima passada, sem logica de recuperacao.
 * 3. O delete-e-regrava so existe para expulsar a serie do Yahoo, que vinha em outra convencao.
 *    Entre dados da propria BRAPI nao ha convencao para misturar, entao upsert basta.
 *
 * A limpeza dos provisorios e o que corrige o feriado da B3. O `regularMarketTime` da BRAPI NAO
 * serve de trava: medido em 08/09/2026 as 22h55 BRT, ele marcava o horario de atualizacao do
 * feed - horas depois do fechamento das 17h - e nao o da ultima negociacao. Como a rodada
 * horaria pode gravar uma barra num dia sem pregao, e o `historical` sabe exatamente quais
 * pregoes existiram, qualquer provisorio da janela que ele nao confirmar e apagado aqui.
 */
async function fecharODiaEmLote(
  db: Db,
  tickers: string[],
): Promise<Record<string, unknown>> {
  const hoje = hojeNaB3();
  let chamadas = 0, gravadas = 0, apagadas = 0;
  const semRetorno: string[] = [];
  let inicioDaJanela = hoje;

  for (const lote of emLotes(tickers, LOTE_TICKERS)) {
    const j = await pedir(
      `${BRAPI_HIST}?symbols=${lote.join(",")}&range=1mo&interval=1d&sortOrder=asc`,
    );
    chamadas++;

    const vistos = new Set<string>();
    for (const res of (j?.results ?? []) as Record<string, unknown>[]) {
      const ticker = String(res?.symbol ?? res?.requestedSymbol ?? "").toUpperCase();
      if (!ticker) continue;
      vistos.add(ticker);

      const dados = (res?.data ?? res) as Record<string, unknown>;
      const itens = (dados?.historicalDataPrice ?? []) as Record<string, unknown>[];
      const linhas = (Array.isArray(itens) ? itens : [])
        .filter((d) => d.close != null)
        .map((d) => linhaDoHistorico(ticker, d));

      marcarBarrasProvisorias(linhas);
      const janela = linhas.filter((c) => c.data >= PISO_SERIE);
      if (!janela.length) continue;

      const de = janela[0].data;
      if (de < inicioDaJanela) inicioDaJanela = de;

      const { error } = await db.from("cotacoes_acoes")
        .upsert(janela, { onConflict: "ticker,data" });
      if (error) throw new Error(`cotacoes_acoes (${ticker}): ${error.message}`);
      gravadas += janela.length;

      // Provisorio na janela que o historico NAO confirmou: dia sem pregao inventado pela
      // rodada horaria. Some.
      const confirmados = new Set(janela.map((c) => c.data));
      const { data: provisorios, error: eLer } = await db.from("cotacoes_acoes")
        .select("data").eq("ticker", ticker).eq("provisorio", true).gte("data", de);
      if (eLer) throw new Error(`leitura de provisorios (${ticker}): ${eLer.message}`);

      const fantasmas = (provisorios ?? [])
        .map((r: { data: string }) => r.data)
        .filter((d) => !confirmados.has(d));
      if (fantasmas.length) {
        const { error: eDel } = await db.from("cotacoes_acoes")
          .delete().eq("ticker", ticker).eq("provisorio", true).in("data", fantasmas);
        if (eDel) throw new Error(`limpeza de fantasmas (${ticker}): ${eDel.message}`);
        apagadas += fantasmas.length;
      }
    }

    for (const t of lote) if (!vistos.has(t)) semRetorno.push(t);
  }

  return {
    modo: "fechamento",
    papeis: tickers.length,
    chamadas_brapi: chamadas,
    linhas_gravadas: gravadas,
    provisorios_apagados: apagadas,
    janela_desde: inicioDaJanela,
    // A fonte simplesmente nao devolveu esses. Aparece no relatorio em vez de sumir: papel que
    // para de responder e o comeco de uma serie que congela sem ninguem notar.
    sem_retorno_da_fonte: semRetorno,
  };
}

/**
 * RODADA HORARIA, durante o pregao: atualiza so a barra de HOJE, sempre como provisoria.
 *
 * Usa `/api/quote` em lote, que devolve o ultimo preco negociado (a cada 5 minutos no plano
 * Pro). Nao e fechamento - por isso `provisorio: true`, e por isso a boleta NAO deixa lancar
 * operacao de fundo ou renda fixa contra dado provisorio. Acao e excecao, porque ali o preco da
 * operacao e digitado pelo cliente e nao sai desta serie.
 *
 * A barra de hoje e sobrescrita a cada rodada, e no fim do dia o `fecharODiaEmLote` a substitui
 * pelo fechamento oficial.
 */
async function intradiarioEmLote(
  db: Db,
  tickers: string[],
): Promise<Record<string, unknown>> {
  const hoje = hojeNaB3();

  // Primeira barreira contra gravar num dia que nao existe. Nao pega feriado exclusivo da B3
  // (a bolsa fecha o ano um dia util antes do banco, por exemplo) - quem pega esse e a limpeza
  // de fantasmas no fechamento.
  const { data: cal } = await db.from("calendario_dias_uteis")
    .select("dia_util").eq("data", hoje).maybeSingle();
  if (!cal?.dia_util) {
    return { modo: "intradiario", data: hoje, pulado: "nao e dia util no calendario" };
  }

  let chamadas = 0;
  const linhas: LinhaCotacao[] = [];
  const semPreco: string[] = [];

  for (const lote of emLotes(tickers, LOTE_TICKERS)) {
    const j = await pedir(`https://brapi.dev/api/quote/${lote.join(",")}`);
    chamadas++;
    for (const r of (j?.results ?? []) as Record<string, unknown>[]) {
      const ticker = String(r?.symbol ?? "").toUpperCase();
      const preco = r?.regularMarketPrice;
      if (!ticker) continue;
      if (preco == null) { semPreco.push(ticker); continue; }
      linhas.push({
        ticker,
        data: hoje,
        fechamento: Number(preco),
        abertura: r.regularMarketOpen != null ? Number(r.regularMarketOpen) : null,
        maxima: r.regularMarketDayHigh != null ? Number(r.regularMarketDayHigh) : null,
        minima: r.regularMarketDayLow != null ? Number(r.regularMarketDayLow) : null,
        volume: r.regularMarketVolume != null ? Number(r.regularMarketVolume) : null,
        provisorio: true,
      });
    }
  }

  if (linhas.length) {
    const { error } = await db.from("cotacoes_acoes")
      .upsert(linhas, { onConflict: "ticker,data" });
    if (error) throw new Error(`cotacoes_acoes intradiario: ${error.message}`);
  }

  return {
    modo: "intradiario",
    data: hoje,
    papeis: tickers.length,
    chamadas_brapi: chamadas,
    linhas_gravadas: linhas.length,
    sem_preco: semPreco,
  };
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

  marcarBarrasProvisorias(cotacoes);

  // O corte vem DEPOIS da marcacao: `marcarBarrasProvisorias` compara cada barra com a
  // anterior, e cortar antes tiraria a referencia do primeiro dia que sobra.
  const daJanela = cotacoes.filter((c) => c.data >= PISO_SERIE);

  return {
    cotacoes: daJanela,
    // Quantos pregoes a fonte tinha antes do corte. Sem isto o relatorio daria a impressao de
    // que a fonte veio curta, quando na verdade fomos nos que cortamos.
    descartadas_antes_do_piso: cotacoes.length - daJanela.length,
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

/** ── Onde foi parar a lista EVENTOS_JA_NO_PRECO ───────────────────────────────────────────────
 *
 *  Ela virou DADO: a coluna `ja_refletido_no_preco` em `invest.eventos_de_ativos`, com a
 *  medicao que a justifica no campo `evidencia`. Eram tres entradas com apenas tres papeis
 *  cadastrados, e cada papel novo com peculiaridade exigia um deploy - insustentavel numa base
 *  de mercado.
 *
 *  O que mudou na pratica: o evento NAO e mais descartado na ingestao. Ele e enviado
 *  normalmente, colide com a linha ja marcada no indice unico e o `ignoreDuplicates` o descarta.
 *  Quem esconde esses eventos de quem calcula e a view `eventos_corporativos_acoes`.
 *
 *  Continua valendo o porque: se a serie da fonte ja embute o evento, aplicá-lo ajusta duas
 *  vezes - o mesmo erro que tirou o Yahoo daqui. Nao da para detectar isso por heuristica com
 *  seguranca: fator grande aparece como salto no preco, mas bonificacao de 1% some no ruido do
 *  dia. Por isso a coluna e explicita e vem sempre acompanhada da evidencia. */

/** Data-ex de um EVENTO corporativo, e por que ela NAO e derivavel.
 *
 *  A BRAPI nao preenche `exDate` em `stockDividends` - medido em 08/09/2026, vem null nos 6
 *  eventos de KLBN11 e ITSA4. (Em `cashDividends` ele VEM preenchido; o buraco e so nos
 *  eventos.) Sobra `lastDatePrior`, cujo nome promete a ultima data COM direito, ou seja, o
 *  pregao ANTERIOR a data-ex. Se fosse sempre isso, bastava somar um pregao. Nao e:
 *
 *    evento              lastDatePrior   data-ex real   como se sabe
 *    ITSA4 2023 (5%)     28/11           28/11          queda de -4,51% em 28/11
 *    ITSA4 2024 (5%)     03/12           03/12          queda de -5,64% em 03/12
 *    ITSA4 2025 (2%)     18/12           19/12          split date do Yahoo
 *    KLBN11 2025 (1%)    17/12           18/12          split date do Yahoo
 *    KLBN11 2014 (5:1)   24/03           25/03          split date do Yahoo
 *
 *  As vezes o campo traz a data-ex, as vezes o dia anterior. Somar um pregao acerta os tres de
 *  baixo e QUEBRA os dois de cima, que ja estavam certos - foi tentado e revertido no mesmo
 *  dia. Regra que acerta as vezes e pior que nenhuma: da a impressao de que o problema foi
 *  resolvido e o erro passa a ser invisivel.
 *
 *  Ha uma hipotese que explica os cinco: os dois de cima tem `remarks` comecando com "manual:"
 *  (curadoria da propria BRAPI) e os tres de baixo tem `remarks` vazio. Nao foi adotada - sao
 *  cinco pontos e um campo nao documentado, exatamente o tipo de heuristica que este arquivo
 *  evita em outros lugares. Fica registrada para quando houver mais casos.
 *
 *  Entao: grava-se o dado bruto e corrige-se por excecao verificada, uma a uma, com a evidencia
 *  ao lado. Errar aqui nao e cosmetico - o motor so aplica o fator quando `data_ex > data`,
 *  entao um dia de erro tira a bonificacao de quem comprou nesse dia e deixa o preco do dia
 *  sem converter para unidades de hoje. */
const DATA_EX_CORRIGIDA: Record<string, string> = {
  "ITSA4|2025-12-18": "2025-12-19",  // Yahoo 102:100; a queda de 2% some no ruido do dia
  "KLBN11|2025-12-17": "2025-12-18", // Yahoo 101:100; idem, 1%
  "KLBN11|2014-03-24": "2014-03-25", // Yahoo 5:1 (este ja esta marcado no banco)
};

function dataExDoEvento(exDate: string | null, lastDatePrior: string | null, ticker: string) {
  if (exDate) return exDate; // se um dia a BRAPI mandar, ele ganha
  if (!lastDatePrior) return null;
  return DATA_EX_CORRIGIDA[`${ticker}|${lastDatePrior}`] ?? lastDatePrior;
}

async function proventosEEventos(ticker: string) {
  const j = await pedir(`${BRAPI_DIV}?symbols=${ticker}`);
  const dd = j?.results?.[0]?.data ?? j?.results?.[0]?.dividendsData ?? {};

  const proventos = (dd.cashDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    classe: "CAIXA",
    tipo: TIPO_PROVENTO[String(x.label ?? "").toUpperCase().trim()] ?? "OUTRO",
    valor: Number(x.rate),
    // Sem `exDate`, `lastDatePrior` e a ultima data COM direito - um dia antes da data-ex.
    // Guardamos como aproximacao em vez de descartar o provento.
    data_ex: soData(x.exDate) ?? soData(x.lastDatePrior),
    data_liquidacao: soData(x.paymentDate),
    data_aprovacao: soData(x.approvedOn),
    fonte: "brapi",
  })).filter((p: { valor: number }) =>
    // `> 0` nao basta: a coluna e numeric(18,8) e um rate de 1e-10 passa no filtro e ARREDONDA
    // PARA ZERO na gravacao. Foi assim que tres linhas de PETR4 entraram com valor 0 - e com
    // data de pagamento ANTERIOR a data-ex, o que e impossivel. O piso e a menor coisa que a
    // coluna consegue guardar.
    Number.isFinite(p.valor) && p.valor >= 1e-8);

  const eventos = (dd.stockDividends ?? []).map((x: Record<string, unknown>) => ({
    ticker,
    classe: "QUANTIDADE",
    tipo: TIPO_EVENTO[String(x.label ?? "").toUpperCase().trim()] ?? null,
    fator: Number(x.factor),
    data_ex: dataExDoEvento(soData(x.exDate), soData(x.lastDatePrior), ticker),
    data_aprovacao: soData(x.approvedOn),
    fonte: "brapi",
  })).filter((e: { tipo: string | null; fator: number; data_ex: string | null }) =>
    e.tipo && e.data_ex && Number.isFinite(e.fator) && e.fator > 0);

  // O ISIN e a identidade estavel do papel, e a brapi NAO deixa consultar por ele - so o
  // entrega aqui dentro, de brinde, em cada provento. Colhemos do MAIS RECENTE de proposito:
  // provento antigo pode carregar o ISIN de outra classe (ITSA4 tem um de 2012 com
  // BRITSAR14PR5, que nao e o papel de hoje), enquanto o ultimo reflete o papel como ele e
  // agora.
  const comIsin = (dd.cashDividends ?? [])
    .filter((x: Record<string, unknown>) => x.isinCode)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(soData(a.exDate) ?? soData(a.lastDatePrior) ?? "")
        .localeCompare(String(soData(b.exDate) ?? soData(b.lastDatePrior) ?? "")));
  const isin = comIsin.length ? String(comIsin[comIsin.length - 1].isinCode) : null;

  return { proventos, eventos, isin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // `{ db: { schema } }` nao e detalhe: sem ele o cliente aponta para `public`, as tabelas nao
  // existem la, e o upsert volta com erro que ninguem le - foi o que aconteceu na primeira
  // versao, que reportou 6.697 cotacoes gravadas com o banco vazio.
  const db = clienteInvest();

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
      // O laco diario le `sincronizar_cotacoes`, NAO `ativo`.
      //
      // Desde 08/09/2026 o `cadastro_de_acoes` guarda o CATALOGO inteiro da B3 - 2.332 papeis
      // trazidos pelo `sync-base-mercado` para que a busca da boleta ache qualquer papel pelo
      // nome. Todos entram com `ativo = true`, porque sao negociaveis. Se o laco continuasse
      // lendo `ativo`, cada rodada tentaria os 2.332: ~10.500 chamadas a BRAPI, 35 minutos de
      // execucao, e a edge function morre antes de terminar.
      //
      // Serie de preco e carregada SOB DEMANDA, no primeiro uso do papel. `sincronizar_cotacoes`
      // marca quem ja passou por isso, e so esses entram na rotina diaria.
      const { data: papeis } = await db.from("cadastro_de_acoes")
        .select("ticker").eq("sincronizar_cotacoes", true);
      if (!papeis?.length) {
        return new Response(JSON.stringify({ ok: true, aviso: "nenhum papel cadastrado" }),
          { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      tickers = papeis.map((p: { ticker: string }) => p.ticker);
    }

    // ── Modos em lote ──
    //
    // O caminho por ticker abaixo apaga a serie inteira e regrava, gastando 4 a 5 chamadas por
    // papel. Ele e o certo para CADASTRAR um papel; e o errado para manter os ja cadastrados em
    // dia. Estes dois modos existem para a rotina:
    //
    //   { modo: "intradiario" }  de hora em hora no pregao: so a barra de hoje, provisoria
    //   { modo: "fechamento" }   apos o fechamento: janela de 1 mes, oficial, e limpa fantasma
    //
    // Sem `modo`, segue o comportamento antigo - recarga completa de todos os papeis. Continua
    // util para forcar um reprocessamento, mas nao e o que o cron chama.
    const modo = String(body?.modo ?? "").toLowerCase().trim();
    if (!pedido && (modo === "intradiario" || modo === "fechamento")) {
      const saida = modo === "intradiario"
        ? await intradiarioEmLote(db, tickers)
        : await fecharODiaEmLote(db, tickers);
      return new Response(JSON.stringify({ ok: true, ...saida }, null, 2),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const relatorio: Record<string, unknown>[] = [];

    for (const pedidoTicker of tickers) {
      try {
        const exigir = (etapa: string, error: { message: string } | null) => {
          if (error) throw new Error(`${etapa}: ${error.message}`);
        };

        // O codigo canonico vem ANTES de qualquer leitura: pedir a serie de um ticker aposentado
        // traria dado incompleto ou nenhum, e o papel entraria na base como se fosse outro.
        const res = await resolverTicker(pedidoTicker);
        const ticker = res.canonico;

        const renomes = await renomeacoesDe(ticker);
        if (renomes.length) {
          exigir("renomeacoes_acoes", (await db.from("renomeacoes_acoes")
            .upsert(renomes, { onConflict: "ticker_antigo,ticker_atual", ignoreDuplicates: true })).error);
        }

        const p = await precos(ticker);
        const pe = await proventosEEventos(ticker);

        if (pedido) {
          exigir("cadastro_de_acoes", (await db.from("cadastro_de_acoes").upsert(
            // `sincronizar_cotacoes: true` e o que coloca o papel na rotina diaria. Sem isto
            // a carga sob demanda funcionaria uma vez e a serie nunca mais atualizaria.
            { ticker, nome: p.nome, moeda: p.moeda, ativo: true, isin: pe.isin, sincronizar_cotacoes: true },
            { onConflict: "ticker" },
          )).error);
        } else if (pe.isin) {
          // Papel ja cadastrado que ainda nao tem ISIN: preenche sem tocar no resto.
          exigir("isin", (await db.from("cadastro_de_acoes")
            .update({ isin: pe.isin }).eq("ticker", ticker).is("isin", null)).error);
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
        // DUAS protecoes no delete, e as duas ja foram aprendidas na pratica:
        //
        //   fonte <> 'manual'          o que foi cadastrado do fato relevante. Sem isso, a
        //                              proxima rodada apagaria as parcelas que a brapi ainda
        //                              nao publicou e a rentabilidade cairia em silencio.
        //   nao ja_refletido_no_preco  os eventos que a serie da fonte ja embute. Antes o sync
        //                              os DESCARTAVA na ingestao (uma lista no codigo); agora
        //                              eles vivem no banco, marcados e com a evidencia escrita.
        //                              Apagá-los aqui seria reintroduzir o problema pela porta
        //                              dos fundos - eles voltariam sem a marca na proxima
        //                              rodada, e o motor passaria a ajustar duas vezes.
        //
        // Por isso tambem sumiu o filtro EVENTOS_JA_NO_PRECO da ingestao: o evento e reenviado
        // normalmente, colide com a linha ja marcada no indice unico e o `ignoreDuplicates` o
        // descarta. A marca sobrevive sem ninguem precisar lembrar dela.
        const limpar = (classe: string) => db.from("eventos_de_ativos")
          .delete().eq("ticker", ticker).eq("classe", classe)
          .neq("fonte", "manual").eq("ja_refletido_no_preco", false);
        exigir("limpeza de proventos", (await limpar("CAIXA")).error);
        exigir("limpeza de eventos", (await limpar("QUANTIDADE")).error);
        exigir("limpeza de direitos", (await limpar("DIREITO")).error);

        // O ISIN so e conhecido depois de ler os proventos, e a B3 precisa dele para filtrar a
        // classe certa dentro do emissor - por isso a busca de subscricao vem aqui, e nao junto
        // com as outras leituras.
        const isinAtual = pe.isin
          ?? (await db.from("cadastro_de_acoes").select("isin").eq("ticker", ticker).maybeSingle())
             .data?.isin ?? null;
        const subs = await subscricoesDaB3(ticker, isinAtual);

        const CHAVE = "ticker,tipo,data_ex,data_liquidacao,valor,fator";
        if (pe.proventos.length) {
          exigir("eventos CAIXA", (await db.from("eventos_de_ativos")
            .upsert(pe.proventos.map((p: Record<string, unknown>) => ({ ...p, isin: pe.isin })),
              { onConflict: CHAVE, ignoreDuplicates: true })).error);
        }
        if (pe.eventos.length) {
          exigir("eventos QUANTIDADE", (await db.from("eventos_de_ativos")
            .upsert(pe.eventos.map((e: Record<string, unknown>) => ({ ...e, isin: pe.isin })),
              { onConflict: CHAVE, ignoreDuplicates: true })).error);
        }
        if (subs.length) {
          exigir("eventos DIREITO", (await db.from("eventos_de_ativos")
            .upsert(subs, { onConflict: CHAVE, ignoreDuplicates: true })).error);
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

        // Proventos cadastrados a mao e o RISCO que eles carregam.
        //
        // A brapi publica um provento parcelado UMA PARCELA POR VEZ, conforme cada pagamento se
        // aproxima - confirmado pela IA deles em 08/09/2026: "nao existe endpoint, modulo ou
        // campo com calendario futuro de parcelas de um provento ja declarado". Em KLBN11 ela
        // tinha 1 das 4 parcelas do dividendo de 16/12/2025, e as tres restantes entraram a mao.
        //
        // Quando ela publicar as que faltam, virao com o MESMO exDate. Se o paymentDate tambem
        // bater, o `ignoreDuplicates` sobre o indice unico as descarta e nada acontece. Se
        // divergir um dia que seja, viram linhas novas e o provento DOBRA em silencio - a
        // posicao continua certa e so a rentabilidade sobe sem motivo, que e o pior jeito de um
        // erro aparecer.
        //
        // Nao da para alertar por "mesma data-ex e valor com pagamento diferente": e essa a cara
        // do caso NORMAL, parcelas irmas do mesmo dividendo. Um alerta assim tocaria sempre e
        // viraria ruido. O que se faz e mostrar a CONTAGEM: se a empresa declarou 4 parcelas e
        // um dia aparecerem 5, o numero denuncia sozinho.
        const { data: provManuais } = await db.from("proventos_acoes")
          .select("data_ex, data_pagamento, valor, tipo").eq("ticker", ticker).eq("fonte", "manual");
        const { data: provTodos } = await db.from("proventos_acoes")
          .select("data_ex, data_pagamento, valor, fonte").eq("ticker", ticker);
        const parceladosAMao = [...new Set((provManuais ?? [])
          .map((m: Record<string, unknown>) => String(m.data_ex)))]
          .map((dataEx) => {
            const irmas = (provTodos ?? []).filter((p: Record<string, unknown>) =>
              String(p.data_ex) === dataEx);
            return {
              data_ex: dataEx,
              parcelas: irmas.length,
              da_fonte: irmas.filter((p: Record<string, unknown>) => p.fonte !== "manual").length,
              a_mao: irmas.filter((p: Record<string, unknown>) => p.fonte === "manual").length,
              pagamentos: irmas.map((p: Record<string, unknown>) => String(p.data_pagamento)).sort(),
            };
          });

        relatorio.push({
          ticker,
          nome: p.nome,
          isin: pe.isin,
          // Só aparece quando o ticker pedido não é o de hoje - senão vira ruído em toda linha.
          renomeado: res.mudou ? { pedido: pedidoTicker, canonico: ticker, desde: res.desde } : null,
          renomeacoes_conhecidas: renomes,
          cotacoes_lidas: p.cotacoes.length,
          cotacoes_no_banco: nCot,
          cotacoes_provisorias: p.cotacoes.filter((c: { provisorio: boolean }) => c.provisorio)
            .map((c: { data: string }) => c.data),
          primeira: p.cotacoes[0]?.data ?? null,
          ultima: p.cotacoes.at(-1)?.data ?? null,
          proventos_lidos: pe.proventos.length,
          proventos_no_banco: nProv,
          proventos_manuais: provManuais ?? [],
          parcelados_a_mao: parceladosAMao,
          eventos_da_brapi: pe.eventos.length,
          subscricoes_da_b3: subs.map((s) => ({
            data_ex: s.data_ex, percentual: s.percentual,
            preco: s.preco_exercicio, emite: s.ativo_emitido,
          })),
          eventos_manuais: manuais ?? [],
          eventos_no_banco: nEvt,
          // O banco tem o que a fonte trouxe MAIS o que foi cadastrado a mao. Comparar so o
          // lido dispararia alarme falso a cada rodada, e alarme que sempre toca vira ruido -
          // pior que nao ter alarme.
          confere: (pe.proventos.length + (provManuais?.length ?? 0) === nProv
                    && p.cotacoes.length === nCot)
            ? "ok" : "ATENCAO: lido != gravado",
        });
      } catch (e) {
        // `pedidoTicker`, nao `ticker`: este ultimo nasce dentro do try (depois do resolve) e
        // aqui fora nao existe. Referenciá-lo lançaria ReferenceError e trocaria o erro real
        // por um erro de escopo - o relatorio mentiria sobre a causa.
        relatorio.push({ ticker: pedidoTicker, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, relatorio }, null, 2),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
