export interface CdiRecord {
  data: string;
  taxa_anual: number;
  dia_util: boolean;
}

export interface ChartPoint {
  data: string;
  label: string;
  cdi_acumulado: number;
}

export interface MonthlyReturn {
  year: number;
  month: number; // 0-11
  value: number; // percentage
}

export interface YearlyReturn {
  year: number;
  value: number; // percentage
}

export interface RentabilidadeRow {
  year: number;
  months: (number | null)[]; // 12 entries (jan=0..dec=11), null if no data
  noAno: number | null;
  acumulado: number | null;
}

function calcFatorDiario(taxaAnual: number): number {
  return Math.pow(taxaAnual / 100 + 1, 1 / 252) - 1;
}

/* ── Prefixado helpers ── */

export interface DiaUtilRecord {
  data: string;
  dia_util: boolean;
}

export function buildPrefixadoSeries(
  diasUteis: DiaUtilRecord[],
  taxaAnual: number,
  dataInicio: string,
  dataCalculo?: string
): ChartPoint[] {
  if (diasUteis.length === 0 || taxaAnual == null) return [];

  const filtered = dataCalculo
    ? diasUteis.filter(r => r.data <= dataCalculo)
    : diasUteis;

  if (filtered.length === 0) return [];

  const fatorDiario = calcFatorDiario(taxaAnual);

  const dtInicio = new Date(dataInicio + "T00:00:00");
  const dtAnterior = new Date(dtInicio);
  dtAnterior.setDate(dtAnterior.getDate() - 1);
  const anteriorISO = dtAnterior.toISOString().slice(0, 10);

  const points: ChartPoint[] = [
    { data: anteriorISO, label: dtAnterior.toLocaleDateString("pt-BR"), cdi_acumulado: 0 },
  ];

  let fatorAcumulado = 1;

  for (const rec of filtered) {
    // Não há rentabilidade no dia da aplicação (D0); título rentabiliza a partir de D+1
    if (rec.dia_util && rec.data !== dataInicio) {
      fatorAcumulado *= 1 + fatorDiario;
    }
    points.push({
      data: rec.data,
      label: new Date(rec.data + "T00:00:00").toLocaleDateString("pt-BR"),
      cdi_acumulado: parseFloat(((fatorAcumulado - 1) * 100).toFixed(4)),
    });
  }

  return points;
}

export function buildPrefixadoRentabilidadeRows(
  diasUteis: DiaUtilRecord[],
  taxaAnual: number,
  dataInicio: string,
  dataCalculo?: string
): RentabilidadeRow[] {
  if (diasUteis.length === 0 || taxaAnual == null) return [];

  const filtered = dataCalculo
    ? diasUteis.filter(r => r.data <= dataCalculo)
    : diasUteis;

  if (filtered.length === 0) return [];

  const fatorDiario = calcFatorDiario(taxaAnual);

  let fatorAcumulado = 1;
  let fatorMensal = 1;
  let fatorAnual = 1;
  let currentMonth = -1;
  let currentYear = -1;

  const monthlyMap = new Map<number, Map<number, number>>();
  const yearlyMap = new Map<number, number>();

  for (const rec of filtered) {
    const dt = new Date(rec.data + "T00:00:00");
    const m = dt.getMonth();
    const y = dt.getFullYear();

    if (currentMonth === -1) {
      currentMonth = m;
      currentYear = y;
      fatorMensal = 1;
      fatorAnual = 1;
    } else if (m !== currentMonth) {
      fatorMensal = 1;
      currentMonth = m;
      if (y !== currentYear) {
        fatorAnual = 1;
        currentYear = y;
      }
    }

    // Não há rentabilidade no dia da aplicação (D0)
    if (rec.dia_util && rec.data !== dataInicio) {
      fatorAcumulado *= 1 + fatorDiario;
      fatorMensal *= 1 + fatorDiario;
      fatorAnual *= 1 + fatorDiario;
    }

    if (!monthlyMap.has(y)) monthlyMap.set(y, new Map());
    monthlyMap.get(y)!.set(m, (fatorMensal - 1) * 100);
    yearlyMap.set(y, (fatorAnual - 1) * 100);
  }

  const years = Array.from(new Set([...monthlyMap.keys(), ...yearlyMap.keys()])).sort();
  const rows: RentabilidadeRow[] = [];
  let fatorAcumRows = 1;

  for (const year of years) {
    const mMap = monthlyMap.get(year);
    const months: (number | null)[] = [];
    for (let m = 0; m < 12; m++) {
      if (mMap?.has(m)) {
        const pct = mMap.get(m)!;
        months.push(parseFloat(pct.toFixed(2)));
        fatorAcumRows *= 1 + pct / 100;
      } else {
        months.push(null);
      }
    }
    rows.push({
      year,
      months,
      noAno: yearlyMap.has(year) ? parseFloat(yearlyMap.get(year)!.toFixed(2)) : null,
      acumulado: parseFloat(((fatorAcumRows - 1) * 100).toFixed(2)),
    });
  }

  return rows;
}

