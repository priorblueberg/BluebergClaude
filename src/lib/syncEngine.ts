/**
 * Motor de Sincronização de Tabelas
 * 
 * Mantém custodia e controle_de_carteiras atualizadas
 * automaticamente quando movimentacoes são alteradas.
 */
import { supabase } from "@/integrations/supabase/client";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";

/** Fetch CDI records if the product uses CDI indexador */
async function fetchCdiIfNeeded(
  indexador: string | null,
  dataInicio: string,
  dataFim: string
): Promise<{ data: string; taxa_anual: number }[] | undefined> {
  if (!indexador || !indexador.includes("CDI")) return undefined;
  const { data } = await supabase
    .from("historico_cdi")
    .select("data, taxa_anual")
    .gte("data", dataInicio)
    .lte("data", dataFim)
    .order("data");
  return data?.map((r) => ({ data: r.data, taxa_anual: Number(r.taxa_anual) })) || undefined;
}

// ── Resgate no Vencimento Auto Sync ──

type SyncCustodiaBase = {
  vencimento: string | null;
  resgate_total: string | null;
  modalidade: string | null;
  taxa: number | null;
  data_inicio: string;
  categoria_id: string;
  produto_id: string;
  instituicao_id: string | null;
  emissor_id: string | null;
  pagamento: string | null;
  indexador: string | null;
  nome: string | null;
  preco_unitario: number | null;
};

function formatValorExtrato(valor: number, precoUnitario: number, quantidade: number) {
  const fmtBR = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `R$ ${fmtBR(valor)} (${fmtBR(precoUnitario)} x ${fmtBR(quantidade)})`;
}

/**
 * Recalculate manual "Resgate Total" rows created by the "Fechar Posição" flow.
 * These rows are derived values and must be updated when earlier movimentações change.
 */
async function syncManualResgatesTotais(
  codigoCustodia: number,
  userId: string,
  custodiaRecord: SyncCustodiaBase
) {
  try {
    const { data: manualResgates } = await supabase
      .from("movimentacoes")
      .select("id, data")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .eq("tipo_movimentacao", "Resgate Total")
      .eq("origem", "manual")
      .order("data");

    if (!manualResgates || manualResgates.length === 0) return;

    const lastResgateDate = manualResgates[manualResgates.length - 1].data;

    const [{ data: calendario }, { data: movs }] = await Promise.all([
      supabase
        .from("calendario_dias_uteis")
        .select("data, dia_util")
        .gte("data", custodiaRecord.data_inicio)
        .lte("data", lastResgateDate)
        .order("data"),
      supabase
        .from("movimentacoes")
        .select("id, data, tipo_movimentacao, valor")
        .eq("codigo_custodia", codigoCustodia)
        .eq("user_id", userId)
        .neq("tipo_movimentacao", "Resgate no Vencimento")
        .order("data"),
    ]);

    if (!calendario || !movs) return;

    const cdiRecords = await fetchCdiIfNeeded(custodiaRecord.indexador, custodiaRecord.data_inicio, lastResgateDate);

    for (const manualResgate of manualResgates) {
      const calendarioAteData = calendario.filter((dia) => dia.data <= manualResgate.data);
      const movsAteData = movs
        .filter((mov) => mov.id !== manualResgate.id && mov.data <= manualResgate.data)
        .map((mov) => ({
          data: mov.data,
          tipo_movimentacao: mov.tipo_movimentacao,
          valor: Number(mov.valor),
        }));

      if (calendarioAteData.length === 0) continue;

      const rows = calcularRendaFixaDiario({
        dataInicio: custodiaRecord.data_inicio,
        dataCalculo: manualResgate.data,
        taxa: custodiaRecord.taxa || 0,
        modalidade: custodiaRecord.modalidade || "Prefixado",
        puInicial: custodiaRecord.preco_unitario || 1000,
        calendario: calendarioAteData,
        movimentacoes: movsAteData,
        dataResgateTotal: null,
        pagamento: custodiaRecord.pagamento,
        vencimento: custodiaRecord.vencimento,
        indexador: custodiaRecord.indexador,
        cdiRecords,
      });

      const rowDia = rows[rows.length - 1];
      if (!rowDia) continue;

      const valor = Math.max(rowDia.liquido, 0);
      const isNoVencimento = custodiaRecord.pagamento === "No Vencimento";

      let precoUnitario: number;
      let quantidade: number;

      if (isNoVencimento) {
        precoUnitario = rowDia.precoUnitario;
        quantidade = precoUnitario > 0 ? valor / precoUnitario : 0;
      } else {
        precoUnitario = rowDia.puJurosPeriodicos;
        quantidade = precoUnitario > 0 ? valor / precoUnitario : 0;
      }

      await supabase
        .from("movimentacoes")
        .update({
          valor,
          preco_unitario: precoUnitario,
          quantidade,
          valor_extrato: formatValorExtrato(valor, precoUnitario, quantidade),
        })
        .eq("id", manualResgate.id);
    }
  } catch (err) {
    console.error("syncManualResgatesTotais: erro ao recalcular Resgate Total", err);
  }
}

