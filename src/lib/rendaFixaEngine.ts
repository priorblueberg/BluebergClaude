/**
 * Engine de Cálculo Diário de Renda Fixa Prefixada
 * 
 * Baseado na planilha Excel "EngineRendaFixaPrefixada".
 * Utiliza sistema de "Cota Virtual" (Valor da Cota 1 e Cota 2).
 * 
 * Colunas calculadas (conforme Excel):
 * C: Valor da Cota (1) — após resgate
 * D: Saldo de Cotas (1) — após resgate
 * E: Líquido (1) — após resgate
 * F: Valor da Cota (2) — antes do resgate
 * G: Saldo de Cotas (2) — antes do resgate
 * H: Líquido (2) — antes do resgate
 * I: Aplicações
 * J: QTD Cotas (Compra)
 * K: Resgate
 * L: QTD Cotas (Resgate)
 * M: Rentabilidade diária (R$)
 * N: R$ Rentabilidade acumulada
 * O: % Rentabilidade acumulada
 * P: Multiplicador
 * Q: Pagamento de Juros (flag)
 * R: Apoio para o cupom automático
 * S: Cupom Acumulado
 * T: Juros Pago
 * U: Valor Investido
 * V: Resgate Limpo
 */

export interface DailyRow {
  data: string;
  diaUtil: boolean;
  // C-H: Cotas virtuais
  valorCota: number;        // C: Valor da Cota (1) — após resgate
  saldoCotas: number;       // D: Saldo de Cotas (1) — após resgate
  liquido: number;          // E: Líquido (1) — após resgate
  valorCota2: number;       // F: Valor da Cota (2) — antes do resgate
  saldoCotas2: number;      // G: Saldo de Cotas (2) — antes do resgate
  liquido2: number;         // H: Líquido (2) — antes do resgate
  // I-L: Movimentações
  aplicacoes: number;       // I
  qtdCotasCompra: number;   // J
  resgates: number;         // K: Resgate (capital only, excludes juros)
  qtdCotasResgate: number;  // L
  // M-O: Rentabilidade
  ganhoDiario: number;      // M: Rentabilidade diária em R$
  ganhoAcumulado: number;   // N: R$ Rentabilidade acumulada
  rentabilidadeAcumuladaPct: number; // O: % Rentabilidade acumulada
  // CDI Diário + P: Multiplicador
  cdiDiario: number;
  multiplicador: number;    // P
  // Q-T: Juros / Cupom
  pagamentoJuros: number;
  apoioCupom: number;       // R
  cupomAcumulado: number;   // S
  jurosPago: number;        // T
  // U-V: Capital tracking
  valorInvestido: number;   // U
  resgateLimpo: number;     // V
  // W-Y: PU columns
  precoUnitario: number;    // W: Preço Unitário
  qtdAplicacaoPU: number;   // X: QTD Aplicação
  qtdResgatePU: number;     // Y: QTD Resgate
  // New columns
  puJurosPeriodicos: number;  // PU Juros Periódicos
  qtdAplicacao2: number;      // QTD Aplicação (2) = Aplicações / PU Juros Periódicos
  qtdResgate2: number;        // QTD Resgate (2)
  // Green columns
  baseEconomica: number;      // Base Econômica
  aplicacaoExCupom: number;   // Aplicação Ex Cupom
  resgateExCupom: number;     // Resgate Ex Cupom
  // Legacy (kept for consumers like AnaliseIndividualPage)
  rentabilidadeDiaria: number | null;
  // New: Rent. Diária (%) and Rent. Acum (2) — composição diária
  rentDiariaPct: number;
  rentAcumulada2: number;
}

export interface EngineInput {
  dataInicio: string;
  dataCalculo: string;
  taxa: number;
  modalidade: string;
  puInicial: number;
  calendario: { data: string; dia_util: boolean }[];
  movimentacoes: { data: string; tipo_movimentacao: string; valor: number }[];
  dataResgateTotal?: string | null;
  pagamento?: string | null;
  vencimento?: string | null;
  indexador?: string | null;
  cdiRecords?: { data: string; taxa_anual: number }[];
  dataLimite?: string | null;
  /** Pre-computed CDI map (data -> taxa_anual) to avoid rebuilding per product */
  precomputedCdiMap?: Map<string, number>;
  /** If true, skip sorting calendario (already sorted) */
  calendarioSorted?: boolean;
}

