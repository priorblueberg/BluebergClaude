// Carga da serie de cotas de UM fundo do catalogo, em segundo plano.
//
//   POST { fundoId }                          primeira etapa, disparada pela boleta
//   POST { fundoId, desde, liberar? }         etapas seguintes, disparadas por esta propria funcao
//   POST { fundoId, costura: "verificar" }    legado: so conclui a carga (a costura saiu em 12/09/2026)
//   POST { cnpj }                             legado: so para CNPJ sem subclasse
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
// JWT da `cadastrar-fundo` exporia o modo catalogo, que regrava milhares de linhas. Esta aqui so
// carrega cota publica da CVM, com upsert idempotente, de fundo que ja esta no catalogo.
//
// ── O lease ─────────────────────────────────────────────────────────────────────────────────
//
// `carga_cotas_ate` e um prazo, nao uma marca. Cada etapa empurra ele 3 minutos para frente; a
// ultima o limpa e grava `carga_cotas_concluida_em`. Se a cadeia morrer no meio - worker caido,
// pg_net perdido - ninguem precisa limpar nada: o prazo vence sozinho.
//
// ── Sem costura ─────────────────────────────────────────────────────────────────────────────
//
// Desde 12/09/2026 (decisao do Daniel) cada fundo fica so com a propria serie: nada e copiado de um
// fundo para outro. Quando a CVM para de publicar a cota, a tela avisa ao lado do nome e o cliente
// encerra ou migra a posicao (`src/lib/alertaDeFundo.ts`).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cotasDoMes, fimDaSerie, MAX_MESES, mesesAPartirDe, ORCAMENTO_MS, PISO_SERIE, soDigitos,
} from "../_shared/informeCvm.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Folga de cada etapa. Uma etapa leva segundos; 3 minutos cobre fila do pg_net e partida fria. */
const LEASE_MS = 3 * 60 * 1000;

