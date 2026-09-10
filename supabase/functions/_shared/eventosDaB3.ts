/**
 * Leitura dos EVENTOS DE QUANTIDADE declarados na B3 - desdobramento, grupamento, bonificacao.
 *
 * Existe pelo mesmo motivo que `proventosDaB3.ts`: ate 09/09/2026 a unica fonte de evento de
 * quantidade era a BRAPI, e nao havia nada conferindo. O custo disso esta medido - dos 8 eventos
 * da nossa base com data-ex dentro da janela de calculo, DOIS entraram a mao depois de aparecerem
 * na comparacao contra o GorilaVIEW (ITSA4 11/11/2022 e KLBN11 07/05/2024), e um terceiro, a
 * bonificacao de 5% do GGBR4 em 22/03/2023, nao existe em fonte nenhuma.
 *
 * ── O que este endpoint entrega, e o que ele NAO entrega ────────────────────────────────────
 *
 * `GetListedSupplementCompany` devolve o ULTIMO evento de cada rotulo por ISIN. Nao e uma janela
 * de tempo - ele tem GRUPAMENTO de 2003 no GGBR e DESDOBRAMENTO de 2014 no KLBN - e tambem nao e
 * o historico: e um por (ISIN, rotulo). Medido em 09/09/2026:
 *
 *   emissor   o que ele devolve                          o que a nossa base tem alem disso
 *   GGBR      BONIFICACAO 2024, GRUPAMENTO 2003          BONIFICACAO 2023 (5%)
 *   ITSA      BONIFICACAO 2025, RESG TOTAL RV 2012       BONIFICACAO 2022, 2023, 2024
 *   KLBN      BONIFICACAO 2025, DESDOBRAMENTO 2014       BONIFICACAO 2024
 *
 * Ou seja: ele acha o evento NOVO que a BRAPI perdeu, que e o caso que se repete, e nao acha o
 * evento ANTIGO ja substituido por outro do mesmo rotulo. Nao ha endpoint de historico -
 * `GetListedStockDividends`, o analogo de `GetListedCashDividends`, responde 404 (testado).
 *
 * Dizer isso em voz alta importa: uma auditoria que nao declara o que nao cobre transforma
 * ausencia de informacao em aprovacao.
 *
 * ── Duas convencoes de fator no MESMO campo ─────────────────────────────────────────────────
 *
 * O `factor` da B3 nao tem uma unidade so, e confundir as duas erra a quantidade por ordens de
 * grandeza. Medido contra os 10 eventos que ja estavam conferidos na nossa base:
 *
 *   rotulo           factor da B3      nosso fator   leitura
 *   BONIFICACAO      20,00             1,20          percentual de acoes NOVAS
 *   BONIFICACAO      33,333333333      1,3333333     idem (PETR4 1994)
 *   DESDOBRAMENTO    100,00            2,0           idem (PETR4 2008, USIM5 2010)
 *   DESDOBRAMENTO    4.900,00          50,0          idem (BBDC4 2009)
 *   DESDOBRAMENTO    1.100,00          12,0          idem (MELI34 2020)
 *   GRUPAMENTO       0,02              0,02          RAZAO, nao percentual
 *   GRUPAMENTO       0,001             0,001         idem (GGBR4 2003)
 *
 * Bonificacao e desdobramento vem como percentual de acoes novas (fator = 1 + pct/100);
 * grupamento vem como a razao pronta. Aplicar a regra do percentual num grupamento de 0,02
 * daria fator 1,0002 em vez de 0,02 - a posicao ficaria 50 mil vezes maior.
 *
 * ── BDR ────────────────────────────────────────────────────────────────────────────────────
 *
 * Este endpoint COBRE BDR, diferente do de proventos. Ele e chamado pelo codigo de 4 letras do
 * emissor, que sai do proprio ticker, entao nao depende de ISIN - e ainda DEVOLVE o ISIN, que e
 * como o MELI34 saiu de "sem identidade" em 09/09/2026.
 */

const UA = { "User-Agent": "Mozilla/5.0" };

const B3_SUP = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall"
             + "/GetListedSupplementCompany/";

/** Rotulos da B3 que sao evento de QUANTIDADE. O resto e outra coisa - ver `naoModelados`. */
export const TIPO_EVENTO_B3: Record<string, "DESDOBRAMENTO" | "GRUPAMENTO" | "BONIFICACAO"> = {
  DESDOBRAMENTO: "DESDOBRAMENTO",
  GRUPAMENTO: "GRUPAMENTO",
  BONIFICACAO: "BONIFICACAO",
};

/** Codigo de 4 letras do emissor na B3 - e o comeco do proprio ticker (GGBR4 -> GGBR). */
export const emissorDoTicker = (ticker: string) =>
  ticker.toUpperCase().replace(/\d+$/, "").slice(0, 4);

const dataBR = (s: unknown) => {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return iso >= "1990-01-01" && iso <= "2100-01-01" ? iso : null;
};

