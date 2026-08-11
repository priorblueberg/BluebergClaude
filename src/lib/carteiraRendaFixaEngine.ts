/**
 * Engine de Cálculo da Carteira de Renda Fixa (Simplificado)
 *
 * Colunas:
 * - Data, Dia Útil
 * - Líquido (1): soma de todos os títulos
 * - Líquido (2): soma de todos os títulos
 * - Rent. Diária (R$): soma da Rent. Diária (R$) de todos os títulos
 * - Rent. Diária (%): Rent. Diária (R$) / base consolidada do dia
 * - Rent. Acumulada (R$): acumulado da Rent. Diária (R$)
 * - Rent. Acumulada (%): composição (1+acum_anterior)*(1+diaria)-1
 */

import { DailyRow } from "./rendaFixaEngine";

export interface CarteiraRFRow {
  data: string;
  diaUtil: boolean;
  liquido: number;
  liquido2: number;
  rentDiariaRS: number;
  rentDiariaPct: number;
  rentAcumuladaRS: number;
  rentAcumuladaPct: number;
}

export interface CarteiraRFInput {
  productRows: DailyRow[][];
  calendario: { data: string; dia_util: boolean }[];
  dataInicio: string;
  dataCalculo: string;
}

export function calcularCarteiraRendaFixa(input: CarteiraRFInput): CarteiraRFRow[] {
  const { productRows, calendario, dataInicio, dataCalculo } = input;

  // Build per-date aggregation maps from all products
  const dateAgg = new Map<string, {
    liquido: number;
    liquido2: number;
    aplicacoes: number;
    rentDiariaRS: number;
  }>();

  for (const rows of productRows) {
    for (const row of rows) {
      if (row.data < dataInicio || row.data > dataCalculo) continue;
      const existing = dateAgg.get(row.data) || { liquido: 0, liquido2: 0, aplicacoes: 0, rentDiariaRS: 0 };
      existing.liquido += row.liquido;
      existing.liquido2 += row.liquido2;
      existing.aplicacoes += row.aplicacoes;
      existing.rentDiariaRS += row.ganhoDiario;
      dateAgg.set(row.data, existing);
    }
  }

  const sorted = [...calendario]
    .filter(c => c.data >= dataInicio && c.data <= dataCalculo)
    .sort((a, b) => a.data.localeCompare(b.data));

  const result: CarteiraRFRow[] = [];
  let rentAcumuladaRS = 0;
  let rentAcumuladaPct = 0;
  let prevLiquido = 0;

  for (const cal of sorted) {
    const agg = dateAgg.get(cal.data);

    if (!agg) {
      // No product data — carry forward
      result.push({
        data: cal.data,
        diaUtil: cal.dia_util,
        liquido: 0,
        liquido2: 0,
        rentDiariaRS: 0,
        rentDiariaPct: 0,
        rentAcumuladaRS,
        rentAcumuladaPct,
      });
      continue;
    }

    const { liquido, liquido2, aplicacoes, rentDiariaRS } = agg;

    // Segue a mesma base usada na composição diária consolidada da tabela de detalhe
    const baseRentabilidade = prevLiquido + aplicacoes;
    const rentDiariaPct = baseRentabilidade > 0.01 ? rentDiariaRS / baseRentabilidade : 0;

    rentAcumuladaRS += rentDiariaRS;
    rentAcumuladaPct = (1 + rentAcumuladaPct) * (1 + rentDiariaPct) - 1;

    result.push({
      data: cal.data,
      diaUtil: cal.dia_util,
      liquido,
      liquido2,
      rentDiariaRS,
      rentDiariaPct,
      rentAcumuladaRS,
      rentAcumuladaPct,
    });

    prevLiquido = liquido;
  }

  return result;
}