/**
 * Automatically creates or removes a "Resgate no Vencimento" movimentacao
 * when resgate_total === vencimento AND vencimento < today (real date).
 */
async function syncResgateNoVencimento(
  codigoCustodia: number,
  userId: string,
  custodiaRecord: SyncCustodiaBase
) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { vencimento, resgate_total } = custodiaRecord;

  const shouldCreate =
    vencimento && resgate_total && resgate_total === vencimento && vencimento < hoje;

  // Find ALL existing auto resgates (to clean up any duplicates)
  const { data: existingAutos } = await supabase
    .from("movimentacoes")
    .select("id")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .eq("tipo_movimentacao", "Resgate no Vencimento")
    .eq("origem", "automatico");

  if (!shouldCreate) {
    // Remove all existing auto resgates
    if (existingAutos && existingAutos.length > 0) {
      await supabase
        .from("movimentacoes")
        .delete()
        .eq("codigo_custodia", codigoCustodia)
        .eq("user_id", userId)
        .eq("tipo_movimentacao", "Resgate no Vencimento")
        .eq("origem", "automatico");
    }
    return;
  }

  // Keep only the first, delete duplicates
  let existingId: string | null = null;
  if (existingAutos && existingAutos.length > 0) {
    existingId = existingAutos[0].id;
    if (existingAutos.length > 1) {
      const duplicateIds = existingAutos.slice(1).map(a => a.id);
      await supabase
        .from("movimentacoes")
        .delete()
        .in("id", duplicateIds);
    }
  }

  // Calculate liquido and cota via engine
  try {
    const { data: calendario } = await supabase
      .from("calendario_dias_uteis")
      .select("data, dia_util")
      .gte("data", custodiaRecord.data_inicio)
      .lte("data", vencimento!)
      .order("data");

    const { data: movs } = await supabase
      .from("movimentacoes")
      .select("data, tipo_movimentacao, valor")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .neq("tipo_movimentacao", "Resgate no Vencimento")
      .order("data");

    if (!calendario || !movs) return;

    const cdiRecords = await fetchCdiIfNeeded(custodiaRecord.indexador, custodiaRecord.data_inicio, vencimento!);

    const rows = calcularRendaFixaDiario({
      dataInicio: custodiaRecord.data_inicio,
      dataCalculo: vencimento!,
      taxa: custodiaRecord.taxa || 0,
      modalidade: custodiaRecord.modalidade || "Prefixado",
      puInicial: custodiaRecord.preco_unitario || 1000,
      calendario,
      movimentacoes: movs,
      dataResgateTotal: custodiaRecord.resgate_total,
      pagamento: custodiaRecord.pagamento,
      vencimento: custodiaRecord.vencimento,
      indexador: custodiaRecord.indexador,
      cdiRecords,
    });

    if (rows.length === 0) return;

    const lastRow = rows[rows.length - 1];
    const isNoVencimento = custodiaRecord.pagamento === "No Vencimento";

    let valor: number;
    let precoUnitario: number;
    let quantidade: number;

    if (isNoVencimento) {
      valor = lastRow.resgates + lastRow.jurosPago;
      precoUnitario = lastRow.precoUnitario;
      quantidade = lastRow.qtdResgate2 > 0 ? lastRow.qtdResgate2 : (precoUnitario > 0 ? valor / precoUnitario : 0);
    } else {
      valor = lastRow.resgates + lastRow.jurosPago;
      precoUnitario = lastRow.puJurosPeriodicos;
      quantidade = lastRow.qtdResgate2 > 0 ? lastRow.qtdResgate2 : (precoUnitario > 0 ? valor / precoUnitario : 0);
    }

    const movData = {
      user_id: userId,
      data: vencimento!,
      tipo_movimentacao: "Resgate no Vencimento",
      codigo_custodia: codigoCustodia,
      categoria_id: custodiaRecord.categoria_id,
      produto_id: custodiaRecord.produto_id,
      instituicao_id: custodiaRecord.instituicao_id,
      emissor_id: custodiaRecord.emissor_id,
      modalidade: custodiaRecord.modalidade,
      indexador: custodiaRecord.indexador,
      taxa: custodiaRecord.taxa,
      pagamento: custodiaRecord.pagamento,
      vencimento: custodiaRecord.vencimento,
      preco_unitario: precoUnitario,
      quantidade,
      valor,
      valor_extrato: formatValorExtrato(valor, precoUnitario, quantidade),
      nome_ativo: custodiaRecord.nome,
      origem: "automatico",
    };

    if (existingId) {
      await supabase.from("movimentacoes").update(movData).eq("id", existingId);
    } else {
      await supabase.from("movimentacoes").insert(movData);
    }
  } catch (err) {
    console.error("syncResgateNoVencimento: erro ao calcular/inserir", err);
  }
}

// ── Poupança Lotes Sync ──