const numeroBR = (s: unknown) => {
  const n = Number(String(s ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Converte o `factor` da B3 no fator multiplicativo da quantidade.
 *
 * Exportada para ser testada sozinha: e a unica linha deste arquivo em que um engano nao
 * aparece como erro pequeno, e sim como posicao em outra ordem de grandeza.
 */
export function fatorDaB3(tipo: string, factor: number): number | null {
  if (!Number.isFinite(factor)) return null;
  if (tipo === "GRUPAMENTO") return factor > 0 ? factor : null;
  // Bonificacao e desdobramento: percentual de acoes novas sobre as que ja se tinha.
  const f = 1 + factor / 100;
  return f > 0 ? f : null;
}

export interface EventoDeclarado {
  tipo: "DESDOBRAMENTO" | "GRUPAMENTO" | "BONIFICACAO";
  fator: number;
  /** `lastDatePrior` cru da B3. NAO e a data-ex: ver `dataExDeclarada` no reconciliador. */
  dataDeclarada: string;
  aprovacao: string | null;
  isin: string;
  ativoEmitido: string | null;
  factorCru: number;
}

export interface LeituraDeEventos {
  /** null quando o emissor nao respondeu. Distinto de `[]`, que e "respondeu e nao ha evento". */
  eventos: EventoDeclarado[] | null;
  /** Rotulos que a B3 publica e que nao sao evento de quantidade (CIS RED CAP, RESG TOTAL RV). */
  naoModelados: { rotulo: string; isin: string; data: string | null }[];
  /** Todos os ISINs que o emissor tem na B3. E daqui que sai a identidade de um BDR. */
  isinsDoEmissor: string[];
  tradingName: string | null;
  motivo: string | null;
}

/**
 * Eventos de quantidade de UM papel, ja filtrados pela classe dele.
 *
 * O filtro e por ISIN porque o payload traz ON, PN e unit juntos - e, quando nao temos ISIN, so
 * se adota o do emissor se ele tiver UM SO. Com dois ou mais, escolher seria chutar a classe, e
 * um desdobramento aplicado na classe errada nao aparece como erro: aparece como quantidade
 * plausivel e errada.
 */
export async function eventosDaB3(ticker: string, isin: string | null): Promise<LeituraDeEventos> {
  const vazio: LeituraDeEventos = {
    eventos: null, naoModelados: [], isinsDoEmissor: [], tradingName: null, motivo: null,
  };
  const emissor = emissorDoTicker(ticker);
  if (emissor.length < 4) {
    return { ...vazio, motivo: `ticker ${ticker} nao tem codigo de emissor de 4 letras` };
  }

  let corpo: Record<string, unknown> | null = null;
  try {
    const r = await fetch(B3_SUP + btoa(JSON.stringify({
      language: "pt-br", issuingCompany: emissor,
    })), { headers: UA });
    if (!r.ok) return { ...vazio, motivo: `B3 respondeu HTTP ${r.status} para ${emissor}` };
    const j = await r.json();
    corpo = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | null;
  } catch (e) {
    // Mesma regra do resto do projeto: a B3 fora do ar nao e "auditado e ok".
    return { ...vazio, motivo: `B3 nao respondeu para ${emissor}: ${String(e)}` };
  }
  if (!corpo) return { ...vazio, motivo: `B3 nao conhece o emissor ${emissor}` };

  const linhas = (corpo.stockDividends ?? []) as Record<string, unknown>[];
  const isinsDoEmissor = [...new Set(linhas
    .map((x) => String(x.isinCode ?? "").trim().toUpperCase()).filter(Boolean))];
  const tradingName = String(corpo.tradingName ?? "").trim() || null;

  const alvo = isin?.toUpperCase()
    ?? (isinsDoEmissor.length === 1 ? isinsDoEmissor[0] : null);
  if (!alvo) {
    return {
      ...vazio, isinsDoEmissor, tradingName,
      motivo: isinsDoEmissor.length
        ? `sem ISIN na base e o emissor ${emissor} tem ${isinsDoEmissor.length} classes `
          + `(${isinsDoEmissor.join(", ")}); escolher uma seria chutar`
        : `sem ISIN na base e a B3 nao publica ISIN nenhum para ${emissor}`,
    };
  }

  const daClasse = linhas.filter((x) =>
    String(x.isinCode ?? "").trim().toUpperCase() === alvo);

  const eventos: EventoDeclarado[] = [];
  const naoModelados: LeituraDeEventos["naoModelados"] = [];

  for (const x of daClasse) {
    const rotulo = String(x.label ?? "").trim().toUpperCase();
    const tipo = TIPO_EVENTO_B3[rotulo];
    const data = dataBR(x.lastDatePrior);
    if (!tipo) {
      // Nao e ruido: e a B3 dizendo que houve um ato societario que o nosso modelo nao
      // representa. Some-lo aos eventos seria pior, cala-lo tambem.
      naoModelados.push({ rotulo, isin: alvo, data });
      continue;
    }
    const cru = numeroBR(x.factor);
    const fator = cru === null ? null : fatorDaB3(tipo, cru);
    if (fator === null || !data) continue;
    eventos.push({
      tipo, fator, dataDeclarada: data,
      aprovacao: dataBR(x.approvedOn),
      isin: alvo,
      ativoEmitido: String(x.assetIssued ?? "").trim() || null,
      factorCru: cru!,
    });
  }

  return { eventos, naoModelados, isinsDoEmissor, tradingName, motivo: null };
}
