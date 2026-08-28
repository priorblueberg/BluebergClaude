/**
 * Detecta que a aba está rodando um build antigo.
 *
 * O recálculo reescreve custódia e carteiras inteiras. Uma aba aberta desde
 * antes do deploy continua com o JS velho e refaz esse trabalho com regras
 * antigas - foi assim que fundos e moedas sumiram duas vezes em 27/08/2026,
 * porque o build anterior não conhecia essas categorias e descartava as duas.
 *
 * O index.html é servido com must-revalidate, então basta relê-lo e comparar o
 * nome do bundle com o que esta aba carregou.
 */
const bundleDaAba = () =>
  [...document.getElementsByTagName("script")]
    .map((s) => s.src)
    .find((src) => /\/assets\/index-.*\.js$/.test(src)) ?? null;

export async function haVersaoNovaPublicada(): Promise<boolean> {
  const meu = bundleDaAba();
  if (!meu) return false;
  try {
    const html = await fetch(`/index.html?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
    const publicado = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    return !!publicado && !meu.endsWith(publicado);
  } catch {
    // Sem rede ou index inacessível: não é hora de bloquear o usuário.
    return false;
  }
}
