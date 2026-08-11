/**
 * Poupança Engine
 * 
 * Calcula a evolução diária de lotes de poupança, com rendimento
 * creditado apenas no aniversário mensal de cada lote.
 * 
 * Regras:
 * - Selic > 8.5% a.a. → 0.5% ao mês + TR (TR = 0 no MVP)
 * - Selic ≤ 8.5% a.a. → 70% da Selic ao mês + TR
 * - Rendimento ocorre apenas no "aniversário" (dia do mês da aplicação)
 * - Resgate segue FIFO (First In, First Out)
 */

import type { DailyRow } from "./rendaFixaEngine";

export interface PoupancaLote {
  id: string;
  data_aplicacao: string;
  dia_aniversario: number;
  valor_principal: number;
  valor_atual: number;
  rendimento_acumulado: number;
  ultimo_aniversario: string | null;
  status: string;
  data_resgate: string | null;
}

export interface PoupancaEngineInput {
  dataInicio: string;
  dataCalculo: string;
  calendario: { data: string; dia_util: boolean }[];
  movimentacoes: { data: string; tipo_movimentacao: string; valor: number }[];
  lotes: PoupancaLote[];
  selicRecords: { data: string; taxa_anual: number }[];
  trRecords?: { data: string; taxa_mensal: number }[];
  poupancaRendimentoRecords?: { data: string; rendimento_mensal: number }[];
  dataResgateTotal?: string | null;
}

interface LoteState {
  id: string;
  dataAplicacao: string;
  diaAniversario: number;
  valorPrincipal: number;
  valorAtual: number;
  rendimentoAcumulado: number;
  ultimoAniversario: string | null;
  status: string;
}

/**
 * Calcula o rendimento mensal da poupança com base na Selic vigente.
 * Fórmula oficial: (1 + remunBase) × (1 + TR) - 1
 * remunBase = 0.5% se Selic > 8.5%, senão 70% da Selic mensal.
 */
function calcRendimentoMensal(valorAtual: number, selicAnual: number, trMensal: number): number {
  const tr = trMensal / 100; // Convert from % to decimal
  let remunBase: number;
  if (selicAnual > 8.5) {
    remunBase = 0.005; // 0.5% ao mês
  } else {
    // 70% da Selic mensal
    const fatorMensal = Math.pow(1 + selicAnual / 100, 1 / 12);
    remunBase = (fatorMensal - 1) * 0.70;
  }
  // Composição: (1 + remunBase) × (1 + TR) - 1
  return valorAtual * ((1 + remunBase) * (1 + tr) - 1);
}

/**
 * Retorna a data-base da TR para o aniversário: dia do aniversário do mês anterior.
 * Ex: aniversário em 04/04/2024 → data-base = 04/03/2024.
 */
function getDataBaseTR(aniversarioISO: string, diaAniversario: number): string {
  const [y, m] = aniversarioISO.split("-").map(Number);
  // Mês anterior (0-indexed for getAniversarioNoMes)
  let prevMonth = m - 2; // m is 1-indexed, we need 0-indexed minus 1
  let prevYear = y;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear -= 1;
  }
  return getAniversarioNoMes(prevYear, prevMonth, diaAniversario);
}

/**
 * Calcula a data do próximo aniversário a partir de uma data base.
 * Ajusta para o último dia do mês quando necessário (ex: dia 31 em fevereiro → dia 28).
 */
