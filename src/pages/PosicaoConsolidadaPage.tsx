import { useEffect, useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularRendaFixaDiario, type DailyRow } from "@/lib/rendaFixaEngine";
import { calcularCarteiraRendaFixa } from "@/lib/carteiraRendaFixaEngine";
import { calcularPoupancaDiario, type PoupancaLote, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";

import { fullSyncAfterDelete } from "@/lib/syncEngine";
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
  codigo_custodia: number;
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
        .select("id, codigo_custodia, nome, data_inicio, data_calculo, taxa, modalidade, multiplicador, preco_unitario, valor_investido, resgate_total, pagamento, vencimento, indexador, data_limite, quantidade, categoria_id, produto_id, instituicao_id, emissor_id, categorias(nome), produtos(nome), instituicoes(nome), emissores(nome)")
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
      }));

      const rfProducts = mapped.filter((p) => p.categoria_nome === "Renda Fixa" && p.modalidade !== "Poupança");
      const poupancaProducts = mapped.filter((p) => p.modalidade === "Poupança");
      const otherProducts = mapped.filter((p) => p.categoria_nome !== "Renda Fixa" && p.modalidade !== "Poupança");

      const allCalcProducts = [...rfProducts, ...poupancaProducts];
      const minDate = allCalcProducts.reduce((min, p) => (p.data_inicio < min ? p.data_inicio : min), allCalcProducts[0]?.data_inicio || dataReferenciaISO);
      const maxDate = allCalcProducts.reduce((max, p) => {
        const end = p.resgate_total || p.vencimento || dataReferenciaISO;
        return end > max ? end : max;
      }, dataReferenciaISO);

      const allCodigos = allCalcProducts.map((p) => p.codigo_custodia);
      const poupancaCodigos = poupancaProducts.map((p) => p.codigo_custodia);

      const [calRes, cdiRes, movRes, selicRes, lotesRes, trRes, poupRendRes] = await Promise.all([
        supabase.from("calendario_dias_uteis").select("data, dia_util").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data"),
        supabase.from("historico_cdi").select("data, taxa_anual").gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data"),
        allCodigos.length > 0
          ? supabase.from("movimentacoes").select("data, tipo_movimentacao, valor, codigo_custodia").in("codigo_custodia", allCodigos).eq("user_id", user!.id).order("data")
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

      const movByCodigo = new Map<number, { data: string; tipo_movimentacao: string; valor: number }[]>();
      for (const m of ((movRes as any).data || [])) {
        const code = m.codigo_custodia as number;
        if (!movByCodigo.has(code)) movByCodigo.set(code, []);
        movByCodigo.get(code)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
      }

      // lotes are now derived from movimentações to avoid double-counting resgates

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
          dataLimite: product.data_limite,
          precomputedCdiMap: cdiMap,
          calendarioSorted: true,
        });

        allProductRows.push(engineRows);

        const lastRow = engineRows.length > 0 ? engineRows[engineRows.length - 1] : null;
        if (lastRow) {
          const usePeriodic = product.pagamento && product.pagamento !== "No Vencimento";
          const rentPct = usePeriodic ? lastRow.rentAcumulada2 : lastRow.rentabilidadeAcumuladaPct;
          posicaoRows.push({
            nome: product.nome || product.produto_nome,
            valorAtualizado: isEncerrado ? 0 : lastRow.liquido,
            ganhoFinanceiro: lastRow.ganhoAcumulado,
            rentabilidade: (rentPct ?? 0) * 100,
            custodiante: product.instituicao_nome,
            ativo: !isEncerrado,
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
      <h1 className="text-2xl font-bold text-foreground">Posição Consolidada</h1>

      <div className="flex items-center gap-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar ativo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">
          Data de referência:{" "}
          <span className="font-medium text-foreground">
            {new Date(dataReferenciaISO + "T12:00:00").toLocaleDateString("pt-BR")}
          </span>
        </span>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando posição...</p>}
      {!loading && filteredRows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum ativo encontrado.</p>}

      {!loading && filteredRows.length > 0 && (
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
                <TableHead className="min-w-[110px] text-right">% do Portfólio</TableHead>
                <TableHead className="min-w-[180px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
                    <TableCell className="font-medium">{row.nome}</TableCell>
                    <TableCell>{fmtBrl(row.valorAtualizado)}</TableCell>
                    <TableCell>{fmtBrl(row.ganhoFinanceiro)}</TableCell>
                    <TableCell>{row.rentabilidade.toFixed(2)}%</TableCell>
                    <TableCell>{row.custodiante}</TableCell>
                    <TableCell className="text-right font-medium">{pctPortfolio.toFixed(2)}%</TableCell>
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
                <TableCell>Total</TableCell>
                <TableCell>{fmtBrl(totalValor)}</TableCell>
                <TableCell>{fmtBrl(totalGanho)}</TableCell>
                <TableCell>{carteiraRentabilidade.toFixed(2)}%</TableCell>
                <TableCell />
                <TableCell className="text-right">100,00%</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

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