/** Sync poupanca_lotes based on movimentacoes for a given codigo_custodia */
async function syncPoupancaLotes(codigoCustodia: number, userId: string, custodiaId?: string) {
  // Fetch all movimentacoes for this poupança
  const { data: allMovs } = await supabase
    .from("movimentacoes")
    .select("*")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .order("data", { ascending: true });

  if (!allMovs) return;

  // Get custodia id if not provided
  let cusId = custodiaId;
  if (!cusId) {
    const { data: cust } = await supabase
      .from("custodia")
      .select("id")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .maybeSingle();
    cusId = cust?.id;
  }

  // Delete existing lotes and recreate from movimentacoes
  await supabase
    .from("poupanca_lotes")
    .delete()
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId);

  // Build lotes from applications
  interface TempLote {
    data_aplicacao: string;
    dia_aniversario: number;
    valor_principal: number;
    valor_atual: number;
  }

  const lotes: TempLote[] = [];

  for (const m of allMovs) {
    if (["Aplicação Inicial", "Aplicação"].includes(m.tipo_movimentacao)) {
      const dia = new Date(m.data + "T00:00:00").getDate();
      lotes.push({
        data_aplicacao: m.data,
        dia_aniversario: dia,
        valor_principal: m.valor,
        valor_atual: m.valor,
      });
    } else if (["Resgate", "Resgate Total"].includes(m.tipo_movimentacao)) {
      // FIFO consumption
      let restante = m.valor;
      for (const lote of lotes) {
        if (restante <= 0) break;
        if (lote.valor_atual <= 0) continue;
        
        if (restante >= lote.valor_atual - 0.01) {
          restante -= lote.valor_atual;
          lote.valor_atual = 0;
          lote.valor_principal = 0;
        } else {
          const proporcao = restante / lote.valor_atual;
          lote.valor_principal -= lote.valor_principal * proporcao;
          lote.valor_atual -= restante;
          restante = 0;
        }
      }
    }
  }

  // Insert active lotes
  const activeLotes = lotes.filter(l => l.valor_atual > 0.01);
  if (activeLotes.length === 0) return;

  const lotesToInsert = activeLotes.map(l => ({
    user_id: userId,
    custodia_id: cusId || null,
    codigo_custodia: codigoCustodia,
    data_aplicacao: l.data_aplicacao,
    dia_aniversario: l.dia_aniversario,
    valor_principal: l.valor_principal,
    valor_atual: l.valor_atual,
    rendimento_acumulado: 0,
    status: "ativo",
  }));

  const { error } = await supabase
    .from("poupanca_lotes")
    .insert(lotesToInsert);

  if (error) console.error("syncPoupancaLotes: erro ao inserir lotes", error);
}

// ── Custodia Sync ──

/** Compute resgate_total for a Renda Fixa custodia record */
async function computeResgateTotal(codigoCustodia: number, userId: string, vencimento: string | null): Promise<string | null> {
  // Find the most recent "Resgate Total"
  const { data: resgateTotal } = await supabase
    .from("movimentacoes")
    .select("data")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .eq("tipo_movimentacao", "Resgate Total")
    .order("data", { ascending: false })
    .limit(1);

  if (resgateTotal && resgateTotal.length > 0) {
    const dataResgate = resgateTotal[0].data;

    // Check if there's an application AFTER the most recent Resgate Total
    const { data: aplicacaoPostResgate } = await supabase
      .from("movimentacoes")
      .select("data")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .in("tipo_movimentacao", ["Aplicação Inicial", "Aplicação"])
      .gt("data", dataResgate)
      .order("data", { ascending: false })
      .limit(1);

    if (aplicacaoPostResgate && aplicacaoPostResgate.length > 0) {
      // There's an application after the resgate total — revert to vencimento
      return vencimento || null;
    }

    return dataResgate;
  }
  return vencimento || null;
}

/** Compute data_calculo based on data_referencia, resgate_total, and data_limite */
function computeDataCalculo(dataReferencia: string, resgateTotal: string | null, dataLimite: string | null): string | null {
  if (!resgateTotal && !dataLimite) return dataReferencia;

  // If data_referencia >= resgate_total, use resgate_total
  if (resgateTotal && dataReferencia >= resgateTotal) {
    return resgateTotal;
  }

  // If data_referencia < resgate_total:
  // Check data_limite
  if (dataLimite) {
    if (dataReferencia >= dataLimite) {
      return dataLimite;
    } else {
      return dataReferencia;
    }
  }

  return dataReferencia;
}

