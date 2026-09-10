// Mede o layout de impressao do documento: se o indice cabe na primeira pagina e se alguma tabela
// ou bloco passa da largura util. Uso: node scripts/medir-pdf.cjs <arquivo.html>
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const [html] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: process.env.CANAL || "chrome" });
  // A4 com margens de 18mm dos lados: 174mm de largura util, 259mm de altura util (96 dpi).
  const mm = 96 / 25.4;
  const page = await browser.newPage({ viewport: { width: Math.round(174 * mm), height: 1200 } });
  await page.goto("file:///" + path.resolve(html).replace(/\\/g, "/"));
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate((alturaUtil) => {
    const indice = document.querySelector(".indice").getBoundingClientRect();
    const largura = document.body.clientWidth;
    const largos = [...document.querySelectorAll("table, .regra, ol, ul")]
      .filter((e) => e.scrollWidth > largura + 1)
      .map((e) => (e.className || e.tagName) + " " + e.scrollWidth);
    const s85 = document.getElementById("sec-8-5");
    return {
      fimDoIndicePx: Math.round(indice.bottom + window.scrollY),
      alturaUtilPx: Math.round(alturaUtil),
      indiceCabeNaPrimeiraPagina: indice.bottom + window.scrollY <= alturaUtil,
      blocosMaisLargosQueAPagina: largos,
      secao85Existe: !!s85,
      entradasNoIndice: document.querySelectorAll(".indice-lista a").length,
    };
  }, 259 * mm);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
