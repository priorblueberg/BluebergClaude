/**
 * Costura automatica da serie de cotas quando a sucessao entre fundos e inequivoca.
 *
 * O criterio mora em `sucessaoDeFundo.ts`. Aqui ficam a leitura do informe diario em volta da data
 * da troca e o registro no banco:
 *
 *   - uma linha em `sucessoes_de_fundo`, com as evidencias;
 *   - `invest.aplicar_sucessao`, que copia as cotas de um fundo para o outro (a do antecessor ate
 *     a ultima dele vai para o sucessor; a do sucessor a partir da primeira vai para o antecessor),
 *     marcando a origem em `cotas_fundos.fonte_fundo_id`. Um gatilho mantem a copia em dia quando
 *     chegam cotas novas de qualquer um dos dois.
 *
 * Com isso tudo que le `cotas_fundos` - boleta, motor, carteira - ve uma serie so, sem saber que
 * ela foi costurada. Quem escolhe hoje a subclasse nova e lanca uma aplicacao de 2023 recebe a
 * cota do fundo antigo daquela data; quem ja tinha posicao no fundo antigo continua recebendo cota.
 *
 * Quando a serie antiga nao esta no catalogo (a classe que criou subclasses, cenario B3: a linha
 * sem subclasse fica fora da busca, porque a CVM deixa condominio e publico em branco), ela e
 * criada OCULTA (`ativo = false`): existe para guardar a serie, nao aparece para o cliente.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { campo, ficaComNova, membroRemoto, percorrerCsv, soDigitos } from "./informeCvm.ts";
import {
  chaveDaSerie, CRITERIO_DE_SUCESSAO, type LinhaDoInforme, pontasDaJanela, type Sucessao, sucessoesInequivocas,
} from "./sucessaoDeFundo.ts";

export interface FundoDoCatalogo {
  id: string;
  cnpj_classe: string;
  cvm_id_subclasse: string | null;
  nome_curto: string | null;
  classificacao?: string | null;
  come_cotas?: boolean | null;
}

/** Dias uteis em volta de uma data: `folga` antes e depois, com a propria data. */
async function diasEmVolta(sb: SupabaseClient, dataISO: string, folga: number): Promise<string[]> {
  const [{ data: antes, error: e1 }, { data: depois, error: e2 }] = await Promise.all([
    sb.from("calendario_dias_uteis").select("data").eq("dia_util", true).lte("data", dataISO)
      .order("data", { ascending: false }).limit(folga + 1),
    sb.from("calendario_dias_uteis").select("data").eq("dia_util", true).gt("data", dataISO)
      .order("data").limit(folga),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return [
    ...((antes ?? []) as { data: string }[]).map((r) => r.data).reverse(),
    ...((depois ?? []) as { data: string }[]).map((r) => r.data),
  ];
}

/** Todas as linhas do informe diario nos dias pedidos, de todos os fundos. */
async function linhasDosDias(dias: string[]): Promise<LinhaDoInforme[]> {
  const pedidos = new Set(dias);
  const meses = [...new Set(dias.map((d) => d.slice(0, 7).replace("-", "")))].sort();
  const porChaveDia = new Map<string, LinhaDoInforme & { tipo: string }>();
  for (const mes of meses) {
    const url = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${mes}.zip`;
    if ((await fetch(url, { method: "HEAD" })).status === 404) continue;
    await percorrerCsv(await membroRemoto(url, (n) => n.toLowerCase().endsWith(".csv")), (linha, idx) => {
      const iD = idx.get("DT_COMPTC") ?? -1;
      if (iD < 0) return;
      // O filtro barato primeiro: so os dias da janela pagam o parse do resto da linha.
      const data = campo(linha, iD).trim();
      if (!pedidos.has(data)) return;
      const iC = idx.get("CNPJ_FUNDO_CLASSE") ?? idx.get("CNPJ_FUNDO") ?? -1;
      const iQ = idx.get("VL_QUOTA") ?? -1;
      const iP = idx.get("VL_PATRIM_LIQ") ?? -1;
      const iN = idx.get("NR_COTST") ?? -1;
      if (iC < 0 || iQ < 0 || iP < 0 || iN < 0) return;
      const cota = parseFloat(campo(linha, iQ));
      const pl = parseFloat(campo(linha, iP));
      if (!(cota > 0) || !(pl > 0)) return;
      const iS = idx.get("ID_SUBCLASSE") ?? -1;
      const iT = idx.get("TP_FUNDO_CLASSE") ?? idx.get("TP_FUNDO") ?? -1;
      const l = {
        cnpj: soDigitos(campo(linha, iC)),
        subclasse: iS >= 0 ? campo(linha, iS).trim() : "",
        data,
        cota,
        pl,
        cotistas: parseInt(campo(linha, iN), 10) || 0,
        tipo: iT >= 0 ? campo(linha, iT) : "",
      };
      const chave = `${l.cnpj}|${l.subclasse}|${data}`;
      const atual = porChaveDia.get(chave);
      if (atual && !ficaComNova(atual.tipo, l.tipo)) return;
      porChaveDia.set(chave, l);
    });
  }
  return [...porChaveDia.values()];
}

/**
 * A sucessao inequivoca que envolve este fundo em volta de `dataISO`, se houver.
 *
 * `lado = "antecessor"`: o fundo NASCEU em `dataISO` e procuramos de quem ele e continuacao.
 * `lado = "sucessor"`: o fundo PAROU em `dataISO` e procuramos quem continua a serie dele.
 */
export async function buscarSucessaoInequivoca(
  sb: SupabaseClient,
  fundo: FundoDoCatalogo,
  lado: "antecessor" | "sucessor",
  dataISO: string,
): Promise<Sucessao | null> {
  const dias = await diasEmVolta(sb, dataISO, CRITERIO_DE_SUCESSAO.maxDiasUteis + 1);
  if (dias.length < 3) return null;
  const { paradas, nascidas } = pontasDaJanela(await linhasDosDias(dias), dias);
  const chave = chaveDaSerie(soDigitos(fundo.cnpj_classe), fundo.cvm_id_subclasse);
  return sucessoesInequivocas(paradas, nascidas, dias)
    .find((s) => (lado === "antecessor" ? s.sucessor.chave : s.antecessor.chave) === chave) ?? null;
}

async function linhaDoCatalogo(sb: SupabaseClient, cnpj: string, subclasse: string) {
  const base = sb.from("cadastro_de_fundos").select("id, cnpj_classe, cvm_id_subclasse, nome_curto").eq("cnpj_classe", cnpj);
  const { data, error } = subclasse
    ? await base.eq("cvm_id_subclasse", subclasse).maybeSingle()
    : await base.is("cvm_id_subclasse", null).maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

/**
 * Grava a sucessao e costura as series. Devolve `null` quando nao da para gravar (o fundo ja tem
 * outra sucessao ativa do mesmo lado) - nesse caso quem chamou segue para o alerta.
 */
export async function aplicarSucessaoInequivoca(
  sb: SupabaseClient,
  sucessao: Sucessao,
  referencia: FundoDoCatalogo,
): Promise<{ sucessaoId: string; antecessorId: string; sucessorId: string; criouOculto: boolean } | null> {
  let criouOculto = false;
  const garantir = async (p: typeof sucessao.antecessor, lado: "antecessor" | "sucessor") => {
    const existente = await linhaDoCatalogo(sb, p.cnpj, p.subclasse);
    if (existente) return existente.id;
    // Fora do catalogo: cria oculta, so para guardar a serie. O nome e unico no cadastro, entao a
    // linha oculta leva o sufixo da troca em vez de repetir o nome do fundo de referencia.
    const dataBR = p.data.split("-").reverse().join("/");
    const sufixo = lado === "antecessor" ? ` (série até ${dataBR})` : ` (série desde ${dataBR})`;
    const base = (referencia.nome_curto ?? p.cnpj).slice(0, 120 - sufixo.length);
    const { data, error } = await sb.from("cadastro_de_fundos").insert({
      cnpj_classe: p.cnpj,
      cvm_id_subclasse: p.subclasse || null,
      nome_curto: base + sufixo,
      denominacao_social: referencia.nome_curto,
      classificacao: referencia.classificacao ?? null,
      come_cotas: referencia.come_cotas ?? null,
      situacao: lado === "antecessor" ? "Sucedido" : null,
      data_inicio_situacao: lado === "antecessor" ? p.data : null,
      engine: "FUNDO",
      ativo: false,
      sincronizar_cotas: lado === "sucessor",
    }).select("id").single();
    if (error) throw error;
    criouOculto = true;
    return (data as { id: string }).id;
  };

  const antecessorId = await garantir(sucessao.antecessor, "antecessor");
  const sucessorId = await garantir(sucessao.sucessor, "sucessor");

  const { data: gravada, error } = await sb.from("sucessoes_de_fundo").insert({
    antecessor_id: antecessorId,
    sucessor_id: sucessorId,
    ultima_cota_antecessor: sucessao.antecessor.data,
    primeira_cota_sucessor: sucessao.sucessor.data,
    origem: "automatica",
    evidencias: {
      ...sucessao.evidencias,
      antecessor: sucessao.antecessor,
      sucessor: sucessao.sucessor,
    },
  }).select("id").single();
  if (error) {
    // Ja existe sucessao ativa para um dos dois (indice unico parcial): nao sobrescreve.
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
  const sucessaoId = (gravada as { id: string }).id;
  const { error: eAplica } = await sb.rpc("aplicar_sucessao", { p_id: sucessaoId });
  if (eAplica) throw eAplica;
  return { sucessaoId, antecessorId, sucessorId, criouOculto };
}
