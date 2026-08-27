/**
 * Motor de rentabilidade de fundos de investimento (engine FUNDO).
 *
 * Premissa: a rentabilidade vem SO da variacao da cota (ja liquida de taxa de
 * administracao). Nao ha calculo de tributacao aqui - come-cotas e IR entram
 * como movimentacao de saida lancada pelo usuario.
 *
 * Portado do motor validado do vault (`_engine/fundoEngine.mjs`), com um
 * adaptador que devolve as linhas no formato DailyRow para o motor de carteira
 * consolidar fundos e renda fixa no mesmo lugar.
 */
import type { DailyRow } from "./rendaFixaEngine";

const TIPOS_ENTRADA = new Set(["Aplicação", "Aplicacao", "Aplicação Inicial", "Aplicacao Inicial"]);
const TIPOS_SAIDA = new Set(["Resgate", "Resgate Total", "Come-Cotas", "Come-cotas", "Resgate no Vencimento"]);

export interface FundoMovimentacao {
  data: string;
  tipo: string;
  valor: number;
  data_cotizacao?: string | null;
  qtd_cotas?: number | null;
}

export interface FundoDailyRow {
  data: string;
  diaUtil: boolean;
  valorCota: number;
  variacaoCotaPct: number;
  aplicacoes: number;
  qtdCotasCompra: number;
  resgatesBrutos: number;
  qtdCotasResgate: number;
  saldoCotas: number;
  saldoBruto: number;
  baseMW: number;
  valorInvestido: number;
  custoMedioCota: number;
  ganhoDiario: number;
  ganhoAcumulado: number;
  rentDiariaPct: number;
  rentabilidadeAcumuladaPct: number;
  rentDiariaMWPct: number;
  rentabilidadeAcumuladaMWPct: number;
  cotaEstimada: boolean;
}

export interface FundoEngineInput {
  dataInicio: string;
  dataCalculo: string;
  calendario: { data: string; dia_util: boolean }[];
  cotas: { data: string; valor_cota: number }[];
  movimentacoes: FundoMovimentacao[];
  fundo?: { dias_cotizacao_aplicacao?: number | null; dias_cotizacao_resgate?: number | null };
}

function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Data que fica `n` dias uteis depois de `iso`. Cotizacao nunca cai em dia nao util. */
export function offsetDiasUteis(iso: string, n: number, utilSet: Set<string>, maxData?: string): string {
  let cur = iso;
  while (!utilSet.has(cur)) {
    cur = addDias(cur, 1);
    if (maxData && cur > maxData) return cur;
  }
  let restantes = n;
  while (restantes > 0) {
    cur = addDias(cur, 1);
    while (!utilSet.has(cur)) {
      cur = addDias(cur, 1);
      if (maxData && cur > maxData) return cur;
    }
    restantes--;
  }
  return cur;
}

const round = (x: number, casas: number) => {
  const f = Math.pow(10, casas);
  return Math.round((x + Number.EPSILON) * f) / f;
};

