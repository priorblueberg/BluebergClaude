import { useEffect, useState } from "react";
import { useBoleta } from "@/contexts/BoletaContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
import {
  textoConfirmacaoDeExclusao, AVISO_EXCLUSAO_ATIVO, AVISO_EXCLUSAO_MOVIMENTACAO, TITULO_CONFIRMACAO_DE_EXCLUSAO,
} from "@/lib/confirmacaoDeExclusao";
import { formatarCnpj } from "@/components/FundoSelect";

interface Movimentacao {
  id: string;
  data: string;
  tipo_movimentacao: string;
  valor: number;
  quantidade: number | null;
  preco_unitario: number | null;
  custos_operacao: number | null;
  origem: string;
}

export interface PosicaoDetalheData {
  /** Decide o que entra em "Dados da posição": preço e quantidade so existem em fundo e moeda. */
  tipo: "fundo" | "moeda" | "renda_fixa" | "outro";
  nome: string;
  /** CNPJ da classe, nos fundos. Vai junto do nome, como no Gorila. */
  cnpj: string | null;
  /** "Categoria / Produto". */
  classificacao: string;
  custodiante: string;
  valorAtualizado: number;
  pnl: number;
  /** Ja em %, a mesma da linha da Posição Consolidada. */
  rentabilidadePct: number;
  /** Periodo de analise: do inicio do portfolio ate a data de referencia. */
  inicioPeriodo: string;
  fimPeriodo: string;
  valorInvestido: number | null;
  quantidade: number | null;
  ultimoPreco: number | null;
  dataUltimoPreco: string | null;
  precoMedio: number | null;
  dataInicio: string;
  codigoCustodia: string;
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
  /** "Boletar" da gaveta: abre a boleta da propria posicao. */
  onBoletar?: (tipo: "Aplicação" | "Resgate") => void;
}

const TIPOS_SAIDA = new Set(["Resgate", "Resgate Total", "Resgate no Vencimento", "Come-Cotas", "Come-cotas", "Venda"]);

const ORIGEM: Record<string, string> = {
  manual: "Manual",
  importacao: "Importação",
  automatico: "Automático",
  mudanca_de_fundo: "Mudança de fundo",
  teste: "Teste",
};

const fmtBrl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Preco com as casas que a fonte tem, ate 8: "R$ 14,8072282". */
const fmtPreco = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 8 });
const fmtQtd = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const fmtData = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—");
const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const corDoSinal = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-destructive" : "text-foreground");

/**
 * Detalhes da posição, na gaveta lateral, no modelo do Gorila (conferido na tela dele em
 * 11/09/2026): cabeçalho com o período de análise e "Boletar"; classificação, nome e custodiante;
 * valor atualizado, P&L e rentabilidade; dados da posição; histórico de movimentações.
 *
 * A TIR que o Gorila mostra ao lado da TWR fica para depois (decisão do Daniel).
 */
