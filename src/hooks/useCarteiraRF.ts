/**
 * Carrega e calcula a carteira de Renda Fixa (custódia, motores diário e de
 * carteira, CDI, Ibovespa) uma única vez por data de referência.
 *
 * Estava embutido em CarteiraRendaFixaPage. Foi extraído porque o dashboard de
 * Investimentos (lâmina Total) precisa exatamente dos mesmos números — duplicar
 * o cálculo seria repetir a armadilha das cópias que já divergiram no projeto.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularRendaFixaDiario, DailyRow } from "@/lib/rendaFixaEngine";
import { carregarSeriesIpca, fatoresIpcaDoTitulo, algumIndexadoAoIpca, type SeriesIpca } from "@/lib/ipcaSeries";
import { calcularCarteiraRendaFixa, CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import { calcularPoupancaDiario, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";
import { CdiRecord } from "@/lib/cdiCalculations";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { ateAData } from "@/lib/janelaDaCarteira";
import type { CustodiaProduct as AnalysisCustodiaProduct } from "@/pages/AnaliseIndividualPage";
import { metricasDoProdutoNaJanela } from "@/lib/janelaDoProduto";

export interface CarteiraInfo {
  nome_carteira: string;
  status: string;
  data_inicio: string | null;
  data_calculo: string | null;
  data_limite: string | null;
  resgate_total: string | null;
}

interface CustodiaProduct {
  id: string;
  codigo_custodia: string;
  nome: string | null;
  data_inicio: string;
  data_calculo: string | null;
  taxa: number | null;
  modalidade: string | null;
  preco_unitario: number | null;
  resgate_total: string | null;
  pagamento: string | null;
  vencimento: string | null;
  indexador: string | null;
  data_limite: string | null;
  categoria_nome: string;
  produto_nome: string;
  instituicao_nome: string;
  valor_investido: number;
  estrategia: string | null;
  emissor_nome: string;
}

export interface ProductListItem {
  nome: string;
  valorAtualizado: number;
  /** Ganho DENTRO da janela de análise, não desde a aplicação. */
  ganhoFinanceiro: number;
  /** Rentabilidade DENTRO da janela de análise. */
  rentabilidade: number;
  /** false quando o papel nao teve nenhum dia dentro da janela. Some da lista. */
  existiuNaJanela?: boolean;
  custodiante: string;
  ativo: boolean;
  estrategia: string | null;
  emissor_nome: string;
  analysisProduct: AnalysisCustodiaProduct;
}

export interface CustodiaCategoriaItem {
  categoria_nome: string;
  valor_investido: number;
  custodia_no_dia: number | null;
}

