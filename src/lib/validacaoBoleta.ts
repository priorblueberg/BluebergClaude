/**
 * Checagens que a boleta faz antes de gravar fundo e moeda.
 *
 * A boleta de renda fixa já validava dia útil, data futura e saldo do resgate;
 * fundo e moeda não validavam nada disso, então dava para lançar câmbio no
 * sábado, aplicar com data futura e vender mais do que se tem - a posição ficava
 * negativa em silêncio, como aconteceu com o título 228 da massa de CDB.
 */
import { supabase } from "@/integrations/supabase/client";

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
  const { data } = await supabase
    .from("cotas_fundos")
    .select("data, valor_cota")
    .eq("fundo_id", fundoId)
    .lte("data", dataISO)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { naData: null as number | null, ultima: null as { data: string; valor: number } | null };
  const linha = data as any;
  const ultima = { data: linha.data as string, valor: Number(linha.valor_cota) };
  return { naData: ultima.data === dataISO ? ultima.valor : null, ultima };
}

/**
 * Fundos (ou moedas) que o usuario tinha em custodia NA DATA, isto e, com saldo positivo.
 *
 * Serve para a boleta so oferecer, numa saida, o que existia naquele dia. Sem isso da para
 * escolher um fundo que so foi comprado depois, ou um ja zerado, e o erro so aparece na
 * validacao de saldo, depois de tudo preenchido.
 *
 * A data que conta e a de cotizacao quando existe: e ela que define quando a cota entrou ou
 * saiu, nao a data da ordem.
 */
export async function comSaldoNaData(
  userId: string,
  ateDataISO: string,
  chave: "fundo_id" | "moeda",
): Promise<Set<string>> {
  const { data } = await supabase
    .from("movimentacoes")
    .select("fundo_id, moeda, data, data_cotizacao, tipo_movimentacao, valor, quantidade, preco_unitario")
    .eq("user_id", userId);

  const saldos = new Map<string, number>();
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
  return new Set([...saldos].filter(([, v]) => v > 1e-8).map(([k]) => k));
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
    .select("id, data, data_cotizacao, tipo_movimentacao, valor, quantidade, preco_unitario")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId);

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
