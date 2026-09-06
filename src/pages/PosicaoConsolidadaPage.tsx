import { useEffect, useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularRendaFixaDiario, type DailyRow } from "@/lib/rendaFixaEngine";
import { carregarSeriesIpca, fatoresIpcaDoTitulo, algumIndexadoAoIpca, type SeriesIpca } from "@/lib/ipcaSeries";
import { calcularCarteiraRendaFixa } from "@/lib/carteiraRendaFixaEngine";
import { calcularFundoDiario, fundoRowsToDailyRows } from "@/lib/fundoEngine";
import { calcularCambioDiario, cambioRowsToDailyRows } from "@/lib/cambioEngine";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcularPoupancaDiario, type PoupancaLote, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";

import { fullSyncAfterDelete } from "@/lib/syncEngine";
import { situacaoDaPosicao } from "@/lib/situacaoDaPosicao";
import { PaginaCabecalho, BarraDeFiltros, Contagem, TabelaCartao, LinhaMensagem } from "@/components/PaginaPadrao";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BoletaCustodiaDialog, { type CustodiaRowForBoleta } from "@/components/BoletaCustodiaDialog";
import PosicaoDetalheDialog, { type PosicaoDetalheData } from "@/components/PosicaoDetalheDialog";

interface CustodiaProduct {
  id: string;
  codigo_custodia: string;
  nome: string | null;
  data_inicio: string;
  data_calculo: string | null;
  taxa: number | null;
  modalidade: string | null;
  multiplicador: string | null;
  preco_unitario: number | null;
  categoria_nome: string;
  categoria_id: string;
  produto_nome: string;
  produto_id: string;
  resgate_total: string | null;
  pagamento: string | null;
  vencimento: string | null;
  indexador: string | null;
  data_limite: string | null;
  valor_investido: number;
  instituicao_nome: string;
  instituicao_id: string | null;
  emissor_nome: string | null;
  emissor_id: string | null;
  quantidade: number | null;
  fundo_id?: string | null;
  moeda?: string | null;
  fundoCfg?: { dias_cotizacao_aplicacao: number | null; dias_cotizacao_resgate: number | null } | null;
}

interface PosicaoRow {
  nome: string;
  valorAtualizado: number;
  ganhoFinanceiro: number;
  rentabilidade: number;
  custodiante: string;
  ativo: boolean;
  product: CustodiaProduct;
}

// Module-level cache to persist across navigation
let _cachedVersion: number | null = null;
let _cachedRows: PosicaoRow[] = [];
let _cachedRentabilidade = 0;

