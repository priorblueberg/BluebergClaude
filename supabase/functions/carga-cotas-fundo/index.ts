// Carga da serie de cotas de UM fundo do catalogo, em segundo plano.
//
//   POST { cnpj }                primeira etapa, disparada pela boleta
//   POST { cnpj, desde }         etapas seguintes, disparadas por esta propria funcao
//
// ── Por que existe, separada de `cadastrar-fundo` ────────────────────────────────────────────
//
// A boleta pediu um fluxo em que o cliente escolhe um fundo sem cotas, clica em "Adicionar", a
// boleta FECHA e a carga continua. Um laco no navegador morre junto com o componente - e com a
// aba, se ela fechar. Entao a carga tem que andar sozinha no servidor, e o estado "em carga" tem
// que morar no banco, onde a boleta reaberta (talvez depois de recarregar a pagina) consegue ver.
//
// Cada etapa processa o que cabe no orcamento de CPU e agenda a seguinte pelo `pg_net`, via
// `invest.disparar_funcao`. O pg_net e assincrono de verdade: esta chamada termina na hora, e a
// proxima nasce num worker novo com orcamento cheio. Encadear por `fetch` aninharia as esperas.
//
// Ela e separada de `cadastrar-fundo` por seguranca, nao por gosto. O `disparar_funcao` chama sem
// cabecalho de autorizacao, entao a funcao encadeada precisa aceitar chamada sem JWT. Desligar o
// JWT da `cadastrar-fundo` exporia o modo catalogo, que regrava 8.571 linhas. Esta aqui faz uma
// coisa so, e so para fundo que JA existe no catalogo: nao cria linha, e a cota que ela grava e
// dado publico da CVM, com upsert idempotente.
//
// ── O lease ─────────────────────────────────────────────────────────────────────────────────
//
// `carga_cotas_ate` e um prazo, nao uma marca. Cada etapa empurra ele 3 minutos para frente; a
// ultima o limpa e grava `carga_cotas_concluida_em`. Se a cadeia morrer no meio - worker caido,
// pg_net perdido - ninguem precisa limpar nada: o prazo vence sozinho, o fundo volta a aparecer
// como "sem cotas", e o cliente pode adicionar de novo. Uma marca booleana ficaria presa em
// "em carga" para sempre.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cotasDoMes, MAX_MESES, mesesAPartirDe, ORCAMENTO_MS, PISO_SERIE, soDigitos,
} from "../_shared/informeCvm.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Folga de cada etapa. Uma etapa leva segundos; 3 minutos cobre fila do pg_net e partida fria. */
const LEASE_MS = 3 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );
  let fundoId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const cnpj = soDigitos(body.cnpj);
    if (cnpj.length !== 14) return json({ error: "Informe um CNPJ com 14 dígitos." }, 400);

    const { data: fundo, error: eFundo } = await sb.from("cadastro_de_fundos")
      .select("id, data_inicio, cvm_id_subclasse, carga_cotas_ate")
      .eq("cnpj_classe", cnpj)
      .maybeSingle();
    if (eFundo) throw eFundo;
    // Nao cria fundo. Quem cria e o catalogo ou o cadastro por CNPJ, ambos com JWT.
    if (!fundo) return json({ error: "Fundo fora do catálogo." }, 404);
    fundoId = fundo.id as string;

    const continuacao = typeof body.desde === "string";
    // Um segundo clique em "Adicionar" enquanto a carga anda nao abre uma segunda cadeia.
    if (!continuacao && fundo.carga_cotas_ate && new Date(fundo.carga_cotas_ate) > new Date()) {
      return json({ ok: true, jaEmAndamento: true });
    }

    const prazo = () => new Date(Date.now() + LEASE_MS).toISOString();
    // `sincronizar_cotas` liga ja na primeira etapa: o fundo passou a ser usado, e a rotina diaria
    // e quem mantem a serie em dia depois que esta carga terminar.
    const { error: eLease } = await sb.from("cadastro_de_fundos")
      .update({ carga_cotas_ate: prazo(), carga_cotas_erro: null, sincronizar_cotas: true })
      .eq("id", fundoId);
    if (eLease) throw eLease;

    // Primeira etapa: desde o piso, ou desde o inicio do fundo se ele comecou depois. Varrer 2023
    // num fundo de 2025 seria vasculhar meses vazios.
    const inicio = continuacao
      ? String(body.desde)
      : [PISO_SERIE, (fundo.data_inicio as string | null) ?? PISO_SERIE].sort().at(-1)!;
    const { meses, depoisDaLista } = mesesAPartirDe(inicio);

    let inseridas = 0;
    let interrompido: string | null = null;
    const comecou = Date.now();
    const subclasses = new Set<string>();

    for (const [i, mes] of meses.entries()) {
      if (i > 0 && Date.now() - comecou > ORCAMENTO_MS) { interrompido = mes; break; }
      const linhas = await cotasDoMes(mes, cnpj);
      for (const l of linhas) subclasses.add(l.subclasse);

      // Mais de uma subclasse publicando e nenhuma escolhida: gravar seria chutar qual cota e a
      // do cliente, e o erro nao apareceria como erro. A carga para, solta o lease e diz por que.
      if (subclasses.size > 1 && !fundo.cvm_id_subclasse) {
        const opcoes = [...subclasses].filter(Boolean);
        await sb.from("cadastro_de_fundos").update({
          carga_cotas_ate: null,
          carga_cotas_erro: `Este CNPJ publica mais de uma subclasse (${opcoes.join(", ")}). `
            + "Cadastre o fundo pelo botão de cadastrar fundo, escolhendo a subclasse.",
        }).eq("id", fundoId);
        return json({ ok: false, precisaSubclasse: opcoes });
      }

      const alvo = (fundo.cvm_id_subclasse as string | null) ?? null;
      const doFundo = alvo ? linhas.filter((l) => l.subclasse === alvo) : linhas;
      if (!doFundo.length) continue;
      const { error } = await sb.from("cotas_fundos").upsert(
        doFundo.map((l) => ({ fundo_id: fundoId, data: l.data, valor_cota: l.cota })),
        { onConflict: "fundo_id,data" },
      );
      if (error) throw error;
      inseridas += doFundo.length;
    }

    const proximo = interrompido ?? depoisDaLista;
    if (proximo) {
      await sb.from("cadastro_de_fundos").update({ carga_cotas_ate: prazo() }).eq("id", fundoId);
      const desde = `${proximo.slice(0, 4)}-${proximo.slice(4, 6)}-01`;
      const { error: eDisparo } = await sb.rpc("disparar_funcao", {
        nome: "carga-cotas-fundo",
        corpo: { cnpj, desde },
      });
      if (eDisparo) throw eDisparo;
    } else {
      await sb.from("cadastro_de_fundos").update({
        carga_cotas_ate: null,
        carga_cotas_concluida_em: new Date().toISOString(),
      }).eq("id", fundoId);
    }

    return json({ ok: true, cotasInseridas: inseridas, proximoMes: proximo, maxMeses: MAX_MESES });
  } catch (e) {
    // Solta o lease e registra: sem isto, uma etapa que falha deixaria o fundo "em carga" ate o
    // prazo vencer, e o cliente nao saberia por que o fundo nao ficou disponivel.
    if (fundoId) {
      await sb.from("cadastro_de_fundos")
        .update({ carga_cotas_ate: null, carga_cotas_erro: String((e as Error).message ?? e) })
        .eq("id", fundoId)
        .then(() => undefined, () => undefined);
    }
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
