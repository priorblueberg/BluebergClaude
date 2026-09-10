/**
 * Motor de posição em ações (engine ACOES).
 *
 * Uma posição em ação é quantidade x preço - a mesma matemática do fundo, trocando cota por
 * preço e aplicação/resgate por compra/venda. Por isso este motor NÃO reimplementa a conta:
 * ele traduz e chama o motor de fundo, como o de câmbio já faz. Duplicar a lógica é como as
 * cópias divergiram antes neste projeto.
 *
 * O que ação tem e fundo não tem são duas coisas, e cada uma é resolvida de um jeito:
 *
 * 1. DESDOBRAMENTO / GRUPAMENTO / BONIFICAÇÃO mudam a quantidade sem mudar o valor.
 *    Em vez de tratar como caso especial no meio do laço, colocamos tudo em "unidades de
 *    hoje": a quantidade de cada compra é multiplicada pelo fator dos eventos POSTERIORES a
 *    ela, e o preço de cada dia é dividido pelo mesmo fator. O produto não muda em nenhuma
 *    data - `qtd x preço` é o mesmo antes e depois - e o evento simplesmente deixa de existir
 *    para o motor. Um split de 2 para 1 vira "sempre teve o dobro de ações valendo metade".
 *
 * 2. PROVENTO é dinheiro que sai da empresa sem mudar a quantidade que você tem. Ele derruba
 *    o preço na data-ex, e é por isso que precisa entrar no cálculo: sem ele, o dia-ex vira
 *    uma queda de rentabilidade que não aconteceu de verdade.
 *
 *    O valor da POSIÇÃO usa o preço puro. A RENTABILIDADE usa uma segunda série, "total
 *    return", em que o provento é somado de volta ao preço do dia. São duas passadas pelo
 *    mesmo motor com entradas diferentes - não duas implementações.
 *
 * Data-ex ou data de pagamento? Para o cálculo, **data-ex**, sempre: é o dia em que o preço
 * cai, e é a queda que precisa ser compensada. A data de pagamento (que costuma vir meses
 * depois) importa para saber quando o dinheiro entrou na conta, e por isso é guardada e
 * devolvida - mas quem reconhece o provento na data de pagamento produz uma rentabilidade que
 * cai no dia-ex e sobe meses depois, o que não descreve nada que aconteceu.
 */
import {
  calcularFundoDiario, fundoRowsToDailyRows, type FundoDailyRow,
} from "./fundoEngine";
import type { DailyRow } from "./rendaFixaEngine";

const COMPRAS = new Set(["Compra", "Aplicação", "Aplicação Inicial"]);
const VENDAS = new Set(["Venda", "Resgate", "Resgate Total"]);

/** JCP tem 15% de IR retido na fonte; dividendo e rendimento de FII não têm. */
export const IR_JCP = 0.15;

export interface AcaoMovimentacao {
  data: string;
  tipo: string;
  /** Valor financeiro da operação, em reais. */
  valor: number;
  /** Quantidade de ações; em branco, derivada pelo preço do dia. */
  quantidade?: number | null;
  /** Corretagem, emolumentos e afins. Entram no custo da posição. */
  custos?: number | null;
}

export interface Provento {
  tipo: "DIVIDENDO" | "JCP" | "RENDIMENTO" | "OUTRO";
  /** Por ação, no valor NOMINAL da época. */
  valor: number;
  data_ex: string;
  data_pagamento?: string | null;
}

export interface EventoCorporativo {
  tipo: "DESDOBRAMENTO" | "GRUPAMENTO" | "BONIFICACAO";
  /** 2 para um desdobramento 2:1; 0,01 para um grupamento 1:100. */
  fator: number;
  data_ex: string;
  /**
   * A série de preços JÁ vem ajustada por este evento.
   *
   * Quando isso acontece, o preço histórico não pode ser dividido pelo fator de novo - mas a
   * QUANTIDADE continua mudando, porque o cliente recebeu as ações de verdade. São duas coisas
   * distintas, e tratá-las como uma só custou caro: em GGBR4 a bonificação de 20% de 17/04/2024
   * está embutida na série (razão exata de 1,2000 contra o preço nominal da B3 antes do evento,
   * e 1,0000 depois). Ignorar o evento inteiro derrubava a posição de 126 para 100 ações;
   * aplicá-lo ao preço dividia o histórico por 1,2 duas vezes.
   */
  ja_refletido_no_preco?: boolean;
}