// ── Pagamento de Juros Periódico ──

const PERIODICIDADE_MESES: Record<string, number> = {
  Mensal: 1,
  Bimestral: 2,
  Trimestral: 3,
  Quadrimestral: 4,
  Semestral: 6,
};

export function gerarDatasPagamentoJuros(
  dataInicio: string,
  vencimento: string,
  pagamento: string,
  calendario: { data: string; dia_util: boolean }[],
  dataCalculo?: string
): Set<string> {
  const meses = PERIODICIDADE_MESES[pagamento];
  if (!meses) return new Set();

  const vencDate = new Date(vencimento + "T00:00:00");
  const diaBase = vencDate.getDate();

  const diasUteisSet = new Set<string>();
  const allDates: string[] = [];
  for (const c of calendario) {
    allDates.push(c.data);
    if (c.dia_util) diasUteisSet.add(c.data);
  }
  allDates.sort();

  function ajustarParaDiaUtil(targetDate: string): string | null {
    let lo = 0, hi = allDates.length - 1, pos = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (allDates[mid] <= targetDate) { pos = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (pos < 0) return null;
    for (let i = pos; i >= 0; i--) {
      if (diasUteisSet.has(allDates[i])) return allDates[i];
    }
    return null;
  }

  const result = new Set<string>();
  let cursor = new Date(vencDate);

  while (true) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const targetDay = Math.min(diaBase, lastDayOfMonth);
    const targetStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;

    if (targetStr < dataInicio) break;

    if (dataCalculo && targetStr > dataCalculo) {
      cursor.setMonth(cursor.getMonth() - meses);
      continue;
    }

    const adjusted = ajustarParaDiaUtil(targetStr);
    if (adjusted && adjusted >= dataInicio) {
      result.add(adjusted);
    }

    cursor.setMonth(cursor.getMonth() - meses);
  }

  return result;
}

// ── Engine helpers ──

function calcCdiDiario(taxaAnual: number): number {
  return Math.pow(1 + taxaAnual / 100, 1 / 252) - 1;
}

function getMultiplicador(modalidade: string, taxa: number): number {
  if (modalidade === "Prefixado") {
    return Math.pow(1 + taxa / 100, 1 / 252) - 1;
  }
  return 0;
}

/**
 * Build movimentação map excluding "Resgate no Vencimento" (handled natively by engine).
 */
function buildMovMap(movs: EngineInput["movimentacoes"]): Map<string, { aplicacoes: number; resgates: number }> {
  const map = new Map<string, { aplicacoes: number; resgates: number }>();
  for (const m of movs) {
    const entry = map.get(m.data) || { aplicacoes: 0, resgates: 0 };
    if (m.tipo_movimentacao === "Aplicação Inicial" || m.tipo_movimentacao === "Aplicação") {
      entry.aplicacoes += m.valor;
    } else if (["Resgate", "Resgate Parcial", "Resgate Total"].includes(m.tipo_movimentacao)) {
      entry.resgates += m.valor;
    }
    // "Resgate no Vencimento" is excluded — engine computes it natively
    map.set(m.data, entry);
  }
  return map;
}

function findDayBefore(dataInicio: string, calendario: EngineInput["calendario"]): string | null {
  for (let i = calendario.length - 1; i >= 0; i--) {
    if (calendario[i].data < dataInicio) return calendario[i].data;
  }
  return null;
}

// ── Main engine ──