const COLUNAS = "id, cnpj_classe, nome_curto, data_inicio, cvm_id_subclasse, carga_cotas_ate, "
  + "situacao, data_inicio_situacao, classificacao, come_cotas";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );
  const disparar = async (corpo: Record<string, unknown>) => {
    const { error } = await sb.rpc("disparar_funcao", { nome: "carga-cotas-fundo", corpo });
    if (error) throw error;
  };
  let fundoId: string | null = null;
  let liberar: string[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    liberar = Array.isArray(body.liberar) ? body.liberar.filter((x: unknown) => typeof x === "string") : [];

    const base = sb.from("cadastro_de_fundos").select(COLUNAS);
    let resposta;
    if (typeof body.fundoId === "string") {
      resposta = await base.eq("id", body.fundoId).maybeSingle();
    } else {
      const cnpjPedido = soDigitos(body.cnpj);
      if (cnpjPedido.length !== 14) return json({ error: "Informe o fundo." }, 400);
      resposta = await base.eq("cnpj_classe", cnpjPedido).is("cvm_id_subclasse", null).maybeSingle();
    }
    if (resposta.error) throw resposta.error;
    const fundo = resposta.data;
    // Nao cria fundo do catalogo. Quem cria e o catalogo ou o cadastro por CNPJ.
    if (!fundo) return json({ error: "Fundo fora do catálogo." }, 404);
    fundoId = fundo.id as string;
    const cnpj = soDigitos(fundo.cnpj_classe as string);
    const prazo = () => new Date(Date.now() + LEASE_MS).toISOString();
    const renovar = () => sb.from("cadastro_de_fundos").update({ carga_cotas_ate: prazo() }).in("id", [fundoId!, ...liberar]);
    const concluir = () => sb.from("cadastro_de_fundos")
      .update({ carga_cotas_ate: null, carga_cotas_concluida_em: new Date().toISOString(), carga_cotas_erro: null })
      .in("id", [fundoId!, ...liberar]);

    // Etapa final agendada antes de 12/09/2026, quando havia costura: so conclui a carga.
    if (body.costura === "verificar" || body.costura === "avancar") {
      if (body.costura === "verificar") await concluir();
      return json({ ok: true, etapa: "concluida" });
    }

    // ── Carga da serie ─────────────────────────────────────────────────────────────────────
    const continuacao = typeof body.desde === "string";
    // Um segundo clique em "Adicionar" enquanto a carga anda nao abre uma segunda cadeia.
    if (!continuacao && fundo.carga_cotas_ate && new Date(fundo.carga_cotas_ate as string) > new Date()) {
      return json({ ok: true, jaEmAndamento: true });
    }

    // `sincronizar_cotas` liga ja na primeira etapa: o fundo passou a ser usado, e a rotina diaria
    // e quem mantem a serie em dia depois que esta carga terminar.
    const { error: eLease } = await sb.from("cadastro_de_fundos")
      .update({ carga_cotas_ate: prazo(), carga_cotas_erro: null, sincronizar_cotas: true })
      .eq("id", fundoId);
    if (eLease) throw eLease;
    if (liberar.length) await renovar();

    // Primeira etapa: desde o piso, ou desde o inicio do fundo se ele comecou depois. Varrer 2023
    // num fundo de 2025 seria vasculhar meses vazios.
    const inicio = continuacao
      ? String(body.desde)
      : [PISO_SERIE, (fundo.data_inicio as string | null) ?? PISO_SERIE].sort().at(-1)!;
    // Fundo cancelado ou sucedido: o informe segue com cota zero por semanas e depois some.
    const fim = fimDaSerie(fundo.situacao as string | null, fundo.data_inicio_situacao as string | null);
    const { meses, depoisDaLista } = mesesAPartirDe(inicio, fim);

    let inseridas = 0;
    let interrompido: string | null = null;
    const comecou = Date.now();
    const alvo = (fundo.cvm_id_subclasse as string | null) ?? "";

    for (const [i, mes] of meses.entries()) {
      if (i > 0 && Date.now() - comecou > ORCAMENTO_MS) { interrompido = mes; break; }
      const linhas = await cotasDoMes(mes, cnpj);
      // So a serie DESTE fundo: a subclasse escolhida, ou as linhas sem subclasse. Antes a linha
      // sem subclasse aceitava a de qualquer subclasse do CNPJ, e a classe que criou subclasses
      // (cenario B3) teria a serie antiga misturada com a nova.
      const doFundo = linhas.filter((l) => l.subclasse === alvo);

      // CNPJ que so publica por subclasse, fundo sem subclasse escolhida e nenhuma cota gravada:
      // nao ha serie a carregar sem escolher a subclasse.
      if (!alvo && !doFundo.length && linhas.length && inseridas === 0) {
        const { count } = await sb.from("cotas_fundos").select("fundo_id", { count: "exact", head: true })
          .eq("fundo_id", fundoId);
        if (!count) {
          const opcoes = [...new Set(linhas.map((l) => l.subclasse))].filter(Boolean);
          await sb.from("cadastro_de_fundos").update({
            carga_cotas_ate: null,
            carga_cotas_erro: `Este CNPJ publica por subclasse (${opcoes.join(", ")}). Escolha a subclasse na busca.`,
          }).eq("id", fundoId);
          return json({ ok: false, precisaSubclasse: opcoes });
        }
      }

      if (!doFundo.length) continue;
      const { error } = await sb.from("cotas_fundos").upsert(
        doFundo.map((l) => ({ fundo_id: fundoId, data: l.data, valor_cota: l.cota })),
        { onConflict: "fundo_id,data" },
      );
      if (error) throw error;
      inseridas += doFundo.length;
    }

    const proximo = interrompido ?? depoisDaLista;
    await renovar();
    if (proximo) {
      const desde = `${proximo.slice(0, 4)}-${proximo.slice(4, 6)}-01`;
      await disparar({ fundoId, desde, liberar });
      return json({ ok: true, cotasInseridas: inseridas, proximoMes: proximo, maxMeses: MAX_MESES });
    }

    // Serie completa.
    await concluir();
    return json({ ok: true, cotasInseridas: inseridas, proximoMes: null });
  } catch (e) {
    // Solta o lease e registra: sem isto, uma etapa que falha deixaria o fundo "em carga" ate o
    // prazo vencer, e o cliente nao saberia por que o fundo nao ficou disponivel.
    if (fundoId) {
      await sb.from("cadastro_de_fundos")
        .update({ carga_cotas_ate: null, carga_cotas_erro: String((e as Error).message ?? e) })
        .in("id", [fundoId, ...liberar])
        .then(() => undefined, () => undefined);
    }
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
