import { useEffect, useState, useMemo } from "react";
import { ArrowUpDown, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Movimentacao {
  id: string;
  created_at: string;
  data: string;
  tipo_movimentacao: string;
  pagamento: string | null;
  nome_ativo: string | null;
  instituicao: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  valor: number | null;
  origem: string;
  codigo_custodia: number | null;
  modalidade: string | null;
}

type SortField = keyof Movimentacao;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortField; label: string }[] = [
  { key: "data", label: "Data" },
  { key: "nome_ativo", label: "Nome do Ativo" },
  { key: "tipo_movimentacao", label: "Tipo Mov." },
  { key: "quantidade", label: "Quantidade" },
  { key: "preco_unitario", label: "Preço Unitário" },
  { key: "valor", label: "Valor" },
];

// Module-level cache
let _movCachedVersion: number | null = null;
let _movCachedRows: Movimentacao[] = [];

export default function MovimentacoesPage() {
  const navigate = useNavigate();
  const { dataReferenciaISO, applyDataReferencia, appliedVersion } = useDataReferencia();
  const [rows, setRows] = useState<Movimentacao[]>(_movCachedRows);
  const [loading, setLoading] = useState(_movCachedVersion === null);
  const [sortField, setSortField] = useState<SortField>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterNome, setFilterNome] = useState("");
  const [filterTipo, setFilterTipo] = useState("");

  const fetchData = async () => {
    const { data, error } = await supabase
      .from("movimentacoes")
      .select(`
        id, created_at, data, tipo_movimentacao,
        pagamento, nome_ativo, quantidade, preco_unitario,
        valor, origem, codigo_custodia, modalidade,
        instituicoes(nome)
      `)
      .order("data", { ascending: false });

    if (!error && data) {
      const mapped = data.map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          data: r.data,
          tipo_movimentacao: r.tipo_movimentacao,
          pagamento: r.pagamento,
          nome_ativo: r.nome_ativo,
          instituicao: r.instituicoes?.nome ?? null,
          quantidade: r.quantidade ?? null,
          preco_unitario: r.preco_unitario ?? null,
          valor: r.valor ?? null,
          origem: r.origem ?? "manual",
          codigo_custodia: r.codigo_custodia ?? null,
          modalidade: r.modalidade ?? null,
        }));
      setRows(mapped);
      _movCachedRows = mapped;
    }
    _movCachedVersion = appliedVersion;
    setLoading(false);
  };

  useEffect(() => {
    if (_movCachedVersion === appliedVersion) return;
    fetchData();
  }, [appliedVersion]);

  // Unique values for filters
  const uniqueNomes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.nome_ativo) set.add(r.nome_ativo); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const uniqueTipos = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => set.add(r.tipo_movimentacao));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (filterNome && r.nome_ativo !== filterNome) return false;
      if (filterTipo && r.tipo_movimentacao !== filterTipo) return false;
      return true;
    });
  }, [rows, filterNome, filterTipo]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    const { data: movData } = await supabase
      .from("movimentacoes")
      .select("codigo_custodia, categoria_id, user_id, tipo_movimentacao")
      .eq("id", deleteId)
      .single();

    const isAplicacaoInicial = movData?.tipo_movimentacao === "Aplicação Inicial";

    if (isAplicacaoInicial && movData?.codigo_custodia) {
      const { error: movError } = await supabase
        .from("movimentacoes")
        .delete()
        .eq("codigo_custodia", movData.codigo_custodia)
        .eq("user_id", movData.user_id!);

      if (movError) {
        toast.error("Erro ao excluir movimentações do ativo.");
        console.error(movError);
        setDeleteId(null);
        return;
      }

      const { error: custError } = await supabase
        .from("custodia")
        .delete()
        .eq("codigo_custodia", movData.codigo_custodia)
        .eq("user_id", movData.user_id!);

      if (custError) {
        console.error(custError);
      }

      toast.success("Ativo, custódia e todas as movimentações excluídos com sucesso.");
      setRows((prev) => prev.filter((r) => r.codigo_custodia !== movData.codigo_custodia));

      await fullSyncAfterDelete(
        movData.codigo_custodia,
        movData.categoria_id,
        movData.user_id!,
        dataReferenciaISO
      );
      applyDataReferencia();
    } else {
      const { error } = await supabase.from("movimentacoes").delete().eq("id", deleteId);
      if (error) {
        toast.error("Erro ao excluir movimentação.");
        console.error(error);
      } else {
        toast.success("Movimentação excluída com sucesso.");
        setRows((prev) => prev.filter((r) => r.id !== deleteId));

        if (movData) {
          await fullSyncAfterDelete(
            movData.codigo_custodia,
            movData.categoria_id,
            movData.user_id!,
            dataReferenciaISO
          );
          applyDataReferencia();
        }
      }
    }
    setDeleteId(null);
  };

  const handleEdit = (id: string) => {
    navigate(`/cadastrar-transacao?edit=${id}`);
  };

  const sortedRows = [...filteredRows].sort((a, b) => {
    const valA = a[sortField] ?? "";
    const valB = b[sortField] ?? "";
    const cmp = String(valA).localeCompare(String(valB), "pt-BR", { numeric: true });
    const result = sortDir === "asc" ? cmp : -cmp;
    if (result !== 0) return result;
    const prioA = a.tipo_movimentacao.startsWith("Aplicação") ? 0 : 1;
    const prioB = b.tipo_movimentacao.startsWith("Aplicação") ? 0 : 1;
    return prioA - prioB;
  });

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const colSpan = COLUMNS.length + 1;

  const isPagamentoJuros = (tipo: string) => tipo === "Pagamento de Juros";
  const isPoupancaMov = (r: Movimentacao) => r.modalidade === "Poupança";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Movimentações</h1>
        <p className="text-xs text-muted-foreground">Extrato de todas as movimentações registradas</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Nome do Ativo:</label>
          <select
            value={filterNome}
            onChange={(e) => setFilterNome(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30 min-w-[160px]"
          >
            <option value="">Todos</option>
            {uniqueNomes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Tipo de Movimentação:</label>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30 min-w-[160px]"
          >
            <option value="">Todos</option>
            {uniqueTipos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
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
              <TableHead className="text-center whitespace-nowrap">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow><TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">Nenhuma movimentação encontrada.</TableCell></TableRow>
            ) : (
              sortedRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.data)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.nome_ativo ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.tipo_movimentacao}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {isPagamentoJuros(r.tipo_movimentacao) || isPoupancaMov(r)
                      ? "—"
                      : r.quantidade != null
                        ? r.quantidade.toLocaleString("pt-BR", { minimumFractionDigits: 7, maximumFractionDigits: 7 })
                        : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {isPagamentoJuros(r.tipo_movimentacao) || isPoupancaMov(r)
                      ? "—"
                      : r.preco_unitario != null
                        ? r.preco_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                        : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.valor != null ? r.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-center">
                    {r.origem === "automatico" ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Auto</Badge>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEdit(r.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors mr-2"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteId(r.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const row = rows.find((r) => r.id === deleteId);
                if (row?.tipo_movimentacao === "Aplicação Inicial") {
                  return "Ao excluir uma Aplicação Inicial, o título será removido da custódia e todas as movimentações deste código serão excluídas permanentemente.";
                }
                return "Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.";
              })()}
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