export interface AcoesEngineInput {
  dataInicio: string;
  dataCalculo: string;
  /**
   * `dia_util` é o calendário BANCÁRIO; `pregao` é o da bolsa. Eles divergem: de 02/01/2023 a
   * 09/09/2026 são 926 dias úteis contra 921 pregões, e as 5 diferenças são véspera de Natal e
   * último dia do ano, quando o banco abre e a bolsa não.
   *
   * A distinção importa em lugares opostos, e é por isso que os dois campos viajam juntos:
   *
   * - Para saber se falta cotação, vale o PREGÃO. Sem ele, um 24/12 sem negociação era rotulado
   *   como "dia útil sem cotação divulgada", sugerindo dado faltando onde não havia o que
   *   divulgar.
   * - Para o BENCHMARK, vale o dia útil bancário: o CDI é publicado em dia de banco, e usar o
   *   calendário da bolsa faria a série parar naqueles mesmos 5 dias.
   *
   * Sem `pregao`, cai no bancário - que é o comportamento anterior.
   */
  calendario: { data: string; dia_util: boolean; pregao?: boolean }[];
  /** Fechamento por pregão, no valor NOMINAL do dia. */
  precos: { data: string; fechamento: number }[];
  movimentacoes: AcaoMovimentacao[];
  proventos?: Provento[];
  eventos?: EventoCorporativo[];
  /**
   * Desconta o IR do JCP no resultado. Default **false**, para bater com o Gorila.
   *
   * O IR de 15% sobre JCP é retido na fonte de verdade - o líquido é o que cai na conta. Mas
   * o Gorila exibe o BRUTO (medido em 07/09/2026: JSCP de R$ 202,50 numa posição de 1.000
   * ações, que é 0,202504 x 1.000 sem retenção), e a decisão do Daniel foi acompanhar ele,
   * para a validação tela contra tela continuar valendo ao centavo.
   *
   * Ligar isto passa a mostrar o que entra no caixa, ao custo de divergir do Gorila em todo
   * papel que pague JCP.
   */
  descontarIrDoJcp?: boolean;
}

export interface AcaoDailyRow {
  data: string;
  diaUtil: boolean;
  /** Preço nominal do pregão. */
  preco: number;
  precoEstimado: boolean;
  compras: number;
  qtdComprada: number;
  vendas: number;
  qtdVendida: number;
  /** Quantidade em unidades de HOJE (já com desdobramentos aplicados). */
  quantidade: number;
  /** Quantidade x preço. */
  valorPosicao: number;
  custoMedio: number;
  valorInvestido: number;
  /** Provento com data-ex neste dia. `proventoLiquido` é o que entra no resultado - igual ao
   *  bruto por padrão, e descontado do IR do JCP quando `descontarIrDoJcp` está ligado. */
  proventoBruto: number;
  proventoLiquido: number;
  proventoAcumulado: number;
  /** Ganho só de preço, sem provento. */
  ganhoPreco: number;
  /** Ganho de preço + provento líquido. */
  ganhoDiario: number;
  ganhoAcumulado: number;
  /** Time-weighted, já com o provento somado de volta no dia-ex. */
  rentabilidadeAcumuladaPct: number;
  rentDiariaPct: number;
}

/**
 * Fator que converte uma quantidade da data `d` para unidades de hoje.
 *
 * É o produto dos eventos com data-ex DEPOIS de `d`. Quem comprou antes de um desdobramento
 * 2:1 tem hoje o dobro; quem comprou depois não é afetado.
 */
function fatorDesde(data: string, eventos: EventoCorporativo[]): number {
  return eventos.reduce((f, e) => (e.data_ex > data ? f * e.fator : f), 1);
}

/**
 * Fator para converter PREÇO em unidades de hoje.
 *
 * Difere do de quantidade em um ponto: evento que a fonte já embutiu na série fica de fora,
 * porque dividir de novo seria contar duas vezes. Ver `ja_refletido_no_preco`.
 */
function fatorDoPreco(data: string, eventos: EventoCorporativo[]): number {
  return fatorDesde(data, eventos.filter((e) => !e.ja_refletido_no_preco));
}

/** Soma dos proventos por data-ex, já em unidades de hoje. */
function proventosPorData(proventos: Provento[], eventos: EventoCorporativo[], descontarIr: boolean) {
  const bruto = new Map<string, number>();
  const liquido = new Map<string, number>();
  for (const p of proventos) {
    if (!p.data_ex) continue;
    // O provento é por ação da época. Como a quantidade foi multiplicada pelo fator, o valor
    // por ação tem de ser dividido por ele - senão o total recebido dobra junto com o split.
    const f = fatorDesde(p.data_ex, eventos);
    const b = p.valor / f;
    const ir = descontarIr && p.tipo === "JCP" ? IR_JCP : 0;
    bruto.set(p.data_ex, (bruto.get(p.data_ex) ?? 0) + b);
    liquido.set(p.data_ex, (liquido.get(p.data_ex) ?? 0) + b * (1 - ir));
  }
  return { bruto, liquido };
}

