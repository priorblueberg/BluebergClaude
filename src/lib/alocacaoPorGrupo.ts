/**
 * Métricas de alocação por grupo (categoria, instituição, ...) para o dashboard
 * de Investimentos.
 *
 * A rentabilidade de um grupo NÃO é a média das rentabilidades dos títulos nem
 * ganho/capital: para bater com o card totalizador da página, cada grupo passa
 * pelo mesmo motor de carteira (time-weighted) usado no consolidado, só que
 * recebendo apenas as linhas diárias dos seus produtos.
 */
import { calcularCarteiraRendaFixa } from "./carteiraRendaFixaEngine";
import { buildCdiSeries, CdiRecord } from "./cdiCalculations";
import type { DailyRow } from "./rendaFixaEngine";

export interface GrupoMetricas {
  nome: string;
  patrimonio: number;
  ganhoFinanceiro: number | null;
  rentabilidade: number | null;
  cdiAcumulado: number | null;
  sobreCdi: number | null;
  alocacao: number;
}

interface Params {
  /** Índices de allProductRows que compõem cada grupo. */
  gruposIdx: Map<string, number[]>;
  allProductRows: DailyRow[][];
  calendario: { data: string; dia_util: boolean }[];
  cdiRecords: CdiRecord[];
  dataInicio: string;
  dataCalculo: string;
  dataReferencia: string;
  /** Grupos sem motor (só patrimônio em custódia), ex.: categorias ainda não calculadas. */
  extras?: { nome: string; patrimonio: number }[];
}

export function calcularAlocacaoPorGrupo({
  gruposIdx,
  allProductRows,
  calendario,
  cdiRecords,
  dataInicio,
  dataCalculo,
  dataReferencia,
  extras = [],
}: Params): GrupoMetricas[] {
  const linhas: GrupoMetricas[] = [];

  for (const [nome, indices] of gruposIdx) {
    const productRows = indices.map(i => allProductRows[i]).filter(Boolean);
    if (productRows.length === 0) continue;

    const rows = calcularCarteiraRendaFixa({ productRows, calendario, dataInicio, dataCalculo });
    if (rows.length === 0) continue;

    // Posição na data de referência (a carteira pode ir além dela).
    let patrimonio = 0;
    let rentabilidade: number | null = null;
    let ganho: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].data <= dataReferencia) {
        patrimonio = rows[i].liquido;
        rentabilidade = parseFloat((rows[i].rentAcumuladaPct * 100).toFixed(2));
        ganho = rows[i].rentAcumuladaRS;
        break;
      }
    }

    // CDI do período em que o grupo teve posição — um grupo que começou depois
    // não deve ser comparado com o CDI da carteira inteira.
    const primeiraComPosicao = rows.find(r => r.liquido > 0 || r.liquido2 > 0);
    const inicioGrupo = primeiraComPosicao ? primeiraComPosicao.data : dataInicio;
    const cdiSerie = buildCdiSeries(cdiRecords, inicioGrupo, dataCalculo);
    const cdiAcumulado = cdiSerie.length > 0 ? cdiSerie[cdiSerie.length - 1].cdi_acumulado : null;

    const sobreCdi =
      rentabilidade != null && cdiAcumulado != null && cdiAcumulado !== 0
        ? (rentabilidade / cdiAcumulado) * 100
        : null;

    linhas.push({
      nome,
      patrimonio,
      ganhoFinanceiro: ganho,
      rentabilidade,
      cdiAcumulado,
      sobreCdi,
      alocacao: 0,
    });
  }

  for (const extra of extras) {
    if (extra.patrimonio <= 0) continue;
    linhas.push({
      nome: extra.nome,
      patrimonio: extra.patrimonio,
      ganhoFinanceiro: null,
      rentabilidade: null,
      cdiAcumulado: null,
      sobreCdi: null,
      alocacao: 0,
    });
  }

  const total = linhas.reduce((s, l) => s + l.patrimonio, 0);
  return linhas
    .map(l => ({ ...l, alocacao: total > 0 ? (l.patrimonio / total) * 100 : 0 }))
    .filter(l => l.patrimonio > 0)
    .sort((a, b) => b.patrimonio - a.patrimonio);
}
