/**
 * Posicao de um cliente num fundo: saldo de cotas e as movimentacoes que dependem dele.
 *
 * Desde 12/09/2026 (decisao do Daniel) cada posicao tem UM fundo so. Quando o fundo para de receber
 * cota da CVM (encerrado, incorporado, migrado para outro CNPJ ou para uma subclasse), a tela avisa ao
 * lado do nome e o cliente encerra ou migra a posicao. A migracao grava duas movimentacoes ligadas por
 * `transferencia_id`: a "Migração (saída)", que fecha a posicao antiga com o saldo exato, e a "Migração
 * (entrada)", que abre (ou soma) a posicao do fundo novo com o mesmo valor. Nao ha serie costurada nem
 * troca de fundo dentro de uma posicao.
 *
 * O saldo (boleta), a custodia (syncEngine) e as conferencias leem as regras daqui, para nao divergirem.
 */

export const TIPO_RESGATE_TOTAL = "Resgate Total";
export const TIPO_MIGRACAO_SAIDA = "Migração (saída)";
export const TIPO_MIGRACAO_ENTRADA = "Migração (entrada)";
export const TIPOS_DE_MIGRACAO = [TIPO_MIGRACAO_SAIDA, TIPO_MIGRACAO_ENTRADA];

const ENTRADAS = ["Aplicação", "Aplicação Inicial", TIPO_MIGRACAO_ENTRADA];
/** Saidas que levam o saldo inteiro do dia: acompanham o historico anterior e nunca faltam saldo. */
const SAIDAS_TOTAIS = [TIPO_RESGATE_TOTAL, TIPO_MIGRACAO_SAIDA];

export interface MovimentoDeFundo {
  fundo_id: string | null;
  data: string;
  data_cotizacao?: string | null;
  tipo_movimentacao: string;
  quantidade?: number | string | null;
  valor?: number | string | null;
  preco_unitario?: number | string | null;
  created_at?: string | null;
  /** So na "Migração (entrada)": quantidade no fundo novo / quantidade que saiu do antigo. */
  fator_conversao?: number | string | null;
  /** Liga as duas pontas de uma migracao. */
  transferencia_id?: string | null;
}

export const dataEfetiva = (m: { data: string; data_cotizacao?: string | null }) => m.data_cotizacao || m.data;

/**
 * Ordem da posicao: data de cotizacao e, no mesmo dia, as saidas totais por ultimo, porque elas zeram a
 * posicao ao FINAL do dia, com tudo o que entrou nele; empate, pela ordem de cadastro.
 */
export function ordenarMovimentosDeFundo<T extends MovimentoDeFundo>(movs: T[]): T[] {
  const peso = (m: MovimentoDeFundo) => (SAIDAS_TOTAIS.includes(m.tipo_movimentacao) ? 1 : 0);
  return [...movs].sort((a, b) =>
    dataEfetiva(a).localeCompare(dataEfetiva(b))
    || peso(a) - peso(b)
    || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

const ordenar = ordenarMovimentosDeFundo;

const quantidadeDe = (m: MovimentoDeFundo): number | null => {
  let qtd = m.quantidade != null ? Number(m.quantidade) : null;
  if (qtd == null && Number(m.preco_unitario) > 0) qtd = Number(m.valor) / Number(m.preco_unitario);
  return qtd != null && Number.isFinite(qtd) ? qtd : null;
};

const arredondarCotas = (n: number) => Math.round(n * 1e8) / 1e8;

/** Fundo e saldo de cotas de UMA posicao (um codigo de custodia) na data. */
export function posicaoNaData(movs: MovimentoDeFundo[], ateISO: string): { fundoId: string | null; saldo: number } {
  const ordenados = ordenar(movs);
  const fundoId = ordenados.find((m) => m.fundo_id)?.fundo_id ?? null;
  let saldo = 0;
  for (const m of ordenados) {
    if (dataEfetiva(m) > ateISO) break;
    const qtd = quantidadeDe(m);
    if (qtd == null) continue;
    if (ENTRADAS.includes(m.tipo_movimentacao)) saldo += qtd;
    else saldo -= qtd;
  }
  if (Math.abs(saldo) < 1e-8) saldo = 0;
  return { fundoId, saldo };
}

export interface AjusteDeMovimento { id: string; quantidade: number; valor: number; preco_unitario: number }

/**
 * Movimentacoes que dependem do saldo e acompanham o historico anterior (Daniel, 12/09/2026), como na
 * renda fixa e no Gorila: o "Resgate Total" e a "Migração (saída)" levam o saldo exato do dia (com o que
 * entrou no proprio dia), e o valor passa a ser essa quantidade x a cota da data. A posicao segue zerada
 * no fechamento mesmo quando uma movimentacao ANTERIOR entra, muda ou sai depois.
 *
 * Devolve so as que precisam mudar. Sem cota na data, a movimentacao fica como esta. A "Migração
 * (entrada)" acompanha a saida pelo fator (`entradaDaMigracao`), na posicao do fundo novo.
 */
export function ajustarMovimentosDerivados<T extends MovimentoDeFundo & { id: string }>(
  movs: T[],
  cotaEm: (dataISO: string) => number | null,
): AjusteDeMovimento[] {
  const ajustes: AjusteDeMovimento[] = [];
  let saldo = 0;
  for (const m of ordenar(movs)) {
    const qtd = quantidadeDe(m);
    if (SAIDAS_TOTAIS.includes(m.tipo_movimentacao)) {
      const cota = cotaEm(dataEfetiva(m));
      if (cota != null && cota > 0) {
        const quantidade = arredondarCotas(Math.max(saldo, 0));
        const valor = Math.round(quantidade * cota * 100) / 100;
        if (qtd == null || Math.abs(quantidade - qtd) > 1e-8 || Math.abs(valor - Number(m.valor)) >= 0.005) {
          ajustes.push({ id: m.id, quantidade, valor, preco_unitario: cota });
        }
      }
      saldo = 0;
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

/** A "Migração (entrada)" que acompanha a saida: quantidade = saida x fator; valor = o da saida. */
export function entradaDaMigracao(saida: { quantidade: number; valor: number }, fator: number): { quantidade: number; valor: number } {
  return { quantidade: arredondarCotas(saida.quantidade * (fator > 0 ? fator : 1)), valor: saida.valor };
}

/**
 * Primeira saida (resgate ou come-cotas) sem saldo na posicao, ou null (Daniel, 12/09/2026).
 *
 * Serve para conferir uma inclusao, edicao ou exclusao ANTES de gravar: aplicacao editada para menos,
 * aplicacao excluida ou resgate retroativo nao podem deixar um resgate posterior maior que o saldo, senao
 * a posicao fica negativa sem aviso. As saidas totais nunca faltam (levam o saldo do dia).
 */
export function primeiraSaidaSemSaldo<T extends MovimentoDeFundo & { id: string }>(
  movs: T[],
): { id: string; data: string; tipo: string; quantidade: number; saldo: number } | null {
  let saldo = 0;
  for (const m of ordenar(movs)) {
    const qtd = quantidadeDe(m);
    if (SAIDAS_TOTAIS.includes(m.tipo_movimentacao)) {
      saldo = 0;
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