export function calcularAcoesDiario(input: AcoesEngineInput): AcaoDailyRow[] {
  const eventos = (input.eventos ?? []).filter((e) => e.data_ex && Number.isFinite(e.fator) && e.fator > 0);
  const proventos = input.proventos ?? [];
  const descontarIr = input.descontarIrDoJcp ?? false;

  // Preços em unidades de hoje: dividir pelo fator dos eventos posteriores.
  const precosAj = input.precos.map((p) => ({
    data: p.data,
    valor_cota: p.fechamento / fatorDoPreco(p.data, eventos),
  }));
  const precoNominal = new Map(input.precos.map((p) => [p.data, p.fechamento]));

  // Movimentações em unidades de hoje. O custo da operação entra no valor da compra e sai do
  // valor da venda: é dinheiro que saiu do bolso nos dois casos.
  const movs = input.movimentacoes
    .filter((m) => COMPRAS.has(m.tipo) || VENDAS.has(m.tipo))
    .map((m) => {
      const f = fatorDesde(m.data, eventos);
      const ehCompra = COMPRAS.has(m.tipo);
      const custos = Number(m.custos ?? 0);
      const precoDia = precoNominal.get(m.data);
      const qtdNominal = m.quantidade ?? (precoDia ? m.valor / precoDia : null);
      return {
        data: m.data,
        tipo: ehCompra ? "Aplicação" : "Resgate",
        valor: ehCompra ? m.valor + custos : m.valor - custos,
        qtd_cotas: qtdNominal != null ? qtdNominal * f : null,
        data_cotizacao: null,
      };
    });

  // O motor de fundo decide `cotaEstimada` pelo `dia_util` que recebe. Para ações o critério é o
  // PREGÃO, então é ele que vai no lugar - e o dia útil bancário é reposto na saída, mais abaixo,
  // porque é dele que o benchmark depende.
  const calendarioDePregao = input.calendario.map((c) => ({
    data: c.data,
    dia_util: c.pregao ?? c.dia_util,
  }));
  const diaUtilBancario = new Map(input.calendario.map((c) => [c.data, c.dia_util]));

  const base = { dataInicio: input.dataInicio, dataCalculo: input.dataCalculo,
                 calendario: calendarioDePregao,
                 movimentacoes: movs, fundo: { dias_cotizacao_aplicacao: 0, dias_cotizacao_resgate: 0 } };

  // 1a passada: preço puro. Dá posição, quantidade, custo médio e valor investido.
  const posicao = calcularFundoDiario({ ...base, cotas: precosAj });

  const { bruto, liquido } = proventosPorData(proventos, eventos, descontarIr);

  // 2a passada: série total-return. O provento do dia-ex é somado de volta ao preço, o que
  // desfaz exatamente a queda que ele causou - e é isso que a rentabilidade precisa enxergar.
  const totalReturn: { data: string; valor_cota: number }[] = [];
  let fatorTR = 1;
  for (let i = 0; i < precosAj.length; i++) {
    const hoje = precosAj[i].valor_cota;
    const ontem = i > 0 ? precosAj[i - 1].valor_cota : null;
    const prov = liquido.get(precosAj[i].data) ?? 0;
    if (ontem && ontem > 0) fatorTR *= (hoje + prov) / ontem;
    totalReturn.push({ data: precosAj[i].data, valor_cota: precosAj[0].valor_cota * fatorTR });
  }
  const rentab = calcularFundoDiario({ ...base, cotas: totalReturn });
  const rentPorData = new Map(rentab.map((r) => [r.data, r]));

  let proventoAcum = 0;
  let ganhoAcum = 0;
  let fatorRent = 1;

  return posicao.map((r: FundoDailyRow) => {
    const rr = rentPorData.get(r.data);
    const pBruto = (bruto.get(r.data) ?? 0) * r.saldoCotas;
    const pLiquido = (liquido.get(r.data) ?? 0) * r.saldoCotas;
    proventoAcum += pLiquido;

    // ── GANHO DE EXECUÇÃO ──────────────────────────────────────────────────────────────────
    //
    // O custo da posição é o que o cliente PAGOU, não o fechamento do dia em que ele comprou.
    // Sem esta parcela, a diferença entre o preço praticado e o fechamento simplesmente some.
    //
    // Medido em 09/09/2026 contra o GorilaVIEW: uma compra de 100 USIM5 a 7,80 num dia que
    // fechou a 7,03 aparecia com ganho de R$ 114,18 na nossa tela e R$ 44,18 na dele. A
    // diferença eram exatamente os R$ 77,00 pagos acima do fechamento, que nós descartávamos.
    // Em PETR4 o erro ia para o outro lado: comprada a 22,00 num dia que fechou a 22,92, o
    // ganho saía R$ 92,00 MENOR do que o real.
    //
    // Vale nos dois sentidos, e por isso a venda entra também: quem vende acima do fechamento
    // realiza esse ganho no dia da venda. Os custos da operação já estão embutidos em
    // `aplicacoes` e `resgatesBrutos`, então entram aqui como perda imediata, que é o que são.
    const ganhoCompra = r.qtdCotasCompra * r.valorCota - r.aplicacoes;
    const ganhoVenda = r.resgatesBrutos - r.qtdCotasResgate * r.valorCota;
    const ganhoExecucao = ganhoCompra + ganhoVenda;

    const ganhoDiario = r.ganhoDiario + pLiquido + ganhoExecucao;
    ganhoAcum += ganhoDiario;

    // ── RENTABILIDADE ──────────────────────────────────────────────────────────────────────
    //
    // O retorno do dia é o ganho sobre o capital empregado nele: saldo de ontem mais o que
    // entrou hoje. No dia da compra isso dá exatamente `fechamento / preço pago - 1`, que é a
    // regra: a rentabilidade começa no preço pago, não no fechamento.
    //
    // A série `totalReturn` continua sendo calculada porque é ela que devolve a variação sem o
    // degrau do dia-ex; o que mudou é que o ACUMULADO passa a compor a partir daqui, para o dia
    // da compra deixar de render zero.
    const rentDiaria = r.baseMW > 1e-8 ? ganhoDiario / r.baseMW : 0;
    fatorRent *= 1 + rentDiaria;

    return {
      data: r.data,
      // Bancário de propósito: o benchmark acumula CDI por este campo, e o CDI é publicado em
      // dia de banco. `r.diaUtil` aqui já é o pregão, que serviu para marcar `precoEstimado`.
      diaUtil: diaUtilBancario.get(r.data) ?? r.diaUtil,
      preco: precoNominal.get(r.data) ?? r.valorCota * fatorDoPreco(r.data, eventos),
      precoEstimado: r.cotaEstimada,
      compras: r.aplicacoes,
      qtdComprada: r.qtdCotasCompra,
      vendas: r.resgatesBrutos,
      qtdVendida: r.qtdCotasResgate,
      quantidade: r.saldoCotas,
      valorPosicao: r.saldoBruto,
      custoMedio: r.custoMedioCota,
      valorInvestido: r.valorInvestido,
      proventoBruto: pBruto,
      proventoLiquido: pLiquido,
      proventoAcumulado: proventoAcum,
      ganhoPreco: r.ganhoDiario,
      ganhoDiario,
      ganhoAcumulado: ganhoAcum,
      rentabilidadeAcumuladaPct: fatorRent - 1,
      rentDiariaPct: rentDiaria,
    };
  });
}

