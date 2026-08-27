/**
 * Carrega e calcula a carteira de Fundos de Investimentos (custodia, cotas da
 * CVM, motor FUNDO) uma vez por data de referencia.
 *
 * Espelha o useCarteiraRF: mesma forma de saida (linhas diarias por produto +
 * linhas consolidadas da carteira), para que a lamina Total consiga somar renda
 * fixa e fundos passando os dois pelo MESMO motor de carteira.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularFundoDiario, fundoRowsToDailyRows } from "@/lib/fundoEngine";
import { calcularCarteiraRendaFixa, CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import type { CdiRecord } from "@/lib/cdiCalculations";
import type { ProductListItem, CarteiraInfo } from "@/hooks/useCarteiraRF";

interface FundoCustodia {
  id: string;
  codigo_custodia: string;
  nome: string | null;
  fundo_id: string;
  data_inicio: string;
  data_calculo: string | null;
  resgate_total: string | null;
  valor_investido: number;
  categoria_nome: string;
  produto_nome: string;
  instituicao_nome: string;
  fundo: {
    nome_curto: string | null;
    cnpj_classe: string | null;
    benchmark: string | null;
    dias_cotizacao_aplicacao: number | null;
    dias_cotizacao_resgate: number | null;
  } | null;
}

let _fundosCachedVersion: number | null = null;
let _fundosCached: {
  carteiraInfo: CarteiraInfo | null;
  carteiraRows: CarteiraRFRow[];
  allProductRows: DailyRow[][];
  productList: ProductListItem[];
  cdiRecords: CdiRecord[];
  calendario: { data: string; dia_util: boolean }[];
} | null = null;

export function useCarteiraFundos() {
  const { user } = useAuth();
  const { appliedVersion } = useDataReferencia();
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_fundosCached?.carteiraInfo ?? null);
  const [carteiraRows, setCarteiraRows] = useState<CarteiraRFRow[]>(_fundosCached?.carteiraRows ?? []);
  const [allProductRows, setAllProductRows] = useState<DailyRow[][]>(_fundosCached?.allProductRows ?? []);
  const [productList, setProductList] = useState<ProductListItem[]>(_fundosCached?.productList ?? []);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>(_fundosCached?.cdiRecords ?? []);
  const [calendario, setCalendario] = useState<{ data: string; dia_util: boolean }[]>(_fundosCached?.calendario ?? []);
  const [loading, setLoading] = useState(_fundosCachedVersion === null);

  useEffect(() => {
    if (!user) return;
    if (_fundosCachedVersion === appliedVersion) return;
    (async () => {
      setLoading(true);

      const [{ data: cartData }, { data: custodiaData }] = await Promise.all([
        supabase
          .from("controle_de_carteiras")
          .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
          .eq("nome_carteira", "Fundos de Investimentos")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("custodia")
          .select("id, codigo_custodia, nome, fundo_id, data_inicio, data_calculo, resgate_total, valor_investido, categorias(nome), produtos(nome), instituicoes(nome), cadastro_de_fundos(nome_curto, cnpj_classe, benchmark, dias_cotizacao_aplicacao, dias_cotizacao_resgate)")
          .eq("user_id", user.id)
          .not("fundo_id", "is", null),
      ]);

      const fundos: FundoCustodia[] = (custodiaData || []).map((r: any) => ({
        id: r.id,
        codigo_custodia: r.codigo_custodia,
        nome: r.nome,
        fundo_id: r.fundo_id,
        data_inicio: r.data_inicio,
        data_calculo: r.data_calculo,
        resgate_total: r.resgate_total,
        valor_investido: Number(r.valor_investido),
        categoria_nome: r.categorias?.nome || "Fundos de Investimentos",
        produto_nome: r.produtos?.nome || "Fundos de Investimentos",
        instituicao_nome: r.instituicoes?.nome || "—",
        fundo: r.cadastro_de_fundos || null,
      }));

      if (fundos.length === 0 || !cartData?.data_inicio || !cartData?.data_calculo) {
        setCarteiraInfo(cartData ? (cartData as CarteiraInfo) : null);
        setCarteiraRows([]);
        setAllProductRows([]);
        setProductList([]);
        setCdiRecords([]);
        setCalendario([]);
        setLoading(false);
        _fundosCachedVersion = appliedVersion;
        _fundosCached = { carteiraInfo: (cartData as CarteiraInfo) ?? null, carteiraRows: [], allProductRows: [], productList: [], cdiRecords: [], calendario: [] };
        return;
      }

      const info = cartData as CarteiraInfo;
      setCarteiraInfo(info);
      const dataInicio = info.data_inicio!;
      const dataCalculo = info.data_calculo!;

      const fundoIds = fundos.map((f) => f.fundo_id);
      const codigos = fundos.map((f) => f.codigo_custodia);

      const [calRes, cotasRes, movRes, cdiRes] = await Promise.all([
        supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", dataInicio).lte("data", dataCalculo).order("data"),
        supabase.from("cotas_fundos").select("fundo_id, data, valor_cota")
          .in("fundo_id", fundoIds).lte("data", dataCalculo).order("data"),
        supabase.from("movimentacoes")
          .select("codigo_custodia, data, data_cotizacao, tipo_movimentacao, valor, quantidade")
          .eq("user_id", user.id).in("codigo_custodia", codigos).order("data"),
        supabase.from("historico_cdi").select("data, taxa_anual")
          .gte("data", dataInicio).lte("data", dataCalculo).order("data"),
      ]);

      const calendario = (calRes.data || []).map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
      const calMap = new Map<string, boolean>(calendario.map((c) => [c.data, c.dia_util]));
      const mergedCdi: CdiRecord[] = (cdiRes.data || []).map((c: any) => ({
        data: c.data, taxa_anual: Number(c.taxa_anual), dia_util: calMap.get(c.data) ?? false,
      }));

      const cotasPorFundo = new Map<string, { data: string; valor_cota: number }[]>();
      for (const c of cotasRes.data || []) {
        const arr = cotasPorFundo.get((c as any).fundo_id) || [];
        arr.push({ data: (c as any).data, valor_cota: Number((c as any).valor_cota) });
        cotasPorFundo.set((c as any).fundo_id, arr);
      }

      const movsPorCodigo = new Map<string, any[]>();
      for (const m of movRes.data || []) {
        const arr = movsPorCodigo.get((m as any).codigo_custodia) || [];
        arr.push(m);
        movsPorCodigo.set((m as any).codigo_custodia, arr);
      }

      const prodRows: DailyRow[][] = [];
      const pList: ProductListItem[] = [];

      for (const f of fundos) {
        const fim = f.resgate_total && f.resgate_total < dataCalculo ? f.resgate_total : dataCalculo;
        const rows = calcularFundoDiario({
          dataInicio: f.data_inicio,
          dataCalculo: fim,
          calendario,
          cotas: cotasPorFundo.get(f.fundo_id) || [],
          movimentacoes: (movsPorCodigo.get(f.codigo_custodia) || []).map((m) => ({
            data: m.data,
            tipo: m.tipo_movimentacao,
            valor: Number(m.valor),
            data_cotizacao: m.data_cotizacao,
            qtd_cotas: m.quantidade != null ? Number(m.quantidade) : null,
          })),
          fundo: {
            dias_cotizacao_aplicacao: f.fundo?.dias_cotizacao_aplicacao ?? 0,
            dias_cotizacao_resgate: f.fundo?.dias_cotizacao_resgate ?? 0,
          },
        });

        prodRows.push(fundoRowsToDailyRows(rows));

        const ult = rows.length ? rows[rows.length - 1] : null;
        const encerrado = !!f.resgate_total && f.resgate_total <= dataCalculo;
        pList.push({
          nome: f.nome || f.fundo?.nome_curto || f.produto_nome,
          valorAtualizado: encerrado ? 0 : (ult?.saldoBruto ?? 0),
          ganhoFinanceiro: ult?.ganhoAcumulado ?? 0,
          // Headline do fundo e money-weighted (decisao do vault): o aporte entra
          // na base do dia, entao nao infla o mes em que o dinheiro chegou.
          rentabilidade: (ult?.rentabilidadeAcumuladaMWPct ?? 0) * 100,
          custodiante: f.instituicao_nome,
          ativo: !encerrado,
          estrategia: null,
          emissor_nome: f.fundo?.nome_curto || "—",
          analysisProduct: {
            id: f.id,
            nome: f.nome,
            codigo_custodia: f.codigo_custodia,
            data_inicio: f.data_inicio,
            data_calculo: f.data_calculo,
            data_limite: null,
            valor_investido: f.valor_investido,
            taxa: null,
            indexador: f.fundo?.benchmark ?? null,
            vencimento: null,
            modalidade: "Fundo",
            categoria_nome: f.categoria_nome,
            produto_nome: f.produto_nome,
            instituicao_nome: f.instituicao_nome,
            resgate_total: f.resgate_total,
            preco_unitario: ult?.valorCota ?? null,
            pagamento: null,
          } as any,
        });
      }

      const result = calcularCarteiraRendaFixa({ productRows: prodRows, calendario, dataInicio, dataCalculo });

      setAllProductRows(prodRows);
      setProductList(pList);
      setCarteiraRows(result);
      setCdiRecords(mergedCdi);
      setCalendario(calendario);
      _fundosCachedVersion = appliedVersion;
      _fundosCached = { carteiraInfo: info, carteiraRows: result, allProductRows: prodRows, productList: pList, cdiRecords: mergedCdi, calendario };
      setLoading(false);
    })();
  }, [user, appliedVersion]);

  return { carteiraInfo, carteiraRows, allProductRows, productList, cdiRecords, calendario, loading };
}
