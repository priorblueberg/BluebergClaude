/**
 * Exclusao de migracao de fundo (decisao do Daniel, 12/09/2026).
 *
 * A migracao sao duas movimentacoes ligadas por `transferencia_id`: a saida na posicao antiga e a entrada na
 * do fundo novo. Elas nao se editam pela boleta e saem sempre juntas - excluir so uma deixaria a posicao
 * antiga fechada sem destino, ou cotas no fundo novo sem origem.
 */
import { supabase } from "@/integrations/supabase/client";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
import { saidaSemSaldoNaPosicaoDeFundo } from "@/lib/validacaoBoleta";
import { TIPO_MIGRACAO_ENTRADA, TIPOS_DE_MIGRACAO } from "@/lib/posicaoDeFundo";

export const ehMigracao = (tipo?: string | null) => !!tipo && TIPOS_DE_MIGRACAO.includes(tipo);

/** Mensagem para quem tenta editar uma das pontas. */
export const MSG_MIGRACAO_NAO_EDITA = "Migração não se edita: exclua e migre a posição de novo.";

type Ponta = { id: string; codigo_custodia: string | null; tipo_movimentacao: string; categoria_id: string };

async function refazer(pontas: Ponta[], userId: string, dataReferencia: string) {
  const vistos = new Set<string>();
  for (const p of pontas) {
    if (!p.codigo_custodia || vistos.has(p.codigo_custodia)) continue;
    vistos.add(p.codigo_custodia);
    await fullSyncAfterDelete(p.codigo_custodia, String(p.categoria_id), userId, dataReferencia);
  }
}

/**
 * Exclui as duas pontas da migracao de `movimentacaoId`. Devolve a mensagem para o cliente quando nao da
 * para excluir (a entrada ja sustenta um resgate posterior no fundo novo), ou null.
 */
export async function excluirMigracao(userId: string, movimentacaoId: string, dataReferencia: string): Promise<string | null> {
  const { data: mov } = await supabase.from("movimentacoes").select("transferencia_id").eq("id", movimentacaoId).maybeSingle();
  if (!mov?.transferencia_id) return "Esta migração não tem a outra ponta registrada.";

  const { data: par } = await supabase.from("movimentacoes")
    .select("id, codigo_custodia, tipo_movimentacao, categoria_id")
    .eq("user_id", userId).eq("transferencia_id", mov.transferencia_id);
  const pontas = (par || []) as Ponta[];

  const entrada = pontas.find((p) => p.tipo_movimentacao === TIPO_MIGRACAO_ENTRADA);
  if (entrada?.codigo_custodia) {
    const semSaldo = await saidaSemSaldoNaPosicaoDeFundo(userId, entrada.codigo_custodia, (ms) => ms.filter((m) => m.id !== entrada.id));
    if (semSaldo) return semSaldo;
  }

  const { error } = await supabase.from("movimentacoes").delete().eq("user_id", userId).eq("transferencia_id", mov.transferencia_id);
  if (error) return "Erro ao excluir a migração.";
  await refazer(pontas, userId, dataReferencia);
  return null;
}

/**
 * Antes de excluir uma posicao inteira: tira a outra ponta das migracoes dela, nas outras posicoes, e as
 * refaz. Devolve mensagem quando a outra ponta nao pode sair (sustenta um resgate posterior), ou null.
 */
export async function excluirContrapartesDeMigracao(userId: string, codigoCustodia: string, dataReferencia: string): Promise<string | null> {
  const { data: daPosicao } = await supabase.from("movimentacoes")
    .select("transferencia_id")
    .eq("user_id", userId).eq("codigo_custodia", codigoCustodia).not("transferencia_id", "is", null);
  const ids = [...new Set(((daPosicao || []) as { transferencia_id: string | null }[]).map((m) => m.transferencia_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return null;

  const { data: outras } = await supabase.from("movimentacoes")
    .select("id, codigo_custodia, tipo_movimentacao, categoria_id")
    .eq("user_id", userId).in("transferencia_id", ids).neq("codigo_custodia", codigoCustodia);
  const pontas = (outras || []) as Ponta[];
  if (pontas.length === 0) return null;

  for (const p of pontas) {
    if (p.tipo_movimentacao !== TIPO_MIGRACAO_ENTRADA || !p.codigo_custodia) continue;
    const semSaldo = await saidaSemSaldoNaPosicaoDeFundo(userId, p.codigo_custodia, (ms) => ms.filter((m) => m.id !== p.id));
    if (semSaldo) return semSaldo;
  }

  const { error } = await supabase.from("movimentacoes").delete().in("id", pontas.map((p) => p.id));
  if (error) return "Erro ao excluir a outra ponta da migração.";
  await refazer(pontas, userId, dataReferencia);
  return null;
}
