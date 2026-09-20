import { useEffect, useMemo, useState } from "react";
import { useBoleta } from "@/contexts/BoletaContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { type DetailRow } from "@/components/RentabilidadeDetailTable";
import RentabilidadePorAnoTable from "@/components/RentabilidadePorAnoTable";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
import {
  textoConfirmacaoDeExclusao, AVISO_EXCLUSAO_ATIVO, AVISO_EXCLUSAO_MOVIMENTACAO, TITULO_CONFIRMACAO_DE_EXCLUSAO,
} from "@/lib/confirmacaoDeExclusao";
import { formatarCnpj } from "@/components/FundoSelect";
import { saidaSemSaldoNaPosicaoDeFundo } from "@/lib/validacaoBoleta";
import AlertaFundoSemCota from "@/components/AlertaFundoSemCota";
import type { AlertaSemCota } from "@/lib/alertaDeFundo";
import { ehMigracao, excluirContrapartesDeMigracao, excluirMigracao } from "@/lib/migracaoDeFundo";

interface Movimentacao {
  id: string;
  data: string;
  tipo_movimentacao: string;
  valor: number;
  preco_unitario: number | null;
  /** Quantidade negociada. Em renda variável é a coluna que o extrato mostra. */
  quantidade: number | null;
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
  /** Razão social da empresa, em ação: vai abaixo do código do ativo. */
  razaoSocial?: string | null;
  /** Fim do período de análise da posição (a linha "Período de Análise"). */
  dataFim?: string | null;
  /** Dados da posição mostrados abaixo do resumo, em renda variável. */
  valorInvestido?: number | null;
  quantidade?: number | null;
  precoMedio?: number | null;
  /** Proventos recebidos no período, em reais. */
  proventos?: number | null;
  /** Dia do encerramento da posição de fundo, quando encerrada: substitui a última cota. */
  encerradaEm?: string | null;
  /** Fundo sem cota da CVM: "!" ao lado do nome, com encerrar ou migrar. */
  alertaSemCota?: AlertaSemCota | null;
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
/** Quantidade sem casas quando é inteira (ações), com até 8 quando é fracionada. */
const fmtQtd = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const fmtPct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Detalhes da posição, na gaveta lateral (modelo do Gorila, com os ajustes do Daniel em
 * 11/09/2026): começa pelo nome do ativo com a última cota divulgada logo abaixo; o resumo é o
 * MESMO do dashboard (Patrimônio, Ganho Financeiro, Rentabilidade, % do CDI);
 * gráfico de rentabilidade; tabela de rentabilidade por ano; histórico paginado.
 *
 * Abre na Posição Consolidada e nas lâminas de Renda Fixa, Fundos, Moedas e Ações, com os mesmos
 * números (a conta está em `lib/detalheDaPosicao`).
 *
 * A gaveta não fecha ao clicar fora dela: com ela aberta o cliente usa o header (cadastrar
 * transação, trocar a data), e a boleta, o calendário e os menus do header abrem em camadas
 * próprias, fora do header. Fecha no X.
 *
 * A TIR que o Gorila mostra fica para depois (decisão do Daniel).
 */
export default function PosicaoDetalheDialog({ open, onClose, data, userId, dataReferenciaISO, onDataChanged }: Props) {
  const { abrirBoleta } = useBoleta();
  /** Ação é o único tipo com quantidade no extrato e com boleta de compra e venda. */
  const ehRendaVariavel = data.tipo === "acao";
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
      .select("id, data, tipo_movimentacao, valor, quantidade, preco_unitario, origem, created_at")
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
      // Migracao de fundo: a outra ponta, na outra posicao, sai junto.
      const contraparte = await excluirContrapartesDeMigracao(userId, data.codigoCustodia, dataReferenciaISO);
      if (contraparte) {
        toast.error(contraparte);
        setDeleteId(null);
        return;
      }
      await supabase.from("movimentacoes").delete().eq("codigo_custodia", data.codigoCustodia).eq("user_id", userId);
      await supabase.from("custodia").delete().eq("codigo_custodia", data.codigoCustodia).eq("user_id", userId);
      toast.success(AVISO_EXCLUSAO_ATIVO);
      await fullSyncAfterDelete(data.codigoCustodia, data.categoriaId, userId, dataReferenciaISO);
      onDataChanged();
      setDeleteId(null);
      onClose();
      return;
    }

    // Migracao de fundo: as duas pontas saem juntas (Daniel, 12/09/2026).
    if (ehMigracao(mov.tipo_movimentacao)) {
      const msg = await excluirMigracao(userId, mov.id, dataReferenciaISO);
      if (msg) {
        toast.error(msg);
      } else {
        toast.success(AVISO_EXCLUSAO_MOVIMENTACAO);
        onDataChanged();
        fetchMovs();
      }
      setDeleteId(null);
      return;
    }

