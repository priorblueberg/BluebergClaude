/**
 * Checagens que a boleta faz antes de gravar fundo e moeda.
 *
 * A boleta de renda fixa já validava dia útil, data futura e saldo do resgate;
 * fundo e moeda não validavam nada disso, então dava para lançar câmbio no
 * sábado, aplicar com data futura e vender mais do que se tem - a posição ficava
 * negativa em silêncio, como aconteceu com o título 228 da massa de CDB.
 */
import { supabase } from "@/integrations/supabase/client";
import { posicaoNaData, type MovimentoDeFundo } from "@/lib/posicaoDeFundo";

const TABELA_COTACAO: Record<string, string> = {
  USD: "historico_dolar",
  EUR: "historico_euro",
};

const ENTRADAS = ["Aplicação", "Aplicação Inicial", "Compra"];

export const fmtData = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");

/** A data existe no calendário e é dia útil? */
export async function ehDiaUtil(dataISO: string): Promise<boolean> {
  const { data } = await supabase
    .from("calendario_dias_uteis")
    .select("dia_util")
    .eq("data", dataISO)
    .maybeSingle();
  return !!data?.dia_util;
}

/**
 * Primeiro dia em que uma carteira pode ter operacao.
 *
 * E o PRIMEIRO DIA UTIL DE 2023 - 02/01/2023, uma segunda-feira. Nada pode ser lancado antes
 * disso, em nenhum produto.
 *
 * A regra mudou em 08/09/2026, e a anterior durou menos de um dia. Ela era o ultimo dia util
 * BANCARIO de 2022 (30/12), para que quem ja tinha papel lancasse o saldo de abertura na
 * vespera e entrasse o ano novo ja rentabilizando. A ideia funcionava, mas fazia a ferramenta
 * calcular num ano que ela nao cobre, so para acomodar o saldo inicial - e a primeira posicao
 * de teste em 30/12/2022 expos um caso de borda na poupanca, cuja data-base do dia 30 vai para
 * o dia 1o e nao existe na serie do BCB.
 *
 * A decisao do Daniel foi separar as duas coisas: a ferramenta calcula 2023 em diante e ponto;
 * saldo anterior a 2023 sera tratado por um caminho proprio, ainda a definir. Enquanto esse
 * caminho nao existe, NAO ha como registrar posicao anterior a 2023 - e isso e intencional.
 *
 * O piso vale para a data de OPERACAO. Vencimento de titulo nao passa por aqui: e futuro por
 * definicao, e usa a propria data da operacao como minimo.
 *
 * Ao mexer aqui, confira antes que as series cubram a data NOVA e o que vem antes dela: o
 * `pisoDoCalendario` recua 45 dias para fechar o ciclo de IPCA, e serie faltando nao da erro,
 * so faz o motor calcular com o que tem. Hoje CDI, Selic, TR, dolar e euro comecam em
 * 01/11/2022, e o calendario em 01/01/2022 - todos com folga sobre 02/01/2023.
 */
export const DATA_MINIMA_CARTEIRA = "2023-01-02";

/**
 * Mensagem se a data da operacao estiver fora da janela permitida, ou null se estiver dentro.
 *
 * O teto e a ultima data de calculo (o penultimo dia util, ver DataReferenciaContext), nao
 * "hoje": operacao lancada num dia que ainda nao fechou entra numa janela onde falta dado.
 * Vale so para data de OPERACAO - vencimento de titulo e no futuro por definicao.
 */
export function foraDaJanela(dataISO: string, maxISO: string): string | null {
  if (dataISO < DATA_MINIMA_CARTEIRA)
    return `A data não pode ser anterior a ${fmtData(DATA_MINIMA_CARTEIRA)}, primeiro dia útil de 2023 e início do cálculo da ferramenta.`;
  if (dataISO > maxISO)
    return `Ainda não há dado divulgado para ${fmtData(dataISO)}. A última data com informação `
      + `fechada é ${fmtData(maxISO)}, e a operação só pode ser lançada até lá.`;
  return null;
}

export function ehFutura(dataISO: string): boolean {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(dataISO + "T00:00:00") > hoje;
}