/** After inserting/updating a movimentacao, upsert the corresponding custodia record */
export async function syncCustodiaFromMovimentacao(movimentacaoId: string, dataReferencia?: string) {
  const refDate = dataReferencia || new Date().toISOString().slice(0, 10);

  // Fetch the movimentacao with related names
  const { data: mov, error } = await supabase
    .from("movimentacoes")
    .select("*, categorias(nome)")
    .eq("id", movimentacaoId)
    .single();

  if (error || !mov) {
    console.error("syncCustodia: movimentação não encontrada", error);
    return;
  }

  const categoriaNome = (mov as any).categorias?.nome || "";
  const isRendaFixa = categoriaNome === "Renda Fixa";
  let isPoupanca = mov.modalidade === "Poupança";

  if (!mov.codigo_custodia) return;

  // Fetch ALL movimentações for this codigo_custodia to aggregate values
  const { data: allMovs } = await supabase
    .from("movimentacoes")
    .select("*")
    .eq("codigo_custodia", mov.codigo_custodia)
    .eq("user_id", mov.user_id)
    .order("data", { ascending: true });

  // ── Ensure "Aplicação Inicial" is always the earliest application ──
  const aplicacoes = (allMovs || []).filter(
    (m: any) => ["Aplicação Inicial", "Aplicação"].includes(m.tipo_movimentacao)
  );
  if (aplicacoes.length > 1) {
    // Sort by date ascending — the earliest should be "Aplicação Inicial"
    const sorted = [...aplicacoes].sort((a, b) => a.data.localeCompare(b.data));
    const earliest = sorted[0];
    // If the earliest is not "Aplicação Inicial", swap types
    if (earliest.tipo_movimentacao !== "Aplicação Inicial") {
      // Find current "Aplicação Inicial" and demote it
      const currentInicial = sorted.find((m) => m.tipo_movimentacao === "Aplicação Inicial");
      if (currentInicial) {
        await supabase
          .from("movimentacoes")
          .update({ tipo_movimentacao: "Aplicação" })
          .eq("id", currentInicial.id);
      }
      // Promote earliest to "Aplicação Inicial"
      await supabase
        .from("movimentacoes")
        .update({ tipo_movimentacao: "Aplicação Inicial" })
        .eq("id", earliest.id);
      // Update local references
      if (currentInicial) currentInicial.tipo_movimentacao = "Aplicação";
      earliest.tipo_movimentacao = "Aplicação Inicial";
    }
  }

  // Find the first application (Aplicação Inicial) for base fields
  const aplicacaoInicial = (allMovs || []).find(
    (m: any) => m.tipo_movimentacao === "Aplicação Inicial"
  ) || (allMovs || []).find(
    (m: any) => m.tipo_movimentacao === "Aplicação"
  ) || mov;

  // Refine isPoupanca now that we have aplicacaoInicial
  isPoupanca = isPoupanca || aplicacaoInicial.modalidade === "Poupança";

  // Compute net valor_investido: sum of aplicações - sum of resgates
  let valorInvestidoLiquido = 0;
  for (const m of allMovs || []) {
    if (["Aplicação Inicial", "Aplicação", "Aporte Adicional"].includes(m.tipo_movimentacao)) {
      valorInvestidoLiquido += m.valor;
    } else if (["Resgate", "Resgate no Vencimento", "Resgate Total"].includes(m.tipo_movimentacao)) {
      valorInvestidoLiquido -= m.valor;
    }
  }
  if (valorInvestidoLiquido < 0) valorInvestidoLiquido = 0;

  // Compute resgate_total (for RF non-poupança or poupança with resgate total)
  let resgateTotal: string | null = null;
  if (isRendaFixa && !isPoupanca) {
    resgateTotal = await computeResgateTotal(mov.codigo_custodia, mov.user_id!, aplicacaoInicial.vencimento);
  } else if (isPoupanca) {
    // For Poupança, compute resgate_total from manual "Resgate Total" movements
    resgateTotal = await computeResgateTotal(mov.codigo_custodia, mov.user_id!, null);
  }

  // Compute data_limite — Poupança gets a far-future date so the portfolio stays active
  const dataLimite = isPoupanca ? "2040-12-31" : (isRendaFixa ? aplicacaoInicial.vencimento : null);

  // Compute data_calculo
  const dataCalculo = computeDataCalculo(refDate, resgateTotal, dataLimite);

  // Check if custodia record already exists
  const { data: existing } = await supabase
    .from("custodia")
    .select("id")
    .eq("codigo_custodia", mov.codigo_custodia)
    .eq("user_id", mov.user_id!)
    .limit(1);

  // Derive estrategia from modalidade + indexador
  const derivedEstrategia = (() => {
    const mod = aplicacaoInicial.modalidade;
    const idx = aplicacaoInicial.indexador;
    if (mod === "Poupança") return "Poupança";
    if (mod === "Prefixado") return "Prefixado";
    if ((mod === "Pos Fixado" || mod === "Pós Fixado") && idx === "CDI") return "Pós Fixado CDI";
    if (mod === "Mista" && idx === "CDI") return "Pós Fixado CDI + Taxa";
    return null;
  })();

  const custodiaData = {
    codigo_custodia: mov.codigo_custodia,
    data_inicio: aplicacaoInicial.data,
    produto_id: aplicacaoInicial.produto_id,
    tipo_movimentacao: aplicacaoInicial.tipo_movimentacao,
    instituicao_id: aplicacaoInicial.instituicao_id,
    modalidade: aplicacaoInicial.modalidade,
    indexador: aplicacaoInicial.indexador,
    taxa: aplicacaoInicial.taxa,
    valor_investido: valorInvestidoLiquido,
    preco_unitario: aplicacaoInicial.preco_unitario,
    quantidade: aplicacaoInicial.quantidade,
    vencimento: aplicacaoInicial.vencimento,
    emissor_id: aplicacaoInicial.emissor_id,
    pagamento: aplicacaoInicial.pagamento,
    nome: aplicacaoInicial.nome_ativo,
    categoria_id: aplicacaoInicial.categoria_id,
    user_id: mov.user_id,
    data_limite: dataLimite,
    alocacao_patrimonial: "Renda Fixa",
    multiplicador: categoriaNome || null,
    resgate_total: resgateTotal,
    data_calculo: dataCalculo,
    pu_inicial: aplicacaoInicial.preco_unitario,
    estrategia: derivedEstrategia,
  };

  if (existing && existing.length > 0) {
    const { error: upErr } = await supabase
      .from("custodia")
      .update(custodiaData)
      .eq("id", existing[0].id);
    if (upErr) console.error("syncCustodia: erro ao atualizar", upErr);
  } else {
    const { error: insErr } = await supabase
      .from("custodia")
      .insert(custodiaData);
    if (insErr) console.error("syncCustodia: erro ao inserir", insErr);
  }

  // Sync manual "Resgate Total" values created by the "Fechar Posição" flow (RF non-poupança only)
  if (isRendaFixa && !isPoupanca) {
    await syncManualResgatesTotais(mov.codigo_custodia, mov.user_id!, {
      vencimento: aplicacaoInicial.vencimento,
      resgate_total: resgateTotal,
      modalidade: aplicacaoInicial.modalidade,
      taxa: aplicacaoInicial.taxa,
      data_inicio: aplicacaoInicial.data,
      categoria_id: aplicacaoInicial.categoria_id,
      produto_id: aplicacaoInicial.produto_id,
      instituicao_id: aplicacaoInicial.instituicao_id,
      emissor_id: aplicacaoInicial.emissor_id,
      pagamento: aplicacaoInicial.pagamento,
      indexador: aplicacaoInicial.indexador,
      nome: aplicacaoInicial.nome_ativo,
      preco_unitario: aplicacaoInicial.preco_unitario,
    });

    // Sync automatic "Resgate no Vencimento"
    await syncResgateNoVencimento(mov.codigo_custodia, mov.user_id!, {
      vencimento: aplicacaoInicial.vencimento,
      resgate_total: resgateTotal,
      modalidade: aplicacaoInicial.modalidade,
      taxa: aplicacaoInicial.taxa,
      data_inicio: aplicacaoInicial.data,
      categoria_id: aplicacaoInicial.categoria_id,
      produto_id: aplicacaoInicial.produto_id,
      instituicao_id: aplicacaoInicial.instituicao_id,
      emissor_id: aplicacaoInicial.emissor_id,
      pagamento: aplicacaoInicial.pagamento,
      indexador: aplicacaoInicial.indexador,
      nome: aplicacaoInicial.nome_ativo,
      preco_unitario: aplicacaoInicial.preco_unitario,
    });
  }

  // ── Sync Poupança lotes ──
  if (isPoupanca) {
    await syncPoupancaLotes(mov.codigo_custodia, mov.user_id!, existing?.[0]?.id);
  }
}