    // Fundo: excluir nao pode deixar sem saldo um resgate ou come-cotas posterior (Daniel, 12/09/2026).
    if (data.tipo === "fundo") {
      const semSaldo = await saidaSemSaldoNaPosicaoDeFundo(userId, data.codigoCustodia, (ms) => ms.filter((m) => m.id !== mov.id));
      if (semSaldo) {
        toast.error(semSaldo);
        setDeleteId(null);
        return;
      }
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

  // Acao NAO mostra o ultimo preco (Daniel, 19/09/2026): a gaveta dela ja tem o extrato com preco
  // por operacao, e o preco de fechamento do dia nao diz nada sobre a posicao. Fundo e moeda
  // seguem mostrando, porque ali a cota e a cotacao sao a unica referencia de valor na tela.
  const temPreco = data.tipo === "fundo" || data.tipo === "moeda";
  const rotuloDoPreco = data.tipo === "moeda" ? "Última cotação divulgada" : "Última cota divulgada";
  const sobreCdi = data.cdiAcumuladoPct != null && data.cdiAcumuladoPct > 0
    ? (data.rentabilidadePct / data.cdiAcumuladoPct) * 100
    : null;

  // O mesmo resumo do dashboard (Carteira de Investimentos), na mesma ordem.
  const resumo = [
    { rotulo: "Patrimônio", valor: fmtBrl(data.valorAtualizado) },
    { rotulo: "Ganho Financeiro", valor: fmtBrl(data.pnl) },
    { rotulo: "Rentabilidade", valor: fmtPct(data.rentabilidadePct) },
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
            {/*
              Cabecalho. Em acao (Daniel, 19/09/2026): o codigo do ativo, a razao social embaixo
              dele e o periodo de analise - nada de custodiante, emissor, indexador, taxa,
              pagamento e vencimento, que sao termos de renda fixa e vinham todos vazios. O botao
              "Nova Operação" sobe para o canto superior direito, ao lado do X de fechar.
            */}
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0 space-y-1">
                <h4 className="text-base font-bold text-foreground break-words">
                  {data.nome}
                  {data.cnpj ? ` - ${formatarCnpj(data.cnpj)}` : ""}
                  {data.alertaSemCota && (
                    <span className="ml-2 inline-flex align-middle">
                      <AlertaFundoSemCota alerta={data.alertaSemCota} />
                    </span>
                  )}
                </h4>
                {ehRendaVariavel && data.razaoSocial && (
                  <p className="text-sm text-muted-foreground break-words">{data.razaoSocial}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {!ehRendaVariavel && data.instituicao && (
                    <p className="font-semibold text-foreground">{data.instituicao}</p>
                  )}
                  {ehRendaVariavel ? null : data.tipo === "fundo" && data.encerradaEm ? (
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
                <p className="text-xs text-muted-foreground">
                  Período de Análise: de {fmtData(data.dataInicio)} a {fmtData(data.dataFim ?? null)}
                </p>
              </div>

              {/*
                A direcao e escolhida ANTES de abrir a boleta (Daniel, 20/09/2026). Ate 19/09 o
                botao abria a boleta com o tipo em branco; perguntar aqui protege do mesmo jeito
                contra uma venda lancada como compra, e poupa um passo la dentro.
              */}
              {ehRendaVariavel && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-xs">
                      <Plus className="h-3.5 w-3.5" />
                      Nova Operação
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[8rem]">
                    {(["Compra", "Venda"] as const).map((direcao) => (
                      <DropdownMenuItem
                        key={direcao}
                        className="cursor-pointer text-sm"
                        onClick={() =>
                          abrirBoleta(null, {
                            tipo: "negociar_posicao",
                            codigoCustodia: data.codigoCustodia,
                            direcao,
                          })
                        }
                      >
                        {direcao}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/*
              Painel unico (Daniel, 19/09/2026). Antes eram dois blocos: quatro cartoes soltos em
              cima e uma faixa cinza embaixo. Virou um cartao branco so.

              Sem linha vertical entre as colunas (Daniel, 20/09/2026): o alinhamento das colunas
              ja separa, e o traco horizontal entre as duas filas basta para dizer que sao duas
              naturezas de informacao.

              A hierarquia continua: em cima o resultado, com numero grande; embaixo a composicao
              da posicao, menor. Sao coisas diferentes e nao devem competir.
            */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="grid grid-cols-4">
                {resumo.map((item) => (
                  <div key={item.rotulo} className="min-w-0 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.rotulo}</p>
                    <p className="mt-2 truncate text-lg font-bold text-foreground tabular-nums">{item.valor}</p>
                  </div>
                ))}
              </div>

              {ehRendaVariavel && (
                <div className="grid grid-cols-4 border-t border-border">
                  {[
                    { rotulo: "Valor Investido", valor: fmtBrl(data.valorInvestido ?? null) },
                    { rotulo: "Quantidade", valor: fmtQtd(data.quantidade ?? null) },
                    // Duas casas, e nao as ate 8 do `fmtPreco` (Daniel, 19/09/2026): o preco
                    // medio e uma media de precos pagos, e a oitava casa dela nao e informacao.
                    { rotulo: "Preço Médio", valor: fmtBrl(data.precoMedio ?? null) },
                    // Provento em REAIS, e nao o dividend yield (Daniel, 19/09/2026): o yield
                    // sobre a janela de analise nao e anualizado, entao nao se compara nem com o
                    // CDI nem com outro papel - mede sem informar. O valor recebido e fato.
                    { rotulo: "Proventos", valor: fmtBrl(data.proventos ?? null) },
                  ].map((item) => (
                    <div key={item.rotulo} className="min-w-0 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {item.rotulo}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground tabular-nums">
                        {item.valor}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grafico */}
            {data.grafico.length > 1 && (
              <HistoricoRentabilidadeChart
                dados={data.grafico}
                chaveSerie="posicao_acumulado"
                rotuloSerie="Posição"
              />
            )}

            {/* Uma linha de rentabilidade por ano, sem o "% do CDI" (Daniel, 19/09/2026). */}
            {data.tabelaRentabilidade.length > 0 && (
              <RentabilidadePorAnoTable rows={data.tabelaRentabilidade} />
            )}

            {/* Historico */}
            <section className="space-y-2">
              {/* O botao "Nova Operação" mora no canto superior direito da gaveta (Daniel,
                  19/09/2026); aqui ficou so o titulo. */}
              <h6 className="text-sm font-bold text-foreground">Histórico</h6>
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Carregando...</p>
              ) : movs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Nenhuma movimentação.</p>
              ) : (
                <>
                  {/*
                    `table-fixed` com largura por coluna (Daniel, 19/09/2026): sem isso o navegador
                    distribui pelo conteudo, e a largura de cada coluna mudava de pagina para
                    pagina conforme o maior numero da vez - a tabela parecia desalinhada porque
                    ela literalmente se remontava a cada troca de pagina. Data e Tipo a esquerda,
                    os tres numericos a direita e com a mesma largura, e os botoes no fim.
                  */}
                  {/* Fundo branco, como o painel de cima e a tabela de rentabilidade (Daniel,
                      20/09/2026). `overflow-hidden` para o cabecalho nao vazar do canto arredondado. */}
                  <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[96px] text-xs">Data</TableHead>
                          <TableHead className="w-[132px] text-xs">Tipo</TableHead>
                          {ehRendaVariavel && <TableHead className="text-xs text-right">Quantidade</TableHead>}
                          {/* "Valor da Cota" é o vocabulário de fundo; em ação o que existe é preço. */}
                          <TableHead className="text-xs text-right">{ehRendaVariavel ? "Preço" : "Valor da Cota"}</TableHead>
                          <TableHead className="text-xs text-right">Valor total</TableHead>
                          <TableHead className="w-[76px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movsDaPagina.map((m) => {
                          const isAuto = m.origem === "automatico";
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="w-[96px] whitespace-nowrap text-sm tabular-nums">{fmtData(m.data)}</TableCell>
                              <TableCell className="w-[132px] truncate text-sm">{m.tipo_movimentacao}</TableCell>
                              {ehRendaVariavel && (
                                <TableCell className="truncate text-sm text-right tabular-nums">{fmtQtd(m.quantidade)}</TableCell>
                              )}
                              <TableCell className="truncate text-sm text-right tabular-nums">{fmtPreco(m.preco_unitario)}</TableCell>
                              <TableCell className="truncate text-sm text-right tabular-nums">{fmtBrl(m.valor)}</TableCell>
                              <TableCell className="w-[76px] text-right">
                                {!isAuto && (
                                  <div className="flex justify-end gap-1">
                                    {/* Migracao nao se edita: exclui-se o par e migra-se de novo. */}
                                    {!ehMigracao(m.tipo_movimentacao) && (
                                      <Button
                                        variant="ghost" size="icon" className="h-7 w-7" title="Editar"
                                        onClick={() => abrirBoleta(m.id)}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
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
