import { calcularCarteiraRendaFixa } from "./carteiraRendaFixaEngine";
import type { DailyRow } from "./rendaFixaEngine";

export interface MetricasNaJanela {
  /** Patrimônio no fim da janela. Zero se a posição foi encerrada dentro dela. */
  patrimonio: number;
  /** Ganho financeiro DENTRO da janela, não desde a aplicação. */
  ganho: number;
  /** Rentabilidade time-weighted DENTRO da janela, em %. */
  rentabilidade: number;
  /** false quando o papel não tem nenhum dia dentro da janela (morreu antes dela). */
  existiuNaJanela: boolean;
}

/**
 * Ganho e rentabilidade de UM papel dentro da janela de análise.
 *
 * A lista de posições mostrava `ganhoAcumulado` do motor do produto, que acumula desde a
 * aplicação e ignora o período. Com o seletor de período isso ficou insustentável: em
 * "Mês anterior" o card da lâmina dizia R$ 39.041,70 (o mês) e a soma da tabela logo
 * abaixo dava R$ 1.116.975,63 (a vida inteira) - a mesma tela se contradizendo.
 *
 * A conta aqui é a MESMA do card e a mesma dos grupos: o papel passa pelo motor de
 * carteira como um grupo de um. Assim a soma da tabela fecha com o card por construção, e
 * não por coincidência.
 */
export function metricasDoProdutoNaJanela(
  rows: DailyRow[],
  calendario: { data: string; dia_util: boolean }[],
  dataInicio: string,
  dataCalculo: string,
): MetricasNaJanela {
  const existiuNaJanela = rows.some((r) => r.data >= dataInicio && r.data <= dataCalculo);
  if (!existiuNaJanela) {
    return { patrimonio: 0, ganho: 0, rentabilidade: 0, existiuNaJanela: false };
  }

  const linhas = calcularCarteiraRendaFixa({ productRows: [rows], calendario, dataInicio, dataCalculo });
  const ultima = linhas.length > 0 ? linhas[linhas.length - 1] : null;
  return {
    patrimonio: ultima?.liquido ?? 0,
    ganho: ultima?.rentAcumuladaRS ?? 0,
    rentabilidade: (ultima?.rentAcumuladaPct ?? 0) * 100,
    existiuNaJanela: true,
  };
}
