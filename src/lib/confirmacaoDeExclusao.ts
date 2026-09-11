/**
 * Texto da confirmação de exclusão de uma movimentação.
 *
 * A oficial é a da tela de Movimentações (decisão do Daniel, 10/09/2026): ela nomeia a transação
 * (tipo, ativo, data e valor), como a do Gorila. O detalhe da posição tinha um texto próprio
 * ("Deseja excluir esta movimentação?"), e numa lista de linhas parecidas isso não deixa conferir
 * se a linha certa foi clicada. As duas telas usam esta função.
 */

export interface MovimentacaoAExcluir {
  tipo_movimentacao: string;
  nome_ativo: string | null;
  data: string | null;
  valor: number | null;
}

const fmtData = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—";

export const TITULO_CONFIRMACAO_DE_EXCLUSAO = "Confirmar exclusão";

export function textoConfirmacaoDeExclusao(mov: MovimentacaoAExcluir | null | undefined): string {
  if (!mov) return "Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.";
  const valor = mov.valor != null
    ? mov.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "valor não informado";
  const alvo = `${mov.tipo_movimentacao.toLowerCase()} de ${mov.nome_ativo ?? "ativo sem nome"} em ${fmtData(mov.data)}, no valor de ${valor}`;
  return mov.tipo_movimentacao === "Aplicação Inicial"
    ? `A ${alvo} é a aplicação inicial do título. Excluí-la remove o título da custódia e apaga TODAS as movimentações desse código, permanentemente.`
    : `A ${alvo} será excluída. Esta ação não pode ser desfeita.`;
}

/** Mensagens depois da exclusão, iguais nas duas telas. */
export const AVISO_EXCLUSAO_ATIVO = "Ativo, custódia e todas as movimentações excluídos com sucesso.";
export const AVISO_EXCLUSAO_MOVIMENTACAO = "Movimentação excluída com sucesso.";
