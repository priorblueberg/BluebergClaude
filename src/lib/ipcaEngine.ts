/**
 * Fator de correcao do IPCA para titulo privado, na convencao que o Gorila usa.
 *
 * A regra foi medida contra o Gorila em 30/08/2026, com dois CDB IPCA+6% identicos
 * exceto pelo dia do vencimento (08 e 22 de janeiro). Ver
 * `_knowledge/ipca-metodologia-gorila.md` no vault, secao 11. Em resumo:
 *
 *  - a data de aniversario mensal e o DIA DO VENCIMENTO do papel, adiada para o
 *    proximo dia util quando cai em fim de semana ou feriado. Nao e o dia 15, que
 *    e a convencao das NTN-B e das debentures;
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
 * Datas de aniversario que cobrem o calendario, ja adiadas para o proximo dia util.
 * Guardamos a competencia NOMINAL (o mes a que o aniversario pertence), porque e ela
 * que define qual indice o ciclo usa - e nao o mes em que o dia util caiu.
 */
function gerarAniversarios(
  dia: number,
  diasUteis: string[]
): { data: string; competencia: string }[] {
  if (diasUteis.length === 0) return [];
  const uteis = new Set(diasUteis);
  const primeiro = diasUteis[0];
  const ultimo = diasUteis[diasUteis.length - 1];

  let ano = Number(primeiro.slice(0, 4));
  let mes = Number(primeiro.slice(5, 7)) - 1; // comeca um mes antes para cobrir a ponta
  if (mes === 0) { mes = 12; ano -= 1; }

  const out: { data: string; competencia: string }[] = [];
  for (let i = 0; i < 480; i++) {
    const diaEfetivo = Math.min(dia, ultimoDiaDoMes(ano, mes));
    let d = new Date(Date.UTC(ano, mes - 1, diaEfetivo));
    // adia ate cair num dia util do calendario
    for (let k = 0; k < 15; k++) {
      const iso = d.toISOString().slice(0, 10);
      if (uteis.has(iso)) break;
      d = new Date(d.getTime() + 86400000);
    }
    const iso = d.toISOString().slice(0, 10);
    if (uteis.has(iso)) {
      out.push({ data: iso, competencia: `${ano}-${String(mes).padStart(2, "0")}` });
    }
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
  const { diaAniversario, calendario, competencias, projecao } = input;
  const fatoresMensais = montarFatoresMensais(competencias, projecao);
  const diasUteis = calendario.filter((c) => c.dia_util).map((c) => c.data).sort();
  const aniversarios = gerarAniversarios(diaAniversario, diasUteis);

  const out = new Map<string, number>();
  if (aniversarios.length < 2) return out;

  for (let i = 0; i < aniversarios.length - 1; i++) {
    const inicio = aniversarios[i];
    const fim = aniversarios[i + 1].data;

    // O ciclo que comeca no aniversario do mes M carrega a variacao do mes M-1.
    const fatorCiclo = fatoresMensais.get(competenciaAnterior(inicio.competencia));
    if (fatorCiclo == null) continue;

    // dut: dias uteis em (inicio, fim]. O dia do aniversario fecha o ciclo anterior.
    //
    // Testei as duas fronteiras contra os 14 pontos medidos no Gorila: esta erra no
    // maximo 0,083 no PU (R$ 0,83 numa posicao de R$ 11.900), a outra erra 0,232.
    // Fica a ressalva de que no proprio dia do aniversario ha um residuo de cerca de
    // 0,02 no PU, entao a fronteira exata daquele dia ainda nao esta cravada.
    const doCiclo = diasUteis.filter((d) => d > inicio.data && d <= fim);
    if (doCiclo.length === 0) continue;

    const fatorDia = Math.pow(fatorCiclo, 1 / doCiclo.length);
    for (const d of doCiclo) out.set(d, fatorDia);
  }
  return out;
}