/** After deleting a movimentacao, remove the custodia record if no more movimentacoes reference it */
export async function syncCustodiaOnDelete(codigoCustodia: number, userId: string, dataReferencia?: string) {
  if (!codigoCustodia) return;

  const { data: remaining } = await supabase
    .from("movimentacoes")
    .select("id")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .limit(1);

  if (!remaining || remaining.length === 0) {
    await supabase
      .from("custodia")
      .delete()
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId);
  } else {
    await syncCustodiaFromMovimentacao(remaining[0].id, dataReferencia);
  }
}

// ── Controle de Carteiras Sync ──

/** Recalculate controle_de_carteiras for a specific category */
export async function syncControleCarteiras(categoriaId: string, userId: string, dataReferencia?: string) {
  const refDate = dataReferencia || new Date().toISOString().slice(0, 10);

  const { data: catData } = await supabase
    .from("categorias")
    .select("nome")
    .eq("id", categoriaId)
    .single();
  const categoriaNome = catData?.nome || "Desconhecida";

  const { data: custodiaRows } = await supabase
    .from("custodia")
    .select("data_inicio, data_limite, data_calculo")
    .eq("categoria_id", categoriaId)
    .eq("user_id", userId);

  if (!custodiaRows || custodiaRows.length === 0) {
    await supabase
      .from("controle_de_carteiras")
      .delete()
      .eq("categoria_id", categoriaId)
      .eq("user_id", userId)
      .neq("nome_carteira", "Investimentos");
    await syncCarteiraGeral(userId, refDate);
    return;
  }

  const dates = (field: string) =>
    (custodiaRows || []).map((r: any) => r[field]).filter(Boolean).sort();

  const dataInicio = dates("data_inicio")[0] || null;
  const dataLimite = dates("data_limite").reverse()[0] || null;
  const dataCalculo = dates("data_calculo").reverse()[0] || null;

  // Compute resgate_total from custodia for this category
  // Get the most recent resgate_total (vencimento or fechamento date) from custodia
  const { data: custodiaResgateRows } = await supabase
    .from("custodia")
    .select("vencimento, codigo_custodia")
    .eq("categoria_id", categoriaId)
    .eq("user_id", userId);

  let resgateTotal: string | null = null;
  let hasActiveWithoutResgate = false;
  if (custodiaResgateRows && custodiaResgateRows.length > 0) {
    const resgateDates: string[] = [];
    for (const row of custodiaResgateRows) {
      const rt = await computeResgateTotal(row.codigo_custodia, userId, row.vencimento);
      if (rt) {
        resgateDates.push(rt);
      } else {
        hasActiveWithoutResgate = true;
      }
    }
    if (hasActiveWithoutResgate) {
      resgateTotal = null;
    } else if (resgateDates.length > 0) {
      resgateDates.sort();
      resgateTotal = resgateDates[resgateDates.length - 1];
    }
  }

  // Status rules:
  // If data_referencia < data_inicio → "Não Iniciada"
  // If resgate_total > data_referencia → "Ativa"
  // Otherwise → "Encerrada"
  let status = "Ativa";
  if (dataInicio && refDate < dataInicio) {
    status = "Não Iniciada";
  } else if (resgateTotal && resgateTotal > refDate) {
    status = "Ativa";
  } else if (resgateTotal && resgateTotal <= refDate) {
    status = "Encerrada";
  }

  const carteiraData = {
    categoria_id: categoriaId,
    nome_carteira: categoriaNome,
    data_inicio: dataInicio,
    data_limite: dataLimite,
    resgate_total: resgateTotal,
    data_calculo: dataCalculo,
    status,
    user_id: userId,
  };

  await supabase.from("controle_de_carteiras").upsert(carteiraData, {
    onConflict: "nome_carteira,user_id",
  });

  await syncCarteiraGeral(userId, refDate);
}

