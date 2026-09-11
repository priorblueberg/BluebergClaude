/**
 * O que a gaveta de detalhes da posição mostra, calculado num lugar só.
 *
 * A gaveta abre na Posição Consolidada e na lâmina de Fundos de Investimentos. As duas precisam
 * dos mesmos números para a mesma posição, então a conta da posição de fundo, o gráfico e a
 * tabela de rentabilidade saem daqui.
 */
import { calcularFundoDiario, type FundoDailyRow, type FundoMovimentacao } from "@/lib/fundoEngine";
import { cotasCosturadas, trechosDaPosicao, type MovimentoDeFundo } from "@/lib/posicaoDeFundo";
import { situacaoDaPosicao } from "@/lib/situacaoDaPosicao";
import { buildCdiSeries, buildIbovespaSeries, type CdiRecord, type PontoIbovespa } from "@/lib/cdiCalculations";
import type { DetailRow } from "@/components/RentabilidadeDetailTable";
import type { PontoRentabilidade } from "@/components/HistoricoRentabilidadeChart";

/** Dados da posição na data de referência. */
export interface DadosDaPosicao {
  valorInvestido: number | null;
  quantidade: number | null;
  ultimoPreco: number | null;
  dataUltimoPreco: string | null;
  precoMedio: number | null;
}

export const SEM_DADOS: DadosDaPosicao = {
  valorInvestido: null, quantidade: null, ultimoPreco: null, dataUltimoPreco: null, precoMedio: null,
};

/** Ultimo preco publicado ate a data. */
export function ultimoAte(serie: { data: string; valor: number }[], ate: string): { data: string; valor: number } | null {
  let achado: { data: string; valor: number } | null = null;
  for (const ponto of serie) {
    if (ponto.data <= ate && (!achado || ponto.data > achado.data)) achado = ponto;
  }
  return achado;
}

/** Dados da posicao com preco e quantidade. Preco medio como no Gorila: valor investido / quantidade. */
export function dadosDaPosicao(
  valorInvestido: number,
  quantidade: number,
  ultimo: { data: string; valor: number } | null,
): DadosDaPosicao {
  const temSaldo = quantidade > 1e-8;
  return {
    valorInvestido,
    quantidade: temSaldo ? quantidade : 0,
    ultimoPreco: ultimo?.valor ?? null,
    dataUltimoPreco: ultimo?.data ?? null,
    precoMedio: temSaldo ? valorInvestido / quantidade : null,
  };
}

export interface PosicaoDeFundoCalculada {
  linhas: FundoDailyRow[];
  valorAtualizado: number;
  ganho: number;
  /** Money-weighted, em %: a mesma da linha da Posição Consolidada. */
  rentabilidadePct: number;
  encerrada: boolean;
  dados: DadosDaPosicao;
  /** Rentabilidade acumulada (%) por dia util. */
  serie: { data: string; pct: number }[];
}

/** A conta de uma posição de fundo, igual para todas as telas. */
export function calcularPosicaoDeFundo(e: {
  dataInicio: string;
  resgateTotal: string | null;
  fundoId: string;
  diasCotizacaoAplicacao?: number | null;
  diasCotizacaoResgate?: number | null;
  /** Todas as movimentações da posição. */
  movimentacoes: FundoMovimentacao[];
  /** As mesmas, com o fundo de cada uma: costuram a série quando o fundo mudou no caminho. */
  movimentosDaPosicao: MovimentoDeFundo[];
  cotasPorFundo: Map<string, { data: string; valor_cota: number }[]>;
  calendario: { data: string; dia_util: boolean }[];
  dataReferenciaISO: string;
}): PosicaoDeFundoCalculada | null {
  const fim = e.resgateTotal && e.resgateTotal < e.dataReferenciaISO ? e.resgateTotal : e.dataReferenciaISO;
  const trechos = trechosDaPosicao(e.movimentosDaPosicao);
  const cotas = trechos.length > 1 ? cotasCosturadas(trechos, e.cotasPorFundo) : (e.cotasPorFundo.get(e.fundoId) || []);
  const linhas = calcularFundoDiario({
    dataInicio: e.dataInicio,
    dataCalculo: fim,
    calendario: e.calendario,
    cotas,
    movimentacoes: e.movimentacoes,
    fundo: {
      dias_cotizacao_aplicacao: e.diasCotizacaoAplicacao ?? 0,
      dias_cotizacao_resgate: e.diasCotizacaoResgate ?? 0,
    },
  });
  if (linhas.length === 0) return null;

  const ult = linhas[linhas.length - 1];
  const { encerrada, valorExibido } = situacaoDaPosicao(
    ult.saldoBruto,
    !!e.resgateTotal && e.resgateTotal <= e.dataReferenciaISO,
  );
  return {
    linhas,
    valorAtualizado: valorExibido,
    ganho: ult.ganhoAcumulado,
    rentabilidadePct: ult.rentabilidadeAcumuladaMWPct * 100,
    encerrada,
    dados: dadosDaPosicao(
      ult.valorInvestido,
      ult.saldoCotas,
      ultimoAte(cotas.map((c) => ({ data: c.data, valor: c.valor_cota })), fim),
    ),
    serie: linhas.filter((r) => r.diaUtil).map((r) => ({ data: r.data, pct: r.rentabilidadeAcumuladaMWPct * 100 })),
  };
}