export function calcularFundoDiario(input: FundoEngineInput): FundoDailyRow[] {
  const { dataInicio, dataCalculo, calendario, cotas, movimentacoes = [], fundo = {} } = input;

  const utilSet = new Set(calendario.filter((c) => c.dia_util).map((c) => c.data));
  const cotaMap = new Map(cotas.map((c) => [c.data, Number(c.valor_cota)]));
  const dCotAplic = fundo.dias_cotizacao_aplicacao ?? 0;
  const dCotResg = fundo.dias_cotizacao_resgate ?? 0;
  const maxData = calendario.length ? calendario[calendario.length - 1].data : dataCalculo;

  // Movimentos entram na data de COTIZACAO, nao na data da ordem.
  const movsPorCotizacao = new Map<string, { aplic: FundoMovimentacao[]; resg: FundoMovimentacao[] }>();
  for (const mv of movimentacoes) {
    const ehEntrada = TIPOS_ENTRADA.has(mv.tipo);
    if (!ehEntrada && !TIPOS_SAIDA.has(mv.tipo)) continue;
    const dias = ehEntrada ? dCotAplic : dCotResg;
    const dataCot = mv.data_cotizacao || offsetDiasUteis(mv.data, dias, utilSet, maxData);
    if (!movsPorCotizacao.has(dataCot)) movsPorCotizacao.set(dataCot, { aplic: [], resg: [] });
    const bucket = movsPorCotizacao.get(dataCot)!;
    if (ehEntrada) bucket.aplic.push(mv);
    else bucket.resg.push(mv);
  }

  let saldoCotas = 0;
  let valorInvestido = 0;
  let ganhoAcumulado = 0;
  let fatorRent = 1; // time-weighted: produto de (1 + variacao da cota) nos dias com posicao
  let fatorRentMW = 1; // money-weighted (Dietz diario): dilui pelo capital aportado
  let saldoBrutoAnterior = 0;
  let ultimaCota: number | null = cotaMap.get(dataInicio) ?? null;

  const rows: FundoDailyRow[] = [];
  const dias = calendario.filter((c) => c.data >= dataInicio && c.data <= dataCalculo);

  for (const dia of dias) {
    const data = dia.data;
    const diaUtil = !!dia.dia_util;
    const valorCotaAnterior = ultimaCota;
    const saldoCotasAnterior = saldoCotas;

    let valorCota: number | null;
    let cotaEstimada = false;
    if (cotaMap.has(data)) {
      valorCota = cotaMap.get(data)!;
    } else {
      // dia nao util ou dia util sem cota divulgada: repete a ultima conhecida
      valorCota = ultimaCota;
      if (diaUtil) cotaEstimada = true;
    }
    if (valorCota == null) continue; // antes da 1a cota divulgada nao ha o que calcular

    const variacaoCotaPct =
      valorCotaAnterior && valorCota !== valorCotaAnterior && !cotaEstimada
        ? valorCota / valorCotaAnterior - 1
        : 0;
    const ganhoDiario = saldoCotasAnterior * (valorCota - (valorCotaAnterior ?? valorCota));

    const bucket = movsPorCotizacao.get(data) || { aplic: [], resg: [] };
    let aplicacoes = 0;
    let qtdCotasCompra = 0;
    for (const mv of bucket.aplic) {
      const v = Number(mv.valor);
      aplicacoes += v;
      qtdCotasCompra += mv.qtd_cotas != null ? Number(mv.qtd_cotas) : v / valorCota;
    }

    let resgatesBrutos = 0;
    let qtdCotasResgate = 0;
    for (const mv of bucket.resg) {
      const v = Number(mv.valor);
      resgatesBrutos += v;
      qtdCotasResgate += mv.qtd_cotas != null ? Number(mv.qtd_cotas) : v / valorCota;
    }

    // custo medio ANTES do movimento e a base do custo baixado no resgate
    const custoMedioAntes = saldoCotasAnterior > 0 ? valorInvestido / saldoCotasAnterior : 0;
    const custoMedioResgatado = custoMedioAntes * qtdCotasResgate;

    saldoCotas = saldoCotasAnterior + qtdCotasCompra - qtdCotasResgate;
    if (Math.abs(saldoCotas) < 1e-8) saldoCotas = 0;
    valorInvestido = valorInvestido + aplicacoes - custoMedioResgatado;
    if (saldoCotas === 0) valorInvestido = 0;
    if (valorInvestido < 0 && valorInvestido > -1e-6) valorInvestido = 0;

    // So conta rentabilidade quem tinha posicao na abertura do dia: antes do 1o
    // aporte, ou no hiato depois de um resgate total, a cota nao e do investidor.
    const tinhaPosicao = saldoCotasAnterior > 1e-8;
    const rentDiaria = tinhaPosicao ? variacaoCotaPct : 0;
    ganhoAcumulado += ganhoDiario;
    fatorRent *= 1 + rentDiaria;

    // Base money-weighted: saldo de ontem + aporte de hoje. O aporte comprou cota
    // hoje e so rende amanha, entao dilui o mes do aporte (mesmo efeito do Gorila).
    // Resgate e come-cotas saem no fim do dia e nao reduzem a base.
    const baseMW = saldoBrutoAnterior + aplicacoes;
    const rentDiariaMW = baseMW > 1e-8 ? ganhoDiario / baseMW : 0;
    fatorRentMW *= 1 + rentDiariaMW;

    const saldoBruto = saldoCotas * valorCota;

    rows.push({
      data,
      diaUtil,
      valorCota,
      variacaoCotaPct,
      aplicacoes,
      qtdCotasCompra,
      resgatesBrutos,
      qtdCotasResgate,
      saldoCotas,
      saldoBruto,
      baseMW,
      valorInvestido,
      custoMedioCota: saldoCotas > 0 ? valorInvestido / saldoCotas : 0,
      ganhoDiario,
      ganhoAcumulado,
      rentDiariaPct: rentDiaria,
      rentabilidadeAcumuladaPct: fatorRent - 1,
      rentDiariaMWPct: rentDiariaMW,
      rentabilidadeAcumuladaMWPct: fatorRentMW - 1,
      cotaEstimada,
    });

    saldoBrutoAnterior = saldoBruto;
    ultimaCota = valorCota;
  }

  return rows;
}

