/**
 * Fator de correcao do IPCA para titulo privado, na convencao que o Gorila usa.
 *
 * A regra foi medida contra o Gorila em 30/08/2026, com dois CDB IPCA+6% identicos
 * exceto pelo dia do vencimento (08 e 22 de janeiro). Ver
 * `_knowledge/ipca-metodologia-gorila.md` no vault, secao 11. Em resumo:
 *
 *  - a data de aniversario mensal e o DIA DO VENCIMENTO do papel. Nao e o dia 15,
 *    que e a convencao das NTN-B e das debentures;
 *  - o ciclo e delimitado pelas datas de aniversario NOMINAIS, sem adiar para o
 *    proximo dia util. Medido em 30/08/2026: o fator diario do titulo de vencimento
 *    22, no ciclo de junho, e (1+0,16%)^(1/22) - e 22 e o numero de dias uteis entre
 *    22/07 e 22/08, as datas nominais. Entre as datas adiadas seriam 23. Adiar so
 *    mudaria quando o fator novo entra em vigor, nao o tamanho do periodo;
 *  - o ciclo que comeca no aniversario do mes M aplica a variacao do IPCA do mes
 *    M-1, distribuida pro rata em DIAS UTEIS dentro do ciclo (dup/dut);
 *  - o mes ainda nao divulgado entra pela projecao ANBIMA. Como o Gorila recalcula
 *    o passado com o indice ja fechado, a projecao so importa para o mes aberto.
 *
 * Devolvemos um fator POR DIA UTIL: aplicar `fator^(1/dut)` todo dia util do ciclo
 * da exatamente o mesmo resultado que `fator^(dup/dut)` acumulado, e encaixa no
 * motor diario sem caso especial.
 */

export interface IpcaCompetencia {
  competencia: string;              // "AAAA-MM"
  numero_indice?: number | null;    // base dez/1993 = 100 (SIDRA 1737 / 2266)
  variacao_mensal?: number | null;  // fallback, em % (2 casas)
  data_publicacao?: string | null;  // dia em que o IBGE divulgou
}

export interface IpcaProjecao {
  competencia: string;
  variacao_projetada: number;       // em %
  /** dia a partir do qual esta leitura vigora; sem ela, vale desde sempre */
  data_referencia?: string | null;
}

export interface FatoresIpcaInput {
  /** dia do mes do vencimento do titulo */
  diaAniversario: number;
  /** calendario ordenado por data */
  calendario: { data: string; dia_util: boolean }[];
  competencias: IpcaCompetencia[];
  projecao?: IpcaProjecao[];
  /**
   * Data de inicio da rentabilidade (a compra). Decide o DESLOCAMENTO do titulo:
   * quando a compra cai EXATAMENTE numa data de aniversario do DIA 15 EM DIANTE (com o
   * indice daquele ciclo ja divulgado), o titulo perde esse mes e passa a acumular a
   * competencia seguinte - em todos os ciclos, nao so no primeiro.
   *
   * Medido no Gorila em 30/08/2026 sobre 12 CDB IPCA+0% comprados em datas diferentes.
   * Os sete comprados em cima do aniversario se separam exatamente pelo dia 15:
   *
   *   compra 08/05/2025 (dia 8)  -> sem deslocamento
   *   compra 10/02/2025 (dia 10) -> sem deslocamento
   *   compra 11/06/2025 (dia 11) -> sem deslocamento
   *   compra 15/05/2025 (dia 15) -> deslocado
   *   compras 29, 30 e 31/07/2025 -> deslocados
   *
   * O corte NAO e a data de divulgacao: o papel de dia 11 foi comprado em 11/06/2025,
   * um dia depois de o IPCA de maio sair (10/06), e mesmo assim nao deslocou. Medido em
   * 11/09/2025: R$ 10.076,19 no Gorila, contra 10.076,18 previstos sem deslocamento e
   * 10.038,99 com. O dia 15 e a mesma fronteira que a planilha Setup.xlsm do Daniel ja
   * usava, e e a data de aniversario do VNA das NTN-B.
   *
   * Em 29/08/2025 os tres titulos de julho mostram PU 1.002,599 no Gorila, que e a
   * variacao de JULHO cheia (0,2599%), nao a de junho (0,2400%) que a convencao normal
   * mandaria. Tratar isso como "o ciclo nao corrige" errava por -1,10 no PU em
   * 24/08/2026; deslocar a competencia derruba o erro para -0,15.
   *
   * A leitura economica fecha: o Gorila nao paga a correcao de um mes cujo indice ja
   * era publico na hora da compra, porque ele ja estava no preco - o papel comeca a
   * corrigir pelo primeiro mes que ainda era incognita.
   */
  dataInicio?: string | null;
}