export default function PosicaoDetalheDialog({ open, onClose, data, userId, dataReferenciaISO, onDataChanged, onBoletar }: Props) {
  const { abrirBoleta } = useBoleta();
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<Movimentacao | null>(null);

  useEffect(() => {
    if (open) fetchMovs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.codigoCustodia]);

  async function fetchMovs() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("movimentacoes")
      .select("id, data, tipo_movimentacao, valor, quantidade, preco_unitario, custos_operacao, origem, created_at")
      .eq("codigo_custodia", data.codigoCustodia)
      .eq("user_id", userId)
      .order("data", { ascending: false })
      .order("created_at", { ascending: false });

    // Linhas automaticas identicas (mesma data, tipo e valor) aparecem uma vez so.
    const seen = new Set<string>();
    const deduped: Movimentacao[] = [];
    for (const row of (rows || []) as any[]) {
      if (row.origem === "automatico") {
        const key = `${row.data}|${row.tipo_movimentacao}|${row.valor}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(row as Movimentacao);
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
      toast.success(AVISO_EXCLUSAO_ATIVO);
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
      toast.success(AVISO_EXCLUSAO_MOVIMENTACAO);
      await fullSyncAfterDelete(data.codigoCustodia, data.categoriaId, userId, dataReferenciaISO);
      onDataChanged();
      fetchMovs();
    }
    setDeleteId(null);
  }

  const temPreco = data.tipo === "fundo" || data.tipo === "moeda";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="right"
          overlayClassName="bg-black/10"
          className="w-full sm:max-w-[960px] p-0 overflow-y-auto"
        >
          {/* Cabecalho */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 pr-14">
            <div className="min-w-0">
              <SheetTitle className="text-sm font-bold">Detalhes da posição</SheetTitle>
              <SheetDescription className="text-xs">
                Período de análise: Desde o início ({fmtData(data.inicioPeriodo)} - {fmtData(data.fimPeriodo)})
              </SheetDescription>
            </div>
            {onBoletar && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 gap-1 shrink-0">
                    Boletar
                    <ChevronDown size={14} strokeWidth={1.5} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => onBoletar("Aplicação")}>Aplicação</DropdownMenuItem>
                  <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => onBoletar("Resgate")}>Resgate</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="space-y-6 px-6 py-5">
            {/* Identificacao */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{data.classificacao}</p>
              <h4 className="text-base font-bold text-foreground break-words">
                {data.nome}
                {data.cnpj ? ` - ${formatarCnpj(data.cnpj)}` : ""}
              </h4>
              <p className="text-xs text-muted-foreground">{data.custodiante}</p>
            </div>

            {/* Resultado */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border p-4">
              <Metrica rotulo="Valor atualizado" valor={fmtBrl(data.valorAtualizado)} />
              <Metrica rotulo="P&L" valor={fmtBrl(data.pnl)} cor={corDoSinal(data.pnl)} />
              <Metrica rotulo="Rentabilidade (TWR)" valor={fmtPct(data.rentabilidadePct)} cor={corDoSinal(data.rentabilidadePct)} />
            </div>

            {/* Dados da posicao */}
            <section className="space-y-2">
              <h6 className="text-sm font-bold text-foreground">Dados da posição</h6>
              <div className="grid grid-cols-2 gap-x-8">
                <Linha rotulo="Valor investido" valor={fmtBrl(data.valorInvestido)} />
                {temPreco ? (
                  <>
                    <Linha
                      rotulo={`Último preço no período${data.dataUltimoPreco ? ` (${fmtData(data.dataUltimoPreco)})` : ""}`}
                      valor={fmtPreco(data.ultimoPreco)}
                    />
                    <Linha rotulo="Quantidade total" valor={fmtQtd(data.quantidade)} />
                    <Linha rotulo="Preço médio" valor={fmtPreco(data.precoMedio)} />
                  </>
                ) : (
                  <>
                    <Linha rotulo="Emissor" valor={data.emissor ?? "—"} />
                    <Linha rotulo="Indexador" valor={data.indexador ?? "—"} />
                    <Linha
                      rotulo="Taxa"
                      valor={data.taxa != null ? `${data.taxa.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%` : "—"}
                    />
                    <Linha rotulo="Modalidade" valor={data.modalidade ?? "—"} />
                    <Linha rotulo="Pagamento" valor={data.pagamento ?? "—"} />
                    <Linha rotulo="Vencimento" valor={fmtData(data.vencimento)} />
                  </>
                )}
              </div>
            </section>

            {/* Historico */}
            <section className="space-y-2">
              <h6 className="text-sm font-bold text-foreground">Histórico</h6>
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Carregando...</p>
              ) : movs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nenhuma movimentação.</p>
              ) : (
                <div className="rounded-md border border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs text-right">Quantidade</TableHead>
                        <TableHead className="text-xs text-right">Preço</TableHead>
                        <TableHead className="text-xs text-right">Custos Op.</TableHead>
                        <TableHead className="text-xs text-right">Valor total</TableHead>
                        <TableHead className="text-xs">Origem</TableHead>
                        <TableHead className="w-[72px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movs.map((m) => {
                        const isAuto = m.origem === "automatico";
                        const saida = TIPOS_SAIDA.has(m.tipo_movimentacao);
                        const qtd = m.quantidade != null ? (saida ? -Math.abs(m.quantidade) : m.quantidade) : null;
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="whitespace-nowrap text-sm">{fmtData(m.data)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{m.tipo_movimentacao}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtQtd(qtd)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtPreco(m.preco_unitario)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtBrl(m.custos_operacao ?? 0)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtBrl(m.valor)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{ORIGEM[m.origem] ?? m.origem}</TableCell>
                            <TableCell className="text-right">
                              {!isAuto && (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7" title="Editar"
                                    onClick={() => { onClose(); abrirBoleta(m.id); }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Excluir"
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
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{TITULO_CONFIRMACAO_DE_EXCLUSAO}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Mesmo texto da tela de Movimentacoes, que e a oficial. */}
              {textoConfirmacaoDeExclusao(deleteId ? {
                tipo_movimentacao: deleteId.tipo_movimentacao,
                nome_ativo: data.nome,
                data: deleteId.data,
                valor: deleteId.valor,
              } : null)}
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

function Metrica({ rotulo, valor, cor = "text-foreground" }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm">
      <span className="text-foreground">{rotulo}</span>
      <span className="font-medium text-foreground tabular-nums text-right">{valor}</span>
    </div>
  );
}
