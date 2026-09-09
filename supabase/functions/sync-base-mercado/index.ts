// Catalogo de papeis da B3 para `cadastro_de_acoes`, a partir do /quote/list da BRAPI.
//
//   POST { }            atualiza o catalogo inteiro
//   POST { seco: true }  so relata o que faria, sem gravar
//
// ── O que esta funcao NAO faz ────────────────────────────────────────────────────────────────
//
// Ela NAO traz serie de preco. Traz so a identidade do papel: ticker, nome e classificacao.
//
// A separacao e uma decisao de custo, tomada em 08/09/2026 com o numero na mao. Pre-carregar a
// serie diaria dos ~2.332 papeis desde 02/01/2023 daria 2,15 milhoes de linhas e 385 MB - num
// banco Supabase Free cujo teto e 500 MB, e que ja usa 50 MB. Ele estouraria em poucos meses,
// e travar por espaco e o tipo de falha que aparece no pior momento.
//
// A serie continua vindo SOB DEMANDA, no primeiro uso do papel: o `AcaoSelect` chama o
// `sync-acoes` com o ticker e a carga inteira sai em uma chamada. O catalogo existe para que o
// usuario ENCONTRE o papel - por nome, sem decorar o ticker - nao para adiantar o preco dele.
//
// Por isso todo papel entra com `sincronizar_cotacoes = false`. Quem liga essa chave e o
// `sync-acoes` ao carregar o papel de verdade. Se o catalogo entrasse com ela ligada, o laco
// diario passaria a tentar 2.332 papeis por rodada.
//
// ── Por que o /quote/list ────────────────────────────────────────────────────────────────────
//
// E o unico endpoint da BRAPI que responde SEM token, e ja devolve a classificacao (`type` e
// `subType`) que separa acao de BDR, FII, ETF e unit. Derivar isso do sufixo do ticker seria
// heuristica furada: 34 e BDR, mas 11 pode ser unit, ETF ou FII.
//
// Ele pagina em 2.000 por vez e informa `hasNextPage` - com 2.332 papeis hoje, sao 2 paginas.
// A paginacao e seguida ate o fim de proposito: fixar "2 paginas" quebraria em silencio no dia
// em que a B3 passar de 4.000 papeis, e o sintoma seria um papel que nao aparece na busca.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const URL_LISTA = "https://brapi.dev/api/quote/list";
const POR_PAGINA = 2000;
/** Trava de sanidade: o catalogo da B3 nao tem centenas de milhares de papeis. */
const MAX_PAGINAS = 20;

type ItemLista = {
  stock?: string;
  name?: string;
  type?: string | null;
  subType?: string | null;
};