export default function PosicaoConsolidadaPage() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const [rows, setRows] = useState<PosicaoRow[]>(_cachedRows);
  const [carteiraRentabilidade, setCarteiraRentabilidade] = useState(_cachedRentabilidade);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTipo, setDialogTipo] = useState<"Aplicação" | "Resgate">("Aplicação");
  const [dialogRow, setDialogRow] = useState<CustodiaRowForBoleta | null>(null);
  const [deleteRow, setDeleteRow] = useState<PosicaoRow | null>(null);
  const [detalheRow, setDetalheRow] = useState<PosicaoRow | null>(null);

  useEffect(() => {
    if (!user) return;
    if (_cachedVersion === appliedVersion) return;
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, appliedVersion]);

  async function calculate() {
    setLoading(true);
    try {
      const { data: products } = await supabase
        .from("custodia")
        .select("id, codigo_custodia, nome, data_inicio, data_calculo, taxa, modalidade, multiplicador, preco_unitario, valor_investido, resgate_total, pagamento, vencimento, indexador, data_limite, quantidade, categoria_id, produto_id, instituicao_id, emissor_id, fundo_id, moeda, categorias(nome), produtos(nome), instituicoes(nome), emissores(nome), cadastro_de_fundos(dias_cotizacao_aplicacao, dias_cotizacao_resgate)")
        .eq("user_id", user!.id);

      if (!products || products.length === 0) { setRows([]); _cachedRows = []; _cachedVersion = appliedVersion; setLoading(false); return; }

      const mapped: CustodiaProduct[] = products.map((r: any) => ({
        id: r.id,
        codigo_custodia: r.codigo_custodia,
        nome: r.nome,
        data_inicio: r.data_inicio,
        data_calculo: r.data_calculo,
        taxa: r.taxa,
        modalidade: r.modalidade,
        multiplicador: r.multiplicador,
        preco_unitario: r.preco_unitario,
        categoria_nome: r.categorias?.nome || "",
        categoria_id: r.categoria_id,
        produto_nome: r.produtos?.nome || "",
        produto_id: r.produto_id,
        resgate_total: r.resgate_total,
        pagamento: r.pagamento,
        vencimento: r.vencimento,
        indexador: r.indexador,
        data_limite: r.data_limite,
        valor_investido: Number(r.valor_investido),
        instituicao_nome: r.instituicoes?.nome || "—",
        instituicao_id: r.instituicao_id,
        emissor_nome: r.emissores?.nome || null,
        emissor_id: r.emissor_id,
        quantidade: r.quantidade != null ? Number(r.quantidade) : null,
        fundo_id: r.fundo_id ?? null,
        moeda: r.moeda ?? null,
        fundoCfg: r.cadastro_de_fundos ?? null,
      }));

      const rfProducts = mapped.filter((p) => p.categoria_nome === "Renda Fixa" && p.modalidade !== "Poupança");
      const poupancaProducts = mapped.filter((p) => p.modalidade === "Poupança");
      const fundoProducts = mapped.filter((p) => !!p.fundo_id);
      const moedaProducts = mapped.filter((p) => !!p.moeda);
      const otherProducts = mapped.filter((p) => p.categoria_nome !== "Renda Fixa" && p.modalidade !== "Poupança" && !p.fundo_id && !p.moeda);

      const allCalcProducts = [...rfProducts, ...poupancaProducts, ...fundoProducts, ...moedaProducts];
      const minDate = allCalcProducts.reduce((min, p) => (p.data_inicio < min ? p.data_inicio : min), allCalcProducts[0]?.data_inicio || dataReferenciaISO);
      const maxDate = allCalcProducts.reduce((max, p) => {
        const end = p.resgate_total || p.vencimento || dataReferenciaISO;
        return end > max ? end : max;
      }, dataReferenciaISO);

      const allCodigos = allCalcProducts.map((p) => p.codigo_custodia);
      const poupancaCodigos = poupancaProducts.map((p) => p.codigo_custodia);

      const [calRes, cdiRes, movRes, selicRes, lotesRes, trRes, poupRendRes] = await Promise.all([
        fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data").range(de, ate)).then((data) => ({ data })),
        fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data").range(de, ate)).then((data) => ({ data })),
        allCodigos.length > 0
          ? fetchAllRows((de, ate) => supabase.from("movimentacoes").select("data, data_cotizacao, tipo_movimentacao, valor, quantidade, codigo_custodia").in("codigo_custodia", allCodigos).eq("user_id", user!.id).order("data").range(de, ate)).then((data) => ({ data }))
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? supabase.from("historico_selic").select("data, taxa_anual").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data")
          : Promise.resolve({ data: [] }),
        Promise.resolve({ data: [] }), // lotes now built from movimentações
        poupancaCodigos.length > 0
          ? supabase.from("historico_tr").select("data, taxa_mensal").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data")
          : Promise.resolve({ data: [] }),
        poupancaCodigos.length > 0
          ? supabase.from("historico_poupanca_rendimento").select("data, rendimento_mensal").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data")
          : Promise.resolve({ data: [] }),
      ]);

      const calendario = (calRes.data || []).map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
      const cdiRecords = (cdiRes.data || []).map((c: any) => ({ data: c.data, taxa_anual: Number(c.taxa_anual) }));
      const cdiMap = new Map<string, number>();
      for (const c of cdiRecords) cdiMap.set(c.data, c.taxa_anual);
      const selicRecords = ((selicRes as any).data || []).map((s: any) => ({ data: s.data, taxa_anual: Number(s.taxa_anual) }));
      const trRecords = ((trRes as any).data || []).map((t: any) => ({ data: t.data, taxa_mensal: Number(t.taxa_mensal) }));
      const poupancaRendimentoRecords = ((poupRendRes as any).data || []).map((r: any) => ({ data: r.data, rendimento_mensal: Number(r.rendimento_mensal) }));

      // Series de IPCA so quando ha papel indexado a ele: sao duas leituras a mais.
      const seriesIpca: SeriesIpca | null = algumIndexadoAoIpca(rfProducts as any[])
        ? await carregarSeriesIpca()
        : null;

      const movByCodigo = new Map<string, { data: string; tipo_movimentacao: string; valor: number }[]>();
      const movFundoByCodigo = new Map<string, { data: string; tipo: string; valor: number; data_cotizacao: string | null; qtd_cotas: number | null }[]>();
      for (const m of ((movRes as any).data || [])) {
        const code = m.codigo_custodia as string;
        if (!movByCodigo.has(code)) movByCodigo.set(code, []);
        movByCodigo.get(code)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
        if (!movFundoByCodigo.has(code)) movFundoByCodigo.set(code, []);
        movFundoByCodigo.get(code)!.push({
          data: m.data, tipo: m.tipo_movimentacao, valor: Number(m.valor),
          data_cotizacao: m.data_cotizacao ?? null,
          qtd_cotas: m.quantidade != null ? Number(m.quantidade) : null,
        });
      }

      // Cotas dos fundos do usuario: a posicao do fundo e saldo de cotas x cota do dia.
      const cotasPorFundo = new Map<string, { data: string; valor_cota: number }[]>();
      if (fundoProducts.length > 0) {
        const cotasData = await fetchAllRows((de, ate) => supabase
          .from("cotas_fundos")
          .select("fundo_id, data, valor_cota")
          .in("fundo_id", fundoProducts.map((p) => p.fundo_id!))
          .lte("data", dataReferenciaISO)
          .order("data")
          .range(de, ate));
        for (const c of cotasData) {
          const arr = cotasPorFundo.get((c as any).fundo_id) || [];
          arr.push({ data: (c as any).data, valor_cota: Number((c as any).valor_cota) });
          cotasPorFundo.set((c as any).fundo_id, arr);
        }
      }

      // lotes are now derived from movimentações to avoid double-counting resgates

      // Cotacao das moedas em posicao: o patrimonio e saldo x cotacao do dia.
      const cotacoesPorMoeda = new Map<string, { data: string; cotacao: number }[]>();
      const TABELA_MOEDA: Record<string, string> = { USD: "historico_dolar", EUR: "historico_euro" };
      for (const codigo of new Set(moedaProducts.map((p) => p.moeda!))) {
        const tabela = TABELA_MOEDA[codigo];
        if (!tabela) continue;
        const linhas = await fetchAllRows((de, ate) => supabase
          .from(tabela as any).select("data, cotacao_venda")
          .lte("data", dataReferenciaISO).order("data").range(de, ate));
        cotacoesPorMoeda.set(codigo, (linhas as any[]).map((r) => ({ data: r.data, cotacao: Number(r.cotacao_venda) })));
      }

      const posicaoRows: PosicaoRow[] = [];
      const allProductRows: DailyRow[][] = [];

      for (const product of rfProducts) {
        const dataFim = product.resgate_total || product.vencimento || product.data_calculo || "2099-12-31";
        const isEncerrado = product.resgate_total ? product.resgate_total <= dataReferenciaISO : product.vencimento ? product.vencimento <= dataReferenciaISO : false;
        const calcEnd = dataFim > dataReferenciaISO ? dataReferenciaISO : dataFim;

        const engineRows = calcularRendaFixaDiario({
          dataInicio: product.data_inicio,
          dataCalculo: calcEnd,
          taxa: product.taxa || 0,
          modalidade: product.modalidade || "",
          puInicial: product.preco_unitario || 1000,
          calendario,
          movimentacoes: movByCodigo.get(product.codigo_custodia) || [],
          dataResgateTotal: product.resgate_total,
          pagamento: product.pagamento,
          vencimento: product.vencimento,
          indexador: product.indexador,
          cdiRecords,
          ipcaFatores: fatoresIpcaDoTitulo(seriesIpca, product.indexador, product.vencimento, calendario, product.data_inicio),
          dataLimite: product.data_limite,
          precomputedCdiMap: cdiMap,
          calendarioSorted: true,
        });

        allProductRows.push(engineRows);

        const lastRow = engineRows.length > 0 ? engineRows[engineRows.length - 1] : null;
        if (lastRow) {
          const usePeriodic = product.pagamento && product.pagamento !== "No Vencimento";
          const rentPct = usePeriodic ? lastRow.rentAcumulada2 : lastRow.rentabilidadeAcumuladaPct;
          // "Encerrado" vem do SALDO, nao so do cadastro: `custodia.resgate_total` guarda o
          // vencimento quando o papel foi zerado por um "Resgate" parcial em vez de um
          // "Resgate Total" (`resgateTotalDeMovs` so enxerga o segundo). O bloco de
          // poupanca logo abaixo ja fazia assim.
          const { encerrada: encerrado, valorExibido } = situacaoDaPosicao(lastRow.liquido, isEncerrado);
          posicaoRows.push({
            nome: product.nome || product.produto_nome,
            valorAtualizado: valorExibido,
            ganhoFinanceiro: lastRow.ganhoAcumulado,
            rentabilidade: (rentPct ?? 0) * 100,
            custodiante: product.instituicao_nome,
            ativo: !encerrado,
            product,
          });
        }
      }

      // Poupança products — FIFO (single row) or per-certificate
      for (const product of poupancaProducts) {
        const allMovsForProduct = movByCodigo.get(product.codigo_custodia) || [];
        const lotesForEngine = buildPoupancaLotesFromMovs(allMovsForProduct);

        if (lotesForEngine.length === 0) continue;

        const engineRows = calcularPoupancaDiario({
          dataInicio: lotesForEngine[0].data_aplicacao,
          dataCalculo: dataReferenciaISO,
          calendario,
          movimentacoes: allMovsForProduct,
          lotes: lotesForEngine,
          selicRecords,
          trRecords,
          poupancaRendimentoRecords,
          dataResgateTotal: product.resgate_total,
        });

        {

          allProductRows.push(engineRows);

          const lastRow = engineRows.length > 0 ? engineRows[engineRows.length - 1] : null;
          if (lastRow) {
            const isEncerrado = lastRow.liquido < 0.01;
            posicaoRows.push({
              nome: product.nome || "Poupança",
              valorAtualizado: lastRow.liquido,
              ganhoFinanceiro: lastRow.ganhoAcumulado,
              rentabilidade: lastRow.rentabilidadeAcumuladaPct * 100,
              custodiante: product.instituicao_nome,
              ativo: !isEncerrado,
              product,
            });
          }
        }
      }

      for (const product of fundoProducts) {
        const fim = product.resgate_total && product.resgate_total < dataReferenciaISO
          ? product.resgate_total
          : dataReferenciaISO;
        const rowsFundo = calcularFundoDiario({
          dataInicio: product.data_inicio,
          dataCalculo: fim,
          calendario,
          cotas: cotasPorFundo.get(product.fundo_id!) || [],
          movimentacoes: movFundoByCodigo.get(product.codigo_custodia) || [],
          fundo: {
            dias_cotizacao_aplicacao: product.fundoCfg?.dias_cotizacao_aplicacao ?? 0,
            dias_cotizacao_resgate: product.fundoCfg?.dias_cotizacao_resgate ?? 0,
          },
        });
        if (rowsFundo.length === 0) continue;
        allProductRows.push(fundoRowsToDailyRows(rowsFundo));

        const ult = rowsFundo[rowsFundo.length - 1];
        const { encerrada: encerrado, valorExibido } = situacaoDaPosicao(
          ult.saldoBruto,
          !!product.resgate_total && product.resgate_total <= dataReferenciaISO,
        );
        posicaoRows.push({
          nome: product.nome || product.produto_nome,
          valorAtualizado: valorExibido,
          ganhoFinanceiro: ult.ganhoAcumulado,
          rentabilidade: ult.rentabilidadeAcumuladaMWPct * 100,
          custodiante: product.instituicao_nome,
          ativo: !encerrado,
          product,
        });
      }

      for (const product of moedaProducts) {
        const fim = product.resgate_total && product.resgate_total < dataReferenciaISO
          ? product.resgate_total
          : dataReferenciaISO;
        const rowsMoeda = calcularCambioDiario({
          dataInicio: product.data_inicio,
          dataCalculo: fim,
          calendario,
          cotacoes: cotacoesPorMoeda.get(product.moeda!) || [],
          movimentacoes: (movFundoByCodigo.get(product.codigo_custodia) || []).map((m) => ({
            data: m.data, tipo: m.tipo, valor: m.valor, quantidade: m.qtd_cotas,
          })),
        });
        if (rowsMoeda.length === 0) continue;
        allProductRows.push(cambioRowsToDailyRows(rowsMoeda));

        const ult = rowsMoeda[rowsMoeda.length - 1];
        const { encerrada: encerrado, valorExibido } = situacaoDaPosicao(
          ult.saldoReais,
          !!product.resgate_total && product.resgate_total <= dataReferenciaISO,
        );
        posicaoRows.push({
          nome: product.nome || product.produto_nome,
          valorAtualizado: valorExibido,
          ganhoFinanceiro: ult.ganhoAcumulado,
          rentabilidade: ult.rentabilidadeAcumuladaMWPct * 100,
          custodiante: product.instituicao_nome,
          ativo: !encerrado,
          product,
        });
      }

      for (const product of otherProducts) {
        posicaoRows.push({
          nome: product.nome || product.produto_nome,
          valorAtualizado: product.valor_investido,
          ganhoFinanceiro: 0,
          rentabilidade: 0,
          custodiante: product.instituicao_nome,
          ativo: true,
          product,
        });
      }

      // Compute TWR for total rentabilidade using carteira engine
      if (allProductRows.length > 0) {
        const carteiraRows = calcularCarteiraRendaFixa({
          productRows: allProductRows,
          calendario,
          dataInicio: minDate,
          dataCalculo: dataReferenciaISO,
        });
        const lastCarteira = carteiraRows.length > 0 ? carteiraRows[carteiraRows.length - 1] : null;
        const rentVal = lastCarteira ? lastCarteira.rentAcumuladaPct * 100 : 0;
        setCarteiraRentabilidade(rentVal);
        _cachedRentabilidade = rentVal;
      } else {
        setCarteiraRentabilidade(0);
        _cachedRentabilidade = 0;
      }

      setRows(posicaoRows);
      _cachedRows = posicaoRows;
      _cachedVersion = appliedVersion;
    } catch (err) {
      console.error("Erro ao calcular posição consolidada:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter((r) => r.nome.toLowerCase().includes(term));
  }, [rows, search]);

  const totalValor = useMemo(() => filteredRows.reduce((s, r) => s + r.valorAtualizado, 0), [filteredRows]);
  const totalGanho = useMemo(() => filteredRows.reduce((s, r) => s + r.ganhoFinanceiro, 0), [filteredRows]);

  // Boleta helpers
  function openBoleta(row: PosicaoRow, tipo: "Aplicação" | "Resgate", e: React.MouseEvent) {
    e.stopPropagation();
    const p = row.product;
    setDialogRow({
      id: p.id,
      codigo_custodia: p.codigo_custodia,
      data_inicio: p.data_inicio,
      nome: p.nome,
      categoria: p.categoria_nome,
      categoria_id: p.categoria_id,
      produto: p.produto_nome,
      produto_id: p.produto_id,
      instituicao: p.instituicao_nome,
      instituicao_id: p.instituicao_id,
      emissor: p.emissor_nome,
      emissor_id: p.emissor_id,
      modalidade: p.modalidade,
      indexador: p.indexador,
      taxa: p.taxa,
      pagamento: p.pagamento,
      vencimento: p.vencimento,
      preco_unitario: p.preco_unitario,
      valor_investido: p.valor_investido,
      resgate_total: p.resgate_total,
    });
    setDialogTipo(tipo);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteRow || !user) return;
    const p = deleteRow.product;
    await supabase.from("movimentacoes").delete().eq("codigo_custodia", p.codigo_custodia).eq("user_id", user.id);
    const { error } = await supabase.from("custodia").delete().eq("id", p.id);
    if (error) { toast.error("Erro ao excluir."); } else {
      toast.success("Ativo e movimentações excluídos.");
      setRows((prev) => prev.filter((r) => r.product.id !== p.id));
      await fullSyncAfterDelete(p.codigo_custodia, p.categoria_id, user.id, dataReferenciaISO);
      applyDataReferencia();
    }
    setDeleteRow(null);
  }

  function getDetalheData(row: PosicaoRow): PosicaoDetalheData {
    const p = row.product;
    return {
      nome: row.nome,
      custodiante: row.custodiante,
      valorAtualizado: row.valorAtualizado,
      dataInicio: p.data_inicio,
      codigoCustodia: p.codigo_custodia,
      categoriaId: p.categoria_id,
      indexador: p.indexador,
      taxa: p.taxa,
      modalidade: p.modalidade,
      pagamento: p.pagamento,
      emissor: p.emissor_nome,
      vencimento: p.vencimento,
    };
  }

  return (
    <div className="space-y-6">
      <PaginaCabecalho
        titulo="Posição Consolidada"
        subtitulo={`Ativos em custódia e liquidados em ${new Date(dataReferenciaISO + "T12:00:00").toLocaleDateString("pt-BR")}`}
      />

      <BarraDeFiltros>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar ativo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Contagem>{filteredRows.length} ativos</Contagem>
      </BarraDeFiltros>

      <TabelaCartao>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[50px] text-xs">Status</TableHead>
              <TableHead className="min-w-[250px] text-xs">Ativo</TableHead>
              <TableHead className="min-w-[130px] text-xs">Valor Atualizado</TableHead>
              <TableHead className="min-w-[130px] text-xs">Ganho Financeiro</TableHead>
              <TableHead className="min-w-[110px] text-xs">Rentabilidade</TableHead>
              <TableHead className="min-w-[150px] text-xs">Custodiante</TableHead>
              <TableHead className="min-w-[110px] text-xs text-right">% do Portfólio</TableHead>
              <TableHead className="min-w-[180px] text-xs text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <LinhaMensagem colSpan={8}>Carregando posição...</LinhaMensagem>
            ) : filteredRows.length === 0 ? (
              <LinhaMensagem colSpan={8}>Nenhum ativo encontrado.</LinhaMensagem>
            ) : (
              <>
              {filteredRows.map((row, i) => {
                const pctPortfolio = totalValor > 0 ? (row.valorAtualizado / totalValor) * 100 : 0;
                return (
                  <TableRow key={i} className="cursor-pointer" onClick={() => setDetalheRow(row)}>
                    <TableCell>
                      <Badge
                        variant={row.ativo ? "default" : "secondary"}
                        className={row.ativo ? "bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-2 py-0.5" : "bg-muted text-muted-foreground text-[10px] px-2 py-0.5"}
                      >
                        {row.ativo ? "Em custódia" : "Liquidado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{row.nome}</TableCell>
                    <TableCell className="text-sm">{fmtBrl(row.valorAtualizado)}</TableCell>
                    <TableCell className="text-sm">{fmtBrl(row.ganhoFinanceiro)}</TableCell>
                    <TableCell className="text-sm">{row.rentabilidade.toFixed(2)}%</TableCell>
                    <TableCell className="text-sm">{row.custodiante}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{pctPortfolio.toFixed(2)}%</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2" onClick={(e) => openBoleta(row, "Aplicação", e)}>Aplicação</Button>
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2" onClick={(e) => openBoleta(row, "Resgate", e)}>Resgate</Button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteRow(row); }} className="text-muted-foreground hover:text-destructive transition-colors ml-1" title="Excluir ativo">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell />
                <TableCell className="text-sm">Total</TableCell>
                <TableCell className="text-sm">{fmtBrl(totalValor)}</TableCell>
                <TableCell className="text-sm">{fmtBrl(totalGanho)}</TableCell>
                <TableCell className="text-sm">{carteiraRentabilidade.toFixed(2)}%</TableCell>
                <TableCell />
                <TableCell className="text-sm text-right">100,00%</TableCell>
                <TableCell />
              </TableRow>
              </>
            )}
            </TableBody>
          </Table>
      </TabelaCartao>

      {/* Boleta */}
      {dialogRow && user && (
        <BoletaCustodiaDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          tipo={dialogTipo}
          row={dialogRow}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onSuccess={() => { calculate(); applyDataReferencia(); }}
        />
      )}

      {/* Detalhe */}
      {detalheRow && user && (
        <PosicaoDetalheDialog
          open={!!detalheRow}
          onClose={() => setDetalheRow(null)}
          data={getDetalheData(detalheRow)}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onDataChanged={() => { calculate(); applyDataReferencia(); }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão do ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteRow?.nome}"? Todas as movimentações serão removidas permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function fmtBrl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getDateMinus(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
