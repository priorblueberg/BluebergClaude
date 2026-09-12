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
import RentabilidadeDetailTable, { type DetailRow } from "@/components/RentabilidadeDetailTable";
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
  /** Decide a linha abaixo do nome: cota so existe em fundo, cotacao em moeda. */
  tipo: "fundo" | "moeda" | "acao" | "renda_fixa" | "outro";
  nome: string;
  /** CNPJ da classe, nos fundos. Vai junto do nome, como no Gorila. */
  cnpj: string | null;
  /** Instituição (custodiante) da posição: a primeira informação abaixo do nome. */
  instituicao?: string | null;
  /** Dia do encerramento da posição de fundo, quando encerrada: substitui a última cota. */
  encerradaEm?: string | null;
  valorAtualizado: number;
  pnl: number;
  /** Ja em %, a mesma da linha da Posição Consolidada. */
  rentabilidadePct: number;
  /** CDI acumulado na janela da posicao, em %. */
  cdiAcumuladoPct: number | null;
  ultimoPreco: number | null;
  dataUltimoPreco: string | null;
  /** Rentabilidade acumulada da posicao, do CDI e do Ibovespa, dia util a dia util. */
  grafico: PontoRentabilidade[];
  /** Rentabilidade e CDI por mes e por ano, na janela da posicao. */
  tabelaRentabilidade: DetailRow[];
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

/**
 * Detalhes da posição, na gaveta lateral (modelo do Gorila, com os ajustes do Daniel em
 * 11/09/2026): começa pelo nome do ativo com a última cota divulgada logo abaixo; o resumo é o
 * MESMO do dashboard (Patrimônio, Ganho Financeiro, Rentabilidade, CDI Acumulado, % do CDI);
 * gráfico de rentabilidade; tabela de rentabilidade por ano; histórico paginado.
 *
 * Abre na Posição Consolidada e na lâmina de Fundos de Investimentos, com os mesmos números
 * (a conta está em `lib/detalheDaPosicao`).
 *
 * A gaveta não fecha ao clicar fora dela: com ela aberta o cliente usa o header (cadastrar
 * transação, trocar a data), e a boleta, o calendário e os menus do header abrem em camadas
 * próprias, fora do header. Fecha no X.
 *
 * A TIR que o Gorila mostra fica para depois (decisão do Daniel).
 */
export default function PosicaoDetalheDialog({ open, onClose, data, userId, dataReferenciaISO, onDataChanged }: Props) {
  const { abrirBoleta } = useBoleta();
  const [movs, setMovs] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<Movimentacao | null>(null);
  const [pagina, setPagina] = useState(0);

  // Recarrega tambem depois de um recalculo (transacao nova, outra data de referencia).
  useEffect(() => {
    if (open) fetchMovs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.codigoCustodia, data.valorAtualizado, dataReferenciaISO]);

  useEffect(() => {
    setPagina(0);
  }, [data.codigoCustodia]);

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

  const temPreco = data.tipo === "fundo" || data.tipo === "moeda" || data.tipo === "acao";
  const rotuloDoPreco = data.tipo === "moeda" ? "Última cotação divulgada" : data.tipo === "acao" ? "Último preço" : "Última cota divulgada";
  const sobreCdi = data.cdiAcumuladoPct != null && data.cdiAcumuladoPct > 0
    ? (data.rentabilidadePct / data.cdiAcumuladoPct) * 100
    : null;

  // O mesmo resumo do dashboard (Carteira de Investimentos), na mesma ordem.
  const resumo = [
    { rotulo: "Patrimônio", valor: fmtBrl(data.valorAtualizado) },
    { rotulo: "Ganho Financeiro", valor: fmtBrl(data.pnl) },
    { rotulo: "Rentabilidade", valor: fmtPct(data.rentabilidadePct) },
    { rotulo: "CDI Acumulado", valor: fmtPct(data.cdiAcumuladoPct) },
    { rotulo: "% do CDI", valor: fmtPct(sobreCdi) },
  ];

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
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">Detalhes da posição</SheetTitle>
          <SheetDescription className="sr-only">{data.nome}</SheetDescription>

          <div className="space-y-5 px-6 py-5">
            {/* Nome; abaixo dele, primeiro a instituicao e, ao lado, a ultima cota ou o encerramento
                da posicao de fundo (Daniel, 12/09/2026). */}
            <div className="space-y-1 pr-8">
              <h4 className="text-base font-bold text-foreground break-words">
                {data.nome}
                {data.cnpj ? ` - ${formatarCnpj(data.cnpj)}` : ""}
              </h4>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {data.instituicao && <p className="font-semibold text-foreground">{data.instituicao}</p>}
                {data.tipo === "fundo" && data.encerradaEm ? (
                  <p>
                    Fundo encerrado em{" "}
                    <span className="font-semibold text-foreground tabular-nums">{fmtData(data.encerradaEm)}</span>
                  </p>
                ) : temPreco ? (
                  <Info
                    rotulo={`${rotuloDoPreco}${data.dataUltimoPreco ? ` (${fmtData(data.dataUltimoPreco)})` : ""}`}
                    valor={fmtPreco(data.ultimoPreco)}
                  />
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
            </div>

            {/* Resumo: os cartoes do dashboard */}
            <div className="grid grid-cols-5 gap-3">
              {resumo.map((item) => (
                <div key={item.rotulo} className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.rotulo}</p>
                  <p className="mt-2 text-lg font-bold text-foreground tabular-nums">{item.valor}</p>
                </div>
              ))}
            </div>

            {/* Grafico */}
            {data.grafico.length > 1 && (
              <HistoricoRentabilidadeChart
                dados={data.grafico}
                chaveSerie="posicao_acumulado"
                rotuloSerie="Posição"
              />
            )}

            {/* Tabela de rentabilidade: o mesmo elemento das lâminas, só com Rentabilidade e % do CDI */}
            {data.tabelaRentabilidade.length > 0 && (
              <RentabilidadeDetailTable
                rows={data.tabelaRentabilidade}
                tituloLabel={data.nome}
                linhas={["rentabilidade", "percentualCdi"]}
                compacto
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
                                      onClick={() => abrirBoleta(m.id)}
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

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p>
      <span>{rotulo}: </span>
      <span className="font-semibold text-foreground tabular-nums">{valor}</span>
    </p>
  );
}