/** Recalculate the general "Investimentos" carteira */
export async function syncCarteiraGeral(userId: string, dataReferencia?: string) {
  const refDate = dataReferencia || new Date().toISOString().slice(0, 10);

  const { data: allCustodia } = await supabase
    .from("custodia")
    .select("data_inicio, data_limite, data_calculo, vencimento, codigo_custodia")
    .eq("user_id", userId);

  if (!allCustodia || allCustodia.length === 0) {
    await supabase
      .from("controle_de_carteiras")
      .delete()
      .eq("nome_carteira", "Investimentos")
      .eq("user_id", userId);
    return;
  }

  const dates = (field: string) =>
    allCustodia.map((r: any) => r[field]).filter(Boolean).sort();

  const dataInicio = dates("data_inicio")[0] || null;
  const dataLimite = dates("data_limite").reverse()[0] || null;
  const dataCalculo = dates("data_calculo").reverse()[0] || null;

  // Compute resgate_total across all custodia
  const resgateDates: string[] = [];
  let hasActiveWithoutResgate = false;
  for (const row of allCustodia) {
    const rt = await computeResgateTotal(row.codigo_custodia, userId, row.vencimento);
    if (rt) {
      resgateDates.push(rt);
    } else {
      hasActiveWithoutResgate = true;
    }
  }
  let resgateTotal: string | null = null;
  if (hasActiveWithoutResgate) {
    resgateTotal = null;
  } else if (resgateDates.length > 0) {
    resgateDates.sort();
    resgateTotal = resgateDates[resgateDates.length - 1];
  }

  let status = "Ativa";
  if (dataInicio && refDate < dataInicio) {
    status = "Não Iniciada";
  } else if (resgateTotal && resgateTotal > refDate) {
    status = "Ativa";
  } else if (resgateTotal && resgateTotal <= refDate) {
    status = "Encerrada";
  }

  const { data: firstCat } = await supabase.from("categorias").select("id").limit(1);
  const catId = firstCat?.[0]?.id;
  if (!catId) return;

  const carteiraData = {
    categoria_id: catId,
    nome_carteira: "Investimentos",
    data_inicio: dataInicio,
    data_limite: dataLimite,
    resgate_total: resgateTotal,
    data_calculo: dataCalculo,
    status,
    user_id: userId,
  };

  await supabase.from("controle_de_carteiras").upsert(carteiraData, {
    onConflict: "nome_carteira,user_id",
  });
}

