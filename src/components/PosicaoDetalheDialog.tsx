import { useEffect, useMemo, useState } from "react";
import { useBoleta } from "@/contexts/BoletaContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { HistoricoRentabilidadeChart, type PontoRentabilidade } from "@/components/HistoricoRentabilidadeChart";
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
  preco_unitario: number | null;
  origem: string;
}

export interface PosicaoDetalheData {
  /** Decide a linha de informacoes: preco da cota so existe em fundo e moeda. */
  tipo: "fundo" | "moeda" | "renda_fixa" | "outro";
  nome: string;
  /** CNPJ da classe, nos fundos. Vai junto do nome, como no Gorila. */
  cnpj: string | null;
  /** "Categoria / Produto". */
  classificacao: string;
  custodiante: string;
  valorAtualizado: number;
  valorInvestido: number | null;
  pnl: number;
  /** Ja em %, a mesma da linha da Posição Consolidada. */
  rentabilidadePct: number;
  /** CDI acumulado na janela da posicao, em %. Base do "% do CDI". */
  cdiAcumuladoPct: number | null;
  ultimoPreco: number | null;
  dataUltimoPreco: string | null;
  precoMedio: number | null;
  /** Rentabilidade acumulada da posicao e do CDI, dia util a dia util. */
  grafico: PontoRentabilidade[];
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
}

/** A gaveta abre abaixo do header do site (h-14), que continua visivel e clicavel. */
const ALTURA_DO_HEADER = 56;
const LINHAS_POR_PAGINA = 10;

const fmtBrl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Preco com as casas que a fonte tem, ate 8: "R$ 14,8072282". */
const fmtPreco = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 8 });
const fmtData = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—");
const fmtPct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const corDoSinal = (v: number) => (v > 0 ? "text-emerald-700" : v < 0 ? "text-destructive" : "text-foreground");

/**
 * Detalhes da posição, na gaveta lateral, a partir do modelo do Gorila e com os ajustes do Daniel
 * (11/09/2026): sem cabeçalho proprio (o do site ja tem a data e o cadastro de transação), box com
 * patrimônio, valor investido, ganho, rentabilidade e % do CDI; último preço e preço médio numa
 * linha; gráfico de rentabilidade; histórico paginado.
 *
 * A TIR que o Gorila mostra fica para depois (decisão do Daniel).
 */