type Linha = {
  ticker: string;
  nome: string;
  tipo: string | null;
  subtipo: string | null;
  bolsa: string;
  ativo: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const seco = body?.seco === true;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } },
    );

    // ── 1. varre o catalogo, pagina a pagina ──
    const porTicker = new Map<string, Linha>();
    let pagina = 1;
    let totalInformado: number | null = null;

    for (; pagina <= MAX_PAGINAS; pagina++) {
      const r = await fetch(`${URL_LISTA}?limit=${POR_PAGINA}&page=${pagina}`);
      if (!r.ok) throw new Error(`BRAPI /quote/list HTTP ${r.status} na pagina ${pagina}`);
      const j = await r.json() as {
        stocks?: ItemLista[];
        totalCount?: number;
        hasNextPage?: boolean;
      };

      const itens = j.stocks ?? [];
      if (totalInformado === null && typeof j.totalCount === "number") totalInformado = j.totalCount;

      for (const it of itens) {
        const ticker = (it.stock ?? "").toUpperCase().trim();
        if (!ticker) continue;
        // `nome` e NOT NULL na tabela. A BRAPI as vezes devolve o proprio ticker como nome
        // (fundos pequenos); melhor gravar isso do que descartar o papel do catalogo.
        porTicker.set(ticker, {
          ticker,
          nome: (it.name ?? "").trim() || ticker,
          tipo: it.type ?? null,
          subtipo: it.subType ?? null,
          bolsa: "B3",
          ativo: true,
        });
      }

      if (!j.hasNextPage || itens.length === 0) break;
    }

    const linhas = [...porTicker.values()];
    if (!linhas.length) throw new Error("catalogo veio vazio - nao vou apagar nada por causa disso");

    const porTipo: Record<string, number> = {};
    for (const l of linhas) {
      const k = `${l.tipo ?? "?"}/${l.subtipo ?? "-"}`;
      porTipo[k] = (porTipo[k] ?? 0) + 1;
    }

    if (seco) {
      return json({ ok: true, seco: true, paginas: pagina, total_lido: linhas.length, total_informado: totalInformado, por_tipo: porTipo });
    }

    // ── 2. grava ──
    // `onConflict: ticker` insere quem falta e atualiza a classificacao de quem ja existe.
    //
    // Tres colunas ficam FORA do payload de proposito - `sincronizar_cotacoes`, `isin` e, para
    // quem ja foi carregado, `nome`. Todas sao do `sync-acoes`, que sabe coisas que o catalogo
    // nao sabe. Sobrescrever `sincronizar_cotacoes` desligaria a sincronizacao dos papeis em
    // uso a cada rodada semanal, e o sintoma seria a serie de preco parando de atualizar sem
    // ninguem mexer em nada.
    //
    // O NOME de quem ja foi carregado nao pode ser sobrescrito. O /quote/list traz o nome
    // curto - as vezes so o proprio ticker - enquanto o `sync-acoes` traz o nome completo da
    // fonte detalhada. Sobrescrever destroi informacao: no BDR, a RAZAO DE CONVERSAO vive
    // dentro do nome ("... Repr 0.00833 Sh"), e o catalogo trocaria isso por "MELI34".
    //
    // Aconteceu de verdade na primeira carga, em 08/09/2026, e so apareceu porque fui conferir
    // linha a linha depois de gravar.
    // A preservacao e feita REESCREVENDO o nome atual, nao omitindo a coluna. Omitir nao
    // funciona: o upsert do PostgREST monta um INSERT antes do ON CONFLICT, entao `nome`
    // ausente viola o NOT NULL mesmo quando a linha ja existe. Tentei, e o erro foi esse.
    //
    // De quebra, o payload fica com as chaves uniformes - o que o upsert exige de qualquer
    // jeito - e continua sendo uma unica chamada por lote.
    const { data: jaCarregados, error: eSync } = await db.from("cadastro_de_acoes")
      .select("ticker, nome").eq("sincronizar_cotacoes", true);
    if (eSync) throw new Error(`leitura dos sincronizados: ${eSync.message}`);
    const nomeAtual = new Map(
      (jaCarregados ?? []).map((a: { ticker: string; nome: string }) => [a.ticker, a.nome]),
    );

    const payload = linhas.map((l) =>
      nomeAtual.has(l.ticker) ? { ...l, nome: nomeAtual.get(l.ticker)! } : l
    );

    let gravadas = 0;
    for (let i = 0; i < payload.length; i += 500) {
      const lote = payload.slice(i, i + 500);
      const { error } = await db.from("cadastro_de_acoes")
        .upsert(lote, { onConflict: "ticker", ignoreDuplicates: false });
      if (error) throw new Error(`upsert (lote ${i / 500 + 1}): ${error.message}`);
      gravadas += lote.length;
    }

    // ── 3. deslistagem ──
    // Papel que saiu da lista da B3 deixa de ser negociavel. Sem esta etapa ele ficaria
    // `ativo = true` para sempre e continuaria aparecendo na busca.
    //
    // A trava importa mais que a etapa: so mexo se a leitura veio COMPLETA (todas as paginas,
    // e a contagem batendo com a que a propria BRAPI informou). Uma pagina que falhou no meio
    // faria esta etapa desativar milhares de papeis validos de uma vez - e o `hasNextPage`
    // sozinho nao protege disso, porque uma resposta truncada tambem diz que acabou.
    //
    // `ativo = false` NAO interrompe a sincronizacao de quem tem posicao: quem manda nisso e
    // `sincronizar_cotacoes`. Um papel deslistado que alguem carrega continua atualizando ate
    // a fonte parar de responder.
    // A diferenca sai em memoria, e nao num `not.in` com 2.332 tickers: o PostgREST manda
    // filtro na query string, e essa lista daria uma URL de ~16 KB - que o servidor recusa.
    let desativadas: string[] | null = null;
    const leituraCompleta = totalInformado !== null && linhas.length >= totalInformado;
    if (leituraCompleta) {
      const { data: atuais, error: eLer } = await db.from("cadastro_de_acoes")
        .select("ticker").eq("ativo", true);
      if (eLer) throw new Error(`deslistagem (leitura): ${eLer.message}`);

      const noArquivo = new Set(porTicker.keys());
      const sumiram = (atuais ?? [])
        .map((a: { ticker: string }) => a.ticker)
        .filter((t) => !noArquivo.has(t));

      if (sumiram.length) {
        const { error } = await db.from("cadastro_de_acoes")
          .update({ ativo: false }).in("ticker", sumiram);
        if (error) throw new Error(`deslistagem (gravacao): ${error.message}`);
      }
      desativadas = sumiram;
    }

    const { count: noCatalogo } = await db.from("cadastro_de_acoes")
      .select("*", { count: "exact", head: true });
    const { count: sincronizando } = await db.from("cadastro_de_acoes")
      .select("*", { count: "exact", head: true }).eq("sincronizar_cotacoes", true);

    return json({
      ok: true,
      paginas: pagina,
      total_lido: linhas.length,
      total_informado: totalInformado,
      gravadas,
      por_tipo: porTipo,
      // null = leitura incompleta, a etapa de deslistagem foi pulada de proposito.
      deslistadas: desativadas,
      no_catalogo: noCatalogo,
      sincronizando_cotacoes: sincronizando,
    });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