/**
 * Reprocess all movimentações for a given codigo_custodia.
 * Updates preco_unitario on each movimentação:
 *   - Aplicação Inicial: keeps user-entered PU
 *   - Aplicação: uses Valor da Cota (1) before the application
 *   - Resgate/Resgate Total/Resgate Parcial: uses Valor da Cota (2)
 * Then syncs custodia and auto resgates.
 */
export async function reprocessMovimentacoesForCodigo(
  codigoCustodia: number,
  userId: string,
  categoriaId: string,
  dataReferencia?: string
) {
  const refDate = dataReferencia || new Date().toISOString().slice(0, 10);

  // 1. Delete auto movimentações for this codigo
  await supabase
    .from("movimentacoes")
    .delete()
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .eq("origem", "automatico");

  // 2. Fetch all remaining manual movimentações ordered by date
  const { data: manualMovs } = await supabase
    .from("movimentacoes")
    .select("*")
    .eq("codigo_custodia", codigoCustodia)
    .eq("user_id", userId)
    .eq("origem", "manual")
    .order("data", { ascending: true })
    .order("created_at", { ascending: true });

  if (!manualMovs || manualMovs.length === 0) return;

  // 3. Fetch custodia base info from Aplicação Inicial
  const aplicacaoInicial = manualMovs.find(
    (m) => m.tipo_movimentacao === "Aplicação Inicial"
  ) || manualMovs[0];

  const baseInfo = {
    dataInicio: aplicacaoInicial.data,
    taxa: aplicacaoInicial.taxa || 0,
    modalidade: aplicacaoInicial.modalidade || "Prefixado",
    puInicial: aplicacaoInicial.preco_unitario || 1000,
    pagamento: aplicacaoInicial.pagamento,
    vencimento: aplicacaoInicial.vencimento,
  };

  // 4. Get the full calendar range needed
  const lastDate = manualMovs[manualMovs.length - 1].data;
  const calEnd = baseInfo.vencimento && baseInfo.vencimento > lastDate ? baseInfo.vencimento : lastDate;

  const { data: calendario } = await supabase
    .from("calendario_dias_uteis")
    .select("data, dia_util")
    .gte("data", baseInfo.dataInicio)
    .lte("data", calEnd > refDate ? calEnd : refDate)
    .order("data");

  if (!calendario) return;

  // 5. Fetch CDI if needed
  const cdiRecordsReprocess = await fetchCdiIfNeeded(aplicacaoInicial.indexador, baseInfo.dataInicio, calEnd > refDate ? calEnd : refDate);

  // 6. For each movimentação, compute engine and update PU/Qty from calculator columns
  for (let i = 0; i < manualMovs.length; i++) {
    const mov = manualMovs[i];

    // Build movimentações list: for resgates include the current movement so
    // the engine computes qtdResgate2 correctly; for aplicações use only preceding.
    const isResgate = ["Resgate", "Resgate Parcial", "Resgate Total"].includes(mov.tipo_movimentacao);
    const precedingMovs = manualMovs
      .filter((m, idx) => isResgate ? idx <= i : idx < i)
      .map((m) => ({
        data: m.data,
        tipo_movimentacao: m.tipo_movimentacao,
        valor: Number(m.valor),
      }));

    const rows = calcularRendaFixaDiario({
      dataInicio: baseInfo.dataInicio,
      dataCalculo: mov.data,
      taxa: baseInfo.taxa,
      modalidade: baseInfo.modalidade,
      puInicial: baseInfo.puInicial,
      calendario,
      movimentacoes: precedingMovs,
      dataResgateTotal: null,
      pagamento: baseInfo.pagamento,
      vencimento: baseInfo.vencimento,
      indexador: aplicacaoInicial.indexador,
      cdiRecords: cdiRecordsReprocess,
    });

    const rowDia = rows.find((r) => r.data === mov.data);
    if (!rowDia) continue;

    const isAplicacao = ["Aplicação", "Aplicação Inicial"].includes(mov.tipo_movimentacao);
    const isNoVencimento = baseInfo.pagamento === "No Vencimento";
    const isResgateTotalMov = ["Resgate Total", "Resgate no Vencimento"].includes(mov.tipo_movimentacao);

    let newPU: number;
    let newQuantidade: number | null;

    if (isNoVencimento) {
      // Pagamento "No Vencimento": uses Preço Unitário and QTD Aplicação / QTD Resgate
      if (isAplicacao) {
        newPU = rowDia.precoUnitario;
        newQuantidade = rowDia.qtdAplicacaoPU > 0 ? rowDia.qtdAplicacaoPU : (newPU > 0 ? Number(mov.valor) / newPU : null);
      } else if (isResgateTotalMov) {
        // On resgate_total day: use QTD Resgate (2)
        newPU = rowDia.precoUnitario;
        newQuantidade = rowDia.qtdResgate2 > 0 ? rowDia.qtdResgate2 : (newPU > 0 ? Number(mov.valor) / newPU : null);
      } else {
        newPU = rowDia.precoUnitario;
        newQuantidade = rowDia.qtdResgatePU > 0 ? rowDia.qtdResgatePU : (newPU > 0 ? Number(mov.valor) / newPU : null);
      }
    } else {
      // Other pagamento types: uses PU Juros Periódicos and QTD Aplicação (2) / QTD Resgate (2)
      if (isAplicacao) {
        newPU = rowDia.puJurosPeriodicos;
        newQuantidade = rowDia.qtdAplicacao2 > 0 ? rowDia.qtdAplicacao2 : (newPU > 0 ? Number(mov.valor) / newPU : null);
      } else {
        newPU = rowDia.puJurosPeriodicos;
        newQuantidade = rowDia.qtdResgate2 > 0 ? rowDia.qtdResgate2 : (newPU > 0 ? Number(mov.valor) / newPU : null);
      }
    }

    await supabase
      .from("movimentacoes")
      .update({
        preco_unitario: newPU,
        quantidade: newQuantidade,
      })
      .eq("id", mov.id);
  }

  // 6. Now run normal custodia sync using the first movimentação
  await syncCustodiaFromMovimentacao(aplicacaoInicial.id, refDate);
}

