/**
 * O PERÍODO de cálculo, do produto à carteira (regra do Daniel, 11/09/2026).
 *
 * PRODUTO. Começa na aplicação inicial e termina na MENOR de três datas: a data global (o seletor do
 * cabeçalho), o último dado válido do produto e o encerramento (resgate total ou vencimento). Tudo o
 * que se mostra do produto obedece a esse período, inclusive o benchmark: o CDI já divulgado depois
 * da última cota de um fundo não entra na conta dele.
 *
 * Último dado válido, por tipo:
 * - renda fixa (pré, pós CDI, IPCA+ e poupança): a própria data global. O CDI vigente vale até a
 *   próxima reunião do Copom, e o carry-forward já grava o dia com `provisorio`;
 * - fundo: a última cota divulgada;
 * - moeda: a última PTAX oficial (a linha repetida pelo carry-forward não conta);
 * - ação: a última barra negociada, INCLUSIVE a do pregão em andamento. A cópia do dia anterior não
 *   conta (ver `ultimaBarraReal`).
 *
 * CARTEIRA. Vai do menor início ao MAIOR fim entre os produtos com posição. O produto que termina
 * antes recebe o valor repetido até o fim da carteira (os motores já repetem a última cota/preço com
 * variação zero), e o benchmark da carteira vai até esse fim. Na tabela, a linha do produto mostra
 * o próprio período.
 *
 * DATA GLOBAL EFETIVA. A data global cai no último dia útil até ela: num domingo, o período termina
 * na sexta. Não se cria provisório para fim de semana.
 */

export type DiaDoCalendario = { data: string; dia_util: boolean };

const menor = (a: string, b: string) => (a < b ? a : b);

/** Último dia útil até a data global. Sem calendário que a cubra, fica a própria data. */
export function dataGlobalEfetiva(calendario: DiaDoCalendario[], dataGlobal: string): string {
  let achado: string | null = null;
  for (const dia of calendario) {
    if (dia.dia_util && dia.data <= dataGlobal && (achado === null || dia.data > achado)) achado = dia.data;
  }
  return achado ?? dataGlobal;
}

/** Última data de uma série até `ate`, considerando só os pontos aceitos por `vale`. */
export function ultimaDataAte<T extends { data: string }>(
  serie: T[],
  ate: string,
  vale: (ponto: T) => boolean = () => true,
): string | null {
  let achado: string | null = null;
  for (const ponto of serie) {
    if (ponto.data <= ate && vale(ponto) && (achado === null || ponto.data > achado)) achado = ponto.data;
  }
  return achado;
}

export interface BarraDeAcao {
  data: string;
  fechamento: number | null;
  abertura?: number | null;
  maxima?: number | null;
  minima?: number | null;
  volume?: number | null;
  provisorio?: boolean | null;
}

/**
 * Último dia com preço negociado de verdade, até `ate`.
 *
 * As duas barras provisórias têm a mesma marca no banco e significados opostos:
 * - a do pregão em andamento tem valores próprios (o último negócio de hoje) e VALE;
 * - a cópia do dia anterior repete a véspera inteira (abertura, máxima, mínima, fechamento e volume)
 *   e NÃO vale: não é preço novo, é repetição, como a cota de fundo repetida.
 *
 * Dois pregões de verdade nunca têm os cinco valores iguais. É o mesmo critério que o `sync-acoes`
 * usa para marcar a cópia.
 */
export function ultimaBarraReal(barras: BarraDeAcao[], ate: string): string | null {
  const ordenadas = [...barras].filter((b) => b.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
  let achado: string | null = null;
  let anterior: BarraDeAcao | null = null;
  for (const b of ordenadas) {
    const copia = !!b.provisorio && anterior !== null
      && b.fechamento === anterior.fechamento && (b.abertura ?? null) === (anterior.abertura ?? null)
      && (b.maxima ?? null) === (anterior.maxima ?? null) && (b.minima ?? null) === (anterior.minima ?? null)
      && (b.volume ?? null) === (anterior.volume ?? null);
    if (!copia && b.fechamento != null) achado = b.data;
    anterior = b;
  }
  return achado;
}

/**
 * Fim do período de um produto.
 *
 * `ultimoDado`:
 * - `undefined`: o produto não depende de série própria (renda fixa) e vai até a data global;
 * - `null`: a série existe e não tem nenhum ponto até a data global, então não há período (`null`);
 * - data: o último dado válido.
 */
export function fimDoProduto(e: {
  dataGlobal: string;
  ultimoDado?: string | null;
  encerramento?: string | null;
}): string | null {
  if (e.ultimoDado === null) return null;
  let fim = e.dataGlobal;
  if (e.ultimoDado !== undefined) fim = menor(fim, e.ultimoDado);
  if (e.encerramento) fim = menor(fim, e.encerramento);
  return fim;
}

/**
 * Fim do período da carteira: o maior fim entre os produtos COM POSIÇÃO. Produto encerrado não
 * recebe mais nada e não estica a carteira. Se nenhum tem posição (carteira encerrada), vale o maior
 * fim entre todos. `null` quando não há período nenhum.
 */
export function fimDaCarteira(produtos: { fim: string | null; comPosicao: boolean }[]): string | null {
  const maior = (fins: (string | null)[]) =>
    fins.reduce<string | null>((m, f) => (f !== null && (m === null || f > m) ? f : m), null);
  return maior(produtos.filter((p) => p.comPosicao).map((p) => p.fim)) ?? maior(produtos.map((p) => p.fim));
}

/** O período de uma carteira, como os hooks o entregam às telas e à carteira de cima. */
export interface PeriodoDaCarteira {
  fim: string | null;
  /** Algum produto com posição no fim. A carteira sem posição não estica a de cima. */
  comPosicao: boolean;
  /** Data global efetiva usada no cálculo. */
  dataGlobal: string;
  /** Data da lingueta do total da carteira, ou null. */
  lingueta: string | null;
}

/** Fecha o período de uma carteira a partir dos seus produtos (ou das carteiras abaixo dela). */
export function periodoDaCarteira(
  produtos: { fim: string | null; comPosicao: boolean }[],
  dataGlobal: string,
): PeriodoDaCarteira {
  const fim = fimDaCarteira(produtos);
  const comPosicao = produtos.some((p) => p.comPosicao && p.fim !== null);
  return { fim, comPosicao, dataGlobal, lingueta: linguetaDoFim(fim, dataGlobal, comPosicao) };
}

/**
 * Data da lingueta cinza: aparece quando o período termina antes da data global efetiva, para mostrar
 * que o dado não está em D0. Produto encerrado não leva lingueta (já tem o selo de encerrado).
 */
export function linguetaDoFim(fim: string | null, dataGlobal: string, ativo = true): string | null {
  return ativo && fim !== null && fim < dataGlobal ? fim : null;
}
