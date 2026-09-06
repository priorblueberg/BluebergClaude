/**
 * Barra o que o build deixa passar.
 *
 * O `vite build` nao faz checagem de tipos: um identificador inexistente compila
 * e so quebra no navegador, em runtime. Foi assim que uma funcao apagada por
 * engano ("indiceDeEncerramento is not defined") chegou em producao e derrubou a
 * troca de data de referencia.
 *
 * Ate 06/09/2026 este script tolerava erro de TIPO e so reprovava simbolo ou
 * modulo inexistente, porque o `types.ts` descrevia o schema `public` enquanto o
 * client resolve em `invest`: cada `.from()` era um erro, 393 no total, e com
 * esse volume nenhum aviso valia nada. Foi assim que derrubar cinco colunas de
 * `movimentacoes` passou pela compilacao e virou lista vazia em producao.
 *
 * Com os tipos regerados e os 49 erros restantes zerados, a tolerancia acabou:
 * qualquer erro do tsc reprova. Se o ruido voltar a acumular, conserte o ruido -
 * nao afrouxe esta regra, senao ela volta a nao proteger nada.
 */
import { execSync } from "node:child_process";

let saida = "";
try {
  saida = execSync("npx tsc --noEmit -p tsconfig.app.json", { encoding: "utf8", stdio: "pipe" });
} catch (e) {
  saida = `${e.stdout || ""}${e.stderr || ""}`;
}

const problemas = saida.split("\n").filter((linha) => /error TS\d+:/.test(linha));

if (problemas.length > 0) {
  console.error(`\nErros de tipo (${problemas.length}):\n`);
  for (const p of problemas.slice(0, 40)) console.error("  " + p.trim());
  if (problemas.length > 40) console.error(`  ... e mais ${problemas.length - 40}.`);
  console.error("\nO build nao checa tipos: isso passaria e quebraria no navegador. Corrija antes de publicar.\n");
  process.exit(1);
}

console.log("tsc limpo: nenhum erro de tipo.");
