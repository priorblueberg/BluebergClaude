// Cadastro de fundo novo a partir do CNPJ, com backfill das cotas.
//
// Duas fontes da CVM:
//   1. registro_fundo_classe.zip (cadastro): quem e o fundo - denominacao, datas,
//      classificacao, administrador, gestor, custodiante.
//   2. inf_diario_fi_AAAAMM.zip (informe diario): a serie de cotas.
//
// A funcao e idempotente: chamar de novo em um fundo ja cadastrado so completa
// as cotas que faltam. O backfill e paginado por mes (MAX_MESES por chamada)
// para caber no tempo da edge function; a resposta diz o proximo mes pendente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  campo, competencia, cotasDoMes, MAX_MESES, membroRemoto, ORCAMENTO_MS, percorrerCsv, soDigitos,
} from "../_shared/informeCvm.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LinhaCvm = Record<string, string>;

const URL_CADASTRO = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip";

async function buscarCadastro(cnpj: string): Promise<{ classe: LinhaCvm; fundo: LinhaCvm | null }> {
  let classe: LinhaCvm | null = null;
  await percorrerCsv(await membroRemoto(URL_CADASTRO, (n) => n === "registro_classe.csv"), (linha, idx) => {
    const iCnpj = idx.get("CNPJ_CLASSE") ?? -1;
    if (iCnpj < 0) return;
    if (soDigitos(campo(linha, iCnpj)) !== cnpj) return;
    const cols = linha.split(";");
    const row: LinhaCvm = {};
    for (const [nome, i] of idx) row[nome] = (cols[i] ?? "").trim();
    // O CNPJ pode aparecer em mais de um registro; fica o mais recente.
    if (!classe || (row["DATA_REGISTRO"] ?? "") >= (classe["DATA_REGISTRO"] ?? "")) classe = row;
  });
  if (!classe) throw new Error("CNPJ nao encontrado no cadastro de classes da CVM");

  const idFundo = (classe as LinhaCvm)["ID_REGISTRO_FUNDO"];
  let fundo: LinhaCvm | null = null;
  await percorrerCsv(await membroRemoto(URL_CADASTRO, (n) => n === "registro_fundo.csv"), (linha, idx) => {
    const i = idx.get("ID_REGISTRO_FUNDO") ?? -1;
    if (i < 0 || campo(linha, i).trim() !== idFundo) return;
    const cols = linha.split(";");
    const row: LinhaCvm = {};
    for (const [nome, k] of idx) row[nome] = (cols[k] ?? "").trim();
    fundo = row;
  });

  return { classe: classe as LinhaCvm, fundo };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } },
    );

    const body = await req.json().catch(() => ({}));

    // ── Carga do CATALOGO ────────────────────────────────────────────────────────────────────
    //
    //   POST { catalogo: true }        grava
    //   POST { catalogo: true, seco: true }  so conta, sem gravar
    //
    // Mesma logica das acoes: o catalogo serve para ENCONTRAR o fundo pelo nome, e a serie de
    // cotas so nasce quando alguem usa o ativo. Por isso as linhas entram magras - identidade e
    // classificacao - e com `sincronizar_cotas = false`. Quem preenche a ficha inteira e liga a
    // sincronizacao e o cadastro por CNPJ, mais abaixo nesta mesma funcao.
    //
    // Nao ha rotina periodica, e e deliberado: o catalogo de acoes deixou de ter uma em
    // 10/09/2026 pelos mesmos motivos. Esta carga e manual, e roda quando alguem quiser.
    if (body.catalogo === true) {
      // `ignoreDuplicates` e o que protege os fundos JA carregados. Sem ele, a carga passaria
      // por cima da ficha completa deles e desligaria a sincronizacao das cotas - a serie
      // pararia de atualizar sem ninguem mexer em nada.
      const linhas: Record<string, unknown>[] = [];
      let lidas = 0;
      const fora: Record<string, number> = {};
      const descarta = (motivo: string) => { fora[motivo] = (fora[motivo] ?? 0) + 1; };

      await percorrerCsv(
        await membroRemoto(URL_CADASTRO, (n) => n === "registro_classe.csv"),
        (linha, idx) => {
          lidas++;
          const c = (nome: string) => campo(linha, idx.get(nome) ?? -1).trim();
          const tipo = c("TIPO_CLASSE").replace("Classes de Cotas de Fundos ", "");
          const cnpjClasse = soDigitos(c("CNPJ_CLASSE"));
          const publico = c("PUBLICO_ALVO");
          const classificacao = c("CLASSIFICACAO");
          const anbima = c("CLASSIFICACAO_ANBIMA");

          if (cnpjClasse.length !== 14) return descarta("cnpj invalido");
          if (c("SITUACAO") !== "Em Funcionamento Normal") return descarta("nao esta em funcionamento");
          // Condominio fechado nao aceita aplicacao nova, e exclusivo pertence a um cotista so.
          if (c("FORMA_CONDOMINIO") !== "Aberto") return descarta("condominio fechado");
          if (c("EXCLUSIVO") === "S") return descarta("exclusivo");
          // FII, FIAGRO e FIIM sao negociados em bolsa e ja vivem no catalogo de acoes. Deixa-los
          // entrar aqui criaria o mesmo ativo duas vezes, com ticker de um lado e CNPJ do outro.
          if (tipo === "FII" || tipo === "FIAGRO" || tipo === "FIIM") return descarta("negociado em bolsa");
          if (publico !== "Público Geral" && publico !== "Qualificado") return descarta("publico restrito");

          const denominacao = c("DENOMINACAO_SOCIAL");
          if (!denominacao) return descarta("sem denominacao");

          linhas.push({
            cnpj_classe: cnpjClasse,
            nome_curto: denominacao.slice(0, 120),
            denominacao_social: denominacao,
            tipo_classe: c("TIPO_CLASSE") || null,
            classificacao: classificacao || null,
            classificacao_anbima: anbima || null,
            situacao: c("SITUACAO") || null,
            publico_alvo: publico || null,
            forma_condominio: c("FORMA_CONDOMINIO") || null,
            exclusivo: c("EXCLUSIVO") || null,
            data_inicio: c("DATA_INICIO") || null,
            tributacao_longo_prazo: c("TRIBUTACAO_LONGO_PRAZO") || null,
            entidade_investimento: c("ENTIDADE_INVESTIMENTO") || null,
            // A regra do come-cotas por EXCLUSAO, como manda a IN RFB 1585/2015 art. 2o, e nao
            // por "nao contem acoes". Previdencia tem regime proprio (art. 44) e a CVM so a
            // revela na classificacao ANBIMA - no campo dela um PGBL de renda fixa aparece
            // como "Renda Fixa" e passaria batido.
            come_cotas: tipo === "FIF"
              && !/^previd/i.test(anbima)
              && (classificacao === "Renda Fixa" || classificacao === "Multimercado" || classificacao === "Cambial"),
            engine: "FUNDO",
            ativo: true,
            sincronizar_cotas: false,
          });
        },
      );

      if (body.seco === true) {
        return json({ ok: true, seco: true, lidas, no_recorte: linhas.length, descartadas: fora });
      }
      if (!linhas.length) throw new Error("catalogo veio vazio - nao vou gravar nada");

      let gravadas = 0;
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await sb.from("cadastro_de_fundos")
          .upsert(linhas.slice(i, i + 500), { onConflict: "cnpj_classe", ignoreDuplicates: true });
        if (error) throw new Error(`upsert (lote ${i / 500 + 1}): ${error.message}`);
        gravadas += Math.min(500, linhas.length - i);
      }
      const { count: total } = await sb.from("cadastro_de_fundos")
        .select("*", { count: "exact", head: true });
      const { count: sincronizando } = await sb.from("cadastro_de_fundos")
        .select("*", { count: "exact", head: true }).eq("sincronizar_cotas", true);
      return json({ ok: true, lidas, no_recorte: linhas.length, enviadas: gravadas,
                    no_catalogo: total, sincronizando_cotas: sincronizando, descartadas: fora });
    }

    const cnpj = soDigitos(body.cnpj);
    if (cnpj.length !== 14) return json({ error: "Informe um CNPJ com 14 dígitos." }, 400);

    const desde: string | null = body.desde ?? null;              // AAAA-MM-DD
    const subclasseEscolhida: string | null = body.subclasse ?? null;

    // 1. Cadastro (idempotente)
    const { data: existente } = await sb
      .from("cadastro_de_fundos")
      .select("id, nome_curto, cvm_id_subclasse, data_inicio")
      .eq("cnpj_classe", cnpj)
      .maybeSingle();

    let fundoId = existente?.id ?? null;
    let nomeCurto = existente?.nome_curto ?? null;
    let dataInicioFundo = existente?.data_inicio ?? null;

    if (!fundoId) {
      const { classe, fundo } = await buscarCadastro(cnpj);
      const classificacao = classe["CLASSIFICACAO"] ?? "";
      const nova = {
        cnpj_classe: cnpj,
        id_registro_fundo: Number(classe["ID_REGISTRO_FUNDO"]) || null,
        id_registro_classe: Number(classe["ID_REGISTRO_CLASSE"]) || null,
        codigo_cvm: classe["CODIGO_CVM"] || null,
        data_registro: classe["DATA_REGISTRO"] || null,
        data_constituicao: classe["DATA_CONSTITUICAO"] || null,
        data_inicio: classe["DATA_INICIO"] || null,
        tipo_classe: classe["TIPO_CLASSE"] || null,
        denominacao_social: classe["DENOMINACAO_SOCIAL"] || null,
        situacao: classe["SITUACAO"] || null,
        data_inicio_situacao: classe["DATA_INICIO_SITUACAO"] || null,
        classificacao: classificacao || null,
        indicador_desempenho: classe["INDICADOR_DESEMPENHO"] || null,
        classe_cotas: classe["CLASSE_COTAS"] || null,
        classificacao_anbima: classe["CLASSIFICACAO_ANBIMA"] || null,
        tributacao_longo_prazo: classe["TRIBUTACAO_LONGO_PRAZO"] || null,
        entidade_investimento: classe["ENTIDADE_INVESTIMENTO"] || null,
        permitido_aplicacao_exterior_100: classe["PERMITIDO_APLICACAO_CEMPORCENTO_EXTERIOR"] || null,
        classe_esg: classe["CLASSE_ESG"] || null,
        forma_condominio: classe["FORMA_CONDOMINIO"] || null,
        exclusivo: classe["EXCLUSIVO"] || null,
        publico_alvo: classe["PUBLICO_ALVO"] || null,
        cnpj_auditor: classe["CNPJ_AUDITOR"] || null,
        auditor: classe["AUDITOR"] || null,
        cnpj_custodiante: classe["CNPJ_CUSTODIANTE"] || null,
        custodiante: classe["CUSTODIANTE"] || null,
        cnpj_controlador: classe["CNPJ_CONTROLADOR"] || null,
        controlador: classe["CONTROLADOR"] || null,
        cnpj_fundo: fundo?.["CNPJ_FUNDO"] || null,
        tipo_fundo: fundo?.["TIPO_FUNDO"] || null,
        cnpj_administrador: fundo?.["CNPJ_ADMINISTRADOR"] || null,
        administrador: fundo?.["ADMINISTRADOR"] || null,
        cpf_cnpj_gestor: fundo?.["CPF_CNPJ_GESTOR"] || null,
        gestor: fundo?.["GESTOR"] || null,
        nome_curto: (body.nomeCurto || classe["DENOMINACAO_SOCIAL"] || "").slice(0, 120) || null,
        benchmark: classe["INDICADOR_DESEMPENHO"] || null,
        // Fundo de acoes nao tem come-cotas; renda fixa e multimercado tem.
        come_cotas: !/a[cç][õo]es/i.test(classificacao),
        dias_cotizacao_aplicacao: 0,
        dias_cotizacao_resgate: 0,
        dias_liquidacao_resgate: 0,
        engine: "FUNDO",
        ativo: true,
        sincronizar_cotas: true,
        cvm_id_subclasse: subclasseEscolhida,
      };
      const { data: inserido, error } = await sb
        .from("cadastro_de_fundos").insert(nova).select("id, nome_curto, data_inicio").single();
      if (error) throw error;
      fundoId = inserido.id;
      nomeCurto = inserido.nome_curto;
      dataInicioFundo = inserido.data_inicio;
    } else {
      // A linha ja existia. Antes do catalogo isso significava "fundo ja em uso"; desde
      // 10/09/2026 significa, quase sempre, "fundo que estava so no catalogo" - e o catalogo
      // entra com `sincronizar_cotas = false` para a rotina diaria nao tentar 8.571 fundos.
      //
      // Sem ligar a marca aqui, o fundo recem-carregado ficaria de fora da atualizacao diaria e
      // a serie dele congelaria no dia do cadastro. E, do lado da tela, ele nem apareceria na
      // lista de carregados. O sintoma seria "cadastrei e sumiu".
      const remendo: Record<string, unknown> = { sincronizar_cotas: true };
      if (subclasseEscolhida && !existente?.cvm_id_subclasse) {
        remendo.cvm_id_subclasse = subclasseEscolhida;
      }
      await sb.from("cadastro_de_fundos").update(remendo).eq("id", fundoId);
    }

    if (body.apenasCadastro) return json({ fundoId, nomeCurto, cotasInseridas: 0, proximoMes: null });

    // 2. Backfill das cotas, mes a mes
    const { data: ultima } = await sb
      .from("cotas_fundos").select("data").eq("fundo_id", fundoId)
      .order("data", { ascending: false }).limit(1).maybeSingle();

    // O comeco do backfill, com PISO.
    //
    // Antes era `desde ?? data_inicio do fundo ?? "2024-01-01"`, e um fundo de 2015 fazia a
    // rotina varrer dez anos de informe diario para jogar tudo fora - nada antes de 02/01/2023
    // entra em calculo nenhum, que e a data inicial da ferramenta. Com o teto de MAX_MESES por
    // chamada, isso custava varias voltas antes de chegar no periodo util.
    //
    // O maior entre os tres, entao, e nunca antes do piso: se o fundo comecou DEPOIS de
    // 02/01/2023, comecar no piso so varreria meses vazios ate a data de inicio dele.
    const PISO_SERIE = "2023-01-02";
    const comecoUtil = [desde ?? PISO_SERIE, dataInicioFundo ?? PISO_SERIE, PISO_SERIE]
      .sort()
      .at(-1)!;

    // `desde` MANDA quando vem, mesmo que o fundo ja tenha cota.
    //
    // Antes era `ultima?.data ?? comecoUtil`, e isso tornava impossivel carregar uma serie para
    // TRAS: bastava existir uma cota qualquer para o pedido comecar do fim dela. Um fundo com
    // cota so de setembro/2026 ficava preso ali, e o botao "carregar desde 02/01/2023" da boleta
    // nao faria nada - o pior tipo de botao.
    //
    // Sem `desde`, retoma de onde parou. E como o cliente devolve `proximoMes` como `desde` na
    // volta seguinte, o laco anda mes a mes a partir do ponto pedido em vez de saltar para o
    // maior dia ja gravado. O upsert torna a repeticao inofensiva.
    const inicioISO = desde ? comecoUtil : (ultima?.data ?? comecoUtil);
    const cursor = new Date(inicioISO + "T00:00:00");
    const hoje = new Date();
    const meses: string[] = [];
    while (cursor <= hoje && meses.length < MAX_MESES) {
      meses.push(competencia(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }
    // O que sobrou depois do ultimo mes da lista, se o orcamento nao interromper antes.
    const depoisDaLista = cursor <= hoje ? competencia(cursor) : null;

    const { data: cfg } = await sb
      .from("cadastro_de_fundos").select("cvm_id_subclasse").eq("id", fundoId).single();

    let inseridas = 0;
    let interrompido: string | null = null;
    const comecou = Date.now();
    const subclassesVistas = new Set<string>();

    for (const [i, mes] of meses.entries()) {
      // O corte vem ANTES de processar, e nao depois: parar no meio de um mes deixaria a serie
      // pela metade sem ninguem saber onde.
      if (i > 0 && Date.now() - comecou > ORCAMENTO_MS) { interrompido = mes; break; }
      const linhas = await cotasDoMes(mes, cnpj);
      for (const l of linhas) subclassesVistas.add(l.subclasse);

      // Mais de uma subclasse publicando cota: sem escolher, gravaria a cota errada
      // em silencio. Devolve as opcoes para o usuario decidir.
      if (subclassesVistas.size > 1 && !cfg?.cvm_id_subclasse) {
        return json({
          fundoId, nomeCurto, cotasInseridas: inseridas, proximoMes: mes,
          precisaSubclasse: Array.from(subclassesVistas).filter(Boolean),
        });
      }

      const alvo = cfg?.cvm_id_subclasse ?? null;
      const doFundo = alvo ? linhas.filter((l) => l.subclasse === alvo) : linhas;
      if (doFundo.length === 0) continue;

      const { error } = await sb.from("cotas_fundos").upsert(
        doFundo.map((l) => ({ fundo_id: fundoId, data: l.data, valor_cota: l.cota })),
        { onConflict: "fundo_id,data" },
      );
      if (error) throw error;
      inseridas += doFundo.length;
    }

    const proximoMes = interrompido ?? depoisDaLista;
    // Carga completa: grava a conclusao. A boleta decide "sem cotas" por esta coluna, entao um
    // fundo carregado pelo modal sem ela voltaria a pedir carga toda vez que fosse escolhido.
    if (!proximoMes) {
      await sb.from("cadastro_de_fundos")
        .update({ carga_cotas_concluida_em: new Date().toISOString(), carga_cotas_erro: null })
        .eq("id", fundoId);
    }
    return json({ fundoId, nomeCurto, cotasInseridas: inseridas, proximoMes });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
