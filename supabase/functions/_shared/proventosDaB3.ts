/**
 * Leitura dos proventos DECLARADOS na B3.
 *
 * Compartilhado entre `sync-acoes`, que COMPLETA a base com o que a BRAPI perdeu, e
 * `auditoria-proventos`, que so RELATA. Duas copias divergindo ja aconteceu neste projeto.
 */

const UA = { "User-Agent": "Mozilla/5.0" };

const B3_CASH = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall"
              + "/GetListedCashDividends/";
const B3_EMPRESAS = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall"
                  + "/GetInitialCompanies/";
const B3_SUPLEMENTO = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall"
                    + "/GetListedSupplementCompany/";

/** Classe da B3 a partir do sufixo do ticker - convencao da propria bolsa, nao heuristica. */
export const CLASSE_B3: Record<string, string> = {
  "3": "ON", "4": "PN", "5": "PNA", "6": "PNB", "7": "PNC", "8": "PND", "11": "UNT",
};

export const TIPO_PROVENTO: Record<string, string> = {
  DIVIDENDO: "DIVIDENDO",
  JCP: "JCP",
  "JRS CAP PROPRIO": "JCP",
  "JUROS SOBRE CAPITAL PROPRIO": "JCP",
  RENDIMENTO: "RENDIMENTO",
};

