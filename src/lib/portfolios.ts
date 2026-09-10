/**
 * Regras de nome e mensagens dos portfólios, puras para o vitest.
 *
 * O banco garante as mesmas regras (check de tamanho, índice único por conta e gatilho de limite).
 * Aqui elas só chegam antes, na tela, com mensagem em português.
 */

export const LIMITE_DE_PORTFOLIOS = 10;
export const TAMANHO_MAXIMO_DO_NOME = 60;

/** "  Pessoal   XP " -> "Pessoal XP". É assim que o nome vai para o banco. */
export function normalizarNomeDePortfolio(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

/**
 * Motivo para recusar o nome, ou null se ele serve. Duplicado não diferencia maiúsculas nem espaços,
 * como o índice do banco. Ao renomear, `idEmEdicao` deixa o portfólio manter o próprio nome.
 */
export function validarNomeDePortfolio(
  nome: string,
  existentes: { id: string; nome: string }[],
  idEmEdicao?: string,
): string | null {
  const limpo = normalizarNomeDePortfolio(nome);
  if (!limpo) return "Informe um nome.";
  if (limpo.length > TAMANHO_MAXIMO_DO_NOME) return `Use no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`;
  const chave = limpo.toLowerCase();
  if (existentes.some((p) => p.id !== idEmEdicao && normalizarNomeDePortfolio(p.nome).toLowerCase() === chave)) {
    return "Já existe um portfólio com esse nome.";
  }
  return null;
}

/** Erro do PostgREST em mensagem para a tela. Os gatilhos já escrevem em português (P0001). */
export function traduzirErroDePortfolio(erro: { code?: string; message?: string } | null | undefined): string {
  if (!erro) return "Não foi possível concluir a operação.";
  if (erro.code === "23505") return "Já existe um portfólio com esse nome.";
  if (erro.code === "23514") return `O nome precisa ter de 1 a ${TAMANHO_MAXIMO_DO_NOME} caracteres.`;
  return erro.message || "Não foi possível concluir a operação.";
}
