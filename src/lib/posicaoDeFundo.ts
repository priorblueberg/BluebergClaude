/**
 * Posicao de um cliente num fundo quando o fundo MUDA no meio do caminho.
 *
 * Na adaptacao a Resolucao CVM 175 um fundo pode trocar de CNPJ ou virar subclasse de outro. A
 * ferramenta detecta a mudanca e o cliente informa o fundo novo pelo Sininho; a resposta vira um
 * movimento "Mudança de Fundo" DENTRO da mesma posicao (mesmo codigo de custodia). Assim a linha
 * da carteira, o custo e o ganho acumulado continuam, e nada aparece como dinheiro entrando ou
 * saindo.
 *
 * Tudo que le a posicao de fundo precisa entender esse movimento: o saldo (boleta), a custodia
 * (syncEngine) e a serie de cotas (motor). As regras moram aqui para as tres leituras nao
 * divergirem. O servidor tem uma copia em `supabase/functions/_shared/mudancaDeFundo.ts`.
 */

export const TIPO_MUDANCA_DE_FUNDO = "Mudança de Fundo";
export const TIPO_RESGATE_TOTAL = "Resgate Total";
const ENTRADAS = ["Aplicação", "Aplicação Inicial"];

export interface MovimentoDeFundo {
  fundo_id: string | null;
  data: string;
  data_cotizacao?: string | null;
  tipo_movimentacao: string;
  quantidade?: number | string | null;
  valor?: number | string | null;
  preco_unitario?: number | string | null;
  created_at?: string | null;
  /** So na "Mudança de Fundo": quantidade no fundo novo / saldo no fundo antigo. */
  fator_conversao?: number | string | null;
}

export const dataEfetiva = (m: { data: string; data_cotizacao?: string | null }) => m.data_cotizacao || m.data;

/**
 * Ordem da posicao: data de cotizacao e, no mesmo dia, o "Resgate Total" por ultimo, porque ele zera a
 * posicao ao FINAL do dia, com tudo o que entrou nele; empate, pela ordem de cadastro.
 */
