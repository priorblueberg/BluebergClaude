// Gera um PDF a partir de um HTML local, respeitando o @page do documento.
// Uso: node scripts/gerar-pdf.cjs <arquivo.html> <arquivo.pdf>
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const [html, pdf] = process.argv.slice(2);
  // Usa o navegador do sistema: os binarios do Playwright nao estao baixados nesta maquina.
  const browser = await chromium.launch({ channel: process.env.CANAL || "chrome" });
  const page = await browser.newPage();
  await page.goto("file:///" + path.resolve(html).replace(/\\/g, "/"));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log("pdf ok", pdf);
})();
