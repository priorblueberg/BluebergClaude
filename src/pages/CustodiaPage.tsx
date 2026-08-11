import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
import BoletaCustodiaDialog, {
  type CustodiaRowForBoleta,
} from "@/components/BoletaCustodiaDialog";
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

interface CustodiaRow {
  id: string;
  codigo_custodia: number;
  data_inicio: string;
  tipo_movimentacao: string;
  modalidade: string | null;
  indexador: string | null;
  taxa: number | null;
  valor_investido: number;
  preco_unitario: number | null;
  quantidade: number | null;
  vencimento: string | null;
  pagamento: string | null;
  nome: string | null;
  produto: string;
  produto_id: string;
  instituicao: string | null;
  instituicao_id: string | null;
  emissor: string | null;
  emissor_id: string | null;
  categoria: string;
  categoria_id: string;
  resgate_total: string | null;
  status_variavel: string | null;
  data_calculo: string | null;
  multiplicador: string | null;
  amortizacao: number | null;
  rendimentos: number | null;
  alocacao_patrimonial: string | null;
  pu_inicial: number | null;
  data_limite: string | null;
  sigla_tesouro: string | null;
  custodia_no_dia: number | null;
  estrategia: string | null;
}

interface CarteiraInfo {
  nome_carteira: string;
  status: string;
  data_inicio: string | null;
  data_calculo: string | null;
}

// Module-level cache
let _custCachedVersion: number | null = null;
let _custCachedRows: CustodiaRow[] = [];
let _custCachedCarteira: CarteiraInfo | null = null;

