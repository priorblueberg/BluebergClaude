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
  /**
   * Fator de IPCA por dia util, vindo de `construirFatoresIpcaDiarios`. So e usado
   * quando indexador === "IPCA": o fator ja carrega o pro rata do ciclo, entao aqui
   * ele entra como o CDI diario entra na modalidade Mista.
   */
  ipcaFatores?: Map<string, number>;
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
  Anual: 12,
};

/**
 * Periodicidades que a boleta oferece. Sai daqui, e nao de uma lista solta na tela, porque
 * periodicidade que o motor nao conhece NAO gera cupom nenhum: o titulo passa a ser calculado
 * como se fosse "No Vencimento", sem erro na interface. Foi o que aconteceu com "Quatrimestral"
 * (a boleta gravava com T; o motor so conhece "Quadrimestral", com D).
 */
export const PAGAMENTO_OPTIONS = [...Object.keys(PERIODICIDADE_MESES), "No Vencimento"];

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

  // O passo anda em (ano, mes) contados a partir do vencimento, com o cursor ancorado no dia 1.
  // Guardar o dia no cursor e chamar setMonth estoura: 31/12 menos 6 meses vira 01/07 (nao existe
  // 31/06), e a partir dai TODA a serie fica deslocada um mes. O dia certo e recalculado a cada
  // passo a partir do dia do vencimento, limitado ao ultimo dia do mes.
  for (let passo = 0; ; passo++) {
    const ref = new Date(vencDate.getFullYear(), vencDate.getMonth() - passo * meses, 1);
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const targetDay = Math.min(diaBase, lastDayOfMonth);
    const targetStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;

    if (targetStr < dataInicio) break;

    // O corte por dataCalculo olha a data EFETIVA de pagamento, nao a nominal: um cupom de 28/03
    // que cai no sabado e pago em 27/03, e comparar o 28 com uma data de calculo de 27 fazia o
    // cupom sumir. Aparece na virada de mes e em resgate no proprio dia do cupom.
    const adjusted = ajustarParaDiaUtil(targetStr);
    if (!adjusted || adjusted < dataInicio) continue;
    if (dataCalculo && adjusted > dataCalculo) continue;
    result.add(adjusted);
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
  const { dataInicio, dataCalculo, taxa, modalidade, puInicial, calendario, movimentacoes, dataResgateTotal, pagamento, vencimento, indexador, cdiRecords, dataLimite, precomputedCdiMap, calendarioSorted, ipcaFatores } = input;

  const cotaInicial = puInicial > 0 ? puInicial : 1000;
  const rawMultiplicador = getMultiplicador(modalidade, taxa);
  const isPosFixadoCDI = (modalidade === "Pos Fixado" || modalidade === "Pós Fixado") && indexador === "CDI";
  const isMistaCDI = modalidade === "Mista" && indexador === "CDI";
  // IPCA+ tem a mesma forma do CDI+: indice do dia vezes o spread. O que muda e a
  // origem do fator diario, que para o IPCA vem pronto em ipcaFatores.
  const isMistaIPCA = modalidade === "Mista" && indexador === "IPCA";
  // Pre-compute fixed spread for Mista: (1+taxa)^(1/252)
  const mistaSpreadFactor = (isMistaCDI || isMistaIPCA) ? Math.pow(1 + taxa / 100, 1 / 252) : 1;

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
  let qtdCustoAcum = 0;   // cotas que sustentam o custo acima (convencao do Gorila)
  let cupomAcumuladoAcum = 0;
  let prevPrecoUnitario = puInicial > 0 ? puInicial : 1000;
  let prevPuJurosPeriodicos = puInicial > 0 ? puInicial : 1000;
  let vnaAcumulado = puInicial > 0 ? puInicial : 1000;
  const puInicialCustodia = puInicial > 0 ? puInicial : 1000;
  const effectiveDataLimite = dataLimite || vencimento || null;
  let prevBaseEconomica = 0;
  let prevRentDiariaPct = 0;
  let prevRentAcumulada2 = 0;
  let prevLiquido2 = 0;   // saldo da serie 2 no dia anterior: base do retorno no dia do encerramento

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
      qtdCustoAcum = 0;
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
    const fatorIpcaDia = isMistaIPCA ? (ipcaFatores?.get(cal.data) ?? 1) : 1;
    let dailyMult: number;
    if (isMistaIPCA) {
      // (1 + IPCA do dia) * (1 + spread)^(1/252) - 1. Diferente do CDI, o fator do
      // IPCA e do proprio dia: nao ha defasagem de um dia, porque a variacao do ciclo
      // ja e conhecida quando o ciclo comeca.
      dailyMult = diaUtil ? fatorIpcaDia * mistaSpreadFactor - 1 : 0;
    } else if (isMistaCDI) {
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

    // No VENCIMENTO o papel nao rende o proprio dia: o preco ja esta no par quando o dia
    // comeca. Venda antecipada, ao contrario, INCLUI o dia em que ocorre.
    //
    // Medido no Gorila em 31/08/2026, em dois CDBs de IPCA que venceram dentro da janela
    // observada. O valor entregue no vencimento e, no centavo, o do dia util ANTERIOR:
    //
    //   IPCA+3,80% venc. 15/06/2026 -> Gorila 1080,4422 = nosso valor de 12/06 (sexta)
    //   IPCA+4,90% venc. 31/03/2026 -> Gorila 1119,2972 = nosso valor de 30/03 (segunda)
    //
    // E a mesma convencao ja levantada no prefixado; nunca tinha sido exercitada no IPCA
    // porque nenhum papel de teste vencia dentro do periodo medido.
    if (isVencimentoDay) dailyMult = 0;

    // VNA: o principal corrigido pelo indice, SEM o juro. So faz sentido no IPCA, o unico
    // indexador em que o principal e corrigido. E o valor para o qual o PU volta quando o
    // papel paga cupom - ver o bloco do `puJurosPeriodicos` mais abaixo.
    if (isMistaIPCA && diaUtil && !isDataInicio && !isVencimentoDay) {
      vnaAcumulado *= fatorIpcaDia;
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

    // Q: Is this a payment date?
    const isPagamento = datasPagamento.has(cal.data);

    // Para onde o PU volta quando ha pagamento de juros: o principal. No IPCA o principal
    // e o VNA corrigido; nos demais indexadores e o par.
    const puDepoisDoCupom = isMistaIPCA ? vnaAcumulado : puInicialCustodia;

    // W: Preço Unitário — compute BEFORE jurosPago
    let precoUnitario: number;
    const isNoVencimentoFinal = pagamento === "No Vencimento" && isFinalDay;
    if (isDataInicio) {
      precoUnitario = puInicialCustodia;
    } else if (!diaUtil) {
      precoUnitario = prevPrecoUnitario;
    } else if (isPagamento || isNoVencimentoFinal) {
      // O cupom paga o JURO e devolve o PU ao principal. Em prefixado e CDI o principal e
      // o par; em IPCA ele vem corrigido, e a correcao monetaria FICA no papel.
      //
      // Medido no Gorila em 31/08/2026, CDB IPCA+5,00% semestral emitido em 02/01/2025 e
      // vencendo em 15/01/2031. Nos quatro cupons o PU logo apos o pagamento e, no
      // centavo, o VNA daquele dia:
      //
      //   15/01/2025 -> 1001,7530     15/01/2026 -> 1046,4490
      //   15/07/2025 -> 1034,6103     15/07/2026 -> 1083,4927
      //
      // Antes o motor devolvia 1.000,00 nas quatro e jogava a correcao fora.
      precoUnitario = puDepoisDoCupom;
    } else {
      // No vencimento o multiplicador do dia e zero (ver acima), inclusive na trilha que
      // usa `rawMultiplicador` direto.
      const puMult = isVencimentoDay
        ? 0
        : (isMistaCDI || isMistaIPCA || isPosFixadoCDI) ? dailyMult : rawMultiplicador;
      precoUnitario = prevPrecoUnitario * puMult + prevPrecoUnitario;
    }

    // U: Valor Investido — CUSTO, na convencao do Gorila (2026-08-22): a aplicacao entra pelo
    // valor pago e o resgate PARCIAL baixa o custo das cotas vendidas (quantidade x custo medio),
    // nao o valor bruto recebido. Antes subtraiamos o bruto, e o custo caia demais: um resgate de
    // 25% do saldo baixava 25% do SALDO em vez de 25% do principal. Saldo e P&L nao mudam; muda a
    // base de qualquer rentabilidade money-weighted. No encerramento o comportamento e o de sempre
    // (o capital devolvido e o proprio custo), para nao mexer na mecanica do dia final.
    valorInvestidoAcum += aplicacoes;
    if (precoUnitario > 0 && aplicacoes > 0) qtdCustoAcum += aplicacoes / precoUnitario;
    // No encerramento (vencimento ou venda que zera a posicao) o custo vai a ZERO, como no
    // Gorila: a posicao nao existe mais. O capital devolvido ainda e preciso para o resgate
    // limpo, entao fica guardado antes de zerar.
    const custoNoEncerramento = valorInvestidoAcum;
    if (isFinalDay) {
      valorInvestidoAcum = 0;
      qtdCustoAcum = 0;
    } else if (manualResgates > 0.01 && precoUnitario > 0 && qtdCustoAcum > 0) {
      const qtdVendida = manualResgates / precoUnitario;
      const custoMedio = valorInvestidoAcum / qtdCustoAcum;
      valorInvestidoAcum = Math.max(0, valorInvestidoAcum - qtdVendida * custoMedio);
      qtdCustoAcum = Math.max(0, qtdCustoAcum - qtdVendida);
    }
    const valorInvestido = valorInvestidoAcum;

    // V: Resgate Limpo
    let resgateLimpo: number;
    if (isFinalDay) {
      resgateLimpo = custoNoEncerramento;
    } else {
      resgateLimpo = manualResgates;
    }

    // X: Quantidade Aplicação = Aplicações / Preço Unitário
    const qtdAplicacaoPU = precoUnitario > 0 && aplicacoes > 0 ? aplicacoes / precoUnitario : 0;

    // Aplicação Ex Cupom: o PRINCIPAL que entrou, na mesma regua da base economica. Em
    // prefixado e CDI o principal e o par; no IPCA ele vem corrigido, entao a regua e o VNA.
    const aplicacaoExCupom = isMistaIPCA
      ? (precoUnitario > 0 ? aplicacoes * (vnaAcumulado / precoUnitario) : aplicacoes)
      : qtdAplicacaoPU * puInicialCustodia;

    // A base economica e o principal do papel. No IPCA ela e corrigida todo dia util pelo
    // indice, senao o cupom - que e "valor acumulado menos principal" - paga tambem a
    // correcao monetaria e derruba a posicao.
    //
    // Medido no Gorila em 31/08/2026 nos tres CDBs de IPCA com cupom: ele mantem a
    // QUANTIDADE fixa e deixa so o PU cair no pagamento, entao o valor da posicao e sempre
    // quantidade x PU. Antes desta correcao o nosso motor baixava cotas no cupom:
    //
    //   IPCA+5,00% semestral -> Gorila 21.851,65 (20 cotas), nosso 20.167,78 (18,46 cotas)
    //   IPCA+6,00% semestral -> Gorila 21.384,48, nosso 20.484,89
    //   IPCA+4,00% anual     -> Gorila 20.890,83, nosso 20.002,16
    //
    // O PU ja batia no centavo nos tres; a diferenca inteira estava na quantidade.
    const baseCorrigida = isMistaIPCA && diaUtil && !isDataInicio && !isVencimentoDay
      ? prevBaseEconomica * fatorIpcaDia
      : prevBaseEconomica;

    // Temp Base Econômica (before resgate ex cupom)
    const tempBaseEconomica = baseCorrigida + aplicacaoExCupom;

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
      puJurosPeriodicos = puDepoisDoCupom;
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
      // Base do retorno do dia: o saldo de hoje. No dia em que a posicao e encerrada o saldo vai
      // a zero, e ai a base e o saldo de ONTEM -- o titulo rendeu ate ser vendido. Depois disso
      // nao ha mais posicao e o retorno do dia e ZERO: a serie congela.
      // Antes repetia-se o retorno do ultimo dia com saldo, e a rentabilidade seguia subindo
      // sobre nada (o titulo 205 saiu de 22,02% na venda para 29,87% seis meses depois).
      if (liquido2 > 0.01) {
        rentDiariaPct = ganhoDiario / liquido2;
      } else if (prevLiquido2 > 0.01) {
        rentDiariaPct = ganhoDiario / prevLiquido2;
      } else {
        rentDiariaPct = 0;
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
    prevLiquido2 = liquido2;
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
