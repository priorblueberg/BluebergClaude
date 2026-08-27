/**
 * Motor de posição em moeda estrangeira (engine CAMBIO).
 *
 * Uma posição em moeda é saldo x cotação do dia - a mesma matemática do fundo,
 * trocando cota por cotação e aplicação/resgate por compra/venda. Por isso este
 * motor NÃO reimplementa a conta: ele traduz a operação de câmbio e chama o
 * motor de fundo. Duplicar a lógica é como as cópias divergiram antes neste
 * projeto.
 *
 * A rentabilidade aqui é só variação cambial: saldo em moeda não rende juros.
 */
import {
  calcularFundoDiario, fundoRowsToDailyRows, type FundoDailyRow,
} from "./fundoEngine";
import type { DailyRow } from "./rendaFixaEngine";

export const MOEDAS = [
  { codigo: "USD", nome: "Dólar americano", simbolo: "US$", tabela: "historico_dolar" },
  { codigo: "EUR", nome: "Euro", simbolo: "€", tabela: "historico_euro" },
] as const;

export type CodigoMoeda = (typeof MOEDAS)[number]["codigo"];

export const moedaPorCodigo = (codigo: string | null | undefined) =>
  MOEDAS.find((m) => m.codigo === codigo) ?? null;

const COMPRAS = new Set(["Compra", "Aplicação", "Aplicação Inicial"]);
const VENDAS = new Set(["Venda", "Resgate", "Resgate Total"]);

export interface CambioMovimentacao {
  data: string;
  tipo: string;
  /** Valor em reais da operação. */
  valor: number;
  /** Quantidade na moeda; em branco, derivada pela cotação do dia. */
  quantidade?: number | null;
  data_cotizacao?: string | null;
}

export interface CambioEngineInput {
  dataInicio: string;
  dataCalculo: string;
  calendario: { data: string; dia_util: boolean }[];
  /** Série da moeda: cotação de venda por dia útil. */
  cotacoes: { data: string; cotacao: number }[];
  movimentacoes: CambioMovimentacao[];
}

/** Linha diária da posição em moeda. Nomes em termos de câmbio. */
export interface CambioDailyRow {
  data: string;
  diaUtil: boolean;
  cotacao: number;
  variacaoCotacaoPct: number;
  compras: number;
  qtdComprada: number;
  vendas: number;
  qtdVendida: number;
  saldoMoeda: number;
  saldoReais: number;
  custoMedio: number;
  valorInvestido: number;
  ganhoDiario: number;
  ganhoAcumulado: number;
  rentDiariaPct: number;
  rentabilidadeAcumuladaPct: number;
  rentabilidadeAcumuladaMWPct: number;
  cotacaoEstimada: boolean;
}

const traduzir = (r: FundoDailyRow): CambioDailyRow => ({
  data: r.data,
  diaUtil: r.diaUtil,
  cotacao: r.valorCota,
  variacaoCotacaoPct: r.variacaoCotaPct,
  compras: r.aplicacoes,
  qtdComprada: r.qtdCotasCompra,
  vendas: r.resgatesBrutos,
  qtdVendida: r.qtdCotasResgate,
  saldoMoeda: r.saldoCotas,
  saldoReais: r.saldoBruto,
  custoMedio: r.custoMedioCota,
  valorInvestido: r.valorInvestido,
  ganhoDiario: r.ganhoDiario,
  ganhoAcumulado: r.ganhoAcumulado,
  rentDiariaPct: r.rentDiariaPct,
  rentabilidadeAcumuladaPct: r.rentabilidadeAcumuladaPct,
  rentabilidadeAcumuladaMWPct: r.rentabilidadeAcumuladaMWPct,
  cotacaoEstimada: r.cotaEstimada,
});

export function calcularCambioDiario(input: CambioEngineInput): CambioDailyRow[] {
  const rows = calcularFundoDiario({
    dataInicio: input.dataInicio,
    dataCalculo: input.dataCalculo,
    calendario: input.calendario,
    cotas: input.cotacoes.map((c) => ({ data: c.data, valor_cota: c.cotacao })),
    movimentacoes: input.movimentacoes
      .filter((m) => COMPRAS.has(m.tipo) || VENDAS.has(m.tipo))
      .map((m) => ({
        data: m.data,
        tipo: COMPRAS.has(m.tipo) ? "Aplicação" : "Resgate",
        valor: m.valor,
        qtd_cotas: m.quantidade ?? null,
        data_cotizacao: m.data_cotizacao ?? null,
      })),
    // Cambio liquida no proprio dia da operacao: nao ha prazo de cotizacao.
    fundo: { dias_cotizacao_aplicacao: 0, dias_cotizacao_resgate: 0 },
  });
  return rows.map(traduzir);
}

/** Linhas no formato que o motor de carteira consolida. */
export function cambioRowsToDailyRows(rows: CambioDailyRow[]): DailyRow[] {
  return fundoRowsToDailyRows(
    rows.map((r) => ({
      data: r.data,
      diaUtil: r.diaUtil,
      valorCota: r.cotacao,
      variacaoCotaPct: r.variacaoCotacaoPct,
      aplicacoes: r.compras,
      qtdCotasCompra: r.qtdComprada,
      resgatesBrutos: r.vendas,
      qtdCotasResgate: r.qtdVendida,
      saldoCotas: r.saldoMoeda,
      saldoBruto: r.saldoReais,
      baseMW: 0,
      valorInvestido: r.valorInvestido,
      custoMedioCota: r.custoMedio,
      ganhoDiario: r.ganhoDiario,
      ganhoAcumulado: r.ganhoAcumulado,
      rentDiariaPct: r.rentDiariaPct,
      rentabilidadeAcumuladaPct: r.rentabilidadeAcumuladaPct,
      rentDiariaMWPct: 0,
      rentabilidadeAcumuladaMWPct: r.rentabilidadeAcumuladaMWPct,
      cotaEstimada: r.cotacaoEstimada,
    })),
  );
}

export default { calcularCambioDiario, cambioRowsToDailyRows, MOEDAS, moedaPorCodigo };
