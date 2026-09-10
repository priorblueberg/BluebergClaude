/**
 * Grava a mudanca detectada e avisa quem tem posicao no fundo.
 *
 * O detector (`mudancaDeFundo.ts`) so diz que a serie mudou. Aqui essa conclusao vira dado:
 * uma linha em `mudancas_de_fundo` e um alerta no Sininho para cada cliente que tinha cotas do
 * fundo no dia da ultima cota. Quem ja respondeu (lancou a "Mudança de Fundo") ou zerou a
 * posicao tem o alerta resolvido sozinho.
 *
 * Idempotente: roda a cada passada da rotina diaria. Um cliente que cadastra hoje uma posicao
 * num fundo que ja parou recebe o alerta na passada seguinte.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dataDeReferencia, detectarMudanca, type Mudanca, type MovimentoDeFundo, posicaoNaData,
} from "./mudancaDeFundo.ts";

export interface FundoAcompanhado {
  id: string;
  nome_curto: string | null;
  cnpj_classe: string;
  cvm_id_subclasse: string | null;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);

/** Dias uteis de `desdeISO` ate hoje, paginado (o PostgREST corta em 1000 linhas). */
export async function diasUteisDesde(sb: SupabaseClient, desdeISO: string): Promise<string[]> {
  const out: string[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("calendario_dias_uteis").select("data")
      .eq("dia_util", true).gte("data", desdeISO).lte("data", hojeISO())
      .order("data").range(de, de + 999);
    if (error) throw error;
    out.push(...((data ?? []) as { data: string }[]).map((r) => r.data));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Roda o detector num fundo a partir do que ja esta no banco e, havendo mudanca, registra.
 *
 * `extras` traz o que so a leitura do informe enxerga (linhas com cota zero, subclasses novas).
 * Sem ele o detector ainda pega a serie parada, que e o sinal que sempre aparece.
 */
export async function verificarMudanca(
  sb: SupabaseClient,
  fundo: FundoAcompanhado,
  extras: { datasComCotaZero?: string[]; subclassesNovas?: string[] } = {},
  diasUteis?: string[],
): Promise<Mudanca | null> {
  const { data: ultima, error } = await sb.from("cotas_fundos").select("data, valor_cota")
    .eq("fundo_id", fundo.id).order("data", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!ultima) return null;

  // Pelo menos 30 dias para tras: a data de referencia precisa de dias uteis antes de hoje mesmo
  // quando a ultima cota e de ontem.
  const piso = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const desde = (ultima.data as string) < piso ? (ultima.data as string) : piso;
  const uteis = diasUteis && diasUteis.length && diasUteis[0] <= desde
    ? diasUteis
    : await diasUteisDesde(sb, desde);

  const mudanca = detectarMudanca({
    ultimaCotaEm: ultima.data as string,
    referencia: dataDeReferencia(uteis, hojeISO()),
    diasUteis: uteis,
    ...extras,
  });
  if (!mudanca) return null;
  await registrarMudanca(sb, fundo, mudanca, Number(ultima.valor_cota));
  return mudanca;
}

export async function registrarMudanca(
  sb: SupabaseClient,
  fundo: FundoAcompanhado,
  mudanca: Mudanca,
  ultimaCota: number | null,
): Promise<{ mudancaId: string; alertados: number; resolvidos: number }> {
  const { error: eGrava } = await sb.from("mudancas_de_fundo").upsert({
    fundo_id: fundo.id,
    ultima_cota_em: mudanca.ultimaCotaEm,
    sinal: mudanca.sinal,
    evidencias: mudanca.evidencias,
  }, { onConflict: "fundo_id,ultima_cota_em", ignoreDuplicates: true });
  if (eGrava) throw eGrava;
  const { data: linha, error: eLe } = await sb.from("mudancas_de_fundo").select("id")
    .eq("fundo_id", fundo.id).eq("ultima_cota_em", mudanca.ultimaCotaEm).single();
  if (eLe) throw eLe;
  const mudancaId = linha.id as string;

  // Toda posicao que em algum momento teve este fundo. O saldo e calculado posicao a posicao
  // porque uma "Mudança de Fundo" antiga pode ter levado a posicao para outro fundo.
  const { data: tocadas, error: eTocadas } = await sb.from("movimentacoes")
    .select("user_id, codigo_custodia").eq("fundo_id", fundo.id).not("codigo_custodia", "is", null);
  if (eTocadas) throw eTocadas;
  const posicoes = new Map<string, { userId: string; codigo: string }>();
  for (const t of (tocadas ?? []) as { user_id: string; codigo_custodia: string }[]) {
    posicoes.set(`${t.user_id}|${t.codigo_custodia}`, { userId: t.user_id, codigo: String(t.codigo_custodia) });
  }

  const porUsuario = new Map<string, { codigos: string[]; saldo: number }>();
  for (const { userId, codigo } of posicoes.values()) {
    const { data: movs, error } = await sb.from("movimentacoes")
      .select("fundo_id, data, data_cotizacao, tipo_movimentacao, quantidade, valor, preco_unitario, created_at")
      .eq("user_id", userId).eq("codigo_custodia", codigo);
    if (error) throw error;
    const lista = (movs ?? []) as MovimentoDeFundo[];
    const naUltimaCota = posicaoNaData(lista, mudanca.ultimaCotaEm);
    const agora = posicaoNaData(lista, "9999-12-31");
    // Tinha cotas deste fundo no ultimo dia de cota, e continua com elas: ninguem informou nada.
    if (naUltimaCota.fundoId !== fundo.id || naUltimaCota.saldo <= 1e-8) continue;
    if (agora.fundoId !== fundo.id || agora.saldo <= 1e-8) continue;
    const u = porUsuario.get(userId) ?? { codigos: [], saldo: 0 };
    u.codigos.push(codigo);
    u.saldo += naUltimaCota.saldo;
    porUsuario.set(userId, u);
  }

  const nome = fundo.nome_curto ?? fundo.cnpj_classe;
  if (porUsuario.size) {
    const { error } = await sb.from("alertas").upsert(
      [...porUsuario].map(([userId, u]) => ({
        user_id: userId,
        tipo: "mudanca_de_fundo",
        referencia_id: mudancaId,
        titulo: "Possível alteração na composição do fundo",
        detalhe: {
          fundo_id: fundo.id,
          fundo_nome: nome,
          cnpj: fundo.cnpj_classe,
          subclasse: fundo.cvm_id_subclasse,
          ultima_cota_em: mudanca.ultimaCotaEm,
          ultima_cota: ultimaCota,
          sinal: mudanca.sinal,
          evidencias: mudanca.evidencias,
          codigos_custodia: u.codigos,
          saldo_cotas: u.saldo,
        },
      })),
      { onConflict: "user_id,tipo,referencia_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const { data: abertos, error: eAbertos } = await sb.from("alertas").select("id, user_id")
    .eq("tipo", "mudanca_de_fundo").eq("referencia_id", mudancaId).eq("status", "aberto");
  if (eAbertos) throw eAbertos;
  const resolver = ((abertos ?? []) as { id: string; user_id: string }[])
    .filter((a) => !porUsuario.has(a.user_id)).map((a) => a.id);
  if (resolver.length) {
    const { error } = await sb.from("alertas")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() }).in("id", resolver);
    if (error) throw error;
  }
  return { mudancaId, alertados: porUsuario.size, resolvidos: resolver.length };
}
