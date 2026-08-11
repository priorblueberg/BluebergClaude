import { useEffect, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useAuth } from "@/hooks/useAuth";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";
import { calcularPoupancaDiario, type PoupancaLote, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ProventoRow {
  data: string;
  nome: string;
  tipo: string;
  valor: number;
}

type SortField = keyof ProventoRow;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortField; label: string }[] = [
  { key: "data", label: "Data" },
  { key: "nome", label: "Nome" },
  { key: "tipo", label: "Tipo" },
  { key: "valor", label: "Valor Recebido" },
];

function getDateMinus(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function ProventosRecebidosPage() {
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const { user } = useAuth();
  const [rows, setRows] = useState<ProventoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);

      // Load all custodia products for this user
      const { data: custodias } = await supabase
        .from("custodia")
        .select("codigo_custodia, nome, data_inicio, data_calculo, taxa, modalidade, preco_unitario, resgate_total, pagamento, vencimento, categoria_id, categorias(nome)")
        .eq("user_id", user.id);

      if (!custodias || custodias.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Separate renda fixa with periodic payment and poupança (by modalidade)
      const withPayment = custodias.filter(
        (c: any) => c.pagamento && c.pagamento !== "No Vencimento" && c.modalidade === "Prefixado"
      );
      const poupancaProducts = custodias.filter(
        (c: any) => c.modalidade === "Poupança"
      );

      if (withPayment.length === 0 && poupancaProducts.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Find date range for calendar
      const allProducts = [...withPayment, ...poupancaProducts];
      const minDate = allProducts.reduce((m: string, p: any) => p.data_inicio < m ? p.data_inicio : m, allProducts[0].data_inicio);
      const maxDate = allProducts.reduce((m: string, p: any) => {
        const end = p.data_calculo || dataReferenciaISO;
        return end > m ? end : m;
      }, dataReferenciaISO);

      // Batch fetch calendar and all movimentações
      const allCodigos = allProducts.map((p: any) => p.codigo_custodia);
      const poupancaCodigos = poupancaProducts.map((p: any) => p.codigo_custodia);

      const [calRes, allMovRes, selicRes, lotesRes, trRes, poupRendRes] = await Promise.all([
        supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", getDateMinus(minDate, 5)).lte("data", maxDate).order("data"),
        supabase.from("movimentacoes").select("data, tipo_movimentacao, valor, codigo_custodia")
          .in("codigo_custodia", allCodigos).eq("user_id", user.id).order("data"),
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

      const calendario = (calRes.data || []).map((d: any) => ({ data: d.data, dia_util: d.dia_util }));
      const movByCodigo = new Map<number, { data: string; tipo_movimentacao: string; valor: number }[]>();
      for (const m of (allMovRes.data || [])) {
        const code = m.codigo_custodia as number;
        if (!movByCodigo.has(code)) movByCodigo.set(code, []);
        movByCodigo.get(code)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
      }

      const allProventos: ProventoRow[] = [];

      // 1. Renda Fixa — pagamento de juros periódicos
      for (const prod of withPayment) {
        const endDate = (prod as any).data_calculo || dataReferenciaISO;

        const engineRows = calcularRendaFixaDiario({
          dataInicio: prod.data_inicio,
          dataCalculo: endDate,
          taxa: prod.taxa || 0,
          modalidade: prod.modalidade || "Prefixado",
          puInicial: prod.preco_unitario || 1000,
          calendario,
          movimentacoes: movByCodigo.get(prod.codigo_custodia) || [],
          dataResgateTotal: prod.resgate_total,
          pagamento: prod.pagamento,
          vencimento: prod.vencimento,
          calendarioSorted: true,
        });

        for (const row of engineRows) {
          if (row.pagamentoJuros > 0.01) {
            allProventos.push({
              data: row.data,
              nome: prod.nome || "—",
              tipo: "Pagamento de Juros",
              valor: row.pagamentoJuros,
            });
          }
        }
      }

      // 2. Poupança — rendimentos de aniversário
      const selicRecords = ((selicRes as any).data || []).map((s: any) => ({ data: s.data, taxa_anual: Number(s.taxa_anual) }));
      const trRecords = ((trRes as any).data || []).map((t: any) => ({ data: t.data, taxa_mensal: Number(t.taxa_mensal) }));
      const poupancaRendimentoRecords = ((poupRendRes as any).data || []).map((r: any) => ({ data: r.data, rendimento_mensal: Number(r.rendimento_mensal) }));

      for (const prod of poupancaProducts) {
        const allMovs = movByCodigo.get((prod as any).codigo_custodia) || [];
        const lotesForEngine = buildPoupancaLotesFromMovs(allMovs);
        if (lotesForEngine.length === 0) continue;

        const engineRows = calcularPoupancaDiario({
          dataInicio: lotesForEngine[0].data_aplicacao,
          dataCalculo: dataReferenciaISO,
          calendario,
          movimentacoes: allMovs,
          lotes: lotesForEngine,
          selicRecords,
          trRecords,
          poupancaRendimentoRecords,
          dataResgateTotal: (prod as any).resgate_total,
        });

        for (const row of engineRows) {
          if (row.ganhoDiario > 0.01) {
            allProventos.push({
              data: row.data,
              nome: (prod as any).nome || "Poupança",
              tipo: "Rendimento",
              valor: row.ganhoDiario,
            });
          }
        }
      }

      setRows(allProventos);
      setLoading(false);
    })();
  }, [user, appliedVersion, dataReferenciaISO]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDir === "asc" ? valA - valB : valB - valA;
    }
    const cmp = String(valA).localeCompare(String(valB), "pt-BR", { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("pt-BR");

  const fmtBrl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Proventos Recebidos</h1>
        <p className="text-xs text-muted-foreground">Pagamentos de juros periódicos e rendimentos dos seus títulos</p>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className="cursor-pointer select-none whitespace-nowrap"
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown size={12} className={sortField === col.key ? "opacity-100" : "opacity-40"} />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="text-center py-8 text-muted-foreground">
                  Nenhum provento encontrado.
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r, i) => (
                <TableRow key={`${r.data}-${r.nome}-${i}`}>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                  <TableCell>{r.nome}</TableCell>
                  <TableCell>{r.tipo}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtBrl(r.valor)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
