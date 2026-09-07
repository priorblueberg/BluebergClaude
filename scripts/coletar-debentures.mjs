#!/usr/bin/env node
/**
 * Coleta os precos indicativos de debentures do mercado secundario (ANBIMA) e grava em
 * invest.precos_debentures.
 *
 * Este script e a via manual: mesma coleta que a edge function daily-debentures-sync faz
 * sozinha, aqui sob controle, util para backfill e para depurar.
 *
 * A FONTE OSCILA, E O 404 NAO SIGNIFICA "NAO EXISTE"
 * --------------------------------------------------
 * Medido em 06/09/2026: o arquivo de 04/09 respondeu 200 de forma consistente, depois 404 em
 * 24 tentativas seguidas ao longo de cinco minutos, e voltou a 200 em seguida. O mesmo estado
 * e visto da maquina local e do IP da edge function ao mesmo tempo, entao nao e bloqueio de
 * origem nem de datacenter: a fonte oscila para todo mundo, e o padrao acompanha a intensidade
 * das requisicoes - rajada leva a bloqueio, pausa libera.
 *
 * Por isso a coleta e deliberadamente LENTA, com retentativa espacada. Ir rapido nao coleta
 * mais, coleta menos.
 *
 * A JANELA DA FONTE E CURTA
 * -------------------------
 * A ANBIMA guarda cerca de 6 meses de arquivos. O que nao for coletado dentro da janela se
 * perde. Por isso gravamos o arquivo INTEIRO, todos os ~1.290 papeis, e nao so os que estao em
 * custodia: um papel cadastrado no mes que vem vai precisar do preco de hoje, e hoje nao volta.
 *
 * USO
 * ---
 *   node scripts/coletar-debentures.mjs                 # pega os dias que faltam
 *   node scripts/coletar-debentures.mjs --desde 2026-03-02
 *   node scripts/coletar-debentures.mjs --recarregar    # regrava dias que ja existem
 *
 * Precisa de SUPABASE_SERVICE_ROLE_KEY no ambiente ou no .env (que ja esta no .gitignore).
 * A chave nunca e impressa.
 */

import { createClient } from "@supabase/supabase-js";
import { buscarDia } from "./lib/anbima-debentures.mjs";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONCORRENCIA = 4;
// A ANBIMA guarda cerca de 6 meses; varremos um pouco mais para nao raspar a borda.
const JANELA_DIAS = 200;

// ── configuracao ─────────────────────────────────────────────────────

function carregarEnv() {
  const env = { ...process.env };
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = join(RAIZ, arquivo);
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf8").split("\n")) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, "");
      if (!env[m[1]]) env[m[1]] = valor;
    }
  }
  return env;
}

const env = carregarEnv();
const URL_SUPABASE = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const CHAVE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_SUPABASE || !CHAVE) {
  console.error(
    "Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.\n" +
      "A service role key esta em Supabase > Project Settings > API Keys.\n" +
      "Coloque no .env (que ja esta no .gitignore) como SUPABASE_SERVICE_ROLE_KEY=...",
  );
  process.exit(1);
}

const supabase = createClient(URL_SUPABASE, CHAVE, {
  db: { schema: "invest" },
  auth: { persistSession: false },
});

// ── execucao ─────────────────────────────────────────────────────────

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? (process.argv[i + 1] ?? true) : null;
}

function somarDias(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const recarregar = Boolean(argumento("recarregar"));
  const hoje = new Date().toISOString().slice(0, 10);

  // Sempre varremos a janela inteira, e nao a partir do ultimo dia gravado.
  //
  // A fonte oscila: um dia pode responder 404 agora e 200 daqui a pouco. Se partissemos de
  // max(data)+1, um dia que falhasse ficaria para tras assim que o dia seguinte gravasse - e
  // como a ANBIMA so guarda ~6 meses, esse buraco viraria permanente. Varrer a janela custa
  // uma consulta e conserta buracos sozinha na proxima execucao.
  const desdeArg = argumento("desde");
  const desde =
    typeof desdeArg === "string" ? desdeArg : somarDias(hoje, -JANELA_DIAS);

  if (desde > hoje) {
    console.log("Ja esta em dia.");
    return;
  }

  // A ANBIMA so publica em dia util; o calendario do banco evita 404 a toa.
  const { data: cal, error: errCal } = await supabase
    .from("calendario_dias_uteis")
    .select("data")
    .gte("data", desde)
    .lte("data", hoje)
    .eq("dia_util", true)
    .order("data", { ascending: true });
  if (errCal) throw new Error(`calendario: ${errCal.message}`);

  let dias = (cal ?? []).map((c) => c.data);
  if (!dias.length) {
    for (let d = desde; d <= hoje; d = somarDias(d, 1)) {
      const dow = new Date(d + "T12:00:00").getDay();
      if (dow >= 1 && dow <= 5) dias.push(d);
    }
  }

  if (!recarregar && dias.length) {
    // Paginado: o PostgREST corta em 1000 linhas sem avisar.
    const ja = new Set();
    for (let de = 0; ; de += 1000) {
      const { data: p } = await supabase
        .from("precos_debentures")
        .select("data")
        .gte("data", dias[0])
        .lte("data", dias[dias.length - 1])
        .range(de, de + 999);
      if (!p?.length) break;
      p.forEach((r) => ja.add(r.data));
      if (p.length < 1000) break;
    }
    dias = dias.filter((d) => !ja.has(d));
  }

  if (!dias.length) {
    console.log("Nenhum dia novo para coletar.");
    return;
  }

  console.log(`${dias.length} dia(s) a coletar: ${dias[0]} ate ${dias[dias.length - 1]}`);

  let comDado = 0;
  let semArquivo = 0;
  let gravadas = 0;
  const falhas = [];

  for (let i = 0; i < dias.length; i += CONCORRENCIA) {
    const lote = dias.slice(i, i + CONCORRENCIA);
    const res = await Promise.all(
      lote.map(async (d) => {
        try {
          return { dia: d, linhas: await buscarDia(d) };
        } catch (e) {
          return { dia: d, erro: e.message };
        }
      }),
    );

    for (const r of res) {
      if (r.erro) {
        falhas.push(`${r.dia}: ${r.erro}`);
        continue;
      }
      if (!r.linhas) {
        semArquivo++;
        continue;
      }

      for (let j = 0; j < r.linhas.length; j += 500) {
        const { error } = await supabase
          .from("precos_debentures")
          .upsert(r.linhas.slice(j, j + 500), { onConflict: "codigo,data" });
        if (error) throw new Error(`gravacao ${r.dia}: ${error.message}`);
      }
      comDado++;
      gravadas += r.linhas.length;
      console.log(`  ${r.dia}: ${r.linhas.length} papeis`);
    }
  }

  console.log(
    `\n${comDado} dia(s) gravado(s), ${gravadas} linha(s). ` +
      `${semArquivo} dia(s) sem arquivo na fonte.`,
  );
  if (falhas.length) {
    console.log("Falhas:");
    falhas.forEach((f) => console.log("  " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
