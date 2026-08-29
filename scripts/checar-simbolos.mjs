/**
 * Barra o que o build deixa passar.
 *
 * O `vite build` nao faz checagem de tipos: um identificador inexistente compila
 * e so quebra no navegador, em runtime. Foi assim que uma funcao apagada por
 * engano ("indiceDeEncerramento is not defined") chegou em producao e derrubou a
 * troca de data de referencia.
 *
 * Este script roda o tsc e falha SO nos erros que viram quebra em runtime -
 * simbolo ou modulo inexistente - ignorando o ruido de tipagem gerada do
 * Supabase, que o projeto conhece e convive.
 */
import { execSync } from "node:child_process";

const FATAIS = [
  /Cannot find name/,
  /Cannot find module/,
  /has no exported member/,
  /is not a function/,
];

let saida = "";
try {
  saida = execSync("npx tsc --noEmit -p tsconfig.app.json", { encoding: "utf8", stdio: "pipe" });
} catch (e) {
  saida = `${e.stdout || ""}${e.stderr || ""}`;
}

const problemas = saida
  .split("\n")
  .filter((linha) => FATAIS.some((re) => re.test(linha)));

if (problemas.length > 0) {
  console.error(`\nSímbolos ou módulos inexistentes (${problemas.length}):\n`);
  for (const p of problemas) console.error("  " + p.trim());
  console.error("\nIsso quebra em runtime, não no build. Corrija antes de publicar.\n");
  process.exit(1);
}

console.log("Nenhum símbolo ou módulo inexistente.");