/** Cotação de venda da moeda na data exata, ou a última publicada antes dela. */
export async function cotacaoMoeda(moeda: string, dataISO: string) {
  const tabela = TABELA_COTACAO[moeda];
  if (!tabela) return { naData: null as number | null, ultima: null as { data: string; valor: number } | null };

  const { data } = await supabase
    .from(tabela as any)
    .select("data, cotacao_venda")
    .lte("data", dataISO)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { naData: null, ultima: null };
  const linha = data as any;
  const ultima = { data: linha.data as string, valor: Number(linha.cotacao_venda) };
  return { naData: ultima.data === dataISO ? ultima.valor : null, ultima };
}

/** Cota do fundo na data exata, ou a última publicada antes dela. */
export async function cotaFundo(fundoId: string, dataISO: string) {
  // `primeira` vem junto de proposito, e nao e detalhe de exibicao.
  //
  // Sem ela, tres situacoes diferentes chegam na tela como a mesma frase: o fundo nao tem serie
  // carregada, a data e anterior ao comeco da serie, e a CVM ainda nao publicou a cota do dia.
  // As tres pedem acao diferente de quem esta lancando - carregar o fundo, carregar mais para
  // tras, ou esperar - e "nao ha cota disponivel para esse fundo nessa data" nao diz qual.
  // `inicioDoFundo` separa duas situacoes que parecem iguais e pedem acao oposta: a nossa serie
  // esta CURTA (o fundo ja existia antes, e carregar resolve) ou o fundo simplesmente NAO
  // EXISTIA na data (nao ha o que carregar, e sim a data a corrigir).
  const [{ data: ateAData }, { data: aPrimeira }, { data: cadastro }] = await Promise.all([
    supabase.from("cotas_fundos").select("data, valor_cota")
      .eq("fundo_id", fundoId).lte("data", dataISO)
      .order("data", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cotas_fundos").select("data")
      .eq("fundo_id", fundoId).order("data").limit(1).maybeSingle(),
    supabase.from("cadastro_de_fundos").select("data_inicio").eq("id", fundoId).maybeSingle(),
  ]);

  const primeira = (aPrimeira as { data: string } | null)?.data ?? null;
  const inicioDoFundo = (cadastro as { data_inicio: string | null } | null)?.data_inicio ?? null;
  if (!ateAData) {
    return {
      naData: null as number | null,
      ultima: null as { data: string; valor: number } | null,
      primeira, inicioDoFundo,
    };
  }
  const linha = ateAData as { data: string; valor_cota: number };
  const ultima = { data: linha.data, valor: Number(linha.valor_cota) };
  return { naData: ultima.data === dataISO ? ultima.valor : null, ultima, primeira, inicioDoFundo };
}

/**
 * Saldo por fundo (ou por moeda) que o usuario tinha NA DATA. So entra quem tem saldo
 * positivo, entao a presenca da chave ja responde "estava em custodia?" e o valor responde
 * "quanto?" - a boleta precisa das duas coisas: filtrar a lista e mostrar o disponivel.
 *
 * Serve para a boleta so oferecer, numa saida, o que existia naquele dia. Sem isso da para
 * escolher um fundo que so foi comprado depois, ou um ja zerado, e o erro so aparece na
 * validacao de saldo, depois de tudo preenchido.
 *
 * A data que conta e a de cotizacao quando existe: e ela que define quando a cota entrou ou
 * saiu, nao a data da ordem.
 */
export async function saldosNaData(
  userId: string,
  ateDataISO: string,
  chave: "fundo_id" | "moeda",
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("movimentacoes")
    .select("codigo_custodia, fundo_id, moeda, data, data_cotizacao, tipo_movimentacao, valor, quantidade, preco_unitario, created_at")
    .eq("user_id", userId);

  const saldos = new Map<string, number>();
  if (chave === "fundo_id") {
    // Fundo soma POSICAO a posicao, e nao movimento a movimento: uma "Mudança de Fundo" leva o
    // saldo inteiro da posicao para o fundo novo, e somar por `fundo_id` deixaria o antigo com
    // cotas que nao existem mais.
    const porPosicao = new Map<string, MovimentoDeFundo[]>();
    for (const m of ((data || []) as any[])) {
      if (!m.fundo_id) continue;
      const k = m.codigo_custodia ? String(m.codigo_custodia) : `sem-codigo:${m.fundo_id}`;
      porPosicao.set(k, [...(porPosicao.get(k) ?? []), m]);
    }
    for (const movs of porPosicao.values()) {
      const p = posicaoNaData(movs, ateDataISO);
      if (p.fundoId) saldos.set(p.fundoId, (saldos.get(p.fundoId) ?? 0) + p.saldo);
    }
    return new Map([...saldos].filter(([, v]) => v > 1e-8));
  }
  for (const m of ((data || []) as any[])) {
    const k = m[chave];
    if (!k) continue;
    const dataEfetiva = m.data_cotizacao || m.data;
    if (dataEfetiva > ateDataISO) continue;

    let qtd = m.quantidade != null ? Number(m.quantidade) : null;
    if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
    if (qtd == null) continue;

    saldos.set(k, (saldos.get(k) ?? 0) + (ENTRADAS.includes(m.tipo_movimentacao) ? qtd : -qtd));
  }
  // 1e-8 e a mesma folga que a validacao de saldo usa, para posicao residual de arredondamento
  // nao aparecer como se ainda houvesse o que resgatar.
  return new Map([...saldos].filter(([, v]) => v > 1e-8));
}

/**
 * Data em que a operacao cotiza: D+n dias uteis a partir da data da operacao, com o n vindo do
 * cadastro do fundo (aplicacao e resgate podem ter prazos diferentes).
 *
 * Mora aqui porque a boleta precisa dela duas vezes: para MOSTRAR a cota que sera usada e para
 * GRAVAR a quantidade. Enquanto o calculo estava so no submit, a tela nao tinha como exibir a
 * cota certa - e duas copias da regra divergiriam na primeira mudanca.
 */
export async function dataCotizacaoFundo(
  fundoId: string,
  dataISO: string,
  tipoMovimentacao: string,
): Promise<string> {
  // Come-cotas nao pede resgate a ninguem: e retencao na fonte no ultimo dia util de maio e
  // novembro, pela cota daquele proprio dia. Aplicar o prazo de resgate nele deslocaria o
  // evento. Hoje todos os fundos cadastrados sao D+0 e isso nao aparece; num fundo D+1 sim.
  if (tipoMovimentacao === "Come-Cotas") return dataISO;

  const { data: cfg } = await supabase
    .from("cadastro_de_fundos")
    .select("dias_cotizacao_aplicacao, dias_cotizacao_resgate")
    .eq("id", fundoId)
    .maybeSingle();

  const dias = tipoMovimentacao === "Aplicação"
    ? ((cfg as any)?.dias_cotizacao_aplicacao ?? 0)
    : ((cfg as any)?.dias_cotizacao_resgate ?? 0);

  const { data: diasCal } = await supabase
    .from("calendario_dias_uteis")
    .select("data, dia_util")
    .gte("data", dataISO)
    .order("data")
    .limit(60);

  const uteis = ((diasCal || []) as any[]).filter((d) => d.dia_util).map((d) => d.data as string);
  return uteis[dias] ?? uteis[0] ?? dataISO;
}

/**
 * Saldo em cotas (fundo) ou em moeda estrangeira (câmbio) até a data, somando as
 * entradas e subtraindo as saídas já lançadas.
 */
export async function saldoEmQuantidade(
  codigoCustodia: string,
  userId: string,
  ateDataISO: string,
  /** Ao editar, a propria movimentacao nao pode entrar no saldo contra o qual ela e validada. */
  ignorarId?: string | null,
): Promise<number> {
  const { data } = await supabase
    .from("movimentacoes")
    .select("id, fundo_id, data, data_cotizacao, tipo_movimentacao, valor, quantidade, preco_unitario, created_at")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId);

  // Posicao de fundo: a "Mudança de Fundo" substitui o saldo, e isso so da certo em ordem.
  const deFundo = ((data || []) as any[]).filter((m) => !(ignorarId && m.id === ignorarId));
  if (deFundo.some((m) => m.fundo_id)) return posicaoNaData(deFundo, ateDataISO).saldo;

  let saldo = 0;
  for (const m of (data || []) as any[]) {
    if (ignorarId && m.id === ignorarId) continue;
    const dataEfetiva = m.data_cotizacao || m.data;
    if (dataEfetiva > ateDataISO) continue;

    let qtd = m.quantidade != null ? Number(m.quantidade) : null;
    if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
    if (qtd == null) continue;

    saldo += ENTRADAS.includes(m.tipo_movimentacao) ? qtd : -qtd;
  }
  return saldo;
}
