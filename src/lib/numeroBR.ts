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
