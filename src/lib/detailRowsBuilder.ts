/**
 * Shared utility – builds DetailRow[] from engine rows + CDI records.
 * Used by AnaliseIndividualPage and CarteiraRendaFixaPage.
 */

import { CdiRecord } from "./cdiCalculations";
import { DetailRow } from "@/components/RentabilidadeDetailTable";

interface EngineRowLike {
  data: string;
  diaUtil: boolean;
  liquido: number;
  aplicacoes: number;
  resgates: number;
  jurosPago?: number;
  saldoCotas: number;
  ganhoAcumulado: number;
  ganhoDiario: number;
  rentabilidadeDiaria: number | null;
  rentDiariaPct?: number;
}

function calcFatorDiarioCdi(taxaAnual: number): number {
  return Math.pow(taxaAnual / 100 + 1, 1 / 252) - 1;
}

export function buildDetailRowsFromEngine(
  dailyRows: EngineRowLike[],
  cdiRecords: CdiRecord[],
  dataInicio: string,
  pagamento?: string | null,
): DetailRow[] {
  if (dailyRows.length === 0) return [];

  // Determine which daily rent field to use
  const useRentAcum2 = pagamento != null && pagamento !== "No Vencimento";

  const cdiMap = new Map<string, CdiRecord>();
  cdiRecords.forEach(r => cdiMap.set(r.data, r));

  let cdiFatorMensal = 1;
  let cdiFatorAnual = 1;
  let ultimaTaxaCdi: number | null = null;
  let currentMonth = -1;
  let currentYear = -1;

  const rentMonthly = new Map<number, Map<number, number>>();
  const cdiMonthly = new Map<number, Map<number, number>>();
  const patrimonioMonthly = new Map<number, Map<number, number>>();
  const ganhoMensalMonthly = new Map<number, Map<number, number>>();
  const ganhoAnualMap = new Map<number, number>();
  const rentYearly = new Map<number, number>();
  const cdiYearly = new Map<number, number>();

  let rentFatorMensal = 1;
  let rentFatorAnual = 1;

  let patrimonioFimMesAnterior = 0;
  let patrimonioInicioAno = 0;
  let aplicacoesMes = 0;
  let resgatesMes = 0;
  let aplicacoesAno = 0;
  let resgatesAno = 0;
  let ganhoDiarioMes = 0;
  let ganhoDiarioAno = 0;
  let ganhoDiarioAcum = 0;
  let prevRowLiquido = 0;

  for (let idx = 0; idx < dailyRows.length; idx++) {
    const row = dailyRows[idx];
    const rowJurosPago = row.jurosPago ?? 0;
    const totalOutflow = row.resgates + rowJurosPago;
    const isVencimentoDay = idx === dailyRows.length - 1 && row.liquido === 0 && totalOutflow > 0;
    if (row.saldoCotas === 0 && row.liquido === 0 && !isVencimentoDay) {
      prevRowLiquido = row.liquido;
      continue;
    }

    const dt = new Date(row.data + "T00:00:00");
    const m = dt.getMonth();
    const y = dt.getFullYear();

    if (currentMonth === -1) {
      currentMonth = m;
      currentYear = y;
      patrimonioFimMesAnterior = 0;
      patrimonioInicioAno = 0;
      aplicacoesMes = 0;
      resgatesMes = 0;
      aplicacoesAno = 0;
      resgatesAno = 0;
      ganhoDiarioMes = 0;
      ganhoDiarioAno = 0;
    } else if (m !== currentMonth) {
      patrimonioFimMesAnterior = (() => {
        const pMap = patrimonioMonthly.get(currentYear);
        return pMap?.get(currentMonth) ?? row.liquido;
      })();
      rentFatorMensal = 1;
      cdiFatorMensal = 1;
      aplicacoesMes = 0;
      resgatesMes = 0;
      ganhoDiarioMes = 0;
      currentMonth = m;
      if (y !== currentYear) {
        patrimonioInicioAno = patrimonioFimMesAnterior;
        rentFatorAnual = 1;
        cdiFatorAnual = 1;
        aplicacoesAno = 0;
        resgatesAno = 0;
        ganhoDiarioAno = 0;
        currentYear = y;
      }
    }

    aplicacoesMes += row.aplicacoes;
    resgatesMes += totalOutflow;
    aplicacoesAno += row.aplicacoes;
    resgatesAno += totalOutflow;
    ganhoDiarioMes += row.ganhoDiario;
    ganhoDiarioAno += row.ganhoDiario;
    ganhoDiarioAcum += row.ganhoDiario;

    let dailyRent: number;
    if (useRentAcum2) {
      if (row.diaUtil && prevRowLiquido > 0.01) {
        dailyRent = row.ganhoDiario / (prevRowLiquido + row.aplicacoes);
      } else {
        dailyRent = 0;
      }
    } else {
      dailyRent = row.rentabilidadeDiaria ?? 0;
    }
    if (dailyRent !== 0) {
      rentFatorMensal *= 1 + dailyRent;
      rentFatorAnual *= 1 + dailyRent;
    }

    prevRowLiquido = row.liquido;

    // Dia util sem CDI publicado repete a ultima taxa conhecida, em vez de nao render. O
    // BCB publica o CDI de D na noite de D+1, entao a ponta da serie vive um ou dois dias
    // atrasada; sem isso o benchmark ficava parado enquanto a carteira andava. E o que o
    // Gorila faz: medido em 2026-09-01, um CDB de 100% do CDI seguiu rendendo em 28/08,
    // 31/08 e 01/09, dias em que o CDI ainda nao tinha saido.
    const cdiRec = cdiMap.get(row.data);
    if (cdiRec) ultimaTaxaCdi = cdiRec.taxa_anual;
    if (ultimaTaxaCdi != null && row.diaUtil) {
      const fd = calcFatorDiarioCdi(ultimaTaxaCdi);
      cdiFatorMensal *= 1 + fd;
      cdiFatorAnual *= 1 + fd;
    }

    if (!rentMonthly.has(y)) rentMonthly.set(y, new Map());
    rentMonthly.get(y)!.set(m, (rentFatorMensal - 1) * 100);

    if (!cdiMonthly.has(y)) cdiMonthly.set(y, new Map());
    cdiMonthly.get(y)!.set(m, (cdiFatorMensal - 1) * 100);

    if (!patrimonioMonthly.has(y)) patrimonioMonthly.set(y, new Map());
    patrimonioMonthly.get(y)!.set(m, row.liquido);

    if (!ganhoMensalMonthly.has(y)) ganhoMensalMonthly.set(y, new Map());
    ganhoMensalMonthly.get(y)!.set(m, parseFloat(ganhoDiarioMes.toFixed(2)));

    ganhoAnualMap.set(y, parseFloat(ganhoDiarioAno.toFixed(2)));
    rentYearly.set(y, (rentFatorAnual - 1) * 100);
    cdiYearly.set(y, (cdiFatorAnual - 1) * 100);
  }

  const years = Array.from(new Set([...rentMonthly.keys(), ...cdiMonthly.keys()])).sort();
  const rows: DetailRow[] = [];
  let rentFatorAcum = 1;
  let cdiFatorAcumRows = 1;

  const ganhoAcum = parseFloat(ganhoDiarioAcum.toFixed(2));

  for (const year of years) {
    const tMap = rentMonthly.get(year);
    const cMap = cdiMonthly.get(year);
    const pMap = patrimonioMonthly.get(year);
    const gMap = ganhoMensalMonthly.get(year);

    const patrimonioMs: (number | null)[] = [];
    const ganhoMs: (number | null)[] = [];
    const rentMs: (number | null)[] = [];
    const cdiMs: (number | null)[] = [];

    for (let mm = 0; mm < 12; mm++) {
      if (tMap?.has(mm)) {
        const pct = tMap.get(mm)!;
        rentMs.push(parseFloat(pct.toFixed(2)));
        rentFatorAcum *= 1 + pct / 100;
      } else {
        rentMs.push(null);
      }
      if (cMap?.has(mm)) {
        const pct = cMap.get(mm)!;
        cdiMs.push(parseFloat(pct.toFixed(2)));
        cdiFatorAcumRows *= 1 + pct / 100;
      } else {
        cdiMs.push(null);
      }
      patrimonioMs.push(pMap?.has(mm) ? parseFloat(pMap.get(mm)!.toFixed(2)) : null);
      ganhoMs.push(gMap?.has(mm) ? parseFloat(gMap.get(mm)!.toFixed(2)) : null);
    }

    rows.push({
      year,
      patrimonioMonths: patrimonioMs,
      ganhoFinanceiroMonths: ganhoMs,
      rentabilidadeMonths: rentMs,
      cdiMonths: cdiMs,
      rentNoAno: rentYearly.has(year) ? parseFloat(rentYearly.get(year)!.toFixed(2)) : null,
      rentAcumulado: parseFloat(((rentFatorAcum - 1) * 100).toFixed(2)),
      cdiNoAno: cdiYearly.has(year) ? parseFloat(cdiYearly.get(year)!.toFixed(2)) : null,
      cdiAcumulado: parseFloat(((cdiFatorAcumRows - 1) * 100).toFixed(2)),
      ganhoNoAno: ganhoAnualMap.has(year) ? parseFloat(ganhoAnualMap.get(year)!.toFixed(2)) : null,
      ganhoAcumulado: ganhoAcum,
    });
  }

  return rows.reverse();
}