export const dataBR = (s: unknown) => {
  const m = String(s ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  // Data de fachada da B3. Fora dessa janela nao e evento, e sim preenchimento.
  return iso >= "1990-01-01" && iso <= "2100-01-01" ? iso : null;
};

/**
 * Nome de pregao da empresa a partir do ISIN, que e o que o endpoint de proventos exige.
 *
 * Exportado porque a auditoria precisa distinguir "zero parcelas porque a empresa nao distribui"
 * de "zero parcelas porque o nome nao resolveu" - a segunda e um furo silencioso. Medido em
 * 09/09/2026 sobre 77 emissores: 10 nao resolveram (ELET, MRFG, ALSO, ODPV, GOLL, CCRO, WIZS
 * entre eles).
 *
 * A normalizacao nao e cosmetica: o catalogo devolve "KLABIN S/A", que traz ZERO parcelas,
 * enquanto "KLABIN SA" traz 219.
 */
const normalizarNome = (s: unknown) =>
  String(s ?? "").replace(/[\/.]/g, "").replace(/\s+/g, " ").trim() || null;

export async function nomeDePregao(isin: string): Promise<string | null> {
  // O emissor sao os caracteres 3 a 6 do ISIN. O catalogo responde por prefixo, entao a
  // conferencia do `issuingCompany` exato e o que evita pegar a empresa errada: "PETR"
  // devolve 18 resultados e so um deles e a Petrobras.
  const emissor = isin.slice(2, 6).toUpperCase();
  const rc = await fetch(B3_EMPRESAS + btoa(JSON.stringify({
    language: "pt-br", company: emissor,
  })), { headers: UA });
  if (!rc.ok) return null;
  const jc = await rc.json();
  const empresa = ((jc?.results ?? []) as Record<string, unknown>[])
    .find((x) => String(x.issuingCompany ?? "").trim().toUpperCase() === emissor);
  // O catalogo nao conhece todo emissor que a bolsa conhece, e o suplemento e chaveado pelo
  // codigo EXATO em vez de por prefixo. Medido em 09/09/2026 sobre os sete emissores que o
  // catalogo tinha deixado passar: ele resolve GOLL -> "GOL", que tem 41 parcelas declaradas, e
  // MELI -> "MERCADOLIBRE", que e como o unico BDR da base ganhou nome. Os outros cinco (ELET,
  // MRFG, ALSO, ODPV, CCRO, WIZS) nao resolvem em nenhum dos dois - nesses o codigo do emissor
  // simplesmente nao e a raiz do ticker, quase sempre porque o papel foi renomeado.
  //
  // Fallback, e nao substituto: o catalogo resolve KLBN igual e mudar a ordem trocaria uma
  // cobertura medida por outra sem motivo.
  if (!empresa) {
    const rs = await fetch(B3_SUPLEMENTO + btoa(JSON.stringify({
      language: "pt-br", issuingCompany: emissor,
    })), { headers: UA });
    if (!rs.ok) return null;
    const js = await rs.json();
    const corpo = (Array.isArray(js) ? js[0] : js) as Record<string, unknown> | null;
    return corpo ? normalizarNome(corpo.tradingName) : null;
  }

  return normalizarNome(empresa.tradingName);
}

/** B3: os proventos DECLARADOS, com historico COMPLETO - nao os ~9 meses do suplemento.
 *
 *  Ate 09/09/2026 a base vivia achando que a B3 nao tinha historico. Nao era verdade: era o
 *  endpoint errado. `GetListedSupplementCompany` devolve uma janela curta; quem tem o historico
 *  e `GetListedCashDividends`, e o parametro dele e `tradingName`. Com `issuingCompany` ele
 *  responde 200 com zero registros, sem erro nenhum - foi exatamente o que despistou.
 *
 *  Medido em 09/09/2026: PETROBRAS 343 parcelas desde 1996, ITAUSA 506, BRADESCO 902, KLABIN SA
 *  219 - esta ultima inclusive na classe UNT, que o suplemento nao publica.
 *
 *  O casamento e por `tradingName` EXATO: "PETRO" e "PETR" devolvem zero, e "BRASIL" traz so o
 *  Banco do Brasil, nao a BRASILAGRO. Nao ha risco de um emissor arrastar parcela de outro. O
 *  nome sai do catalogo pelo emissor do ISIN (BRITSAACNPR7 -> ITSA -> "ITAUSA"), e passa por uma
 *  normalizacao que nao e cosmetica: o catalogo devolve "KLABIN S/A", que da ZERO parcelas,
 *  enquanto "KLABIN SA" da 219.
 *
 *  ESTE ENDPOINT NAO TEM DATA DE PAGAMENTO. Por isso ele nao substitui a BRAPI - ele completa o
 *  que ela perde. E ela perde: medido em 09/09/2026, PETR4 veio inteiro (55 de 55), ITSA4 sem 1
 *  parcela e KLBN11 sem 3, todas parcelas subsequentes de declaracoes parceladas.
 *
 *  BDR fica de fora por construcao: nao aparece neste endpoint, e sem ISIN nem chegamos aqui. */
export const numeroBR = (s: unknown) => {
  const n = Number(String(s ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * As linhas CRUAS do endpoint de caixa, ja filtradas pela classe do ticker.
 *
 * Separada de `proventosDaB3` porque a mesma resposta serve a duas perguntas diferentes: o
 * VALOR de cada parcela, que e o que a reconciliacao de proventos usa, e o `closingPricePriorExDate`
 * de cada uma, que e um preco NOMINAL publicado pela propria bolsa e serve de ancora para medir
 * se a nossa serie de precos vem ajustada. Duas chamadas para o mesmo payload seria desperdicio
 * de rede, e duas copias do filtro de classe seria a duplicacao que este arquivo existe para
 * evitar.
 */
export async function linhasDeCaixaDaB3(ticker: string, isin: string | null) {
  const vazio = (motivo: string) =>
    ({ linhas: [] as Record<string, unknown>[], nome: null as string | null, motivo });
  if (!isin) return vazio(`${ticker} nao tem ISIN na base`);
  const sufixo = ticker.replace(/^[A-Z]+/, "");
  const classe = CLASSE_B3[sufixo];
  if (!classe) {
    // BDR cai aqui, e de proposito. O filtro deste endpoint e por classe de acao (ON, PN, UNT)
    // e um BDR nao tem nenhuma delas. Tirar o filtro para BDR seria facil e nao ha como validar
    // a mudanca: o unico BDR da base, MELI34, nao tem provento nenhum na B3 - a MercadoLibre
    // nao distribui. Sem um caso para conferir, generalizar seria escrever regra no escuro.
    return vazio(`o sufixo ${sufixo} de ${ticker} nao e classe de acao na B3`
      + " (BDR nao entra neste endpoint, que filtra por ON/PN/UNT)");
  }

  try {
    const nome = await nomeDePregao(isin);
    if (!nome) return vazio(`o nome de pregao nao resolveu a partir do ISIN ${isin}`);

    const linhas: Record<string, unknown>[] = [];
    for (let pagina = 1; pagina <= 30; pagina++) {
      const r = await fetch(B3_CASH + btoa(JSON.stringify({
        language: "pt-br", pageNumber: pagina, pageSize: 100, tradingName: nome,
      })), { headers: UA });
      if (!r.ok) break;
      const j = await r.json();
      const res = (j?.results ?? []) as Record<string, unknown>[];
      linhas.push(...res);
      const total = Number(j?.page?.totalPages ?? 0);
      if (!res.length || (total > 0 && pagina >= total)) break;
    }

    return {
      linhas: linhas.filter((x) => String(x.typeStock ?? "").trim().toUpperCase() === classe),
      nome,
      motivo: null as string | null,
    };
  } catch (e) {
    // Mesma regra da subscricao: a B3 fora do ar nao derruba preco nem provento da BRAPI.
    return vazio(`a B3 nao respondeu: ${String(e)}`);
  }
}

/**
 * Precos NOMINAIS que a B3 publica junto de cada parcela: o fechamento da vespera da data-ex.
 *
 * Uma serie esparsa - um ponto por parcela declarada - mas com uma propriedade que a nossa nao
 * tem: ela e sempre NOMINAL, nunca ajustada retroativamente. Comparar as duas no MESMO dia
 * mede quanto de ajuste a nossa carrega, sem o mercado no meio do caminho.
 */
export async function ancorasDePrecoDaB3(ticker: string, isin: string | null) {
  const { linhas, nome, motivo } = await linhasDeCaixaDaB3(ticker, isin);
  const porData = new Map<string, number>();
  for (const x of linhas) {
    const data = dataBR(x.dateClosingPricePriorExDate);
    const preco = numeroBR(x.closingPricePriorExDate);
    // Parcelas irmas repetem a mesma vespera com o mesmo preco; o Map colapsa sozinho.
    if (data && preco !== null && preco > 0) porData.set(data, preco);
  }
  return {
    nome,
    // "Nao consultamos" e "consultamos e nao ha" sao respostas diferentes, e a segunda pode ser
    // a verdade sobre a empresa: a MercadoLibre nao distribui provento nenhum.
    motivo: motivo
      ?? (porData.size ? null : `a B3 respondeu para "${nome}" e nao ha parcela declarada `
        + "nesta classe; sem parcela nao ha preco nominal, porque ele vem junto dela"),
    ancoras: [...porData.entries()]
      .map(([data, precoNominal]) => ({ data, precoNominal }))
      .sort((a, b) => a.data.localeCompare(b.data)),
  };
}

export async function proventosDaB3(ticker: string, isin: string | null, pregoes: string[]) {
  const { linhas, nome } = await linhasDeCaixaDaB3(ticker, isin);
  if (!nome) return [];
  const classe = CLASSE_B3[ticker.replace(/^[A-Z]+/, "")];

  return linhas
    .map((x) => {
      // `lastDatePriorEx` e o ultimo dia COM direito. A data-ex e o pregao seguinte, e quem
      // sabe onde ficam os pregoes e a propria serie de cotacoes do papel - usar o calendario
      // bancario erraria, porque banco e bolsa nao fecham nos mesmos dias.
      const ultimoComDireito = dataBR(x.lastDatePriorEx);
      if (!ultimoComDireito) return null;

      // A serie precisa COBRIR o momento da declaracao, e nao apenas ter alguma data depois
      // dela. Sem esta guarda, toda parcela anterior ao inicio da serie casa com o PRIMEIRO
      // pregao dela - e o resultado nao e uma linha errada, e um monte: na primeira versao
      // desta funcao, 206 parcelas de ITSA4 entre 1996 e 2022 entraram todas com data-ex
      // 02/01/2023, e o papel saltou de 37 para 442 proventos.
      //
      // Antes do inicio da serie nao ha como saber qual foi o pregao seguinte, e o periodo
      // esta abaixo do piso de calculo de qualquer forma. Entao a parcela e descartada, que e
      // a resposta honesta - diferente de chutar a primeira data disponivel.
      if (!pregoes.length || ultimoComDireito < pregoes[0]) return null;

      const dataEx = pregoes.find((d) => d > ultimoComDireito) ?? null;
      const valor = numeroBR(x.valueCash);
      const tipo = TIPO_PROVENTO[String(x.corporateAction ?? "").toUpperCase().trim()];
      if (!dataEx || !tipo || valor === null || valor < 1e-8) return null;
      return {
        ticker, isin,
        classe: "CAIXA",
        tipo,
        data_ex: dataEx,
        data_liquidacao: null, // este endpoint nao publica; ver o comentario da funcao
        data_aprovacao: dataBR(x.dateApproval),
        valor,
        ja_refletido_no_preco: false,
        fonte: "b3",
        evidencia: `B3 GetListedCashDividends, tradingName="${nome}", classe ${classe}. `
                 + `Ultimo dia com direito ${x.lastDatePriorEx}, data-ex = pregao seguinte. `
                 + "Parcela declarada que a BRAPI nao trouxe; sem data de pagamento porque "
                 + "este endpoint nao a publica.",
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