export default function CustodiaPage() {
  const [rows, setRows] = useState<CustodiaRow[]>(_custCachedRows);
  const [loading, setLoading] = useState(_custCachedVersion === null);
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_custCachedCarteira);
  const { appliedVersion, dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const { user } = useAuth();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTipo, setDialogTipo] = useState<"Aplicação" | "Resgate">("Aplicação");
  const [dialogRow, setDialogRow] = useState<CustodiaRowForBoleta | null>(null);
  const [deleteRow, setDeleteRow] = useState<CustodiaRow | null>(null);

  const fetchData = async () => {
    const { data: carteiraData } = await supabase
      .from("controle_de_carteiras")
      .select("nome_carteira, status, data_inicio, data_calculo")
      .eq("nome_carteira", "Renda Fixa")
      .maybeSingle();

    if (carteiraData) {
      const info = {
        nome_carteira: carteiraData.nome_carteira,
        status: carteiraData.status,
        data_inicio: carteiraData.data_inicio,
        data_calculo: carteiraData.data_calculo,
      };
      setCarteiraInfo(info);
      _custCachedCarteira = info;
    }

    const { data, error } = await supabase
      .from("custodia")
      .select(`
        id, codigo_custodia, data_inicio, tipo_movimentacao,
        modalidade, indexador, taxa, valor_investido, preco_unitario,
        quantidade, vencimento, pagamento, nome,
        resgate_total, status_variavel, data_calculo, multiplicador,
        amortizacao, rendimentos, alocacao_patrimonial, pu_inicial,
        data_limite, sigla_tesouro, custodia_no_dia, estrategia,
        categoria_id, produto_id, instituicao_id, emissor_id,
        produtos(nome), instituicoes(nome), emissores(nome), categorias(nome)
      `)
      .order("codigo_custodia", { ascending: true });

    if (!error && data) {
      const mapped = data.map((r: any) => ({
          id: r.id,
          codigo_custodia: r.codigo_custodia,
          data_inicio: r.data_inicio,
          tipo_movimentacao: r.tipo_movimentacao,
          modalidade: r.modalidade,
          indexador: r.indexador,
          taxa: r.taxa,
          valor_investido: r.valor_investido,
          preco_unitario: r.preco_unitario,
          quantidade: r.quantidade,
          vencimento: r.vencimento,
          pagamento: r.pagamento,
          nome: r.nome,
          produto: r.produtos?.nome ?? "—",
          produto_id: r.produto_id,
          instituicao: r.instituicoes?.nome ?? null,
          instituicao_id: r.instituicao_id,
          emissor: r.emissores?.nome ?? null,
          emissor_id: r.emissor_id,
          categoria: r.categorias?.nome ?? "—",
          categoria_id: r.categoria_id,
          resgate_total: r.resgate_total,
          status_variavel: r.status_variavel,
          data_calculo: r.data_calculo,
          multiplicador: r.multiplicador,
          amortizacao: r.amortizacao,
          rendimentos: r.rendimentos,
          alocacao_patrimonial: r.alocacao_patrimonial,
          pu_inicial: r.pu_inicial,
          data_limite: r.data_limite,
          sigla_tesouro: r.sigla_tesouro,
          custodia_no_dia: r.custodia_no_dia,
          estrategia: r.estrategia,
        }));
      setRows(mapped);
      _custCachedRows = mapped;
    }
    _custCachedVersion = appliedVersion;
    setLoading(false);
  };

  useEffect(() => {
    if (_custCachedVersion === appliedVersion) return;
    fetchData();
  }, [appliedVersion]);

  const openBoleta = (row: CustodiaRow, tipo: "Aplicação" | "Resgate") => {
    setDialogRow({
      id: row.id,
      codigo_custodia: row.codigo_custodia,
      data_inicio: row.data_inicio,
      nome: row.nome,
      categoria: row.categoria,
      categoria_id: row.categoria_id,
      produto: row.produto,
      produto_id: row.produto_id,
      instituicao: row.instituicao,
      instituicao_id: row.instituicao_id,
      emissor: row.emissor,
      emissor_id: row.emissor_id,
      modalidade: row.modalidade,
      indexador: row.indexador,
      taxa: row.taxa,
      pagamento: row.pagamento,
      vencimento: row.vencimento,
      preco_unitario: row.preco_unitario,
      valor_investido: row.valor_investido,
    });
    setDialogTipo(tipo);
    setDialogOpen(true);
  };

  const handleDeleteCustodia = async () => {
    if (!deleteRow || !user) return;
    const codigoCustodia = deleteRow.codigo_custodia;
    const categoriaId = deleteRow.categoria_id;

    // Delete all movimentações for this codigo_custodia
    const { error: movError } = await supabase
      .from("movimentacoes")
      .delete()
      .eq("codigo_custodia", codigoCustodia)
      .eq("user_id", user.id);

    if (movError) {
      toast.error("Erro ao excluir movimentações do ativo.");
      console.error(movError);
      setDeleteRow(null);
      return;
    }

    // Delete custodia record
    const { error: custError } = await supabase
      .from("custodia")
      .delete()
      .eq("id", deleteRow.id);

    if (custError) {
      toast.error("Erro ao excluir registro de custódia.");
      console.error(custError);
    } else {
      toast.success("Ativo e movimentações excluídos com sucesso.");
      setRows((prev) => prev.filter((r) => r.id !== deleteRow.id));
      await fullSyncAfterDelete(codigoCustodia, categoriaId, user.id, dataReferenciaISO);
      applyDataReferencia();
    }
    setDeleteRow(null);
  };

  const fmt = (v: number | null) =>
    v != null
      ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const renderCarteiraMessage = () => {
    if (!carteiraInfo) return null;
    if (carteiraInfo.status === "Ativa") {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          Período de Análise: De {fmtDate(carteiraInfo.data_inicio)} a {fmtDate(carteiraInfo.data_calculo)}
        </p>
      );
    }
    if (carteiraInfo.status === "Não Iniciada") {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          Data selecionada anterior ao início dos seus investimentos em Renda Fixa
        </p>
      );
    }
    if (carteiraInfo.status === "Encerrada") {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          Carteira Encerrada em {fmtDate(carteiraInfo.data_calculo)}
        </p>
      );
    }
    return null;
  };

  const headers = [
    "Ações",
    "Cód. Custódia", "Nome", "Data Início", "Categoria", "Produto",
    "Tipo Mov.", "Instituição", "Emissor", "Modalidade", "Indexador",
    "Taxa", "Valor Investido (R$)", "Preço Unit. (R$)", "Quantidade",
    "Vencimento", "Pagamento",
    "Resgate Total", "Status Variável", "Data p/ Cálculo", "Multiplicador",
    "Amortização", "Rendimentos", "Alocação Patrimonial", "PU Inicial",
    "Data Limite", "Sigla Tesouro", "Custódia no Dia", "Estratégia",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Renda Fixa</h1>
        {renderCarteiraMessage()}
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">Nenhum registro de custódia encontrado.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/30"}`}>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2"
                        onClick={() => openBoleta(r, "Aplicação")}
                      >
                        Aplicação
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2"
                        onClick={() => openBoleta(r, "Resgate")}
                      >
                        Resgate
                      </Button>
                      <button
                        onClick={() => setDeleteRow(r)}
                        className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                        title="Excluir ativo"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.codigo_custodia}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.nome ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtDate(r.data_inicio)}</td>
                  <td className="px-3 py-2 text-foreground">{r.categoria}</td>
                  <td className="px-3 py-2 text-foreground">{r.produto}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.tipo_movimentacao}</td>
                  <td className="px-3 py-2 text-foreground">{r.instituicao ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground">{r.emissor ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground">{r.modalidade ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground">{r.indexador ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground">{r.taxa != null ? `${fmt(r.taxa)}%` : "—"}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.valor_investido)}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.preco_unitario)}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.quantidade)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtDate(r.vencimento)}</td>
                  <td className="px-3 py-2 text-foreground">{r.pagamento ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.resgate_total as any)}</td>
                  <td className="px-3 py-2 text-foreground">{r.status_variavel ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtDate(r.data_calculo)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.multiplicador ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.amortizacao)}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.rendimentos)}</td>
                  <td className="px-3 py-2 text-foreground">{r.alocacao_patrimonial ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.pu_inicial)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtDate(r.data_limite)}</td>
                  <td className="px-3 py-2 text-foreground">{r.sigla_tesouro ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground text-right whitespace-nowrap">{fmt(r.custodia_no_dia)}</td>
                  <td className="px-3 py-2 text-foreground">{r.estrategia ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Boleta de Custódia */}
      {dialogRow && user && (
        <BoletaCustodiaDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          tipo={dialogTipo}
          row={dialogRow}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onSuccess={() => { fetchData(); applyDataReferencia(); }}
        />
      )}

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!deleteRow} onOpenChange={(open) => !open && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão do ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o ativo "{deleteRow?.nome ?? deleteRow?.codigo_custodia}"?
              Todas as movimentações associadas a este código de custódia serão excluídas permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustodia}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