export function buildCdiSeries(cdiRecords: CdiRecord[], dataInicio: string, dataCalculo?: string): ChartPoint[] {
  if (cdiRecords.length === 0) return [];

  const filtered = dataCalculo
    ? cdiRecords.filter(r => r.data <= dataCalculo)
    : cdiRecords;

  if (filtered.length === 0) return [];

  const dtInicio = new Date(dataInicio + "T00:00:00");
  const dtAnterior = new Date(dtInicio);
  dtAnterior.setDate(dtAnterior.getDate() - 1);
  const anteriorISO = dtAnterior.toISOString().slice(0, 10);

  const points: ChartPoint[] = [
    {
      data: anteriorISO,
      label: dtAnterior.toLocaleDateString("pt-BR"),
      cdi_acumulado: 0,
    },
  ];

  let fatorAcumulado = 1;

  for (const rec of filtered) {
    if (rec.dia_util) {
      fatorAcumulado *= 1 + calcFatorDiario(rec.taxa_anual);
    }

    points.push({
      data: rec.data,
      label: new Date(rec.data + "T00:00:00").toLocaleDateString("pt-BR"),
      cdi_acumulado: parseFloat(((fatorAcumulado - 1) * 100).toFixed(4)),
    });
  }

  return points;
}

export function buildRentabilidadeRows(
  cdiRecords: CdiRecord[],
  dataInicio: string,
  dataCalculo?: string
): RentabilidadeRow[] {
  if (cdiRecords.length === 0) return [];

  const filtered = dataCalculo
    ? cdiRecords.filter(r => r.data <= dataCalculo)
    : cdiRecords;

  if (filtered.length === 0) return [];

  let fatorAcumulado = 1;
  let fatorMensal = 1;
  let fatorAnual = 1;

  let currentMonth = -1;
  let currentYear = -1;

  // Map: year -> month(0-11) -> final percentage
  const monthlyMap = new Map<number, Map<number, number>>();
  const yearlyMap = new Map<number, number>();

  const inicioDate = new Date(dataInicio + "T00:00:00");
  const inicioMonth = inicioDate.getMonth();
  const inicioYear = inicioDate.getFullYear();

  for (const rec of filtered) {
    const dt = new Date(rec.data + "T00:00:00");
    const m = dt.getMonth();
    const y = dt.getFullYear();

    // Detect month change: reset fatorMensal
    // First record ever also initializes
    if (currentMonth === -1) {
      // First record - same month as data_inicio, fatorMensal starts at 1
      currentMonth = m;
      currentYear = y;
      fatorMensal = 1;
      fatorAnual = 1;
    } else if (m !== currentMonth) {
      // Save previous month result before resetting
      // (already saved below in the per-record update)
      // Reset for new month
      fatorMensal = 1;
      currentMonth = m;

      if (y !== currentYear) {
        // Save previous year, reset
        fatorAnual = 1;
        currentYear = y;
      }
    }

    if (rec.dia_util) {
      const fd = calcFatorDiario(rec.taxa_anual);
      fatorAcumulado *= 1 + fd;
      fatorMensal *= 1 + fd;
      fatorAnual *= 1 + fd;
    }

    // Always update the current month/year values (last one wins)
    if (!monthlyMap.has(y)) monthlyMap.set(y, new Map());
    monthlyMap.get(y)!.set(m, (fatorMensal - 1) * 100);
    yearlyMap.set(y, (fatorAnual - 1) * 100);
  }

  // Build rows sorted by year
  const years = Array.from(
    new Set([...monthlyMap.keys(), ...yearlyMap.keys()])
  ).sort();

  const rows: RentabilidadeRow[] = [];
  let fatorAcumRows = 1;

  for (const year of years) {
    const mMap = monthlyMap.get(year);
    const months: (number | null)[] = [];

    // Rebuild accumulated from monthly factors for this row
    for (let m = 0; m < 12; m++) {
      if (mMap?.has(m)) {
        const pct = mMap.get(m)!;
        months.push(parseFloat(pct.toFixed(2)));
        fatorAcumRows *= 1 + pct / 100;
      } else {
        months.push(null);
      }
    }

    rows.push({
      year,
      months,
      noAno: yearlyMap.has(year)
        ? parseFloat(yearlyMap.get(year)!.toFixed(2))
        : null,
      acumulado: parseFloat(((fatorAcumRows - 1) * 100).toFixed(2)),
    });
  }

  return rows;
}