export function calcularRendaFixaDiario(input: EngineInput): DailyRow[] {
  const { dataInicio, dataCalculo, taxa, modalidade, puInicial, calendario, movimentacoes, dataResgateTotal, pagamento, vencimento, indexador, cdiRecords, dataLimite, precomputedCdiMap, calendarioSorted } = input;

  const cotaInicial = puInicial > 0 ? puInicial : 1000;
  const rawMultiplicador = getMultiplicador(modalidade, taxa);
  const isPosFixadoCDI = (modalidade === "Pos Fixado" || modalidade === "Pós Fixado") && indexador === "CDI";
  const isMistaCDI = modalidade === "Mista" && indexador === "CDI";
  // Pre-compute fixed spread for Mista: (1+taxa)^(1/252)
  const mistaSpreadFactor = isMistaCDI ? Math.pow(1 + taxa / 100, 1 / 252) : 1;

  // Build CDI map: reuse pre-computed if available
  let cdiMap: Map<string, number>;
  if (precomputedCdiMap) {
    cdiMap = precomputedCdiMap;
  } else {
    cdiMap = new Map<string, number>();
    if (cdiRecords) {
      for (const c of cdiRecords) {
        cdiMap.set(c.data, c.taxa_anual);
      }
    }
  }
  const movMap = buildMovMap(movimentacoes);

  const sorted = calendarioSorted ? calendario : [...calendario].sort((a, b) => a.data.localeCompare(b.data));
  const endDate = dataCalculo || sorted[sorted.length - 1]?.data || dataInicio;

  // Effective end: the furthest date we need to compute
  const effectiveEnd = dataResgateTotal || vencimento || endDate;

  // Generate payment dates
  const datasPagamento = pagamento && pagamento !== "No Vencimento" && vencimento
    ? gerarDatasPagamentoJuros(dataInicio, vencimento, pagamento, calendario, effectiveEnd)
    : new Set<string>();

  const dayBefore = findDayBefore(dataInicio, calendario);
  const startIdx = dayBefore
    ? sorted.findIndex((d) => d.data === dayBefore)
    : sorted.findIndex((d) => d.data >= dataInicio);

  if (startIdx < 0) return [];

  const rows: DailyRow[] = [];

  let prevLiquido = 0;
  let prevSaldoCotas = 0;
  let prevValorCota = cotaInicial;
  let rentAcumRS = 0;
  let valorInvestidoAcum = 0;
  let cupomAcumuladoAcum = 0;
  let prevPrecoUnitario = puInicial > 0 ? puInicial : 1000;
  let prevPuJurosPeriodicos = puInicial > 0 ? puInicial : 1000;
  const puInicialCustodia = puInicial > 0 ? puInicial : 1000;
  const effectiveDataLimite = dataLimite || vencimento || null;
  let prevBaseEconomica = 0;
  let prevRentDiariaPct = 0;
  let prevRentAcumulada2 = 0;

  for (let i = startIdx; i < sorted.length; i++) {
    const cal = sorted[i];
    if (cal.data > effectiveEnd) break;
    if (cal.data > endDate) break;

    const isInitialDay = dayBefore ? cal.data === dayBefore : false;

    if (isInitialDay) {
      rows.push(makeZeroRow(cal.data, cal.dia_util, cotaInicial));
      prevValorCota = cotaInicial;
      prevLiquido = 0;
      prevSaldoCotas = 0;
      rentAcumRS = 0;
      valorInvestidoAcum = 0;
      cupomAcumuladoAcum = 0;
      prevBaseEconomica = 0;
      continue;
    }

    const isDataInicio = cal.data === dataInicio;
    const isVencimentoDay = !!vencimento && cal.data === vencimento;
    const isResgateTotalDay = !!dataResgateTotal && cal.data === dataResgateTotal;
    const isFinalDay = isVencimentoDay || isResgateTotalDay;

    const diaUtil = cal.dia_util;

    // CDI Diário
    const cdiAnual = cdiMap.get(cal.data) ?? 0;
    const prevCdiDiarioVal = rows.length > 0 ? rows[rows.length - 1].cdiDiario : 0;
    const cdiDiarioVal = diaUtil && cdiAnual > 0 ? calcCdiDiario(cdiAnual) : prevCdiDiarioVal;

    // Multiplicador
    let dailyMult: number;
    if (isMistaCDI) {
      // Mista: (1 + CDI Diário anterior) * (1 + Taxa)^(1/252) - 1
      const prevCdiDiario = rows.length > 0 ? rows[rows.length - 1].cdiDiario : 0;
      dailyMult = diaUtil ? (1 + prevCdiDiario) * mistaSpreadFactor - 1 : 0;
    } else if (isPosFixadoCDI) {
      const prevCdiDiario = rows.length > 0 ? rows[rows.length - 1].cdiDiario : 0;
      const cdiArredondado = parseFloat(prevCdiDiario.toFixed(8));
      dailyMult = diaUtil ? cdiArredondado * (taxa / 100) : 0;
    } else {
      dailyMult = diaUtil ? rawMultiplicador : 0;
    }

    const mov = movMap.get(cal.data) || { aplicacoes: 0, resgates: 0 };
    const aplicacoes = mov.aplicacoes;
    const manualResgates = mov.resgates;

    const multiplicadorDia = dailyMult;

    // R: Apoio para o cupom automático
    let apoioCupom: number;
    if (isDataInicio) {
      apoioCupom = aplicacoes;
    } else {
      apoioCupom = prevLiquido * (1 + dailyMult) + aplicacoes;
    }

    // U: Valor Investido
    valorInvestidoAcum += aplicacoes - manualResgates;
    const valorInvestido = valorInvestidoAcum;

    // V: Resgate Limpo
    let resgateLimpo: number;
    if (isFinalDay) {
      resgateLimpo = valorInvestido;
    } else {
      resgateLimpo = manualResgates;
    }

    // Q: Is this a payment date?
    const isPagamento = datasPagamento.has(cal.data);

    // W: Preço Unitário — compute BEFORE jurosPago
    let precoUnitario: number;
    const isNoVencimentoFinal = pagamento === "No Vencimento" && isFinalDay;
    if (isDataInicio) {
      precoUnitario = puInicialCustodia;
    } else if (!diaUtil) {
      precoUnitario = prevPrecoUnitario;
    } else if (isPagamento || isNoVencimentoFinal) {
      // Reset to initial PU on payment days (including "No Vencimento" final day)
      precoUnitario = puInicialCustodia;
    } else {
      const puMult = (isMistaCDI || isPosFixadoCDI) ? dailyMult : rawMultiplicador;
      precoUnitario = prevPrecoUnitario * puMult + prevPrecoUnitario;
    }

    // X: Quantidade Aplicação = Aplicações / Preço Unitário
    const qtdAplicacaoPU = precoUnitario > 0 && aplicacoes > 0 ? aplicacoes / precoUnitario : 0;

    // Aplicação Ex Cupom = qtdAplicacaoPU * puInicialCustodia
    const aplicacaoExCupom = qtdAplicacaoPU * puInicialCustodia;

    // Temp Base Econômica (before resgate ex cupom)
    const tempBaseEconomica = prevBaseEconomica + aplicacaoExCupom;

    // T: Juros Pago — now uses baseEconômica instead of valorInvestido
    let jurosPago: number;
    if (isFinalDay && pagamento !== "No Vencimento") {
      jurosPago = apoioCupom - tempBaseEconomica;
    } else if (isPagamento) {
      jurosPago = apoioCupom - tempBaseEconomica;
    } else {
      jurosPago = 0;
    }
    if (jurosPago < 0) jurosPago = 0;

    // K: Resgate (capital only, excludes juros)
    let resgatesTotal: number;
    if (isFinalDay) {
      // Full patrimônio minus juros (juros is separate outflow)
      resgatesTotal = prevLiquido * (1 + dailyMult) - jurosPago;
    } else {
      resgatesTotal = resgateLimpo; // capital only
    }

    // E: Líquido (1) — subtract both resgates and jurosPago
    let liquido1: number;
    if (isDataInicio) {
      liquido1 = aplicacoes;
    } else {
      liquido1 = prevLiquido * (1 + dailyMult) + aplicacoes - resgatesTotal - jurosPago;
    }
    if (Math.abs(liquido1) < 0.01) liquido1 = 0;

    // J: QTD Cotas Compra
    const qtdCotasCompra = prevValorCota > 0 ? aplicacoes / prevValorCota : 0;

    // G: Saldo de Cotas (2)
    let saldoCotas2: number;
    if (isFinalDay) {
      saldoCotas2 = prevSaldoCotas;
    } else if (liquido1 === 0 && aplicacoes === 0) {
      saldoCotas2 = 0;
    } else {
      saldoCotas2 = prevSaldoCotas + qtdCotasCompra;
    }

    // H: Líquido (2) = Líquido (1) + Resgates (capital)
    let liquido2: number;
    if (isFinalDay) {
      liquido2 = prevLiquido * (1 + dailyMult);
    } else {
      liquido2 = liquido1 + resgatesTotal;
    }

    const isZeroLiquido = Math.abs(liquido2) < 0.01;

    // F: Valor da Cota (2)
    const valorCota2 = isZeroLiquido
      ? prevValorCota
      : (saldoCotas2 > 0 ? liquido2 / saldoCotas2 : prevValorCota);

    // L: QTD Cotas Resgate — only capital resgates consume cotas (juros don't)
    const qtdCotasResgate = resgatesTotal > 0 && valorCota2 > 0 ? resgatesTotal / valorCota2 : 0;

    // D: Saldo de Cotas (1)
    let saldoCotas1: number;
    if (isFinalDay) {
      saldoCotas1 = 0;
    } else {
      saldoCotas1 = saldoCotas2 - qtdCotasResgate;
    }

    // C: Valor da Cota (1)
    let valorCota1: number;
    if (!diaUtil && cal.data > dataInicio) {
      valorCota1 = prevValorCota;
    } else if (cal.data <= dataInicio) {
      valorCota1 = cotaInicial;
    } else if (isZeroLiquido && aplicacoes === 0 && resgatesTotal === 0 && jurosPago === 0) {
      valorCota1 = prevValorCota;
    } else if (isFinalDay) {
      // Final day: Resgate / Saldo de Cotas (2)
      valorCota1 = saldoCotas2 > 0 ? resgatesTotal / saldoCotas2 : prevValorCota;
    } else {
      // Normal: (Líquido(1) + Juros Pago) / Saldo Cotas(1)
      valorCota1 = saldoCotas1 > 0 ? (liquido1 + jurosPago) / saldoCotas1 : prevValorCota;
    }

    // M: Rentabilidade diária (R$)
    const ganhoDiario = isDataInicio ? 0 : (liquido1 - prevLiquido - aplicacoes + resgatesTotal + jurosPago);

    // N: R$ Rentabilidade acumulada
    rentAcumRS += ganhoDiario;

    // O: % Rentabilidade acumulada
    const rentabilidadeAcumuladaPct = cotaInicial > 0 ? (valorCota1 / cotaInicial) - 1 : 0;

    // Legacy: daily return %
    const rentDiaria = prevValorCota > 0 && cal.data > dataInicio
      ? valorCota1 / prevValorCota - 1
      : null;

    // S: Cupom Acumulado
    cupomAcumuladoAcum += jurosPago;

    // Y: Quantidade de Resgate
    let qtdResgatePU: number;
    if (isFinalDay) {
      // Final: Resgate / Preço Unitário
      qtdResgatePU = precoUnitario > 0 && resgatesTotal > 0.01
        ? resgatesTotal / precoUnitario : 0;
    } else {
      qtdResgatePU = precoUnitario > 0 && resgateLimpo > 0.01 ? resgateLimpo / precoUnitario : 0;
    }

    // Resgate Ex Cupom = qtdResgatePU * puInicialCustodia
    const resgateExCupom = qtdResgatePU * puInicialCustodia;

    // Base Econômica = tempBaseEconomica - resgateExCupom
    const baseEconomica = tempBaseEconomica - resgateExCupom;

    // PU Juros Periódicos
    let puJurosPeriodicos: number;
    if (isDataInicio) {
      puJurosPeriodicos = puInicialCustodia;
    } else if (!diaUtil) {
      puJurosPeriodicos = prevPuJurosPeriodicos;
    } else if (isPagamento && effectiveDataLimite && cal.data !== effectiveDataLimite) {
      puJurosPeriodicos = puInicialCustodia;
    } else {
      puJurosPeriodicos = prevPuJurosPeriodicos * dailyMult + prevPuJurosPeriodicos;
    }

    // QTD Aplicação (2)
    const qtdAplicacao2 = puJurosPeriodicos > 0 && aplicacoes > 0 ? aplicacoes / puJurosPeriodicos : 0;

    // QTD Resgate (2)
    let qtdResgate2: number;
    const totalOutflowForQtd2 = resgatesTotal + jurosPago;
    if (effectiveDataLimite && cal.data === effectiveDataLimite) {
      qtdResgate2 = puJurosPeriodicos > 0 && totalOutflowForQtd2 > 0.01 ? totalOutflowForQtd2 / puJurosPeriodicos : 0;
    } else if (isPagamento && resgateLimpo > 0.01) {
      qtdResgate2 = puJurosPeriodicos > 0 ? resgateLimpo / puJurosPeriodicos : 0;
    } else {
      qtdResgate2 = puJurosPeriodicos > 0 && totalOutflowForQtd2 > 0.01 ? totalOutflowForQtd2 / puJurosPeriodicos : 0;
    }

    // Rent. Diária (%) and Rent. Acum (2)
    let rentDiariaPct: number;
    let rentAcumulada2: number;
    if (cal.data <= dataInicio) {
      rentDiariaPct = 0;
      rentAcumulada2 = 0;
    } else if (cal.data > effectiveEnd) {
      rentDiariaPct = 0;
      rentAcumulada2 = 0;
    } else if (!diaUtil) {
      rentDiariaPct = prevRentDiariaPct;
      rentAcumulada2 = prevRentAcumulada2;
    } else {
      // Rent. Diária (%) = ganhoDiario / liquido2 do dia atual
      if (liquido2 > 0.01) {
        rentDiariaPct = ganhoDiario / liquido2;
      } else {
        rentDiariaPct = prevRentDiariaPct;
      }
      rentAcumulada2 = (1 + prevRentAcumulada2) * (1 + rentDiariaPct) - 1;
    }

    rows.push({
      data: cal.data,
      diaUtil,
      valorCota: valorCota1,
      saldoCotas: saldoCotas1,
      liquido: liquido1,
      valorCota2,
      saldoCotas2,
      liquido2,
      aplicacoes,
      qtdCotasCompra,
      resgates: resgatesTotal,
      qtdCotasResgate,
      ganhoDiario,
      ganhoAcumulado: rentAcumRS,
      rentabilidadeAcumuladaPct,
      cdiDiario: cdiDiarioVal,
      multiplicador: multiplicadorDia,
      pagamentoJuros: jurosPago,
      apoioCupom,
      cupomAcumulado: cupomAcumuladoAcum,
      jurosPago,
      valorInvestido,
      resgateLimpo,
      precoUnitario,
      qtdAplicacaoPU,
      qtdResgatePU,
      puJurosPeriodicos,
      qtdAplicacao2,
      qtdResgate2,
      baseEconomica,
      aplicacaoExCupom,
      resgateExCupom,
      rentabilidadeDiaria: rentDiaria,
      rentDiariaPct,
      rentAcumulada2,
    });

    prevLiquido = liquido1;
    prevSaldoCotas = saldoCotas1;
    prevValorCota = valorCota1;
    prevPrecoUnitario = precoUnitario;
    prevPuJurosPeriodicos = puJurosPeriodicos;
    prevBaseEconomica = baseEconomica;
    prevRentDiariaPct = rentDiariaPct;
    prevRentAcumulada2 = rentAcumulada2;
  }

  return rows;
}

