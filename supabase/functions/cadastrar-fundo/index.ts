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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESES = 12; // meses de informe processados por chamada
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const competencia = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

function campo(linha: string, n: number): string {
  let ini = 0;
  for (let k = 0; k < n; k++) { const p = linha.indexOf(";", ini); if (p < 0) return ""; ini = p + 1; }
  const fim = linha.indexOf(";", ini);
  return fim < 0 ? linha.slice(ini) : linha.slice(ini, fim);
}

/**
 * Abre um membro de um zip REMOTO sem baixar o arquivo inteiro.
 *
 * O cadastro da CVM tem 6,7 MB comprimidos e 44 MB de csv; materializar isso
 * estoura a memoria da edge function (foi o que aconteceu na primeira versao).
 * Aqui lemos o rodape (diretorio central) por Range, achamos o offset do membro
 * e pedimos so a faixa de bytes dele, jogando direto no DecompressionStream.
 */
async function faixa(url: string, range: string): Promise<Response> {
  const r = await fetch(url, { headers: { Range: range } });
  if (r.status !== 206 && r.status !== 200) throw new Error(`Range ${range} HTTP ${r.status}`);
  return r;
}

async function membroRemoto(url: string, escolher: (nome: string) => boolean): Promise<ReadableStream<string>> {
  const rodape = new Uint8Array(await (await faixa(url, "bytes=-4096")).arrayBuffer());
  const dvR = new DataView(rodape.buffer, rodape.byteOffset, rodape.byteLength);
  let e = rodape.length - 22;
  while (e >= 0 && dvR.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip sem diretorio central");
  const cdTam = dvR.getUint32(e + 12, true);
  const cdIni = dvR.getUint32(e + 16, true);

  const cd = new Uint8Array(await (await faixa(url, `bytes=${cdIni}-${cdIni + cdTam - 1}`)).arrayBuffer());
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  let p = 0;
  while (p < cd.length && dv.getUint32(p, true) === 0x02014b50) {
    const nomeLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const comLen = dv.getUint16(p + 32, true);
    const metodo = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nomeLen));
    if (escolher(nome)) {
      if (metodo !== 8) throw new Error(`${nome}: membro nao esta em deflate`);
      const cab = new Uint8Array(await (await faixa(url, `bytes=${offsetLocal}-${offsetLocal + 29}`)).arrayBuffer());
      const dvC = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
      const inicio = offsetLocal + 30 + dvC.getUint16(26, true) + dvC.getUint16(28, true);
      const corpo = await faixa(url, `bytes=${inicio}-${inicio + csize - 1}`);
      return corpo.body!
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .pipeThrough(new TextDecoderStream("iso-8859-1")) as ReadableStream<string>;
    }
    p += 46 + nomeLen + extraLen + comLen;
  }
  throw new Error("membro nao encontrado no zip");
}

/** Percorre um csv da CVM linha a linha, sem materializar o arquivo inteiro. */
async function percorrerCsv(
  stream: ReadableStream<string>,
  aoLer: (linha: string, idx: Map<string, number>) => void,
) {
  let resto = "";
  let idx: Map<string, number> | null = null;
  for await (const pedaco of stream as unknown as AsyncIterable<string>) {
    const partes = (resto + pedaco).split("\n");
    resto = partes.pop() ?? "";
    for (const linha of partes) {
      if (!idx) {
        idx = new Map(linha.replace(/\r$/, "").split(";").map((c, i) => [c.trim().toUpperCase(), i] as const));
        continue;
      }
      aoLer(linha.replace(/\r$/, ""), idx);
    }
  }
  if (resto && idx) aoLer(resto.replace(/\r$/, ""), idx);
}

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

type CotaMes = { subclasse: string; data: string; cota: number };

async function cotasDoMes(mes: string, cnpj: string): Promise<CotaMes[]> {
  const url = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${mes}.zip`;
  // 404 = mes ainda nao publicado (normal nos primeiros dias); nao e erro.
  const cabeca = await fetch(url, { method: "HEAD" });
  if (cabeca.status === 404) return [];
  const stream = await membroRemoto(url, (n) => n.toLowerCase().endsWith(".csv"));

  const achados: CotaMes[] = [];
  await percorrerCsv(stream, (linha, idx) => {
    const iCnpj = idx.get("CNPJ_FUNDO_CLASSE") ?? idx.get("CNPJ_FUNDO") ?? -1;
    const iData = idx.get("DT_COMPTC") ?? -1;
    const iCota = idx.get("VL_QUOTA") ?? -1;
    const iSub = idx.get("ID_SUBCLASSE") ?? -1;
    if (iCnpj < 0 || iData < 0 || iCota < 0) return;
    if (soDigitos(campo(linha, iCnpj)) !== cnpj) return;
    const cota = parseFloat(campo(linha, iCota));
    if (!Number.isFinite(cota) || cota <= 0) return;
    achados.push({
      subclasse: iSub >= 0 ? campo(linha, iSub).trim() : "",
      data: campo(linha, iData).trim(),
      cota,
    });
  });
  return achados;
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
    } else if (subclasseEscolhida && !existente?.cvm_id_subclasse) {
      await sb.from("cadastro_de_fundos").update({ cvm_id_subclasse: subclasseEscolhida }).eq("id", fundoId);
    }

    if (body.apenasCadastro) return json({ fundoId, nomeCurto, cotasInseridas: 0, proximoMes: null });

    // 2. Backfill das cotas, mes a mes
    const { data: ultima } = await sb
      .from("cotas_fundos").select("data").eq("fundo_id", fundoId)
      .order("data", { ascending: false }).limit(1).maybeSingle();

    const inicioISO = ultima?.data ?? desde ?? dataInicioFundo ?? "2024-01-01";
    const cursor = new Date(inicioISO + "T00:00:00");
    const hoje = new Date();
    const meses: string[] = [];
    while (cursor <= hoje && meses.length < MAX_MESES) {
      meses.push(competencia(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }

    const { data: cfg } = await sb
      .from("cadastro_de_fundos").select("cvm_id_subclasse").eq("id", fundoId).single();

    let inseridas = 0;
    const subclassesVistas = new Set<string>();

    for (const mes of meses) {
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

    const proximo = cursor <= hoje ? competencia(cursor) : null;
    return json({ fundoId, nomeCurto, cotasInseridas: inseridas, proximoMes: proximo });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