export default function PosicaoDetalheDialog({ open, onClose, data, userId, dataReferenciaISO, onDataChanged }: Props) {
  const { abrirBoleta } = useBoleta();
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<Movimentacao | null>(null);
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    if (open) fetchMovs();
    setPagina(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.codigoCustodia]);

  async function fetchMovs() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("movimentacoes")
      .select("id, data, tipo_movimentacao, valor, preco_unitario, origem, created_at")
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
  const sobreCdi = data.cdiAcumuladoPct != null && data.cdiAcumuladoPct > 0
    ? (data.rentabilidadePct / data.cdiAcumuladoPct) * 100
    : null;

  const totalPaginas = Math.max(1, Math.ceil(movs.length / LINHAS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const movsDaPagina = useMemo(
    () => movs.slice(paginaAtual * LINHAS_POR_PAGINA, (paginaAtual + 1) * LINHAS_POR_PAGINA),
    [movs, paginaAtual],
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[960px] p-0 overflow-y-auto"
          style={{ top: ALTURA_DO_HEADER, height: `calc(100% - ${ALTURA_DO_HEADER}px)` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // O header fica utilizavel com a gaveta aberta, e a confirmacao de exclusao e dela.
            const alvo = e.target as HTMLElement | null;
            if (alvo?.closest("header") || alvo?.closest("[role=alertdialog]")) e.preventDefault();
          }}
        >
          <SheetTitle className="sr-only">Detalhes da posição</SheetTitle>
          <SheetDescription className="sr-only">{data.nome}</SheetDescription>

          <div className="space-y-5 px-6 py-5">
            {/* Identificacao */}
            <div className="space-y-1 pr-8">
              <p className="text-xs text-muted-foreground">{data.classificacao}</p>
              <h4 className="text-base font-bold text-foreground break-words">
                {data.nome}
                {data.cnpj ? ` - ${formatarCnpj(data.cnpj)}` : ""}
              </h4>
              <p className="text-xs text-muted-foreground">{data.custodiante}</p>
            </div>

            {/* Resultado */}
            <div className="grid grid-cols-5 gap-4 rounded-lg border border-border p-4">
              <Metrica rotulo="Patrimônio" valor={fmtBrl(data.valorAtualizado)} />
              <Metrica rotulo="Valor Investido" valor={fmtBrl(data.valorInvestido)} />
              <Metrica rotulo="Ganho Financeiro" valor={fmtBrl(data.pnl)} cor={corDoSinal(data.pnl)} />
              <Metrica rotulo="Rentabilidade" valor={fmtPct(data.rentabilidadePct)} cor={corDoSinal(data.rentabilidadePct)} />
              <Metrica rotulo="% do CDI" valor={fmtPct(sobreCdi)} />
            </div>

            {/* Linha de informacoes */}
            <div className="flex flex-wrap gap-x-8 gap-y-1 px-1 text-sm">
              {temPreco ? (
                <>
                  <Info
                    rotulo={`Último preço do período${data.dataUltimoPreco ? ` (${fmtData(data.dataUltimoPreco)})` : ""}`}
                    valor={fmtPreco(data.ultimoPreco)}
                  />
                  <Info rotulo="Preço Médio" valor={fmtPreco(data.precoMedio)} />
                </>
              ) : (
                <>
                  <Info rotulo="Emissor" valor={data.emissor ?? "—"} />
                  <Info rotulo="Indexador" valor={data.indexador ?? "—"} />
                  <Info
                    rotulo="Taxa"
                    valor={data.taxa != null ? `${data.taxa.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%` : "—"}
                  />
                  <Info rotulo="Pagamento" valor={data.pagamento ?? "—"} />
                  <Info rotulo="Vencimento" valor={fmtData(data.vencimento)} />
                </>
              )}
            </div>

            {/* Grafico */}
            {data.grafico.length > 1 && (
              <HistoricoRentabilidadeChart
                dados={data.grafico}
                chaveSerie="posicao_acumulado"
                rotuloSerie="Posição"
                temIbovespa={false}
              />
            )}

            {/* Historico */}
            <section className="space-y-2">
              <h6 className="text-sm font-bold text-foreground">Histórico</h6>
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Carregando...</p>
              ) : movs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nenhuma movimentação.</p>
              ) : (
                <>
                  <div className="rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Data</TableHead>
                          <TableHead className="text-xs">Tipo</TableHead>
                          <TableHead className="text-xs text-right">Valor da Cota</TableHead>
                          <TableHead className="text-xs text-right">Valor total</TableHead>
                          <TableHead className="w-[72px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movsDaPagina.map((m) => {
                          const isAuto = m.origem === "automatico";
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="whitespace-nowrap text-sm">{fmtData(m.data)}</TableCell>
                              <TableCell className="whitespace-nowrap text-sm">{m.tipo_movimentacao}</TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtPreco(m.preco_unitario)}</TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-right tabular-nums">{fmtBrl(m.valor)}</TableCell>
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

                  {totalPaginas > 1 && (
                    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                      <span>
                        {paginaAtual * LINHAS_POR_PAGINA + 1}-{Math.min((paginaAtual + 1) * LINHAS_POR_PAGINA, movs.length)} de {movs.length}
                      </span>
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        disabled={paginaAtual === 0}
                        onClick={() => setPagina(paginaAtual - 1)}
                        title="Página anterior"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span>Página {paginaAtual + 1} de {totalPaginas}</span>
                      <Button
                        variant="outline" size="icon" className="h-7 w-7"
                        disabled={paginaAtual >= totalPaginas - 1}
                        onClick={() => setPagina(paginaAtual + 1)}
                        title="Próxima página"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
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
      <p className={`mt-1 text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p>
      <span className="text-muted-foreground">{rotulo}: </span>
      <span className="font-semibold text-foreground tabular-nums">{valor}</span>
    </p>
  );
}
