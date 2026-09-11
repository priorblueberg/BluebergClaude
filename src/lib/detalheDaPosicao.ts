/**
 * O que a gaveta de detalhes da posição mostra, calculado num lugar só.
 *
 * A gaveta abre na Posição Consolidada e na lâmina de Fundos de Investimentos. As duas precisam
 * dos mesmos números para a mesma posição, então a conta da posição de fundo, o gráfico e a
 * tabela de rentabilidade saem daqui.
 *
 * REGRA (Daniel, 11/09/2026): respeitar a data do produto. A janela vai da primeira aplicação até
 * a data da última cota divulgada; o CDI não passa dessa data. Sem isso o benchmark anda nos dias
 * em que a cota ainda não saiu e o fundo fica parado, e o % do CDI do mês corrente despenca (setembro
 * de 2026 dava 72% no SulAmérica; na mesma janela, 101,80%). O período de cada tipo de produto
 * está em `src/lib/periodo.ts`.
 */
import { calcularFundoDiario, type FundoDailyRow, type FundoMovimentacao } from "@/lib/fundoEngine";
import { cotasCosturadas, trechosDaPosicao, type MovimentoDeFundo } from "@/lib/posicaoDeFundo";
import { situacaoDaPosicao } from "@/lib/situacaoDaPosicao";
import { buildCdiSeries, buildIbovespaSeries, type CdiRecord, type PontoIbovespa } from "@/lib/cdiCalculations";
import type { DetailRow } from "@/components/RentabilidadeDetailTable";
import type { PontoRentabilidade } from "@/components/HistoricoRentabilidadeChart";
import { dataGlobalEfetiva, fimDoProduto, ultimaDataAte } from "@/lib/periodo";

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
  /** Fim do período do fundo: a última cota divulgada até a data global, ou o resgate total. */
  fim: string | null;
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
  // No fim de semana a data global cai no último dia útil.
  const global = dataGlobalEfetiva(e.calendario, e.dataReferenciaISO);
  const fim = e.resgateTotal && e.resgateTotal < global ? e.resgateTotal : global;
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
    fim: fimDoProduto({ dataGlobal: global, ultimoDado: ultimaDataAte(cotas, global), encerramento: e.resgateTotal }),
  };
}

const MESES = 12;
const arredonda = (v: number) => parseFloat(v.toFixed(2));

/** % do CDI com todas as casas: arredondar antes de dividir erra até ~0,3 ponto (1,21 / 1,21). */
const percentualDoCdi = (rent: number | null, cdi: number | null) =>
  rent != null && cdi != null && cdi > 0 ? arredonda((rent / cdi) * 100) : null;

/**
 * Tabela de rentabilidade por ano a partir das séries ACUMULADAS da posição e do CDI.
 *
 * Sair do acumulado, e não de retornos diários, é o que garante que o produto dos meses feche no
 * mesmo número do resumo e do fim do gráfico. Mês e ano valem (1 + acumulado no fim) /
 * (1 + acumulado no fim do período anterior) - 1. O % do CDI é calculado ANTES de arredondar.
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

  const noPeriodo = (fim: number, base: number) => ((1 + fim / 100) / (1 + base / 100) - 1) * 100;
  const anos = [...new Set(meses.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);

  const linhas: DetailRow[] = [];
  let rentFimAnoAnterior = 0;
  let cdiFimAnoAnterior = 0;
  let rentFimMesAnterior = 0;
  let cdiFimMesAnterior = 0;
  for (const ano of anos) {
    const rentMeses: (number | null)[] = [];
    const cdiMeses: (number | null)[] = [];
    const percentualMeses: (number | null)[] = [];
    for (let mes = 1; mes <= MESES; mes++) {
      const chave = `${ano}-${String(mes).padStart(2, "0")}`;
      const r = rent.get(chave);
      const c = cdi.get(chave);
      const rentMes = r == null ? null : noPeriodo(r, rentFimMesAnterior);
      const cdiMes = c == null ? null : noPeriodo(c, cdiFimMesAnterior);
      rentMeses.push(rentMes == null ? null : arredonda(rentMes));
      cdiMeses.push(cdiMes == null ? null : arredonda(cdiMes));
      percentualMeses.push(percentualDoCdi(rentMes, cdiMes));
      if (r != null) rentFimMesAnterior = r;
      if (c != null) cdiFimMesAnterior = c;
    }
    const rentAno = noPeriodo(rentFimMesAnterior, rentFimAnoAnterior);
    const cdiAno = noPeriodo(cdiFimMesAnterior, cdiFimAnoAnterior);
    linhas.push({
      year: ano,
      patrimonioMonths: Array(MESES).fill(null),
      ganhoFinanceiroMonths: Array(MESES).fill(null),
      rentabilidadeMonths: rentMeses,
      cdiMonths: cdiMeses,
      rentNoAno: arredonda(rentAno),
      rentAcumulado: arredonda(rentFimMesAnterior),
      cdiNoAno: arredonda(cdiAno),
      cdiAcumulado: arredonda(cdiFimMesAnterior),
      ganhoNoAno: null,
      ganhoAcumulado: null,
      percentualCdiMonths: percentualMeses,
      percentualCdiNoAno: percentualDoCdi(rentAno, cdiAno),
    });
    rentFimAnoAnterior = rentFimMesAnterior;
    cdiFimAnoAnterior = cdiFimMesAnterior;
  }
  return linhas.reverse();
}

/**
 * Gráfico (posição, CDI e Ibovespa), CDI acumulado e tabela de rentabilidade, na janela do
 * produto: do início da posição até `fim`, cortado na última data com preço divulgado
 * (`ultimaDataDoProduto`, a última cota do fundo) quando ela vem antes.
 */
export function montarGraficoETabela(e: {
  serie: { data: string; pct: number }[];
  cdiRecords: CdiRecord[];
  ibovespa: PontoIbovespa[];
  inicio: string;
  fim: string;
  ultimaDataDoProduto?: string | null;
}): { grafico: PontoRentabilidade[]; cdiAcumuladoPct: number | null; tabela: DetailRow[] } {
  const fim = e.ultimaDataDoProduto && e.ultimaDataDoProduto < e.fim ? e.ultimaDataDoProduto : e.fim;
  const cdiSerie = buildCdiSeries(e.cdiRecords, e.inicio, fim);
  const naJanela = e.serie.filter((s) => s.data >= e.inicio && s.data <= fim);

  const pontos = new Map<string, PontoRentabilidade>();
  for (const c of cdiSerie) pontos.set(c.data, { data: c.data, cdi_acumulado: c.cdi_acumulado });
  for (const s of naJanela) {
    const ponto = pontos.get(s.data) ?? { data: s.data };
    ponto.posicao_acumulado = Number(s.pct.toFixed(4));
    pontos.set(s.data, ponto);
  }
  // Ibovespa rebaseado no primeiro pregao da janela da posicao.
  for (const [dia, valor] of buildIbovespaSeries(e.ibovespa, e.inicio, fim)) {
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
