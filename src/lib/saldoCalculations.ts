import { supabase } from "@/integrations/supabase/client";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";

/**
 * Calcula o saldo (patrimônio) de um título Prefixado na data de consulta,
 * usando o engine completo de renda fixa (inclui pagamento de juros periódico).
 */
export async function calcSaldoPrefixado(
  valorInvestido: number,
  taxa: number,
  dataInicio: string,
  dataConsulta: string,
  codigoCustodia: number,
  userId: string,
  pagamento?: string | null,
  vencimento?: string | null,
  precoUnitario?: number | null
): Promise<number> {
  // Fetch calendar, movements, and custodia data in parallel
  const [calRes, movRes, custRes] = await Promise.all([
    supabase
      .from("calendario_dias_uteis")
      .select("data, dia_util")
      .gte("data", (() => {
        const d = new Date(dataInicio + "T00:00:00");
        d.setDate(d.getDate() - 5);
        return d.toISOString().slice(0, 10);
      })())
      .lte("data", dataConsulta)
      .order("data"),
    supabase
      .from("movimentacoes")
      .select("data, tipo_movimentacao, valor")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .order("data"),
    supabase
      .from("custodia")
      .select("resgate_total, pagamento, vencimento, pu_inicial")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const calendario = calRes.data || [];
  const movimentacoes = (movRes.data || []).map((m: any) => ({
    data: m.data,
    tipo_movimentacao: m.tipo_movimentacao,
    valor: Number(m.valor),
  }));

  const custData = custRes.data;
  const finalPagamento = pagamento ?? custData?.pagamento ?? null;
  const finalVencimento = vencimento ?? custData?.vencimento ?? null;
  const finalPu = precoUnitario ?? custData?.pu_inicial ?? 1000;

  const rows = calcularRendaFixaDiario({
    dataInicio,
    dataCalculo: dataConsulta,
    taxa,
    modalidade: "Prefixado",
    puInicial: finalPu,
    calendario,
    movimentacoes,
    dataResgateTotal: custData?.resgate_total ?? null,
    pagamento: finalPagamento,
    vencimento: finalVencimento,
  });

  if (rows.length === 0) return 0;

  // Find the row for dataConsulta, or use the last row
  const targetRow = rows.find((r) => r.data === dataConsulta) || rows[rows.length - 1];
  return targetRow.liquido;
}