/**
 * Traduz as linhas do fundo para o formato DailyRow. E o que permite ao motor de
 * carteira (`calcularCarteiraRendaFixa`) consolidar fundo e renda fixa juntos:
 * ele so olha data, liquido, aplicacoes e ganhoDiario.
 */
export function fundoRowsToDailyRows(rows: FundoDailyRow[]): DailyRow[] {
  return rows.map((r) => {
    const liquidoAntesDoResgate = (r.saldoCotas + r.qtdCotasResgate) * r.valorCota;
    return {
      data: r.data,
      diaUtil: r.diaUtil,
      valorCota: r.valorCota,
      saldoCotas: r.saldoCotas,
      liquido: r.saldoBruto,
      valorCota2: r.valorCota,
      saldoCotas2: r.saldoCotas + r.qtdCotasResgate,
      liquido2: liquidoAntesDoResgate,
      aplicacoes: r.aplicacoes,
      qtdCotasCompra: r.qtdCotasCompra,
      resgates: r.resgatesBrutos,
      qtdCotasResgate: r.qtdCotasResgate,
      ganhoDiario: r.ganhoDiario,
      ganhoAcumulado: r.ganhoAcumulado,
      rentabilidadeAcumuladaPct: r.rentabilidadeAcumuladaPct,
      cdiDiario: 0,
      multiplicador: 0,
      pagamentoJuros: 0,
      apoioCupom: 0,
      cupomAcumulado: 0,
      jurosPago: 0,
      valorInvestido: r.valorInvestido,
      resgateLimpo: r.resgatesBrutos,
      precoUnitario: r.valorCota,
      qtdAplicacaoPU: r.qtdCotasCompra,
      qtdResgatePU: r.qtdCotasResgate,
      puJurosPeriodicos: r.valorCota,
      qtdAplicacao2: r.qtdCotasCompra,
      qtdResgate2: r.qtdCotasResgate,
      baseEconomica: r.saldoBruto,
      aplicacaoExCupom: r.aplicacoes,
      resgateExCupom: r.resgatesBrutos,
      rentabilidadeDiaria: r.ganhoDiario,
      rentDiariaPct: r.rentDiariaPct,
      rentAcumulada2: r.rentabilidadeAcumuladaPct,
    } as DailyRow;
  });
}

export const posicaoFundo = (rows: FundoDailyRow[]) => {
  if (!rows.length) return null;
  const ult = rows[rows.length - 1];
  return {
    dataInicio: rows[0].data,
    dataCalculo: ult.data,
    saldoCotas: round(ult.saldoCotas, 8),
    valorCota: ult.valorCota,
    saldoBruto: round(ult.saldoBruto, 2),
    valorInvestido: round(ult.valorInvestido, 2),
    ganhoAcumulado: round(ult.ganhoAcumulado, 2),
    rentabilidadeAcumuladaPct: ult.rentabilidadeAcumuladaPct,
    rentabilidadeAcumuladaMWPct: ult.rentabilidadeAcumuladaMWPct,
    diasComCotaEstimada: rows.filter((r) => r.cotaEstimada).length,
  };
};

export default { calcularFundoDiario, fundoRowsToDailyRows, posicaoFundo, offsetDiasUteis };
