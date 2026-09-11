import { useEffect, useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import { calcularAlocacaoPorGrupo } from "@/lib/alocacaoPorGrupo";
import { useIbovespa } from "@/hooks/useIbovespa";
import { useCarteiraInvestimentos } from "@/hooks/useCarteiraInvestimentos";
import AlocacaoBloco from "@/components/AlocacaoBloco";
import LinguetaDeData from "@/components/LinguetaDeData";
import { SEM_DADOS, montarGraficoETabela, serieDoProduto, type DadosDaPosicao } from "@/lib/detalheDaPosicao";
import { fullSyncAfterDelete } from "@/lib/syncEngine";
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

/** O cadastro da posição: o que a boleta, a exclusão e a gaveta precisam. Os números vêm dos hooks. */
interface CustodiaProduct {
  id: string;
  codigo_custodia: string;
  nome: string | null;
  data_inicio: string;
  taxa: number | null;
  modalidade: string | null;
  preco_unitario: number | null;
  categoria_nome: string;
  categoria_id: string;
  produto_nome: string;
  produto_id: string;
  resgate_total: string | null;
  pagamento: string | null;
  vencimento: string | null;
  indexador: string | null;
  valor_investido: number;
  instituicao_nome: string;
  instituicao_id: string | null;
  emissor_nome: string | null;
  emissor_id: string | null;
  fundo_id: string | null;
  moeda: string | null;
  acao_id: string | null;
  fundoCnpj: string | null;
}

interface PosicaoRow {
  nome: string;
  valorAtualizado: number;
  ganhoFinanceiro: number;
  rentabilidade: number;
  custodiante: string;
  ativo: boolean;
  product: CustodiaProduct;
  dados: DadosDaPosicao;
  /** Fim do período do produto (`src/lib/periodo.ts`). */
  fim: string | null;
  lingueta: string | null;
  /** Linhas diárias do motor da posição: a série do gráfico da gaveta sai delas. */
  linhas: DailyRow[];
}

// Cadastro das posições entre navegações: evita a tabela piscar vazia enquanto a busca volta.
let _cachedCustodias: Map<string, CustodiaProduct> = new Map();

/**
 * Posição Consolidada.
 *
 * Desde 11/09/2026 (etapa 6 do período) a tela não calcula nada por conta própria: as linhas vêm de
 * `useCarteiraInvestimentos`, os mesmos hooks das lâminas. Antes ela tinha uma cópia inteira da conta,
 * e a cópia já divergia: ações apareciam com ganho e rentabilidade zero, moeda com rentabilidade
 * money-weighted e o total não fechava com a carteira de Investimentos.
 */
export default function PosicaoConsolidadaPage() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const {
    carteiraInfo, loading, produtos, calendario, periodo, resumo, cdiRecords,
  } = useCarteiraInvestimentos();
  const ibovespa = useIbovespa();
  const [custodias, setCustodias] = useState<Map<string, CustodiaProduct>>(_cachedCustodias);
  const [search, setSearch] = useState("");

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTipo, setDialogTipo] = useState<"Aplicação" | "Resgate">("Aplicação");
  const [dialogRow, setDialogRow] = useState<CustodiaRowForBoleta | null>(null);
  const [deleteRow, setDeleteRow] = useState<PosicaoRow | null>(null);
  const [detalheRow, setDetalheRow] = useState<PosicaoRow | null>(null);

  useEffect(() => {
    if (!user) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("custodia")
        .select("id, codigo_custodia, nome, data_inicio, taxa, modalidade, preco_unitario, valor_investido, resgate_total, pagamento, vencimento, indexador, categoria_id, produto_id, instituicao_id, emissor_id, fundo_id, moeda, acao_id, categorias(nome), produtos(nome), instituicoes(nome), emissores(nome), cadastro_de_fundos(cnpj_classe)")
        .eq("user_id", user.id);
      if (!vivo) return;
      const mapa = new Map<string, CustodiaProduct>();
      for (const r of (data || []) as any[]) {
        mapa.set(String(r.codigo_custodia), {
          id: r.id,
          codigo_custodia: String(r.codigo_custodia),
          nome: r.nome,
          data_inicio: r.data_inicio,
          taxa: r.taxa,
          modalidade: r.modalidade,
          preco_unitario: r.preco_unitario,
          categoria_nome: r.categorias?.nome || "",
          categoria_id: r.categoria_id,
          produto_nome: r.produtos?.nome || "",
          produto_id: r.produto_id,
          resgate_total: r.resgate_total,
          pagamento: r.pagamento,
          vencimento: r.vencimento,
          indexador: r.indexador,
          valor_investido: Number(r.valor_investido),
          instituicao_nome: r.instituicoes?.nome || "—",
          instituicao_id: r.instituicao_id,
          emissor_nome: r.emissores?.nome || null,
          emissor_id: r.emissor_id,
          fundo_id: r.fundo_id ?? null,
          moeda: r.moeda ?? null,
          acao_id: r.acao_id ?? null,
          fundoCnpj: r.cadastro_de_fundos?.cnpj_classe ?? null,
        });
      }
      _cachedCustodias = mapa;
      setCustodias(mapa);
    })();
    return () => {
      vivo = false;
    };
  }, [user, appliedVersion]);

  /** Uma linha por posição, com os números da lâmina dela. */
  const rows = useMemo<PosicaoRow[]>(() => {
    const lista: PosicaoRow[] = [];
    const comMotor = new Set<string>();
    for (const { item, rows: linhas } of produtos) {
      const codigo = String(item.analysisProduct.codigo_custodia);
      comMotor.add(codigo);
      // A lâmina não lista posição que não existiu no período; aqui também não.
      if (item.existiuNaJanela === false) continue;
      const product = custodias.get(codigo);
      if (!product) continue;
      lista.push({
        nome: item.nome,
        valorAtualizado: item.valorAtualizado,
        ganhoFinanceiro: item.ganhoFinanceiro,
        rentabilidade: item.rentabilidade,
        custodiante: item.custodiante,
        ativo: item.ativo,
        product,
        dados: item.dados ?? SEM_DADOS,
        fim: item.fim ?? null,
        lingueta: item.lingueta ?? null,
        linhas,
      });
    }
    // Categoria ainda sem motor (ex.: Tesouro Direto): entra só com o valor investido.
    for (const product of custodias.values()) {
      if (comMotor.has(product.codigo_custodia)) continue;
      lista.push({
        nome: product.nome || product.produto_nome,
        valorAtualizado: product.valor_investido,
        ganhoFinanceiro: 0,
        rentabilidade: 0,
        custodiante: product.instituicao_nome,
        ativo: true,
        product,
        dados: { ...SEM_DADOS, valorInvestido: product.valor_investido },
        fim: null,
        lingueta: null,
        linhas: [],
      });
    }
    return lista;
  }, [produtos, custodias]);

  // Alocacao por instituicao. Cada grupo passa pelo motor de carteira com as linhas das posicoes dele.
  const alocacaoInstituicao = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) return [];
    const gruposIdx = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.linhas.length === 0) return;
      const inst = r.custodiante || "—";
      if (!gruposIdx.has(inst)) gruposIdx.set(inst, []);
      gruposIdx.get(inst)!.push(i);
    });
    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows: rows.map((r) => r.linhas),
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
    });
  }, [rows, calendario, cdiRecords, carteiraInfo, dataReferenciaISO]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter((r) => r.nome.toLowerCase().includes(term));
  }, [rows, search]);

  const totalValor = useMemo(() => filteredRows.reduce((s, r) => s + r.valorAtualizado, 0), [filteredRows]);
  const totalGanho = useMemo(() => filteredRows.reduce((s, r) => s + r.ganhoFinanceiro, 0), [filteredRows]);

  // Boleta helpers
  function openBoleta(row: PosicaoRow, tipo: "Aplicação" | "Resgate", e?: React.MouseEvent) {
    e?.stopPropagation();
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
      await fullSyncAfterDelete(p.codigo_custodia, p.categoria_id, user.id, dataReferenciaISO);
      applyDataReferencia();
    }
    setDeleteRow(null);
  }

  function getDetalheData(row: PosicaoRow): PosicaoDetalheData {
    const p = row.product;
    const tipo = p.fundo_id ? "fundo" : p.moeda ? "moeda" : p.acao_id ? "acao" : p.categoria_nome === "Renda Fixa" ? "renda_fixa" : "outro";
    const dados = row.dados;

    // Periodo da posicao, o mesmo da linha da lamina (`src/lib/periodo.ts`): CDI, grafico e tabela
    // param no fim dele.
    const inicio = p.data_inicio;
    const fim = row.fim ?? periodo.dataGlobal;
    const { grafico, cdiAcumuladoPct, tabela } = montarGraficoETabela({
      serie: serieDoProduto(row.linhas, calendario, inicio, fim),
      cdiRecords, ibovespa, inicio, fim,
    });

    return {
      tipo,
      nome: row.nome,
      cnpj: p.fundoCnpj ?? null,
      valorAtualizado: row.valorAtualizado,
      pnl: row.ganhoFinanceiro,
      rentabilidadePct: row.rentabilidade,
      cdiAcumuladoPct,
      ultimoPreco: dados.ultimoPreco,
      dataUltimoPreco: dados.dataUltimoPreco,
      grafico,
      tabelaRentabilidade: tabela,
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

  const detalheData = useMemo(
    () => (detalheRow ? getDetalheData(detalheRow) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detalheRow, cdiRecords, calendario, periodo, ibovespa],
  );

  // Depois de um recalculo (transacao nova pelo header, outra data de referencia) a gaveta aberta
  // passa a mostrar a linha recalculada da mesma posicao. Sem isto ela ficaria com os numeros de
  // antes, ja que nao fecha mais ao clicar fora.
  useEffect(() => {
    if (!detalheRow) return;
    const atual = rows.find((r) => r.product.id === detalheRow.product.id);
    if (!atual) setDetalheRow(null);
    else if (atual !== detalheRow) setDetalheRow(atual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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
                    <TableCell className="whitespace-nowrap text-sm text-right font-medium">
                      {pctPortfolio.toFixed(2)}%
                      <LinguetaDeData data={row.lingueta} dataGlobal={periodo.dataGlobal} />
                    </TableCell>
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
                <TableCell className="text-sm">{resumo.rent != null ? `${resumo.rent.toFixed(2)}%` : "—"}</TableCell>
                <TableCell />
                <TableCell className="whitespace-nowrap text-sm text-right">
                  100,00%
                  <LinguetaDeData data={periodo.lingueta} dataGlobal={periodo.dataGlobal} />
                </TableCell>
                <TableCell />
              </TableRow>
              </>
            )}
            </TableBody>
          </Table>
      </TabelaCartao>

      {/* Alocação por instituição: saiu do dashboard em 07/09/2026 e vive aqui. */}
      <div className="mt-6">
        <AlocacaoBloco
          titulo="Posição Consolidada por Instituição"
          colunaLabel="Instituição"
          linhas={alocacaoInstituicao}
          totalPatrimonio={alocacaoInstituicao.reduce((s, l) => s + l.patrimonio, 0)}
          totalGanho={totalGanho}
          totalRent={resumo.rent}
          totalCdi={resumo.cdiAcum}
          totalSobreCdi={resumo.sobreCdi}
          dataLabel={new Date((carteiraInfo?.data_calculo ?? dataReferenciaISO) + "T00:00:00").toLocaleDateString("pt-BR")}
          linguetaTotal={periodo.lingueta}
          dataGlobal={periodo.dataGlobal}
        />
      </div>

      {/* Boleta */}
      {dialogRow && user && (
        <BoletaCustodiaDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          tipo={dialogTipo}
          row={dialogRow}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onSuccess={() => applyDataReferencia()}
        />
      )}

      {/* Detalhe */}
      {detalheRow && detalheData && user && (
        <PosicaoDetalheDialog
          open={!!detalheRow}
          onClose={() => setDetalheRow(null)}
          data={detalheData}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onDataChanged={() => applyDataReferencia()}
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
