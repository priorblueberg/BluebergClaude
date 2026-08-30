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
}

export interface FatoresIpcaInput {
  /** dia do mes do vencimento do titulo */
  diaAniversario: number;
  /** calendario ordenado por data */
  calendario: { data: string; dia_util: boolean }[];
  competencias: IpcaCompetencia[];
  projecao?: IpcaProjecao[];
  /**
   * Data de inicio da rentabilidade (a compra). So e usada para a regra do ciclo
   * inicial: quando a compra cai EXATAMENTE numa data de aniversario e o indice
   * daquele ciclo ja tinha sido divulgado nesse dia, o ciclo nao corrige.
   *
   * Medido no Gorila em 30/08/2026 com tres titulos comprados no proprio
   * aniversario. Os dois cujo indice ainda nao tinha saido (compra em 10/02/2025,
   * com janeiro divulgado so em 11/02; e em 08/05/2025, com abril divulgado em
   * 09/05) corrigem o primeiro ciclo e batem no centavo. O terceiro, comprado em
   * 15/05/2025 com abril ja publicado desde 09/05, NAO corrige - ignorar isso dava
   * um erro de 4,60 no PU, contra 0,08 com a regra.
   *
   * A leitura economica fecha: o Gorila nao paga a correcao de um mes cujo indice ja
   * era publico na hora da compra, porque ele ja estava no preco.
   */
  dataInicio?: string | null;
}

function competenciaAnterior(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Fator mensal de cada competencia. O numero-indice e a fonte preferida: acumular
 * variacao arredondada em 2 casas nao da o mesmo resultado que dividir dois
 * numeros-indice, e a ANBIMA exige o indice com as casas que o IBGE divulga.
 */
function montarFatoresMensais(
  competencias: IpcaCompetencia[],
  projecao?: IpcaProjecao[]
): Map<string, number> {
  const ni = new Map<string, number>();
  for (const c of competencias) {
    if (c.numero_indice != null) ni.set(c.competencia, Number(c.numero_indice));
  }

  const fatores = new Map<string, number>();
  for (const c of competencias) {
    const atual = ni.get(c.competencia);
    const anterior = ni.get(competenciaAnterior(c.competencia));
    if (atual != null && anterior != null && anterior !== 0) {
      fatores.set(c.competencia, atual / anterior);
    } else if (c.variacao_mensal != null) {
      fatores.set(c.competencia, 1 + Number(c.variacao_mensal) / 100);
    }
  }

  // A projecao so vale onde o indice oficial ainda nao existe.
  for (const p of projecao || []) {
    if (!fatores.has(p.competencia)) {
      fatores.set(p.competencia, 1 + Number(p.variacao_projetada) / 100);
    }
  }
  return fatores;
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Datas de aniversario NOMINAIS que cobrem o calendario: o dia do vencimento em cada
 * mes, sem adiar para dia util. Meses mais curtos que o dia do vencimento usam o
 * ultimo dia do mes (um papel que vence dia 31 faz aniversario em 28 de fevereiro).
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
 * Fator de IPCA por dia util. Dias nao uteis nao aparecem no mapa (o motor ja os
 * trata como dias sem rendimento).
 */
export function construirFatoresIpcaDiarios(input: FatoresIpcaInput): Map<string, number> {
  const { diaAniversario, calendario, competencias, projecao, dataInicio } = input;
  const fatoresMensais = montarFatoresMensais(competencias, projecao);

  const publicacao = new Map<string, string>();
  for (const c of competencias) {
    if (c.data_publicacao) publicacao.set(c.competencia, c.data_publicacao);
  }
  const diasUteis = calendario.filter((c) => c.dia_util).map((c) => c.data).sort();
  const aniversarios = gerarAniversarios(diaAniversario, diasUteis);

  const out = new Map<string, number>();
  if (aniversarios.length < 2) return out;

  for (let i = 0; i < aniversarios.length - 1; i++) {
    const inicio = aniversarios[i];
    const fim = aniversarios[i + 1].data;

    // O ciclo que comeca no aniversario do mes M carrega a variacao do mes M-1.
    const competenciaDoCiclo = competenciaAnterior(inicio.competencia);
    const fatorCiclo = fatoresMensais.get(competenciaDoCiclo);
    if (fatorCiclo == null) continue;

    // Compra em cima do aniversario com o indice do ciclo ja publicado: sem correcao
    // neste ciclo. Ver o comentario de `dataInicio`.
    if (dataInicio && dataInicio === inicio.data) {
      const publicado = publicacao.get(competenciaDoCiclo);
      if (publicado && publicado <= dataInicio) continue;
    }

    // Dias uteis em (aniversario nominal, proximo aniversario nominal]. O dut e o
    // tamanho dessa lista: mesma fronteira para os dias que recebem o fator e para o
    // divisor do pro rata, senao o ciclo aplicaria mais ou menos que a variacao do mes.
    const doCiclo = diasUteis.filter((d) => d > inicio.data && d <= fim);
    if (doCiclo.length === 0) continue;

    const fatorDia = Math.pow(fatorCiclo, 1 / doCiclo.length);
    for (const d of doCiclo) out.set(d, fatorDia);
  }
  return out;
}
