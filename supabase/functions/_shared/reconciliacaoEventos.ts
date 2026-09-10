/**
 * Reconciliacao de EVENTOS DE QUANTIDADE: desdobramento, grupamento e bonificacao.
 *
 * O equivalente de `reconciliacaoProventos.ts` para o outro efeito do mesmo evento. Vive aqui,
 * sem fetch e sem banco, pelo mesmo motivo: poder ser testado. A funcao irma teve tres defeitos
 * em 09/09/2026, todos com a assinatura de inserir linha a mais em silencio, e todos so
 * apareceram porque alguem conferiu numero a numero. Nao vale repetir isso.
 *
 * Sao DOIS testes, porque um evento tem dois efeitos independentes e cada um falha sozinho:
 *
 *   `reconciliarEventos`  a B3 declara evento que a nossa base nao tem? (efeito QUANTIDADE)
 *   `degrausDeAjuste`     o PRECO da nossa serie ja embute um evento? (efeito PRECO)
 *
 * A segunda existe porque a marca `ja_refletido_no_preco` e medida no proprio papel, contra o
 * dia anterior e o dia seguinte - e um preco ruim num desses dois dias inverte o veredito sem
 * fazer barulho. Foi o que aconteceu com o BBDC4: o fechamento de 07/02/2024 veio 15,9% abaixo
 * do dia anterior e 16,6% abaixo do seguinte (um bico, nao um degrau), a medicao leu 1,1891
 * onde o fator era 1,20 e concluiu "serie nominal". Contra os precos nominais que a B3 publica,
 * a razao e exatamente 1,2000 antes de fevereiro/2024 e 1,0000 depois: a serie ESTAVA ajustada.
 */

/** Um evento que ja esta na nossa base. */
export interface EventoNosso {
  tipo: string;
  fator: number;
  dataEx: string;
  jaRefletidoNoPreco: boolean;
  fonte: string;
}

/** Um evento declarado pela B3. O tipo e generico para o chamador anexar o que quiser. */
export interface EventoDeclaradoMin {
  tipo: string;
  fator: number;
  /** `lastDatePrior` cru. Ver `dataExPossiveis` para o porque de nao ser a data-ex. */
  dataDeclarada: string;
}

/**
 * Quanto dois fatores podem diferir e ainda serem o MESMO evento.
 *
 * Relativa, e nao absoluta como a dos proventos: aqui o erro E proporcional. A B3 publica
 * 33,333333333 para a bonificacao de 1/3 do PETR4 em 1994 e a BRAPI publica 1,3333334 - a
 * diferenca e de truncamento da dizima, e cresce com o fator. Um desdobramento 50:1 com o mesmo
 * numero de casas erraria 50 vezes mais em valor absoluto e continuaria sendo o mesmo evento.
 */
export const TOLERANCIA_FATOR = 1e-6;

export const mesmoFator = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(TOLERANCIA_FATOR, Math.abs(b) * TOLERANCIA_FATOR);

/**
 * As datas-ex que um `lastDatePrior` da B3 pode significar.
 *
 * O nome do campo promete a ultima data COM direito, ou seja o pregao ANTERIOR a data-ex. As
 * vezes e isso; as vezes o campo ja traz a propria data-ex. Medido nos 10 eventos conferidos da
 * nossa base em 09/09/2026: BBDC4 2022, BBDC4 2009, PETR4 2008, USIM5 2008 e GGBR4 2024 vem com
 * a DATA-EX; KLBN11 2025 e ITSA4 2025 vem com o dia ANTERIOR.
 *
 * Somar um pregao sempre acerta metade e quebra a outra - foi tentado em `sync-acoes` e
 * revertido no mesmo dia, e o comentario de la registra o episodio. Numa reconciliacao, que so
 * RELATA, a saida honesta e outra: aceitar as duas leituras e casar com qualquer uma delas. Uma
 * auditoria que dispara em todo evento por um dia de convencao vira ruido, e alarme que toca
 * sempre ninguem le - o que e pior do que nao ter alarme.
 */