/** Full sync: reprocess all movimentações for the codigo and update custodia + carteiras */
export async function fullSyncAfterMovimentacao(
  movimentacaoId: string | null,
  categoriaId: string,
  userId: string,
  dataReferencia?: string
) {
  if (movimentacaoId) {
    // Get the codigo_custodia for this movimentação
    const { data: mov } = await supabase
      .from("movimentacoes")
      .select("codigo_custodia")
      .eq("id", movimentacaoId)
      .single();

    if (mov?.codigo_custodia) {
      await reprocessMovimentacoesForCodigo(mov.codigo_custodia, userId, categoriaId, dataReferencia);
    } else {
      await syncCustodiaFromMovimentacao(movimentacaoId, dataReferencia);
    }
  }
  await syncControleCarteiras(categoriaId, userId, dataReferencia);
}

/** Full sync after deleting a movimentacao */
export async function fullSyncAfterDelete(
  codigoCustodia: number | null,
  categoriaId: string,
  userId: string,
  dataReferencia?: string
) {
  if (codigoCustodia) {
    // Check if there are remaining movimentações for this codigo
    const { data: remaining } = await supabase
      .from("movimentacoes")
      .select("id")
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", userId)
      .limit(1);

    if (remaining && remaining.length > 0) {
      // Reprocess all remaining movements
      await reprocessMovimentacoesForCodigo(codigoCustodia, userId, categoriaId, dataReferencia);
    } else {
      // No remaining movements — delete custodia
      await supabase
        .from("custodia")
        .delete()
        .eq("codigo_custodia", codigoCustodia)
        .eq("user_id", userId);
    }
  }
  await syncControleCarteiras(categoriaId, userId, dataReferencia);
}

/** Guard to prevent concurrent full recalculations */
let _isRecalculating = false;

/** Recalculate ALL custodia and controle_de_carteiras for a user based on a new data_referencia.
 *  Destructive-reconstructive: wipes custodia, controle_de_carteiras, and automatic movimentacoes,
 *  then replays every unique codigo_custodia once.
 */
export async function recalculateAllForDataReferencia(userId: string, dataReferencia: string) {
  if (_isRecalculating) {
    console.warn("recalculateAllForDataReferencia: already in progress, skipping");
    return;
  }
  _isRecalculating = true;

  try {
    // 1. Delete all custodia for the user
    await supabase.from("custodia").delete().eq("user_id", userId);

    // 2. Delete all controle_de_carteiras for the user
    await supabase.from("controle_de_carteiras").delete().eq("user_id", userId);

    // 3. Delete all automatic movimentacoes
    await supabase
      .from("movimentacoes")
      .delete()
      .eq("user_id", userId)
      .eq("origem", "automatico");

    // 4. Fetch all remaining (manual) movimentacoes ordered chronologically
    const { data: manualMovs } = await supabase
      .from("movimentacoes")
      .select("id, categoria_id, codigo_custodia")
      .eq("user_id", userId)
      .order("data", { ascending: true })
      .order("created_at", { ascending: true });

    if (!manualMovs || manualMovs.length === 0) return;

    // 5. Process each codigo_custodia only ONCE via reprocessMovimentacoesForCodigo
    const processedCodigos = new Set<number>();
    const categoriaIds = new Set<string>();

    for (const mov of manualMovs) {
      categoriaIds.add(mov.categoria_id);
      const code = mov.codigo_custodia;
      if (code != null && !processedCodigos.has(code)) {
        processedCodigos.add(code);
        await reprocessMovimentacoesForCodigo(code, userId, mov.categoria_id, dataReferencia);
      }
    }

    // 6. Sync controle_de_carteiras for each category
    for (const catId of categoriaIds) {
      await syncControleCarteiras(catId, userId, dataReferencia);
    }

    // 7. Sync carteira geral ("Investimentos")
    await syncCarteiraGeral(userId, dataReferencia);
  } finally {
    _isRecalculating = false;
  }
}