function makeZeroRow(data: string, diaUtil: boolean, cotaInicial: number): DailyRow {
  return {
    data,
    diaUtil,
    valorCota: cotaInicial,
    saldoCotas: 0,
    liquido: 0,
    valorCota2: cotaInicial,
    saldoCotas2: 0,
    liquido2: 0,
    aplicacoes: 0,
    qtdCotasCompra: 0,
    resgates: 0,
    qtdCotasResgate: 0,
    ganhoDiario: 0,
    ganhoAcumulado: 0,
    rentabilidadeAcumuladaPct: 0,
    cdiDiario: 0,
    multiplicador: 0,
    pagamentoJuros: 0,
    apoioCupom: 0,
    cupomAcumulado: 0,
    jurosPago: 0,
    valorInvestido: 0,
    resgateLimpo: 0,
    precoUnitario: cotaInicial,
    qtdAplicacaoPU: 0,
    qtdResgatePU: 0,
    puJurosPeriodicos: cotaInicial,
    qtdAplicacao2: 0,
    qtdResgate2: 0,
    baseEconomica: 0,
    aplicacaoExCupom: 0,
    resgateExCupom: 0,
    rentabilidadeDiaria: null,
    rentDiariaPct: 0,
    rentAcumulada2: 0,
  };
}