export function dataExPossiveis(dataDeclarada: string, pregoes: string[]): string[] {
  // Quando a declaracao e anterior ao inicio da nossa serie, "o pregao seguinte" nao existe
  // dentro dela - e perguntar mesmo assim devolve o PRIMEIRO dia da serie, que pode estar anos
  // depois. Foi o que aconteceu com o desdobramento 5:1 do KLBN11: declarado em 24/03/2014,
  // nossa data-ex 25/03/2014, e a serie comeca em 02/01/2023. O candidato calculado virou
  // 02/01/2023, o evento que TEMOS nao casou e a auditoria o reportou como faltante.
  //
  // A armadilha do calendario truncado ja mordeu este projeto antes, em outro lugar (o cupom
  // fantasma no ultimo dia da serie de renda fixa). Fora do alcance da serie a resposta honesta
  // nao e chutar um pregao: e dizer que a data-ex e o dia declarado ou algum dos poucos dias
  // seguintes, porque o proximo pregao depois de uma sexta-feira com feriado ainda cai dentro
  // de quatro dias de calendario.
  const seguinte = dataDeclarada >= (pregoes[0] ?? "9999-12-31")
    ? pregoes.find((d) => d > dataDeclarada)
    : null;
  if (seguinte) return [dataDeclarada, seguinte];

  const dias: string[] = [dataDeclarada];
  const base = new Date(`${dataDeclarada}T00:00:00Z`);
  if (!Number.isFinite(base.getTime())) return dias;
  for (let i = 1; i <= 4; i++) {
    dias.push(new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return dias;
}

export interface ResultadoEventos<T> {
  /** Declarados pela B3 sem par na nossa base. */
  faltantes: { declarado: T; datas_ex_possiveis: string[]; abaixo_do_piso?: boolean }[];
  /** Nossos sem par na B3. NAO se apaga nada por isso - a B3 so publica o ultimo de cada rotulo. */
  sobrando: EventoNosso[];
}

/**
 * Casa o que a B3 declara com o que temos, por (tipo, fator) dentro da janela de data.
 *
 * Por CONTAGEM, como nos proventos, e nao por chave: o mesmo par (tipo, fator) pode se repetir
 * em anos diferentes - BBDC4 tem sete bonificacoes de 1,10 - e casar por chave faria duas delas
 * colapsarem numa.
 *
 * @param piso data-ex minima. Abaixo do piso de calculo nada e reportado como faltante, mas o
 *             evento anterior a ele NAO e ignorado no resto: ele continua valendo para converter
 *             preco antigo em unidades de hoje.
 */
export function reconciliarEventos<T extends EventoDeclaradoMin>(
  nossos: EventoNosso[],
  declarados: T[],
  pregoes: string[],
  piso?: string,
): ResultadoEventos<T> {
  const pendentes = [...nossos];
  const faltantes: ResultadoEventos<T>["faltantes"] = [];

  for (const d of declarados) {
    const datas = dataExPossiveis(d.dataDeclarada, pregoes);
    const i = pendentes.findIndex((n) =>
      n.tipo === d.tipo && mesmoFator(n.fator, d.fator) && datas.includes(n.dataEx));
    if (i >= 0) { pendentes.splice(i, 1); continue; }
    // Nao basta o evento ser antigo: se ele for anterior ao piso E nos ja o tivermos, ele saiu
    // acima. Chegar aqui abaixo do piso e um evento antigo que nao temos - e ele importa,
    // porque converte o preco historico. Por isso a marcacao, em vez do descarte.
    faltantes.push({ declarado: d, datas_ex_possiveis: datas });
  }

  return {
    faltantes: piso
      ? faltantes.map((f) => ({ ...f, abaixo_do_piso: f.datas_ex_possiveis[0] < piso }))
      : faltantes,
    sobrando: pendentes,
  };
}

/** Um preco NOMINAL publicado pela B3, com a data a que ele se refere. */
export interface Ancora {
  data: string;
  precoNominal: number;
}

/**
 * Piso de deteccao do degrau, em razao.
 *
 * O preco da ancora vem com DUAS casas decimais. Num papel de R$ 11,56 meio centavo e 0,043%, e
 * a razao entre duas ancoras acumula os dois arredondamentos: ~0,09% no pior caso. 0,4% deixa
 * folga de quatro vezes sobre esse ruido e ainda pega uma bonificacao de 1%, que e o menor
 * evento que a nossa base ja viu (KLBN11 18/12/2025).
 *
 * Este piso e MUITO menor que os 3% da deteccao dentro do `sync-acoes`, e o motivo e a fonte:
 * la se compara o papel com ele mesmo em dois dias, e o mercado se move no meio; aqui se compara
 * o mesmo dia em duas fontes, e o mercado nao entra na conta.
 */
export const PISO_DEGRAU = 0.004;

export interface DivergenciaDeAjuste {
  de: string;
  para: string;
  degrau_medido: number;
  degrau_esperado: number;
  eventos_na_janela: { tipo: string; fator: number; data_ex: string; ja_refletido: boolean }[];
  diagnostico: string;
}

export interface ResultadoAjuste {
  /** Ancoras que casaram com um pregao nosso. Menos que 2 e medicao impossivel, nao aprovacao. */
  ancoras_usadas: number;
  /**
   * O periodo REALMENTE medido, e nao o que a B3 publica.
   *
   * A distincao nao e cosmetica: a B3 tem ancora de BBDC4 desde 1995 e a nossa serie comeca em
   * 02/01/2023, entao anunciar "1995 a 2026" faria a auditoria parecer cobrir trinta anos que
   * ela nao olhou. Ancora sem pregao nosso do lado nao mede nada.
   */
  periodo: [string, string] | null;
  /** A razao na ancora mais ANTIGA. Diferente de 1 sem degrau depois = ajuste fora da janela. */
  razao_inicial: number | null;
  razao_final: number | null;
  divergencias: DivergenciaDeAjuste[];
}

/**
 * Compara o preco NOMINAL da B3 com a nossa serie e explica cada degrau pelos eventos que temos.
 *
 * A ideia inteira cabe numa frase: se a nossa serie for nominal, a razao B3/nossa e 1 em toda a
 * janela; se ela vier ajustada por um evento, a razao vale o fator antes da data-ex e 1 depois.
 * Entao todo degrau na razao e um evento que a FONTE embutiu no preco, e cada um deles tem que
 * estar na nossa base com `ja_refletido_no_preco = true`. Sobra ou falta e defeito.
 *
 * O que ela NAO pega, e vale dizer: evento que nenhuma fonte declara E que a fonte tambem nao
 * embutiu no preco. E o caso do GGBR4 em 22/03/2023 - a serie e nominal dos dois lados, a razao
 * fica lisa em 1,2000 atravessando a data-ex, e nao ha degrau nenhum para medir. A queda de
 * -4,37% naquele dia tambem nao serve de sinal: sete pregoes antes, em 15/03, o papel caiu
 * -5,36% sem evento nenhum. Um detector de queda que pegasse 22/03 pegaria 15/03 primeiro.
 */
export function degrausDeAjuste(
  ancoras: Ancora[],
  nossaSerie: Map<string, number>,
  eventos: EventoNosso[],
): ResultadoAjuste {
  const pontos = ancoras
    .filter((a) => Number.isFinite(a.precoNominal) && a.precoNominal > 0)
    .map((a) => ({ data: a.data, razao: a.precoNominal / (nossaSerie.get(a.data) ?? NaN) }))
    .filter((p) => Number.isFinite(p.razao) && p.razao > 0)
    .sort((a, b) => a.data.localeCompare(b.data));

  const vazio: ResultadoAjuste = {
    ancoras_usadas: pontos.length,
    periodo: pontos.length ? [pontos[0].data, pontos.at(-1)!.data] : null,
    razao_inicial: pontos[0]?.razao ?? null,
    razao_final: pontos.at(-1)?.razao ?? null,
    divergencias: [],
  };
  if (pontos.length < 2) return vazio;

  const arredonda = (n: number) => +n.toFixed(6);
  const divergencias: DivergenciaDeAjuste[] = [];

  for (let i = 1; i < pontos.length; i++) {
    const de = pontos[i - 1].data;
    const para = pontos[i].data;
    const medido = pontos[i - 1].razao / pontos[i].razao;

    // A janela e (de, para]: um evento com data-ex igual a `de` ja esta refletido no preco
    // daquele dia, entao ele nao explica o degrau que vem DEPOIS dele.
    const naJanela = eventos.filter((e) => e.dataEx > de && e.dataEx <= para);
    const esperado = naJanela
      .filter((e) => e.jaRefletidoNoPreco)
      .reduce((f, e) => f * e.fator, 1);

    const temDegrau = Math.abs(medido - 1) > PISO_DEGRAU;
    const esperaDegrau = Math.abs(esperado - 1) > PISO_DEGRAU;
    // Frouxo de proposito: o degrau medido carrega o arredondamento de duas ancoras, e o que
    // se quer distinguir e "o fator explica" de "o fator nao explica", nao a sexta casa.
    const explicado = Math.abs(medido / esperado - 1) <= PISO_DEGRAU;
    if (explicado) continue;

    const lista = naJanela.map((e) => ({
      tipo: e.tipo, fator: e.fator, data_ex: e.dataEx, ja_refletido: e.jaRefletidoNoPreco,
    }));

    // O diagnostico e escrito aqui, e nao no relatorio, porque as tres situacoes exigem acoes
    // diferentes e quem le o JSON precisa saber qual e sem refazer a conta.
    let diagnostico: string;
    // Com a tolerancia do FATOR, e nao a do degrau, este teste nunca casaria: o degrau medido
    // carrega o arredondamento de duas ancoras de duas casas e cai em 1,19999 onde o fator e
    // 1,2 exato. A pergunta aqui e "o fator explica o degrau?", que e a mesma de `explicado`.
    const casaComEvento = naJanela.find((e) => Math.abs(medido / e.fator - 1) <= PISO_DEGRAU);
    if (temDegrau && casaComEvento && !casaComEvento.jaRefletidoNoPreco) {
      diagnostico = `a serie JA vem ajustada pelo ${casaComEvento.tipo} de `
        + `${casaComEvento.dataEx} (fator ${casaComEvento.fator}), mas ele esta marcado como `
        + "nao refletido. O motor vai dividir o preco uma segunda vez: "
        + "`ja_refletido_no_preco` precisa virar true.";
    } else if (temDegrau && !naJanela.length) {
      diagnostico = "a fonte embutiu no preco um evento que a nossa base NAO tem. "
        + `A razao contra o preco nominal da B3 cai de ${arredonda(pontos[i - 1].razao)} para `
        + `${arredonda(pontos[i].razao)} sem nenhum evento cadastrado entre as duas datas.`;
    } else if (!temDegrau && esperaDegrau) {
      diagnostico = "ha evento marcado como ja refletido no preco, mas a serie NAO tem degrau "
        + "nenhum aqui - ou seja, ela e nominal. Com a marca em true o motor deixa de converter "
        + "o preco antigo para unidades de hoje.";
    } else {
      diagnostico = "o degrau medido nao bate com o fator dos eventos desta janela. "
        + "Pode ser data-ex errada, fator errado, ou evento a mais e a menos se cancelando.";
    }

    divergencias.push({
      de, para,
      degrau_medido: arredonda(medido),
      degrau_esperado: arredonda(esperado),
      eventos_na_janela: lista,
      diagnostico,
    });
  }

  return { ...vazio, divergencias };
}

/**
 * O MESMO evento gravado duas vezes.
 *
 * Nao e hipotese: a base tem tres casos vindos de cargas antigas - PETR4 25/04/2008 e
 * 21/06/2000, KLBN11 25/03/2014 - e em todos eles as duas linhas discordam justamente na marca
 * `ja_refletido_no_preco`, uma em true e a outra em false. Os tres tem data-ex anterior ao
 * inicio da serie de precos, entao hoje sao inertes: o motor so aplica o fator quando
 * `data_ex > data`. Um duplicado DENTRO da janela de calculo nao seria - ele dobraria a
 * quantidade ou dividiria o preco duas vezes.
 *
 * Reportar em campo proprio, e nao deixar cair em `sem_par_na_b3`: la eles se misturam com o
 * caso normal (a B3 so publica o ultimo evento de cada rotulo) e o defeito fica invisivel no
 * meio de vinte linhas esperadas.
 *
 * Nao se apaga nada por isto. Escolher qual das duas linhas fica exige medir o degrau de preco
 * na data-ex, e quando ela e anterior ao inicio da serie nao ha o que medir - apagar a errada
 * seria chute com cara de correcao.
 */
export function duplicados(nossos: EventoNosso[]) {
  const porChave = new Map<string, EventoNosso[]>();
  for (const e of nossos) {
    const k = `${e.dataEx}|${e.tipo}|${e.fator}`;
    const lista = porChave.get(k);
    if (lista) lista.push(e);
    else porChave.set(k, [e]);
  }
  return [...porChave.values()]
    .filter((lista) => lista.length > 1)
    .map((lista) => ({
      data_ex: lista[0].dataEx,
      tipo: lista[0].tipo,
      fator: lista[0].fator,
      copias: lista.length,
      fontes: lista.map((e) => e.fonte),
      // Quando as copias discordam da marca, o motor obedece a uma delas e ninguem sabe qual.
      marcas_divergentes: new Set(lista.map((e) => e.jaRefletidoNoPreco)).size > 1,
    }));
}
