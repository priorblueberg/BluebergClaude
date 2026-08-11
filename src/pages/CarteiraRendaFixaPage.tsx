import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularRendaFixaDiario, DailyRow } from "@/lib/rendaFixaEngine";
import { calcularCarteiraRendaFixa, CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import { calcularPoupancaDiario, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";
import { buildCdiSeries, CdiRecord } from "@/lib/cdiCalculations";
import { buildDetailRowsFromEngine } from "@/lib/detailRowsBuilder";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import { ProductDetail, type CustodiaProduct as AnalysisCustodiaProduct } from "@/pages/AnaliseIndividualPage";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CircleCheck, CircleX } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";


interface CarteiraInfo {
  nome_carteira: string;
  status: string;
  data_inicio: string | null;
  data_calculo: string | null;
  data_limite: string | null;
  resgate_total: string | null;
}

interface CustodiaProduct {
  id: string;
  codigo_custodia: number;
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

const PIE_COLORS = [
  "hsl(210, 100%, 45%)",
  "hsl(150, 60%, 40%)",
  "hsl(30, 90%, 50%)",
  "hsl(270, 60%, 50%)",
  "hsl(0, 70%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(330, 70%, 50%)",
  "hsl(60, 70%, 45%)",
  "hsl(120, 50%, 35%)",
  "hsl(240, 50%, 55%)",
];

const CustomTooltipChart = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <p className="text-foreground font-medium mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color }} className="font-semibold">
            {entry.name}: {entry.value?.toFixed(2)}%
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const PieTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <p className="text-foreground font-medium">{payload[0].name}</p>
        <p className="font-semibold text-foreground">{payload[0].value.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
};

function getDateMinus(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}


// Module-level cache
let _cartRFCachedVersion: number | null = null;
let _cartRFCached: { carteiraInfo: CarteiraInfo | null; carteiraRows: CarteiraRFRow[]; allProductRows: DailyRow[][]; cdiRecords: CdiRecord[]; ibovespaData: { data: string; pontos: number }[]; productList: any[]; allCustodiaForCategoria: any[] } | null = null;

export default function CarteiraRendaFixaPage() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_cartRFCached?.carteiraInfo ?? null);
  const [carteiraRows, setCarteiraRows] = useState<CarteiraRFRow[]>(_cartRFCached?.carteiraRows ?? []);
  const [allProductRows, setAllProductRows] = useState<DailyRow[][]>(_cartRFCached?.allProductRows ?? []);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>(_cartRFCached?.cdiRecords ?? []);
  const [ibovespaData, setIbovespaData] = useState<{ data: string; pontos: number }[]>(_cartRFCached?.ibovespaData ?? []);
  const [loading, setLoading] = useState(_cartRFCachedVersion === null);
  const [productList, setProductList] = useState<{ nome: string; valorAtualizado: number; ganhoFinanceiro: number; rentabilidade: number; custodiante: string; ativo: boolean; estrategia: string | null; emissor_nome: string; analysisProduct: AnalysisCustodiaProduct }[]>(_cartRFCached?.productList ?? []);
  const [allCustodiaForCategoria, setAllCustodiaForCategoria] = useState<{ categoria_nome: string; valor_investido: number; custodia_no_dia: number | null }[]>(_cartRFCached?.allCustodiaForCategoria ?? []);
  const [selectedProduct, setSelectedProduct] = useState<AnalysisCustodiaProduct | null>(null);
  const [seriesVisibility, setSeriesVisibility] = useState({ cdi: true, ibovespa: false });

  useEffect(() => {
    if (!user) return;
    if (_cartRFCachedVersion === appliedVersion) return;
    (async () => {
      setLoading(true);
      const [{ data: cartData }, { data: custodiaData }] = await Promise.all([
        supabase
          .from("controle_de_carteiras")
          .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
          .eq("nome_carteira", "Renda Fixa")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("custodia")
          .select("id, codigo_custodia, nome, data_inicio, data_calculo, data_limite, taxa, modalidade, preco_unitario, resgate_total, pagamento, vencimento, indexador, valor_investido, estrategia, categorias(nome), produtos(nome), instituicoes(nome), emissores(nome)")
          .eq("user_id", user.id),
      ]);

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

      const maxEndDate = rfProducts.reduce((max, p) => {
        const end = p.resgate_total || p.vencimento || dataCalculo;
        return end > max ? end : max;
      }, dataCalculo);

      const poupancaProds = rfProducts.filter(p => p.modalidade === "Poupança");
      const poupancaCodigos = poupancaProds.map(p => p.codigo_custodia);

      const [calRes, cdiRes, ibovRes, selicRes, trRes, poupRendRes] = await Promise.all([
        supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data"),
        supabase.from("historico_cdi").select("data, taxa_anual")
          .gte("data", dataInicio).lte("data", dataCalculo).order("data"),
        supabase.from("historico_ibovespa").select("data, pontos")
          .gte("data", dataInicio).lte("data", dataCalculo).order("data"),
        poupancaCodigos.length > 0
          ? supabase.from("historico_selic").select("data, taxa_anual").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data")
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? supabase.from("historico_tr").select("data, taxa_mensal").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data")
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? supabase.from("historico_poupanca_rendimento").select("data, rendimento_mensal").gte("data", getDateMinus(dataInicio, 5)).lte("data", maxEndDate).order("data")
          : Promise.resolve({ data: [] }),
      ]);

      const calendario = (calRes.data || []).map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
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
      const { data: allMovData } = await supabase
        .from("movimentacoes")
        .select("data, tipo_movimentacao, valor, codigo_custodia")
        .in("codigo_custodia", allCodigos)
        .eq("user_id", user!.id)
        .order("data");

      const movByCodigo = new Map<number, { data: string; tipo_movimentacao: string; valor: number }[]>();
      for (const m of (allMovData || [])) {
        const code = m.codigo_custodia as number;
        if (!movByCodigo.has(code)) movByCodigo.set(code, []);
        movByCodigo.get(code)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
      }

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
        const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
        const isEncerradoNaDataCalculo = product.resgate_total
          ? product.resgate_total <= dataCalculo
          : product.vencimento
            ? product.vencimento <= dataCalculo
            : false;
        const usePeriodic = product.pagamento && product.pagamento !== "No Vencimento";
        const rentPct = lastRow ? ((usePeriodic ? lastRow.rentAcumulada2 : lastRow.rentabilidadeAcumuladaPct) * 100) : 0;
        return {
          nome: product.nome || product.produto_nome,
          valorAtualizado: isEncerradoNaDataCalculo ? 0 : (lastRow?.liquido ?? 0),
          ganhoFinanceiro: lastRow?.ganhoAcumulado ?? 0,
          rentabilidade: rentPct,
          custodiante: product.instituicao_nome,
          ativo: !isEncerradoNaDataCalculo,
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
      _cartRFCached = { carteiraInfo: info, carteiraRows: result, allProductRows: allProdRows, cdiRecords: mergedCdi, ibovespaData: ibovRaw, productList: pList, allCustodiaForCategoria: (custodiaData || []).filter((r: any) => !r.resgate_total).map((r: any) => ({ categoria_nome: r.categorias?.nome || "Outros", valor_investido: Number(r.valor_investido), custodia_no_dia: r.custodia_no_dia != null ? Number(r.custodia_no_dia) : null })) };
      setLoading(false);
    })();
  }, [user, appliedVersion]);

  // Chart: Rentabilidade vs CDI vs Ibovespa
  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio || carteiraRows.length === 0) return [];

    const cdiSeries = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);

    const enginePoints = carteiraRows
      .filter(r => r.liquido > 0 || r.liquido2 > 0)
      .map(r => ({
        data: r.data,
        label: new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR"),
        titulo_acumulado: parseFloat((r.rentAcumuladaPct * 100).toFixed(4)),
      }));

    // Build Ibovespa accumulated series
    const ibovMap = new Map<string, number>();
    if (ibovespaData.length > 0) {
      const basePoints = ibovespaData[0].pontos;
      for (const item of ibovespaData) {
        ibovMap.set(item.data, parseFloat(((item.pontos / basePoints - 1) * 100).toFixed(4)));
      }
    }

    const map = new Map<string, any>();
    for (const p of cdiSeries) {
      map.set(p.data, { data: p.data, label: p.label, cdi_acumulado: p.cdi_acumulado });
    }
    for (const p of enginePoints) {
      const existing = map.get(p.data) || { data: p.data, label: p.label };
      existing.titulo_acumulado = p.titulo_acumulado;
      existing.label = existing.label || p.label;
      map.set(p.data, existing);
    }
    for (const [data, value] of ibovMap) {
      const existing = map.get(data) || { data, label: new Date(data + "T00:00:00").toLocaleDateString("pt-BR") };
      existing.ibovespa_acumulado = value;
      map.set(data, existing);
    }
    return Array.from(map.values()).sort((a: any, b: any) => a.data.localeCompare(b.data));
  }, [carteiraRows, cdiRecords, carteiraInfo, ibovespaData]);

  const detailRows = useMemo(() => {
    if (allProductRows.length === 0 || !carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo) return [];

    const dateMap = new Map<string, {
      data: string; diaUtil: boolean; liquido: number; aplicacoes: number;
      resgates: number; jurosPago: number; saldoCotas: number;
      ganhoAcumulado: number; ganhoDiario: number; rentabilidadeDiaria: number | null;
    }>();

    for (const prodRows of allProductRows) {
      for (const row of prodRows) {
        if (row.data < carteiraInfo.data_inicio! || row.data > carteiraInfo.data_calculo!) continue;
        const existing = dateMap.get(row.data);
        if (existing) {
          existing.liquido += row.liquido;
          existing.aplicacoes += row.aplicacoes;
          existing.resgates += row.resgates;
          existing.jurosPago += row.jurosPago;
          existing.saldoCotas += row.saldoCotas;
          existing.ganhoDiario += row.ganhoDiario;
        } else {
          dateMap.set(row.data, {
            data: row.data,
            diaUtil: row.diaUtil,
            liquido: row.liquido,
            aplicacoes: row.aplicacoes,
            resgates: row.resgates,
            jurosPago: row.jurosPago,
            saldoCotas: row.saldoCotas,
            ganhoAcumulado: 0,
            ganhoDiario: row.ganhoDiario,
            rentabilidadeDiaria: null,
          });
        }
      }
    }

    const merged = Array.from(dateMap.values()).sort((a, b) => a.data.localeCompare(b.data));
    const carteiraMap = new Map<string, CarteiraRFRow>();
    carteiraRows.forEach(r => carteiraMap.set(r.data, r));

    let ganhoAcum = 0;
    for (const row of merged) {
      ganhoAcum += row.ganhoDiario;
      row.ganhoAcumulado = ganhoAcum;
      const cr = carteiraMap.get(row.data);
      row.rentabilidadeDiaria = cr ? cr.rentDiariaPct : null;
    }

    return buildDetailRowsFromEngine(merged, cdiRecords, carteiraInfo.data_inicio!);
  }, [allProductRows, carteiraRows, cdiRecords, carteiraInfo]);

  // Allocation charts data
  const allocationData = useMemo(() => {
    const activeProducts = productList.filter(p => p.ativo && p.valorAtualizado > 0);
    const total = activeProducts.reduce((sum, p) => sum + p.valorAtualizado, 0);
    if (total === 0) return { estrategia: [], custodiante: [], emissor: [] };

    const groupBy = (key: (p: typeof activeProducts[0]) => string) => {
      const map = new Map<string, number>();
      for (const p of activeProducts) {
        const k = key(p) || "Não definido";
        map.set(k, (map.get(k) || 0) + p.valorAtualizado);
      }
      return Array.from(map.entries()).map(([name, value]) => ({
        name,
        value: parseFloat(((value / total) * 100).toFixed(1)),
      }));
    };

    return {
      estrategia: groupBy(p => p.estrategia || "Não definida"),
      custodiante: groupBy(p => p.custodiante),
      emissor: groupBy(p => p.emissor_nome),
    };
  }, [productList]);

  // Category allocation (RF vs other categories)
  const categoriaAllocation = useMemo(() => {
    // Use productList for RF value (calculated), allCustodiaForCategoria for other categories
    const rfTotal = productList.filter(p => p.ativo && p.valorAtualizado > 0).reduce((s, p) => s + p.valorAtualizado, 0);
    const otherMap = new Map<string, number>();
    for (const c of allCustodiaForCategoria) {
      if (c.categoria_nome === "Renda Fixa") continue;
      const val = c.custodia_no_dia != null ? c.custodia_no_dia : c.valor_investido;
      otherMap.set(c.categoria_nome, (otherMap.get(c.categoria_nome) || 0) + val);
    }
    const entries: [string, number][] = [];
    if (rfTotal > 0) entries.push(["Renda Fixa", rfTotal]);
    for (const [k, v] of otherMap) entries.push([k, v]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return [];
    return entries.map(([name, value]) => ({
      name,
      value: parseFloat(((value / total) * 100).toFixed(1)),
    }));
  }, [productList, allCustodiaForCategoria]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const showContent = carteiraInfo && (carteiraInfo.status === "Ativa" || carteiraInfo.status === "Encerrada") && carteiraRows.length > 0;

  const fmtBrl = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const statusBadge = carteiraInfo ? (
    carteiraInfo.status === "Ativa" ? (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Ativa</Badge>
    ) : carteiraInfo.status === "Encerrada" ? (
      <Badge variant="destructive">Encerrada</Badge>
    ) : (
      <Badge variant="secondary">Não Iniciada</Badge>
    )
  ) : null;

  if (selectedProduct) {
    return (
      <ProductDetail
        product={selectedProduct}
        onBack={() => setSelectedProduct(null)}
        backLabel="Voltar para Carteira de Renda Fixa"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Renda Fixa</h1>
        {carteiraInfo && (
          carteiraInfo.status === "Não Iniciada" ? (
            <p className="text-sm text-muted-foreground mt-1">
              Data selecionada anterior ao início dos seus investimentos em Renda Fixa
            </p>
          ) : (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-muted-foreground">
                Período de Análise: De {fmtDate(carteiraInfo.data_inicio)} a {fmtDate(carteiraInfo.data_calculo)}
              </p>
              {statusBadge}
            </div>
          )
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      ) : !showContent ? (
        <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
          Nenhum dado disponível para o período selecionado.
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {(() => {
            let patrimonioValue: number | null = null;
            let rentValue: number | null = null;
            let ganhoValue: number | null = null;

            for (let i = carteiraRows.length - 1; i >= 0; i--) {
              if (carteiraRows[i].data <= dataReferenciaISO) {
                patrimonioValue = carteiraRows[i].liquido;
                rentValue = parseFloat((carteiraRows[i].rentAcumuladaPct * 100).toFixed(2));
                ganhoValue = carteiraRows[i].rentAcumuladaRS;
                break;
              }
            }

            const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
            const fmtPct = (v: number | null) =>
              v != null ? `${v.toFixed(2)}%` : "—";

            const cards = [
              { label: "Patrimônio", value: fmtBrl(patrimonioValue) },
              { label: "Ganho Financeiro", value: fmtBrl(ganhoValue) },
              { label: "Rentabilidade", value: fmtPct(rentValue) },
              { label: "CDI Acumulado", value: fmtPct(cdiAcum) },
            ];

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {cards.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                    <p className="text-lg font-semibold text-foreground">{c.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-md border border-border bg-card p-6">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Variação acumulada (%) no período</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={seriesVisibility.cdi}
                      onCheckedChange={(v) => setSeriesVisibility(prev => ({ ...prev, cdi: v }))}
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                    />
                    CDI
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={seriesVisibility.ibovespa}
                      onCheckedChange={(v) => setSeriesVisibility(prev => ({ ...prev, ibovespa: v }))}
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                    />
                    Ibovespa
                  </label>
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<CustomTooltipChart />} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="titulo_acumulado" name="Carteira RF" stroke="hsl(210, 100%, 45%)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
                    {seriesVisibility.cdi && (
                      <Line type="monotone" dataKey="cdi_acumulado" name="CDI" stroke="hsl(0, 0%, 55%)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} strokeDasharray="5 3" connectNulls />
                    )}
                    {seriesVisibility.ibovespa && (
                      <Line type="monotone" dataKey="ibovespa_acumulado" name="Ibovespa" stroke="hsl(30, 90%, 50%)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} strokeDasharray="3 2" connectNulls />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-md border border-border bg-card p-6">
              <h2 className="text-sm font-semibold text-foreground">Patrimônio Mensal</h2>
              <p className="mt-1 text-xs text-muted-foreground">Evolução do patrimônio por mês (R$)</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(() => {
                    const MONTH_LABELS = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
                    const barData: { mes: string; patrimonio: number }[] = [];
                    const chronRows = [...detailRows].reverse();
                    for (const row of chronRows) {
                      for (let m = 0; m < 12; m++) {
                        if (row.patrimonioMonths[m] !== null) {
                          barData.push({ mes: `${MONTH_LABELS[m]}/${String(row.year).slice(2)}`, patrimonio: row.patrimonioMonths[m]! });
                        }
                      }
                    }
                    return barData;
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} tickFormatter={(v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
                    <Tooltip formatter={(value: number) => [value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "Patrimônio"]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }} />
                    <Bar dataKey="patrimonio" name="Patrimônio" fill="hsl(210, 100%, 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Detail Table */}
          <RentabilidadeDetailTable rows={detailRows} tituloLabel="Rentabilidade" />

          {/* Allocation Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Alocação por Estratégia", data: allocationData.estrategia },
              { title: "Alocação por Custodiante", data: allocationData.custodiante },
              { title: "Alocação por Emissor", data: allocationData.emissor },
              { title: "Alocação por Categoria", data: categoriaAllocation },
            ].map((chart) => (
              <div key={chart.title} className="rounded-md border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-foreground mb-2">{chart.title}</h3>
                {chart.data.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    Sem títulos de Renda Fixa em custódia para cálculo de alocação
                  </p>
                ) : (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chart.data}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          innerRadius={30}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${value}%`}
                          labelLine={{ strokeWidth: 0.5 }}
                          style={{ fontSize: 9 }}
                        >
                          {chart.data.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Posição Consolidada */}
          {productList.length > 0 && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Posição Consolidada</h2>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[50px]">Status</TableHead>
                      <TableHead className="min-w-[250px]">Ativo</TableHead>
                      <TableHead className="min-w-[130px]">Valor Atualizado</TableHead>
                      <TableHead className="min-w-[130px]">Ganho Financeiro</TableHead>
                      <TableHead className="min-w-[110px]">Rentabilidade</TableHead>
                      <TableHead className="min-w-[150px]">Custodiante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productList.map((row, i) => (
                      <TableRow key={i} className="cursor-pointer hover:bg-accent/50" onClick={() => setSelectedProduct(row.analysisProduct)}>
                        <TableCell>
                          <Badge
                            variant={row.ativo ? "default" : "secondary"}
                            className={row.ativo ? "bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-2 py-0.5" : "bg-muted text-muted-foreground text-[10px] px-2 py-0.5"}
                          >
                            {row.ativo ? "Em custódia" : "Liquidado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-foreground">{row.nome}</TableCell>
                        <TableCell className="text-foreground">{fmtBrl(row.valorAtualizado)}</TableCell>
                        <TableCell className="text-foreground">{fmtBrl(row.ganhoFinanceiro)}</TableCell>
                        <TableCell className="text-foreground">{row.rentabilidade.toFixed(2)}%</TableCell>
                        <TableCell className="text-foreground">{row.custodiante}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