function getAniversarioNoMes(year: number, month: number, diaAniversario: number): string {
  // month is 0-indexed
  const lastDay = new Date(year, month + 1, 0).getDate();
  const dia = Math.min(diaAniversario, lastDay);
  const m = String(month + 1).padStart(2, "0");
  const d = String(dia).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/**
 * Verifica se uma data ISO é dia de aniversário de um lote.
 */
function isAniversario(dataISO: string, diaAniversario: number): boolean {
  const [y, m] = dataISO.split("-").map(Number);
  const expected = getAniversarioNoMes(y, m - 1, diaAniversario);
  return dataISO === expected;
}

/**
 * Calcula a evolução diária da poupança, retornando DailyRow[] compatível
 * com o engine de renda fixa para integração com a carteira.
 */
export function calcularPoupancaDiario(input: PoupancaEngineInput): DailyRow[] {
  const { dataInicio, dataCalculo, calendario, movimentacoes, lotes, selicRecords, trRecords, poupancaRendimentoRecords, dataResgateTotal } = input;

  // Build poupança rendimento map (série 195 BCB — preferred source)
  const poupRendMap = new Map<string, number>();
  if (poupancaRendimentoRecords) {
    for (const r of poupancaRendimentoRecords) {
      poupRendMap.set(r.data, r.rendimento_mensal);
    }
  }

  // Build Selic map (fallback when série 195 not available)
  const selicMap = new Map<string, number>();
  for (const r of selicRecords) {
    selicMap.set(r.data, r.taxa_anual);
  }

  // Build TR map (fallback when série 195 not available)
  const trMap = new Map<string, number>();
  if (trRecords) {
    for (const r of trRecords) {
      trMap.set(r.data, r.taxa_mensal);
    }
  }

  // Get latest Selic for fallback
  let lastSelic = 13.75; // fallback
  const sortedSelic = [...selicRecords].sort((a, b) => a.data.localeCompare(b.data));
  if (sortedSelic.length > 0) {
    lastSelic = sortedSelic[sortedSelic.length - 1].taxa_anual;
  }

  // Build movimentações map
  const movMap = new Map<string, { aplicacoes: number; resgates: number }>();
  for (const m of movimentacoes) {
    const entry = movMap.get(m.data) || { aplicacoes: 0, resgates: 0 };
    if (m.tipo_movimentacao === "Aplicação" || m.tipo_movimentacao === "Aplicação Inicial") {
      entry.aplicacoes += m.valor;
    } else if (m.tipo_movimentacao === "Resgate" || m.tipo_movimentacao === "Resgate Total") {
      entry.resgates += m.valor;
    }
    movMap.set(m.data, entry);
  }

  // Sort and filter calendar
  const sortedCal = calendario
    .filter(c => c.data >= dataInicio && c.data <= dataCalculo)
    .sort((a, b) => a.data.localeCompare(b.data));

  if (sortedCal.length === 0) return [];

  // Initialize lote states (only active lotes)
  const loteStates: LoteState[] = lotes
    .filter(l => l.status === "ativo" || l.data_resgate !== null)
    .map(l => ({
      id: l.id,
      dataAplicacao: l.data_aplicacao,
      diaAniversario: Number(l.dia_aniversario),
      valorPrincipal: Number(l.valor_principal),
      valorAtual: Number(l.valor_principal), // Start from principal, will accumulate
      rendimentoAcumulado: 0,
      ultimoAniversario: null,
      status: "ativo",
    }));

  const rows: DailyRow[] = [];
  let rentAcum2 = 0;
  let ganhoAcumulado = 0;
  let totalAplicacoes = 0;
  let totalResgates = 0;

  // Track which lotes are active on each day
  const activeLotesOnDate = (date: string) =>
    loteStates.filter(l => l.dataAplicacao <= date && l.status === "ativo");

  for (let idx = 0; idx < sortedCal.length; idx++) {
    const cal = sortedCal[idx];
    const date = cal.data;
    const diaUtil = cal.dia_util;

    // Track latest Selic for fallback
    if (selicMap.has(date)) lastSelic = selicMap.get(date)!;

    // Calculate rendimento for lotes that have anniversary today
    let rendimentoDia = 0;
    const activeLotes = activeLotesOnDate(date);

    for (const lote of activeLotes) {
      if (date <= lote.dataAplicacao) continue;

      // Credit yield on anniversary date regardless of business day
      if (isAniversario(date, lote.diaAniversario)) {
        // Preferred: use série 195 (rendimento direto da poupança do BCB)
        const dataBaseTR = getDataBaseTR(date, lote.diaAniversario);
        const serie195 = poupRendMap.get(dataBaseTR);

        let rendBruto: number;
        if (serie195 !== undefined) {
          // Série 195 já inclui 0.5% + TR compostos com precisão oficial
          rendBruto = lote.valorAtual * (serie195 / 100);
        } else {
          // Fallback: calcular a partir de Selic + TR
          const selicHoje = selicMap.get(date) ?? lastSelic;
          const trDataBase = trMap.get(dataBaseTR) ?? 0;
          rendBruto = calcRendimentoMensal(lote.valorAtual, selicHoje, trDataBase);
        }

        // Manter 8 casas decimais no intermediário (padrão B3/CETIP)
        // para evitar drift de arredondamento ao longo dos meses
        const rend = Math.round(rendBruto * 1e8) / 1e8;
        lote.valorAtual += rend;
        lote.rendimentoAcumulado += rend;
        lote.ultimoAniversario = date;
        rendimentoDia += rend;
      }
    }

    // Process movimentações
    const mov = movMap.get(date) || { aplicacoes: 0, resgates: 0 };
    totalAplicacoes += mov.aplicacoes;
    totalResgates += mov.resgates;

    // Process resgates: reduce lote values proportionally (FIFO within the single lote)
    if (mov.resgates > 0) {
      let restante = mov.resgates;
      // Sort active lotes by application date (FIFO)
      const sortedActive = [...activeLotes].sort((a, b) => a.dataAplicacao.localeCompare(b.dataAplicacao));
      for (const lote of sortedActive) {
        if (restante <= 0.01) break;
        if (lote.valorAtual <= 0.01) continue;

        if (restante >= lote.valorAtual - 0.01) {
          // Consume entire lote
          restante -= lote.valorAtual;
          lote.valorAtual = 0;
          lote.valorPrincipal = 0;
          lote.rendimentoAcumulado = 0;
          lote.status = "resgatado";
        } else {
          // Partial consumption — reduce proportionally
          const proporcao = restante / lote.valorAtual;
          lote.valorPrincipal -= lote.valorPrincipal * proporcao;
          lote.rendimentoAcumulado -= lote.rendimentoAcumulado * proporcao;
          lote.valorAtual -= restante;
          restante = 0;
        }
      }
    }

    // Calculate totals
    const liquido = activeLotes.reduce((sum, l) => sum + l.valorAtual, 0);
    const valorInvestido = activeLotes.reduce((sum, l) => sum + l.valorPrincipal, 0);

    // Ganho diário
    const ganhoDiario = rendimentoDia;
    ganhoAcumulado += ganhoDiario;

    // Rentabilidade diária %
    const prevLiquido = idx > 0 ? rows[idx - 1].liquido : 0;
    const base = prevLiquido + mov.aplicacoes;
    const rentDiariaPct = base > 0.01 ? ganhoDiario / base : 0;
    rentAcum2 = (1 + rentAcum2) * (1 + rentDiariaPct) - 1;

    const row: DailyRow = {
      data: date,
      diaUtil,
      valorCota: 1,
      saldoCotas: liquido,
      liquido,
      valorCota2: 1,
      saldoCotas2: liquido + mov.resgates,
      liquido2: liquido + mov.resgates,
      aplicacoes: mov.aplicacoes,
      qtdCotasCompra: 0,
      resgates: mov.resgates,
      qtdCotasResgate: 0,
      ganhoDiario,
      ganhoAcumulado,
      rentabilidadeAcumuladaPct: rentAcum2,
      cdiDiario: 0,
      multiplicador: 0,
      pagamentoJuros: 0,
      apoioCupom: 0,
      cupomAcumulado: 0,
      jurosPago: 0,
      valorInvestido,
      resgateLimpo: mov.resgates,
      precoUnitario: 0,
      qtdAplicacaoPU: 0,
      qtdResgatePU: 0,
      puJurosPeriodicos: 0,
      qtdAplicacao2: 0,
      qtdResgate2: 0,
      baseEconomica: valorInvestido,
      aplicacaoExCupom: mov.aplicacoes,
      resgateExCupom: mov.resgates,
      rentabilidadeDiaria: rentDiariaPct > 0 ? rentDiariaPct : null,
      rentDiariaPct,
      rentAcumulada2: rentAcum2,
    };

    rows.push(row);

    // Check resgate total
    if (dataResgateTotal && date === dataResgateTotal) break;
  }

  return rows;
}

/**
 * Constrói lotes de poupança a partir das movimentações (somente aplicações).
 * Use esta função em vez de buscar lotes do banco de dados para evitar
 * contagem dupla de resgates (o engine aplica resgates via FIFO).
 */
export function buildPoupancaLotesFromMovs(
  movimentacoes: { data: string; tipo_movimentacao: string; valor: number }[]
): PoupancaLote[] {
  return movimentacoes
    .filter(m => m.tipo_movimentacao === "Aplicação Inicial" || m.tipo_movimentacao === "Aplicação")
    .map((m, idx) => ({
      id: `derived-${idx}`,
      data_aplicacao: m.data,
      dia_aniversario: new Date(m.data + "T00:00:00").getDate(),
      valor_principal: m.valor,
      valor_atual: m.valor,
      rendimento_acumulado: 0,
      ultimo_aniversario: null,
      status: "ativo",
      data_resgate: null,
    }));
}

/**
 * Algoritmo FIFO para resgate de poupança.
 * Consome lotes do mais antigo para o mais novo.
 * Retorna os lotes atualizados e o valor efetivamente resgatado.
 */
export function resgatarPoupancaFIFO(
  lotes: LoteState[],
  valorResgate: number,
  dataResgate: string
): { lotesAtualizados: LoteState[]; valorResgatado: number } {
  const sorted = [...lotes]
    .filter(l => l.status === "ativo")
    .sort((a, b) => a.dataAplicacao.localeCompare(b.dataAplicacao));

  let restante = valorResgate;
  let valorResgatado = 0;

  for (const lote of sorted) {
    if (restante <= 0) break;

    const disponivel = lote.valorAtual;

    if (restante >= disponivel - 0.01) {
      // Consume entire lote
      valorResgatado += disponivel;
      restante -= disponivel;
      lote.status = "resgatado";
      lote.valorAtual = 0;
      lote.valorPrincipal = 0;
    } else {
      // Partial consumption
      const proporcao = restante / lote.valorAtual;
      lote.valorPrincipal -= lote.valorPrincipal * proporcao;
      lote.rendimentoAcumulado -= lote.rendimentoAcumulado * proporcao;
      lote.valorAtual -= restante;
      valorResgatado += restante;
      restante = 0;
    }
  }

  return { lotesAtualizados: sorted, valorResgatado };
}