/** Linhas no formato que o motor de carteira consolida. */
export function acoesRowsToDailyRows(rows: AcaoDailyRow[]): DailyRow[] {
  return fundoRowsToDailyRows(
    rows.map((r) => ({
      data: r.data,
      diaUtil: r.diaUtil,
      valorCota: r.preco,
      variacaoCotaPct: r.rentDiariaPct,
      aplicacoes: r.compras,
      qtdCotasCompra: r.qtdComprada,
      resgatesBrutos: r.vendas,
      qtdCotasResgate: r.qtdVendida,
      saldoCotas: r.quantidade,
      saldoBruto: r.valorPosicao,
      baseMW: 0,
      valorInvestido: r.valorInvestido,
      custoMedioCota: r.custoMedio,
      ganhoDiario: r.ganhoDiario,
      ganhoAcumulado: r.ganhoAcumulado,
      rentDiariaPct: r.rentDiariaPct,
      rentabilidadeAcumuladaPct: r.rentabilidadeAcumuladaPct,
      rentDiariaMWPct: 0,
      rentabilidadeAcumuladaMWPct: r.rentabilidadeAcumuladaPct,
      cotaEstimada: r.precoEstimado,
    })),
  );
}

export default { calcularAcoesDiario, acoesRowsToDailyRows };
