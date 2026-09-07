/**
 * Leitura do arquivo publico de precos indicativos de debentures da ANBIMA.
 *
 *   https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/db{DDMMAA}.txt
 *
 * Formato: encoding latin-1, campos separados por "@", 3 linhas de preambulo
 * (titulo, vazia, cabecalho) e 15 campos por registro. Cerca de 1.290 papeis por dia.
 *
 * Separado do coletor para poder ser testado sem credencial de banco.
 */

export const BASE_ANBIMA =
  "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs";

/** "1.084,413875" -> 1084.413875 ; "--", "N/D" e vazio -> null */
export function num(v) {
  if (!v) return null;
  const s = v.trim();
  if (!s || s === "--" || s.toUpperCase() === "N/D") return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "02/10/2030" -> "2030-10-02" ; qualquer outra coisa -> null */
export function paraISO(v) {
  const m = (v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "2026-09-04" -> "040926" (o nome do arquivo e DDMMAA) */
export function nomeArquivo(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y.slice(2)}`;
}

/**
 * Converte o texto do arquivo nas linhas de invest.precos_debentures.
 * O cabecalho e localizado pelo conteudo, nao pela posicao, para nao quebrar se a ANBIMA
 * mudar o preambulo.
 */
export function parse(txt, dataRef) {
  const linhas = txt.split("\n").map((l) => l.replace(/\r$/, ""));

  let inicio = linhas.findIndex((l) => l.startsWith("Código@Nome@"));
  if (inicio < 0) inicio = linhas.findIndex((l) => l.split("@").length >= 15) - 1;

  const out = [];
  for (const l of linhas.slice(inicio + 1)) {
    const p = l.split("@");
    if (p.length < 15 || !p[0].trim()) continue;

    out.push({
      codigo: p[0].trim(),
      data: dataRef,
      nome: p[1].trim() || null,
      vencimento: paraISO(p[2]),
      indexador: p[3].trim() || null,
      taxa_compra: num(p[4]),
      taxa_venda: num(p[5]),
      taxa_indicativa: num(p[6]),
      desvio_padrao: num(p[7]),
      pu: num(p[10]),
      percent_pu_par: num(p[11]),
      duration: num(p[12]),
      percent_reune: num(p[13]),
      referencia_ntnb: paraISO(p[14]),
      provisorio: false,
    });
  }
  return out;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uma tentativa. Devolve as linhas, ou null se o servidor respondeu 404. */
async function tentar(iso) {
  const resp = await fetch(`${BASE_ANBIMA}/db${nomeArquivo(iso)}.txt`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`ANBIMA respondeu ${resp.status}`);

  const txt = new TextDecoder("windows-1252").decode(await resp.arrayBuffer());
  // Um 200 devolvendo pagina de erro nao pode virar dado.
  if (!txt.startsWith("ANBIMA")) return null;

  const linhas = parse(txt, iso);
  return linhas.length ? linhas : null;
}

/**
 * Baixa e converte um dia, com retentativas.
 *
 * O 404 desta fonte NAO significa "nao existe". Medido em 06/09/2026: o arquivo de 04/09
 * respondeu 200 de forma consistente, depois 404 em 24 tentativas seguidas ao longo de cinco
 * minutos, e voltou a 200 em seguida - da mesma maquina e tambem de um IP de datacenter, ao
 * mesmo tempo. A fonte oscila para todo mundo, e nao e bloqueio de origem.
 *
 * Sem retentativa, a coleta grava buracos silenciosos, e o dia perdido nao volta depois que a
 * janela de ~6 meses passa.
 *
 * Devolve null so depois de esgotar as tentativas: ai sim e feriado, dia ainda nao publicado,
 * ou data fora da janela.
 */
export async function buscarDia(iso, { tentativas = 3, esperaMs = 15000 } = {}) {
  let ultimoErro = null;
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await espera(esperaMs * i); // 15s, 30s
    try {
      const linhas = await tentar(iso);
      if (linhas) return linhas;
    } catch (e) {
      ultimoErro = e;
    }
  }
  if (ultimoErro) throw ultimoErro;
  return null;
}
