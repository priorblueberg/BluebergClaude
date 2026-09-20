/**
 * Leitura de quantidade digitada (cotas, moeda).
 *
 * A boleta tratava TODO ponto como separador de milhar: quem digitasse `0.5`
 * cotas gravava `5`, sem aviso. Aqui a regra é a que a pessoa espera:
 *
 * - tem vírgula   -> vírgula é o decimal e os pontos são milhar ("1.234,56" = 1234,56)
 * - só um ponto   -> o ponto é o decimal ("0.5" = 0,5)
 * - vários pontos -> todos são milhar ("1.234.567" = 1234567)
 *
 * Devolve null quando não sobra número, para o chamador tratar como "em branco"
 * em vez de gravar zero.
 */
export function parseQuantidade(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const limpo = texto.trim().replace(/\s/g, "");
  if (!limpo) return null;

  let normalizado: string;
  if (limpo.includes(",")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const pontos = (limpo.match(/\./g) || []).length;
    normalizado = pontos === 1 ? limpo : limpo.replace(/\./g, "");
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mascara de quantidade em pt-BR: ponto no milhar, virgula no decimal.
 *
 * Existe para o campo de quantidade de acoes (Daniel, 20/09/2026). Nao e so cosmetica: o campo
 * aceitava ponto digitado a mao, e o `parseQuantidade` le UM ponto sozinho como decimal - quem
 * digitasse "1.300" gravava 1,3 acao, em silencio. Com a mascara o formato deixa de ser ambiguo,
 * e a leitura passa a ser o `parseQuantidadeMascarada`, que trata todo ponto como milhar.
 *
 * A virgula final sobrevive enquanto a pessoa digita ("1.300," continua "1.300,"), senao seria
 * impossivel chegar na parte decimal.
 */
export function formatarQuantidadeBR(bruto: string, maxDecimais = 8): string {
  const limpo = bruto.replace(/[^\d,]/g, "");
  if (!limpo) return "";

  const [inteiroCru, ...resto] = limpo.split(",");
  const temVirgula = resto.length > 0;
  const inteiro = (inteiroCru.replace(/^0+(?=\d)/, "") || "0")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (!temVirgula) return inteiro;
  return `${inteiro},${resto.join("").slice(0, maxDecimais)}`;
}

/**
 * Le o que a `formatarQuantidadeBR` produziu: ponto e SEMPRE milhar, virgula e sempre decimal.
 *
 * Diferente do `parseQuantidade`, que precisa adivinhar porque recebe texto livre.
 */
export function parseQuantidadeMascarada(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!limpo || limpo === ".") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}