function competenciaAnterior(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

interface FatorOficial {
  fator: number;
  publicacao?: string | null;
}

/**
 * Fator mensal oficial de cada competencia. O numero-indice e a fonte preferida:
 * acumular variacao arredondada em 2 casas nao da o mesmo resultado que dividir dois
 * numeros-indice, e a ANBIMA exige o indice com as casas que o IBGE divulga.
 */
function montarOficiais(competencias: IpcaCompetencia[]): Map<string, FatorOficial> {
  const ni = new Map<string, number>();
  for (const c of competencias) {
    if (c.numero_indice != null) ni.set(c.competencia, Number(c.numero_indice));
  }

  const out = new Map<string, FatorOficial>();
  for (const c of competencias) {
    const atual = ni.get(c.competencia);
    const anterior = ni.get(competenciaAnterior(c.competencia));
    let fator: number | null = null;
    if (atual != null && anterior != null && anterior !== 0) fator = atual / anterior;
    else if (c.variacao_mensal != null) fator = 1 + Number(c.variacao_mensal) / 100;
    if (fator != null) out.set(c.competencia, { fator, publicacao: c.data_publicacao });
  }
  return out;
}

/** Leituras de projecao por competencia, em ordem de vigencia. */
function montarProjecoes(
  projecao?: IpcaProjecao[]
): Map<string, { desde?: string | null; fator: number }[]> {
  const out = new Map<string, { desde?: string | null; fator: number }[]>();
  for (const p of projecao || []) {
    const lista = out.get(p.competencia) || [];
    lista.push({ desde: p.data_referencia, fator: 1 + Number(p.variacao_projetada) / 100 });
    out.set(p.competencia, lista);
  }
  for (const lista of out.values()) {
    lista.sort((a, b) => String(a.desde ?? "").localeCompare(String(b.desde ?? "")));
  }
  return out;
}

/**
 * A partir deste dia do mes o papel segue a convencao de fim de mes: o aniversario que
 * cai em dia nao util e adiado. Sao os dias que podem nao existir no mes.
 */
const DIA_DE_FIM_DE_MES = 28;

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Datas de aniversario que cobrem o calendario: o dia do vencimento em cada mes. Meses
 * mais curtos que o dia do vencimento usam o ultimo dia do mes (um papel que vence dia
 * 31 faz aniversario em 28 de fevereiro).
 *
 * A data e NOMINAL - nao se adia para dia util - EXCETO para os papeis cujo dia de
 * vencimento e 28, 29, 30 ou 31. Nesses, o aniversario que cai em dia nao util vai para o
 * proximo dia util, e isso encurta o `dut` do ciclo que termina nele. A competencia
 * continua sendo a do mes nominal, mesmo quando a data escorrega para o mes seguinte.
 *
 * Sao justamente os dias que podem SER o ultimo dia do mes - 28 e o menor deles, por
 * causa de fevereiro. E a convencao de fim de mes que o mercado usa para papeis com
 * vencimento na virada. Medido no Gorila em
 * 30/08/2026 sobre 14 CDB IPCA+0%:
 *
 *   dia 29: 29/12/2024 (domingo) -> 30/12. O ciclo tem 21 dias uteis, nao 22. Em
 *   28/02/2025 o Gorila marca R$ 10.087,46; com dut 21 da 10.087,46, com dut 22 da
 *   10.085,85.
 *
 *   dia 29 e 30: 29/03/2025 (sabado) e 30/03/2025 (domingo) -> 31/03. Em 28/03/2025 o
 *   Gorila marca 10.102,75 e 10.102,92; sem adiar dariam 10.103,60 e 10.103,77.
 *
 *   dia 31: 31/05/2025 (sabado) -> 02/06. Em 30/05/2025 o Gorila marca R$ 10.292,67,
 *   que e 0,56%^(21/22); com a data nominal daria 10.295,28.
 *
 * E os papeis de dia 8, 10, 15, 20 e 25 NAO adiam - batem no centavo com a data nominal
 * mesmo quando o aniversario cai em fim de semana (20/04/2025 e 25/05/2025 sao
 * domingos). Adiar esses quebra oito casos que hoje sao exatos.
 *
 * O corte foi medido pelos dois lados, com papeis de vencimento 27/04/2029 e
 * 28/04/2029 comprados em 02/01/2025:
 *
 *   dia 27 NAO adia: 27/04/2025 e domingo e em 25/04/2025 o Gorila marca R$ 10.233,78,
 *   o valor sem adiamento (adiando daria 10.227,12).
 *
 *   dia 28 ADIA: 28/06/2025 e sabado e em 29/08/2025 o Gorila marca R$ 10.390,40,
 *   contra 10.390,34 adiando e 10.388,67 sem adiar.
 *
 * O mes do vencimento nao entra: dois papeis de vencimento 29/04/2029 e 29/09/2029,
 * comprados no mesmo dia, marcam exatamente o mesmo valor no Gorila.
 *
 * Sobre as 66 medicoes, esta regra tem a menor soma de erros (45,15 contra 49,21 da
 * regra do fim de mes e 63,57 de nunca adiar) e o maior numero de pontos exatos (22).
 * Ver as secoes 24 a 28 de `_knowledge/ipca-metodologia-gorila.md`.
 */
function gerarAniversarios(
  dia: number,
  diasUteis: string[],
  dataInicio?: string | null
): { data: string; competencia: string }[] {
  if (diasUteis.length === 0) return [];
  const primeiro = diasUteis[0];
  const ultimo = diasUteis[diasUteis.length - 1];
  const ehUtil = new Set(diasUteis);

  /**
   * Quando a compra cai em cima de um aniversario, o aniversario que FECHA esse
   * primeiro ciclo nao adia. Medido no CDB de vencimento 31/10/2029, comprado em
   * 31/07/2025: 31/08/2025 e domingo, e mesmo assim em 29/08/2025 o Gorila marca
   * R$ 10.025,99, o fator de julho cheio - o que so acontece sem adiamento. Em
   * 01/09/2025 ele marca 10.025,37, contra 10.025,40 sem adiar e 10.025,99 adiando.
   * Ja os aniversarios seguintes do mesmo papel adiam normalmente (31/01/2026 e
   * 28/02/2026, ambos sabados). O papel de vencimento 31/03/2029, comprado em
   * 02/01/2025 - fora de aniversario -, adia esse mesmo 31/08/2025.
   *
   * A regra e empirica: reduz a soma dos erros nos tres papeis deslocados de 16,15
   * para 13,25 e nao piora nenhum ponto, mas nao temos uma leitura de mercado que a
   * explique. Nao muda o valor de hoje, so a serie dos primeiros meses.
   */
  let semAdiamento: string | null = null;
  if (dataInicio) {
    const a0 = Number(dataInicio.slice(0, 4)), m0 = Number(dataInicio.slice(5, 7));
    const nominal0 = `${a0}-${String(m0).padStart(2, "0")}-${String(Math.min(dia, ultimoDiaDoMes(a0, m0))).padStart(2, "0")}`;
    if (nominal0 === dataInicio) {
      let a1 = a0, m1 = m0 + 1;
      if (m1 === 13) { m1 = 1; a1 += 1; }
      semAdiamento = `${a1}-${String(m1).padStart(2, "0")}-${String(Math.min(dia, ultimoDiaDoMes(a1, m1))).padStart(2, "0")}`;
    }
  }

  let ano = Number(primeiro.slice(0, 4));
  let mes = Number(primeiro.slice(5, 7)) - 1; // comeca um mes antes para cobrir a ponta
  if (mes === 0) { mes = 12; ano -= 1; }

  const out: { data: string; competencia: string }[] = [];
  for (let i = 0; i < 480; i++) {
    const diaEfetivo = Math.min(dia, ultimoDiaDoMes(ano, mes));
    let iso = `${ano}-${String(mes).padStart(2, "0")}-${String(diaEfetivo).padStart(2, "0")}`;
    if (dia >= DIA_DE_FIM_DE_MES && iso !== semAdiamento) {
      for (let k = 0; k < 15 && !ehUtil.has(iso); k++) {
        iso = new Date(Date.parse(iso + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
      }
    }
    out.push({ data: iso, competencia: `${ano}-${String(mes).padStart(2, "0")}` });
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    if (iso > ultimo) break;
  }
  return out;
}

/**
 * Fator de IPCA por dia util. Dias nao uteis nao aparecem no mapa (o motor ja os
 * trata como dias sem rendimento).
 */
export function construirFatoresIpcaDiarios(input: FatoresIpcaInput): Map<string, number> {
  const { diaAniversario, calendario, competencias, projecao, dataInicio } = input;
  const oficiais = montarOficiais(competencias);
  const projecoes = montarProjecoes(projecao);

  /**
   * O indice que valia para esta competencia num dia. Enquanto o IBGE nao divulga, o
   * mercado usa a projecao ANBIMA vigente - e ela e revisada na saida do IPCA-15, por
   * volta do dia 26. Medido no Gorila em 30/08/2026 sobre o CDB de vencimento
   * 15/12/2025 (secao 21 do vault): a variacao implicita no ciclo de novembro/2025 era
   * 0,2301% em 25/11, 0,2001% em 26/11 (dia do IPCA-15) e 0,1801% em 12/12, depois da
   * divulgacao oficial em 10/12.
   */
  const fatorVigente = (competencia: string, dia: string): number | undefined => {
    const oficial = oficiais.get(competencia);
    if (oficial?.publicacao && oficial.publicacao <= dia) return oficial.fator;
    let daProjecao: number | undefined;
    for (const p of projecoes.get(competencia) || []) {
      if (!p.desde || p.desde <= dia) daProjecao = p.fator;
    }
    if (daProjecao != null) return daProjecao;
    // Sem projecao vigente, o oficial e o melhor que temos.
    return oficial?.fator;
  };

  const publicacao = new Map<string, string>();
  for (const c of competencias) {
    if (c.data_publicacao) publicacao.set(c.competencia, c.data_publicacao);
  }
  const diasUteis = calendario.filter((c) => c.dia_util).map((c) => c.data).sort();
  const aniversarios = gerarAniversarios(diaAniversario, diasUteis, dataInicio);

  const out = new Map<string, number>();
  if (aniversarios.length < 2) return out;

  // Comprou em cima de um aniversario do dia 15 em diante: o papel pula essa
  // competencia e fica um mes adiantado para sempre. Ver o comentario de `dataInicio`.
  let deslocado = false;
  if (dataInicio) {
    const naCompra = aniversarios.find((a) => a.data === dataInicio);
    if (naCompra && Number(dataInicio.slice(8, 10)) >= 15) {
      const publicado = publicacao.get(competenciaAnterior(naCompra.competencia));
      deslocado = !!publicado && publicado <= dataInicio;
    }
  }

  for (let i = 0; i < aniversarios.length - 1; i++) {
    const inicio = aniversarios[i];
    const fim = aniversarios[i + 1].data;

    // O ciclo que comeca no aniversario do mes M carrega a variacao do mes M-1 - ou a
    // do proprio mes M, quando o papel esta deslocado.
    const competenciaDoCiclo = deslocado
      ? inicio.competencia
      : competenciaAnterior(inicio.competencia);

    // Dias uteis em (aniversario nominal, proximo aniversario nominal]. O dut e o
    // tamanho dessa lista: mesma fronteira para os dias que recebem o fator e para o
    // divisor do pro rata, senao o ciclo aplicaria mais ou menos que a variacao do mes.
    const doCiclo = diasUteis.filter((d) => d > inicio.data && d <= fim);
    if (doCiclo.length === 0) continue;
    const dut = doCiclo.length;

    // O indice pode trocar no meio do ciclo (revisao da projecao, saida do oficial) e,
    // quando troca, o Gorila reprecifica o ciclo DESDE O INICIO. Por isso o acumulado de
    // cada dia e recalculado com o indice vigente naquele dia, e o fator diario e a
    // razao entre acumulados: no dia da troca ele carrega o ajuste inteiro de uma vez.
    let acumuladoAnterior = 1;
    for (let n = 1; n <= dut; n++) {
      const d = doCiclo[n - 1];
      const fator = fatorVigente(competenciaDoCiclo, d);
      if (fator == null) continue;   // indice ainda desconhecido: dia sem correcao
      const acumulado = Math.pow(fator, n / dut);
      out.set(d, acumulado / acumuladoAnterior);
      acumuladoAnterior = acumulado;
    }
  }
  return out;
}
