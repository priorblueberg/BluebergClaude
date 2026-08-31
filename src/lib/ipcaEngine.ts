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

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Datas de aniversario NOMINAIS: o dia do vencimento em cada mes, sem adiar para dia
 * util. Meses mais curtos que o dia do vencimento usam o ultimo dia do mes (um papel
 * que vence dia 31 faz aniversario em 28 de fevereiro).
 *
 * Nao ha adiamento. A versao anterior adiava o aniversario de papeis com vencimento do
 * dia 28 em diante, o que era um artefato: a regra tinha sido inferida de medicoes onde
 * compensava a contagem errada da janela (ver `janelaIncluiOAniversario`). Com a janela
 * certa, o adiamento some.
 */
function gerarAniversarios(
  dia: number,
  diasUteis: string[]
): { data: string; competencia: string }[] {
  if (diasUteis.length === 0) return [];
  const primeiro = diasUteis[0];
  const ultimo = diasUteis[diasUteis.length - 1];

  let ano = Number(primeiro.slice(0, 4));
  let mes = Number(primeiro.slice(5, 7)) - 1; // comeca um mes antes para cobrir a ponta
  if (mes === 0) { mes = 12; ano -= 1; }

  const out: { data: string; competencia: string }[] = [];
  for (let i = 0; i < 480; i++) {
    const diaEfetivo = Math.min(dia, ultimoDiaDoMes(ano, mes));
    const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(diaEfetivo).padStart(2, "0")}`;
    out.push({ data: iso, competencia: `${ano}-${String(mes).padStart(2, "0")}` });
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    if (iso > ultimo) break;
  }
  return out;
}

/**
 * O `dut` (denominador do pro rata) NAO e simplesmente o numero de dias uteis do ciclo.
 * Quando um aniversario cai em dia nao util, o Gorila as vezes desloca a fronteira para
 * o proximo dia util - e o criterio e diferente conforme o aniversario esteja abrindo ou
 * fechando o ciclo. Os dias que RECEBEM o fator continuam sendo os de (aniversario,
 * proximo aniversario], sempre nominais: so o divisor muda.
 *
 * As duas regras abaixo saem de 157 medicoes (17 CDBs de teste no Gorila, jan/2025 a
 * abr/2026). O `dut` de cada ciclo foi lido invertendo o expoente a partir da serie
 * diaria do proprio Gorila (`positions/overview`), o que da numeros inteiros exatos.
 * As duas juntas acertam 157/157.
 *
 * Consequencia pratica: quando a fronteira anda, o ciclo nao fecha exatamente 1 no seu
 * ultimo dia util - ele aplica n/dut. O Gorila realmente vaza (ou dobra) um dia de
 * correcao nessas viradas; nao e arredondamento nosso.
 */

/**
 * No ciclo em que o papel NASCE (a compra caiu no meio dele), quando a compra esta num MES
 * POSTERIOR ao da abertura o Gorila empurra AS DUAS PONTAS do ciclo para o proximo dia
 * util. Se a compra e no mesmo mes da abertura, nada anda.
 *
 * O detalhe que custou caro: quando as duas pontas caem em dia nao util os dois
 * deslocamentos se cancelam e o `dut` volta a ser o da janela nominal. Fevereiro e onde
 * isso mais aparece, porque com 28 dias o mesmo dia do mes cai no MESMO dia da semana no
 * mes seguinte:
 *
 *   abre 15/02/2025 sab -> fecha 15/03/2025 sab -> dut 18 = a janela nominal
 *   abre 22/02/2025 sab -> fecha 22/03/2025 sab -> dut 18 = a janela nominal
 *   abre 13/09/2025 sab -> fecha 13/10/2025 seg -> dut 20, a janela tem 21
 *
 * Que a data da COMPRA entre no divisor e estranho - o `dut` deveria ser propriedade do
 * papel - mas esta medido em duas duplas independentes, dois papeis com o mesmo ciclo e
 * duts diferentes so porque foram comprados em meses diferentes:
 *
 *   abre 13/09/2025, compra 16/09 -> dut 21     abre 21/04/2025, compra 23/04 -> dut 21
 *   abre 13/09/2025, compra 06/10 -> dut 20     abre 21/04/2025, compra 05/05 -> dut 20
 *
 * 44 ciclos de nascimento medidos, 36 na amostra que gerou a regra e 8 cadastrados depois
 * para conferir a previsao. 44/44. Cobre abertura em sabado, domingo e cinco feriados
 * diferentes, fechamento em dia util e nao util, compra no mesmo mes e no mes seguinte.
 *
 * Uma versao anterior desta funcao dizia que fim de semana desloca e feriado nao. Era
 * artefato: os 9 papeis que a geraram tinham todos a compra no mesmo mes.
 */
function compraEmMesPosterior(aberturaDoCiclo: string, dataDaCompra: string): boolean {
  return dataDaCompra.slice(0, 7) > aberturaDoCiclo.slice(0, 7);
}

/** Abertura do ciclo: adia so quando o proximo dia util cai em outro mes. 41/41. */
function corteInicio(data: string, ehDiaUtil: (d: string) => boolean, proximoUtil: (d: string) => string): string {
  if (ehDiaUtil(data)) return data;
  const p = proximoUtil(data);
  return p.slice(0, 7) !== data.slice(0, 7) ? p : data;
}

/**
 * Fechamento do ciclo: adia para o proximo dia util quando o ciclo ABRE no fim do mes,
 * isto e, quando nao sobra nenhum dia util no mes da abertura depois dela. Nao depende do
 * dia do vencimento nem de o fechamento ser fim de mes.
 *
 *   abre 30/04/2025 (ultimo util de abril)  -> fecha 31/05, sab  -> dut conta ate 02/06
 *   abre 28/11/2025 (ultimo util de novembro) -> fecha 28/12, dom -> dut conta ate 29/12
 *   abre 30/07/2025 (ainda ha 31/07 em julho) -> fecha 30/08, sab -> dut para em 29/08
 *
 * Esse terceiro caso e o que derruba qualquer regra baseada no formato do calendario do
 * fechamento: 30/08/2025 e 30/05/2026 sao sabados identicos (dia 31 no domingo, proximo
 * util no mes seguinte) e o Gorila trata os dois de forma diferente. O que os separa e a
 * abertura: 30/04/2026 e o ultimo dia util de abril, 30/07/2025 nao e o de julho.
 *
 * 157/157 ciclos medidos.
 */
function corteFim(
  data: string,
  inicioDoCiclo: string,
  ehDiaUtil: (d: string) => boolean,
  proximoUtil: (d: string) => string,
  haUtilDepoisNoMes: (d: string) => boolean
): string {
  if (ehDiaUtil(data)) return data;
  return haUtilDepoisNoMes(inicioDoCiclo) ? data : proximoUtil(data);
}

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
  const setUteis = new Set(diasUteis);
  const ehDiaUtil = (d: string) => setUteis.has(d);
  const proximoUtil = (d: string) => diasUteis.find((u) => u >= d) ?? d;
  const haUtilDepoisNoMes = (d: string) =>
    diasUteis.some((u) => u > d && u.slice(0, 7) === d.slice(0, 7));

  const aniversarios = gerarAniversarios(diaAniversario, diasUteis);

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
    // O divisor usa as fronteiras deslocadas (ver `corteInicio` / `corteFim`); os dias
    // que recebem o fator, nao. No ciclo em que o papel nasce em cima do aniversario o
    // fechamento nao anda: nao ha ciclo anterior para emendar.
    const cicloDaCompra = dataInicio != null && inicio.data === dataInicio;
    const nasceEmMesAnterior =
      dataInicio != null && inicio.data <= dataInicio && dataInicio <= fim &&
      compraEmMesPosterior(inicio.data, dataInicio);
    const abre = nasceEmMesAnterior
      ? proximoUtil(inicio.data)
      : corteInicio(inicio.data, ehDiaUtil, proximoUtil);
    const fecha = nasceEmMesAnterior
      ? proximoUtil(fim)
      : cicloDaCompra
        ? fim
        : corteFim(fim, inicio.data, ehDiaUtil, proximoUtil, haUtilDepoisNoMes);
    const dut = diasUteis.filter((d) => d > abre && d <= fecha).length;
    if (dut === 0) continue;

    // O indice pode trocar no meio do ciclo (revisao da projecao, saida do oficial) e,
    // quando troca, o Gorila reprecifica o ciclo DESDE O INICIO. Por isso o acumulado de
    // cada dia e recalculado com o indice vigente naquele dia, e o fator diario e a
    // razao entre acumulados: no dia da troca ele carrega o ajuste inteiro de uma vez.
    let acumuladoAnterior = 1;
    // Percorre os dias que RECEBEM o fator (doCiclo). Quando o divisor difere desse
    // total, o ultimo dia do ciclo fecha com expoente diferente de 1 - e o que o Gorila
    // faz nas viradas em que a fronteira anda.
    for (let n = 1; n <= doCiclo.length; n++) {
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
