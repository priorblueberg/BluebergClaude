import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fullSyncAfterDelete } from "@/lib/syncEngine";

interface Movimentacao {
  id: string;
  data: string;
  tipo_movimentacao: string;
  valor: number;
  quantidade: number | null;
  preco_unitario: number | null;
  origem: string;
}

export interface PosicaoDetalheData {
  nome: string;
  custodiante: string;
  valorAtualizado: number;
  dataInicio: string;
  codigoCustodia: number;
  categoriaId: string;
  indexador: string | null;
  taxa: number | null;
  modalidade: string | null;
  pagamento: string | null;
  emissor: string | null;
  vencimento: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  data: PosicaoDetalheData;
  userId: string;
  dataReferenciaISO: string;
  onDataChanged: () => void;
}

function fmtBrl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(d: string | null) {
  return d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
}
function fmtQty(v: number | null) {
  return v != null ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "—";
}

export default function PosicaoDetalheDialog({ open, onClose, data, userId, dataReferenciaISO, onDataChanged }: Props) {
  const navigate = useNavigate();
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<Movimentacao | null>(null);

  useEffect(() => {
    if (open) fetchMovs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function fetchMovs() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("movimentacoes")
      .select("id, data, tipo_movimentacao, valor, quantidade, preco_unitario, origem")
      .eq("codigo_custodia", data.codigoCustodia)
      .eq("user_id", userId)
      .order("data", { ascending: true });

    // Deduplicate: remove identical auto rows (same date + type + valor)
    const seen = new Set<string>();
    const deduped: Movimentacao[] = [];
    for (const row of rows || []) {
      if (row.origem === "automatico") {
        const key = `${row.data}|${row.tipo_movimentacao}|${row.valor}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(row);
    }

    setMovs(deduped);
    setLoading(false);
  }

  async function handleDeleteMov() {
    if (!deleteId) return;
    const mov = deleteId;
    const isAplicacaoInicial = mov.tipo_movimentacao === "Aplicação Inicial";

    if (isAplicacaoInicial) {
      await supabase.from("movimentacoes").delete().eq("codigo_custodia", data.codigoCustodia).eq("user_id", userId);
      await supabase.from("custodia").delete().eq("codigo_custodia", data.codigoCustodia).eq("user_id", userId);
      toast.success("Ativo e movimentações excluídos.");
      await fullSyncAfterDelete(data.codigoCustodia, data.categoriaId, userId, dataReferenciaISO);
      onDataChanged();
      setDeleteId(null);
      onClose();
      return;
    }

    const { error } = await supabase.from("movimentacoes").delete().eq("id", mov.id);
    if (error) {
      toast.error("Erro ao excluir movimentação.");
    } else {
      toast.success("Movimentação excluída.");
      await fullSyncAfterDelete(data.codigoCustodia, data.categoriaId, userId, dataReferenciaISO);
      onDataChanged();
      fetchMovs();
    }
    setDeleteId(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-bold">{data.nome}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {data.custodiante} · Período: {fmtDate(data.dataInicio)} — {fmtDate(dataReferenciaISO)}
                </DialogDescription>
              </div>
              <span className="text-lg font-semibold text-foreground whitespace-nowrap shrink-0">
                {fmtBrl(data.valorAtualizado)}
              </span>
            </div>
          </DialogHeader>

          <Tabs defaultValue="historico" className="mt-2">
            <TabsList>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
              <TabsTrigger value="dados">Dados</TabsTrigger>
            </TabsList>

            <TabsContent value="historico">
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Carregando...</p>
              ) : movs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nenhuma movimentação.</p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Data</TableHead>
                        <TableHead className="w-[140px]">Tipo</TableHead>
                        <TableHead className="w-[130px]">Valor</TableHead>
                        <TableHead className="w-[100px]">Quantidade</TableHead>
                        <TableHead className="w-[120px]">Preço Unit.</TableHead>
                        <TableHead className="w-[80px]">Origem</TableHead>
                        <TableHead className="w-[80px] text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movs.map((m) => {
                        const isAuto = m.origem === "automatico";
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="whitespace-nowrap">{fmtDate(m.data)}</TableCell>
                            <TableCell className="whitespace-nowrap">{m.tipo_movimentacao}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtBrl(m.valor)}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtQty(m.quantidade)}</TableCell>
                            <TableCell className="whitespace-nowrap">{m.preco_unitario != null ? fmtBrl(m.preco_unitario) : "—"}</TableCell>
                            <TableCell>
                              {isAuto ? <Badge variant="secondary">Auto</Badge> : "Manual"}
                            </TableCell>
                            <TableCell className="text-right">
                              {!isAuto && (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7"
                                    onClick={() => { onClose(); navigate(`/cadastrar-transacao?edit=${m.id}`); }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                    onClick={() => setDeleteId(m)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="dados">
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 py-2 text-sm">
                <DataField label="Nome do Ativo" value={data.nome} />
                <DataField label="Indexador" value={data.indexador ?? "—"} />
                <DataField label="Taxa" value={data.taxa != null ? `${data.taxa.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%` : "—"} />
                <DataField label="Modalidade" value={data.modalidade ?? "—"} />
                <DataField label="Tipo de Pagamento" value={data.pagamento ?? "—"} />
                <DataField label="Emissor" value={data.emissor ?? "—"} />
                <DataField label="Custodiante" value={data.custodiante} />
                <DataField label="Vencimento" value={fmtDate(data.vencimento ?? null)} />
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteId?.tipo_movimentacao === "Aplicação Inicial"
                ? "Ao excluir a Aplicação Inicial, o ativo e todas as movimentações serão removidos permanentemente."
                : "Deseja excluir esta movimentação?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMov}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