/**
 * Consolida as linhas diárias de todos os produtos numa única série e devolve
 * as DetailRow da carteira. Usado pela carteira de Renda Fixa e pelo dashboard
 * de Investimentos (lâmina Total), que precisam da mesma consolidação.
 */
export function buildCarteiraDetailRows(
  allProductRows: { data: string; diaUtil: boolean; liquido: number; aplicacoes: number; resgates: number; jurosPago: number; saldoCotas: number; ganhoDiario: number }[][],
  carteiraRows: { data: string; rentDiariaPct: number | null }[],
  cdiRecords: CdiRecord[],
  dataInicio: string,
  dataCalculo: string,
): DetailRow[] {
  if (allProductRows.length === 0) return [];

  const dateMap = new Map<string, any>();
  for (const prodRows of allProductRows) {
    for (const row of prodRows) {
      if (row.data < dataInicio || row.data > dataCalculo) continue;
      const existing = dateMap.get(row.data);
      if (existing) {
        existing.liquido += row.liquido;
        existing.aplicacoes += row.aplicacoes;
        existing.resgates += row.resgates;
        existing.jurosPago += row.jurosPago;
        existing.saldoCotas += row.saldoCotas;
        existing.ganhoDiario += row.ganhoDiario;
      } else {
        dateMap.set(row.data, {
          data: row.data,
          diaUtil: row.diaUtil,
          liquido: row.liquido,
          aplicacoes: row.aplicacoes,
          resgates: row.resgates,
          jurosPago: row.jurosPago,
          saldoCotas: row.saldoCotas,
          ganhoAcumulado: 0,
          ganhoDiario: row.ganhoDiario,
          rentabilidadeDiaria: null,
        });
      }
    }
  }

  const merged = Array.from(dateMap.values()).sort((a, b) => a.data.localeCompare(b.data));
  const carteiraMap = new Map<string, { rentDiariaPct: number | null }>();
  carteiraRows.forEach(r => carteiraMap.set(r.data, r));

  let ganhoAcum = 0;
  for (const row of merged) {
    ganhoAcum += row.ganhoDiario;
    row.ganhoAcumulado = ganhoAcum;
    const cr = carteiraMap.get(row.data);
    row.rentabilidadeDiaria = cr ? cr.rentDiariaPct : null;
  }

  return buildDetailRowsFromEngine(merged, cdiRecords, dataInicio);
}