function getDateMinus(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Cache de módulo: as duas páginas que usam o hook compartilham o mesmo
// resultado enquanto a data de referência não muda.
let _cartRFCachedVersion: number | null = null;
let _cartRFCached: {
  carteiraInfo: CarteiraInfo | null;
  carteiraRows: CarteiraRFRow[];
  allProductRows: DailyRow[][];
  cdiRecords: CdiRecord[];
  ibovespaData: { data: string; pontos: number }[];
  productList: ProductListItem[];
  allCustodiaForCategoria: CustodiaCategoriaItem[];
  calendario: { data: string; dia_util: boolean }[];
} | null = null;

export function useCarteiraRF() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_cartRFCached?.carteiraInfo ?? null);
  const [carteiraRows, setCarteiraRows] = useState<CarteiraRFRow[]>(_cartRFCached?.carteiraRows ?? []);
  const [allProductRows, setAllProductRows] = useState<DailyRow[][]>(_cartRFCached?.allProductRows ?? []);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>(_cartRFCached?.cdiRecords ?? []);
  const [ibovespaData, setIbovespaData] = useState<{ data: string; pontos: number }[]>(_cartRFCached?.ibovespaData ?? []);
  const [loading, setLoading] = useState(_cartRFCachedVersion === null);
  const [productList, setProductList] = useState<ProductListItem[]>(_cartRFCached?.productList ?? []);
  const [allCustodiaForCategoria, setAllCustodiaForCategoria] = useState<CustodiaCategoriaItem[]>(_cartRFCached?.allCustodiaForCategoria ?? []);
  // Calendário sai do hook porque o dashboard roda o motor de carteira por grupo
  // (categoria/instituição) para obter a rentabilidade de cada linha.
  const [calendario, setCalendario] = useState<{ data: string; dia_util: boolean }[]>(_cartRFCached?.calendario ?? []);

  useEffect(() => {
    if (!user) return;
    if (_cartRFCachedVersion === appliedVersion) return;
    (async () => {
      setLoading(true);
      const [{ data: todasCarteiras }, { data: custodiaData }] = await Promise.all([
        supabase
          .from("controle_de_carteiras")
          .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
          .eq("user_id", user.id),
        supabase
          .from("custodia")
          .select("id, codigo_custodia, nome, data_inicio, data_calculo, data_limite, taxa, modalidade, preco_unitario, resgate_total, pagamento, vencimento, indexador, valor_investido, estrategia, categorias(nome), produtos(nome), instituicoes(nome), emissores(nome)")
          .eq("user_id", user.id),
      ]);

      const cartData = ateAData(
        (todasCarteiras || []).find((c: any) => c.nome_carteira === "Renda Fixa") as any,
        dataReferenciaISO,
      );

      // Series de mercado: o dashboard consolidado roda sobre a carteira "Investimentos",
      // que comeca ANTES da renda fixa (os fundos nasceram primeiro). Buscar o CDI so a
      // partir do inicio da renda fixa deixava o benchmark consolidado curto - dois dias
      // uteis a menos, 38,16% no lugar de 38,28% do Gorila em 24/08/2026. Quem recorta a
      // janela de cada lamina e o consumidor da serie, nao a busca.
      const dataInicioMercado = (todasCarteiras || [])
        .map((c: any) => c.data_inicio)
        .filter(Boolean)
        .sort()[0] ?? null;

      // Store all custodia for category allocation (active, no resgate_total)
      setAllCustodiaForCategoria((custodiaData || [])
        .filter((r: any) => !r.resgate_total)
        .map((r: any) => ({
          categoria_nome: r.categorias?.nome || "Outros",
          valor_investido: Number(r.valor_investido),
          custodia_no_dia: r.custodia_no_dia != null ? Number(r.custodia_no_dia) : null,
        }))
      );
      const rfProducts: CustodiaProduct[] = (custodiaData || [])
        .filter((r: any) => r.categorias?.nome === "Renda Fixa")
        .map((r: any) => ({
          id: r.id,
          codigo_custodia: r.codigo_custodia,
          nome: r.nome,
          data_inicio: r.data_inicio,
          taxa: r.taxa,
          modalidade: r.modalidade,
          preco_unitario: r.preco_unitario,
          resgate_total: r.resgate_total,
          pagamento: r.pagamento,
          vencimento: r.vencimento,
          indexador: r.indexador,
          data_limite: r.data_limite,
          categoria_nome: r.categorias?.nome || "",
          produto_nome: r.produtos?.nome || "",
          instituicao_nome: r.instituicoes?.nome || "—",
          data_calculo: r.data_calculo,
          valor_investido: Number(r.valor_investido),
          estrategia: r.estrategia || null,
          emissor_nome: r.emissores?.nome || "—",
        }));

      if (rfProducts.length === 0 || !cartData || !cartData.data_inicio || !cartData.data_calculo || cartData.status === "Não Iniciada") {
        setCarteiraInfo(cartData ? {
          nome_carteira: cartData.nome_carteira,
          status: cartData.status,
          data_inicio: cartData.data_inicio,
          data_calculo: cartData.data_calculo,
          data_limite: cartData.data_limite,
          resgate_total: cartData.resgate_total,
        } : null);
        setCarteiraRows([]);
        setAllProductRows([]);
        setCdiRecords([]);
        setIbovespaData([]);
        setProductList([]);
        setCalendario([]);
        setLoading(false);
        _cartRFCachedVersion = appliedVersion;
        return;
      }

      const info: CarteiraInfo = {
        nome_carteira: cartData.nome_carteira,
        status: cartData.status,
        data_inicio: cartData.data_inicio,
        data_calculo: cartData.data_calculo,
        data_limite: cartData.data_limite,
        resgate_total: cartData.resgate_total,
      };
      setCarteiraInfo(info);

      const dataInicio = cartData.data_inicio;
      const dataCalculo = cartData.data_calculo;
      const pisoSeries = dataInicioMercado && dataInicioMercado < dataInicio ? dataInicioMercado : dataInicio;

      const maxEndDate = rfProducts.reduce((max, p) => {
        const end = p.resgate_total || p.vencimento || dataCalculo;
        return end > max ? end : max;
      }, dataCalculo);

      const poupancaProds = rfProducts.filter(p => p.modalidade === "Poupança");
      const poupancaCodigos = poupancaProds.map(p => p.codigo_custodia);

      // Paginado: calendario ate o vencimento mais longo e serie de CDI passam
      // das 1000 linhas por requisicao do PostgREST, que corta em silencio.
      const [calRes, cdiRes, ibovRes, selicRes, trRes, poupRendRes] = await Promise.all([
        fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", getDateMinus(pisoSeries, 5)).lte("data", maxEndDate).order("data").range(de, ate))
          .then((data) => ({ data })),
        fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual")
          .gte("data", pisoSeries).lte("data", dataCalculo).order("data").range(de, ate))
          .then((data) => ({ data })),
        fetchAllRows((de, ate) => supabase.from("historico_ibovespa").select("data, pontos")
          .gte("data", pisoSeries).lte("data", dataCalculo).order("data").range(de, ate))
          .then((data) => ({ data })),
        poupancaCodigos.length > 0
          ? fetchAllRows((de, ate) => supabase.from("historico_selic").select("data, taxa_anual").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data").range(de, ate)).then((data) => ({ data }))
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? fetchAllRows((de, ate) => supabase.from("historico_tr").select("data, taxa_mensal").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data").range(de, ate)).then((data) => ({ data }))
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? fetchAllRows((de, ate) => supabase.from("historico_poupanca_rendimento").select("data, rendimento_mensal").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data").range(de, ate)).then((data) => ({ data }))
          : Promise.resolve({ data: [] }),
      ]);

      const calendario = (calRes.data || []).map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
      setCalendario(calendario);
      const cdiRaw = (cdiRes.data || []).map((c: any) => ({ data: c.data, taxa_anual: Number(c.taxa_anual) }));
      const ibovRaw = (ibovRes.data || []).map((r: any) => ({ data: r.data, pontos: Number(r.pontos) }));
      setIbovespaData(ibovRaw);

      const calMap = new Map<string, boolean>();
      calendario.forEach(c => calMap.set(c.data, c.dia_util));
      const mergedCdi: CdiRecord[] = cdiRaw.map(r => ({
        ...r,
        dia_util: calMap.get(r.data) ?? false,
      }));
      setCdiRecords(mergedCdi);

      const cdiMap = new Map<string, number>();
      for (const c of cdiRaw) cdiMap.set(c.data, c.taxa_anual);

      const selicRecords = ((selicRes as any).data || []).map((s: any) => ({ data: s.data, taxa_anual: Number(s.taxa_anual) }));
      const trRecords = ((trRes as any).data || []).map((t: any) => ({ data: t.data, taxa_mensal: Number(t.taxa_mensal) }));
      const poupancaRendimentoRecords = ((poupRendRes as any).data || []).map((r: any) => ({ data: r.data, rendimento_mensal: Number(r.rendimento_mensal) }));

      const allCodigos = rfProducts.map(p => p.codigo_custodia);
      const allMovData = await fetchAllRows((de, ate) => supabase
        .from("movimentacoes")
        .select("data, tipo_movimentacao, valor, codigo_custodia")
        .in("codigo_custodia", allCodigos)
        .eq("user_id", user!.id)
        .order("data")
        .range(de, ate));

      const movByCodigo = new Map<string, { data: string; tipo_movimentacao: string; valor: number }[]>();
      for (const m of (allMovData || [])) {
        const code = m.codigo_custodia as string;
        if (!movByCodigo.has(code)) movByCodigo.set(code, []);
        movByCodigo.get(code)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
      }

      // Series de IPCA so quando ha papel indexado a ele.
      const seriesIpca: SeriesIpca | null = algumIndexadoAoIpca(rfProducts as any[])
        ? await carregarSeriesIpca()
        : null;

      const allProdRows: DailyRow[][] = [];
      const prodRowProducts: CustodiaProduct[] = []; // parallel array to track which product each row set belongs to

      // Renda Fixa products
      for (const product of rfProducts.filter(p => p.modalidade !== "Poupança")) {
        const dataFim = product.resgate_total || product.vencimento || dataCalculo;
        allProdRows.push(calcularRendaFixaDiario({
          dataInicio: product.data_inicio,
          dataCalculo: dataFim > dataCalculo ? dataCalculo : dataFim,
          taxa: product.taxa || 0,
          modalidade: product.modalidade || "",
          puInicial: product.preco_unitario || 1000,
          calendario,
          movimentacoes: movByCodigo.get(product.codigo_custodia) || [],
          dataResgateTotal: product.resgate_total,
          pagamento: product.pagamento,
          vencimento: product.vencimento,
          indexador: product.indexador,
          cdiRecords: cdiRaw,
          ipcaFatores: fatoresIpcaDoTitulo(seriesIpca, product.indexador, product.vencimento, calendario, product.data_inicio),
          dataLimite: product.data_limite,
          precomputedCdiMap: cdiMap,
          calendarioSorted: true,
        }));
        prodRowProducts.push(product);
      }

      // Poupança products
      for (const product of poupancaProds) {
        const allMovsForProduct = movByCodigo.get(product.codigo_custodia) || [];
        const lotesForEngine = buildPoupancaLotesFromMovs(allMovsForProduct);
        if (lotesForEngine.length === 0) continue;

        allProdRows.push(calcularPoupancaDiario({
          dataInicio: lotesForEngine[0].data_aplicacao,
          dataCalculo: dataCalculo,
          calendario,
          movimentacoes: allMovsForProduct,
          lotes: lotesForEngine,
          selicRecords,
          trRecords,
          poupancaRendimentoRecords,
          dataResgateTotal: product.resgate_total,
        }));
        prodRowProducts.push(product);
      }

      setAllProductRows(allProdRows);

      const pList = prodRowProducts.map((product, idx) => {
        const rows = allProdRows[idx];
        const isEncerradoNaDataCalculo = product.resgate_total
          ? product.resgate_total <= dataCalculo
          : product.vencimento
            ? product.vencimento <= dataCalculo
            : false;
        // Ganho e rentabilidade DA JANELA, pela mesma conta do card e dos grupos.
        const m = metricasDoProdutoNaJanela(rows, calendario, dataInicio, dataCalculo);
        // "Encerrado" vem do SALDO calculado, nao so do cadastro. `custodia.resgate_total`
        // guarda o vencimento quando o papel foi zerado por uma movimentacao do tipo
        // "Resgate" (parcial que zerou) em vez de "Resgate Total" - `resgateTotalDeMovs` so
        // enxerga a segunda. Quatro CDBs apareciam como "Em custodia" com valor R$ 0,00.
        const encerrado = isEncerradoNaDataCalculo || (m.existiuNaJanela && m.patrimonio <= 0.005);
        return {
          nome: product.nome || product.produto_nome,
          valorAtualizado: encerrado ? 0 : m.patrimonio,
          ganhoFinanceiro: m.ganho,
          rentabilidade: m.rentabilidade,
          existiuNaJanela: m.existiuNaJanela,
          custodiante: product.instituicao_nome,
          ativo: !encerrado,
          estrategia: product.estrategia,
          emissor_nome: product.emissor_nome,
          analysisProduct: {
            id: product.id,
            nome: product.nome,
            codigo_custodia: product.codigo_custodia,
            data_inicio: product.data_inicio,
            data_calculo: product.data_calculo,
            data_limite: product.data_limite,
            valor_investido: product.valor_investido,
            taxa: product.taxa,
            indexador: product.indexador,
            vencimento: product.vencimento,
            modalidade: product.modalidade,
            categoria_nome: product.categoria_nome,
            produto_nome: product.produto_nome,
            instituicao_nome: product.instituicao_nome,
            resgate_total: product.resgate_total,
            preco_unitario: product.preco_unitario,
            pagamento: product.pagamento,
          } as AnalysisCustodiaProduct,
        };
      });
      setProductList(pList);

      const result = calcularCarteiraRendaFixa({
        productRows: allProdRows,
        calendario,
        dataInicio,
        dataCalculo,
      });

      setCarteiraRows(result);
      _cartRFCachedVersion = appliedVersion;
      _cartRFCached = { carteiraInfo: info, carteiraRows: result, allProductRows: allProdRows, cdiRecords: mergedCdi, ibovespaData: ibovRaw, productList: pList, allCustodiaForCategoria: (custodiaData || []).filter((r: any) => !r.resgate_total).map((r: any) => ({ categoria_nome: r.categorias?.nome || "Outros", valor_investido: Number(r.valor_investido), custodia_no_dia: r.custodia_no_dia != null ? Number(r.custodia_no_dia) : null })), calendario };
      setLoading(false);
    })();
  }, [user, appliedVersion]);

  return {
    carteiraInfo,
    carteiraRows,
    allProductRows,
    cdiRecords,
    ibovespaData,
    productList,
    allCustodiaForCategoria,
    calendario,
    loading,
  };
}