export function ordenarMovimentosDeFundo<T extends MovimentoDeFundo>(movs: T[]): T[] {
  const peso = (m: MovimentoDeFundo) => (m.tipo_movimentacao === TIPO_RESGATE_TOTAL ? 1 : 0);
  return [...movs].sort((a, b) =>
    dataEfetiva(a).localeCompare(dataEfetiva(b))
    || peso(a) - peso(b)
    || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

const ordenar = ordenarMovimentosDeFundo;

/**
 * "Resgate Total" de fundo acompanha o historico (Daniel, 12/09/2026), como na renda fixa e no Gorila:
 * a posicao fica zerada ao final do dia do resgate mesmo quando uma aplicacao, um resgate ou uma
 * mudanca de fundo ANTERIOR a ele entra, muda ou sai depois. A quantidade passa a ser o saldo de cotas
 * na vespera do fechamento (com o que entrou no proprio dia) e o valor, essa quantidade x a cota da data
 * de cotizacao dele.
 *
 * A "Mudança de Fundo" tambem acompanha (Daniel, 12/09/2026): com o fator de conversao guardado, a
 * quantidade no fundo novo passa a ser o saldo do fundo antigo na data x fator, e o valor, essa quantidade
 * x a cota nova. Sem fator (lancamento anterior a regra), fica como esta.
 *
 * Devolve so os movimentos que precisam mudar. Sem cota na data, o resgate total fica como esta.
 */
export interface AjusteDeMovimento { id: string; quantidade: number; valor: number; preco_unitario: number }

const quantidadeDe = (m: MovimentoDeFundo): number | null => {
  let qtd = m.quantidade != null ? Number(m.quantidade) : null;
  if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
  return qtd != null && Number.isFinite(qtd) ? qtd : null;
};

const fatorDe = (m: MovimentoDeFundo): number | null => {
  const f = m.fator_conversao != null ? Number(m.fator_conversao) : null;
  return f != null && Number.isFinite(f) && f > 0 ? f : null;
};

const arredondarCotas = (n: number) => Math.round(n * 1e8) / 1e8;

export function ajustarMovimentosDerivados<T extends MovimentoDeFundo & { id: string }>(
  movs: T[],
  cotaEm: (dataISO: string) => number | null,
): AjusteDeMovimento[] {
  const ajustes: AjusteDeMovimento[] = [];
  let saldo = 0;
  for (const m of ordenar(movs)) {
    const qtd = quantidadeDe(m);
    const mudou = (quantidade: number, valor: number) =>
      qtd == null || Math.abs(quantidade - qtd) > 1e-8 || Math.abs(valor - Number(m.valor)) >= 0.005;

    if (m.tipo_movimentacao === TIPO_RESGATE_TOTAL) {
      const cota = cotaEm(dataEfetiva(m));
      if (cota != null && cota > 0) {
        const quantidade = arredondarCotas(Math.max(saldo, 0));
        const valor = Math.round(quantidade * cota * 100) / 100;
        if (mudou(quantidade, valor)) ajustes.push({ id: m.id, quantidade, valor, preco_unitario: cota });
      }
      saldo = 0;
      continue;
    }

    if (m.tipo_movimentacao === TIPO_MUDANCA_DE_FUNDO) {
      const fator = fatorDe(m);
      const cotaNova = Number(m.preco_unitario);
      if (fator != null && cotaNova > 0) {
        const quantidade = arredondarCotas(Math.max(saldo, 0) * fator);
        const valor = Math.round(quantidade * cotaNova * 100) / 100;
        if (mudou(quantidade, valor)) ajustes.push({ id: m.id, quantidade, valor, preco_unitario: cotaNova });
        saldo = quantidade;
      } else if (qtd != null) {
        saldo = qtd;
      }
      continue;
    }

    if (qtd == null) continue;
    if (ENTRADAS.includes(m.tipo_movimentacao)) saldo += qtd;
    else saldo -= qtd;
  }
  return ajustes;
}

/** Nome do primeiro recalculo, que so tratava o "Resgate Total". */
export const ajustarResgatesTotais = ajustarMovimentosDerivados;

/**
 * Primeira saida (resgate ou come-cotas) sem saldo na posicao, ou null (Daniel, 12/09/2026).
 *
 * Serve para conferir uma inclusao, edicao ou exclusao ANTES de gravar: aplicacao editada para menos,
 * aplicacao excluida ou resgate retroativo nao podem deixar um resgate posterior maior que o saldo, senao
 * a posicao fica negativa sem aviso. O "Resgate Total" nunca falta (ele leva o saldo do dia) e a "Mudança
 * de Fundo" com fator acompanha o saldo, como em `ajustarMovimentosDerivados`.
 */
export function primeiraSaidaSemSaldo<T extends MovimentoDeFundo & { id: string }>(
  movs: T[],
): { id: string; data: string; tipo: string; quantidade: number; saldo: number } | null {
  let saldo = 0;
  for (const m of ordenar(movs)) {
    const qtd = quantidadeDe(m);
    if (m.tipo_movimentacao === TIPO_RESGATE_TOTAL) {
      saldo = 0;
      continue;
    }
    if (m.tipo_movimentacao === TIPO_MUDANCA_DE_FUNDO) {
      const fator = fatorDe(m);
      if (fator != null) saldo = arredondarCotas(Math.max(saldo, 0) * fator);
      else if (qtd != null) saldo = qtd;
      continue;
    }
    if (qtd == null) continue;
    if (ENTRADAS.includes(m.tipo_movimentacao)) {
      saldo += qtd;
    } else {
      if (qtd > saldo + 1e-8) {
        return { id: m.id, data: dataEfetiva(m), tipo: m.tipo_movimentacao, quantidade: qtd, saldo: Math.max(saldo, 0) };
      }
      saldo -= qtd;
    }
  }
  return null;
}

/**
 * Fundo e saldo de cotas de UMA posicao (um codigo de custodia) na data.
 *
 * "Mudança de Fundo" SUBSTITUI o saldo em vez de somar: e a quantidade que o cliente tem no
 * fundo novo, que pode diferir da antiga quando houve fator de conversao.
 */
export function posicaoNaData(movs: MovimentoDeFundo[], ateISO: string): { fundoId: string | null; saldo: number } {
  const ordenados = ordenar(movs);
  let fundoId = ordenados.find((m) => m.fundo_id)?.fundo_id ?? null;
  let saldo = 0;
  for (const m of ordenados) {
    if (dataEfetiva(m) > ateISO) break;
    let qtd = m.quantidade != null ? Number(m.quantidade) : null;
    if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
    if (qtd == null || !Number.isFinite(qtd)) continue;
    if (m.tipo_movimentacao === TIPO_MUDANCA_DE_FUNDO) {
      if (m.fundo_id) fundoId = m.fundo_id;
      saldo = qtd;
    } else if (ENTRADAS.includes(m.tipo_movimentacao)) {
      saldo += qtd;
    } else {
      saldo -= qtd;
    }
  }
  if (Math.abs(saldo) < 1e-8) saldo = 0;
  return { fundoId, saldo };
}

/** De quando a quando cada fundo alimentou a posicao. O primeiro trecho comeca em "". */
export function trechosDaPosicao(movs: MovimentoDeFundo[]): { desde: string; fundoId: string }[] {
  const ordenados = ordenar(movs);
  const inicial = ordenados.find((m) => m.fundo_id)?.fundo_id;
  if (!inicial) return [];
  const trechos = [{ desde: "", fundoId: inicial }];
  for (const m of ordenados) {
    if (m.tipo_movimentacao !== TIPO_MUDANCA_DE_FUNDO || !m.fundo_id) continue;
    trechos.push({ desde: dataEfetiva(m), fundoId: m.fundo_id });
  }
  return trechos;
}

/**
 * A serie de cotas da posicao, costurada pelos trechos: antes da mudanca, a cota do fundo
 * antigo; a partir dela, a do novo.
 *
 * A costura NAO ajusta valor. Se houve fator de conversao a serie da um salto na data da
 * mudanca, e quem absorve o salto e o motor, que troca a quantidade de cotas no mesmo dia.
 */
export function cotasCosturadas(
  trechos: { desde: string; fundoId: string }[],
  cotasPorFundo: Map<string, { data: string; valor_cota: number }[]>,
): { data: string; valor_cota: number }[] {
  const out: { data: string; valor_cota: number }[] = [];
  trechos.forEach((t, i) => {
    const fim = trechos[i + 1]?.desde;
    for (const c of cotasPorFundo.get(t.fundoId) ?? []) {
      if (c.data >= t.desde && (!fim || c.data < fim)) out.push(c);
    }
  });
  return out.sort((a, b) => a.data.localeCompare(b.data));
}