const MESES = 12;

/**
 * Tabela de rentabilidade por ano a partir das séries ACUMULADAS da posição e do CDI.
 *
 * Sair do acumulado, e não de retornos diários, é o que garante que o produto dos meses feche no
 * mesmo número do resumo e do fim do gráfico. Mês e ano valem (1 + acumulado no fim) /
 * (1 + acumulado no fim do período anterior) - 1.
 */
export function tabelaDeRentabilidade(
  serie: { data: string; pct: number }[],
  cdiSerie: { data: string; cdi_acumulado: number }[],
): DetailRow[] {
  const fimDeMes = (pontos: { data: string; valor: number }[]) => {
    const porMes = new Map<string, number>();
    for (const p of [...pontos].sort((a, b) => a.data.localeCompare(b.data))) porMes.set(p.data.slice(0, 7), p.valor);
    return porMes;
  };
  const rent = fimDeMes(serie.map((s) => ({ data: s.data, valor: s.pct })));
  const cdi = fimDeMes(cdiSerie.map((c) => ({ data: c.data, valor: c.cdi_acumulado })));
  const meses = [...new Set([...rent.keys(), ...cdi.keys()])].sort();
  if (meses.length === 0) return [];

  const noPeriodo = (fim: number, base: number) => parseFloat((((1 + fim / 100) / (1 + base / 100) - 1) * 100).toFixed(2));
  const anos = [...new Set(meses.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);

  const linhas: DetailRow[] = [];
  let rentFimAnoAnterior = 0;
  let cdiFimAnoAnterior = 0;
  let rentFimMesAnterior = 0;
  let cdiFimMesAnterior = 0;
  for (const ano of anos) {
    const rentMeses: (number | null)[] = [];
    const cdiMeses: (number | null)[] = [];
    for (let mes = 1; mes <= MESES; mes++) {
      const chave = `${ano}-${String(mes).padStart(2, "0")}`;
      const r = rent.get(chave);
      const c = cdi.get(chave);
      rentMeses.push(r == null ? null : noPeriodo(r, rentFimMesAnterior));
      cdiMeses.push(c == null ? null : noPeriodo(c, cdiFimMesAnterior));
      if (r != null) rentFimMesAnterior = r;
      if (c != null) cdiFimMesAnterior = c;
    }
    linhas.push({
      year: ano,
      patrimonioMonths: Array(MESES).fill(null),
      ganhoFinanceiroMonths: Array(MESES).fill(null),
      rentabilidadeMonths: rentMeses,
      cdiMonths: cdiMeses,
      rentNoAno: noPeriodo(rentFimMesAnterior, rentFimAnoAnterior),
      rentAcumulado: parseFloat(rentFimMesAnterior.toFixed(2)),
      cdiNoAno: noPeriodo(cdiFimMesAnterior, cdiFimAnoAnterior),
      cdiAcumulado: parseFloat(cdiFimMesAnterior.toFixed(2)),
      ganhoNoAno: null,
      ganhoAcumulado: null,
    });
    rentFimAnoAnterior = rentFimMesAnterior;
    cdiFimAnoAnterior = cdiFimMesAnterior;
  }
  return linhas.reverse();
}

/** Gráfico (posição, CDI e Ibovespa), CDI acumulado e tabela de rentabilidade, na janela da posição. */
export function montarGraficoETabela(e: {
  serie: { data: string; pct: number }[];
  cdiRecords: CdiRecord[];
  ibovespa: PontoIbovespa[];
  inicio: string;
  fim: string;
}): { grafico: PontoRentabilidade[]; cdiAcumuladoPct: number | null; tabela: DetailRow[] } {
  const cdiSerie = buildCdiSeries(e.cdiRecords, e.inicio, e.fim);
  const naJanela = e.serie.filter((s) => s.data >= e.inicio && s.data <= e.fim);

  const pontos = new Map<string, PontoRentabilidade>();
  for (const c of cdiSerie) pontos.set(c.data, { data: c.data, cdi_acumulado: c.cdi_acumulado });
  for (const s of naJanela) {
    const ponto = pontos.get(s.data) ?? { data: s.data };
    ponto.posicao_acumulado = Number(s.pct.toFixed(4));
    pontos.set(s.data, ponto);
  }
  // Ibovespa rebaseado no primeiro pregao da janela da posicao.
  for (const [dia, valor] of buildIbovespaSeries(e.ibovespa, e.inicio, e.fim)) {
    const ponto = pontos.get(dia) ?? { data: dia };
    ponto.ibovespa_acumulado = valor;
    pontos.set(dia, ponto);
  }

  return {
    grafico: [...pontos.values()].sort((a, b) => a.data.localeCompare(b.data)),
    cdiAcumuladoPct: cdiSerie.length ? cdiSerie[cdiSerie.length - 1].cdi_acumulado : null,
    tabela: tabelaDeRentabilidade(naJanela, cdiSerie),
  };
}
