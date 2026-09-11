import { useMemo } from "react";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useCarteiraInvestimentos } from "@/hooks/useCarteiraInvestimentos";
import { HistoricoRentabilidadeChart } from "@/components/HistoricoRentabilidadeChart";
import { buildCdiSeries, buildIbovespaSeries } from "@/lib/cdiCalculations";
import { calcularAlocacaoPorGrupo } from "@/lib/alocacaoPorGrupo";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import AlocacaoBloco from "@/components/AlocacaoBloco";
import PatrimonioChart, { serieDePatrimonio } from "@/components/PatrimonioChart";
import { useBoleta } from "@/contexts/BoletaContext";
import LinguetaDeData from "@/components/LinguetaDeData";




const fmtBrlValue = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtPctValue = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");



export const CarteiraVisaoGeral = () => {
  const { abrirBoleta } = useBoleta();
  const { dataReferenciaISO } = useDataReferencia();

  // A carteira de Investimentos é montada num lugar só, junto com a Posição Consolidada: as
  // quatro carteiras por categoria somadas pelo mesmo motor (`useCarteiraInvestimentos`).
  const {
    carteiraInfo, notFound, loading: carregando, productList, allProductRows, calendario, periodo,
    periodoPorCategoria, carteiraRows, detailRows, resumo, cdiRecords, ibovespaData, allCustodiaForCategoria,
  } = useCarteiraInvestimentos();

  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio || carteiraRows.length === 0) return [];

    const cdiSeries = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);

    const map = new Map<string, any>();
    for (const p of cdiSeries) {
      map.set(p.data, { data: p.data, label: p.label, cdi_acumulado: p.cdi_acumulado });
    }

    for (const r of carteiraRows) {
      // So dia util no grafico: o motor de carteira emite linha todo dia do calendario, e
      // fim de semana virava ponto repetido.
      if (!r.diaUtil) continue;
      if (r.liquido <= 0 && r.liquido2 <= 0) continue;
      const label = new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR");
      const existing = map.get(r.data) || { data: r.data, label };
      existing.carteira_acumulado = parseFloat((r.rentAcumuladaPct * 100).toFixed(4));
      map.set(r.data, existing);
    }

    const ibov = buildIbovespaSeries(ibovespaData, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);
    for (const [data, valor] of ibov) {
      const label = new Date(data + "T00:00:00").toLocaleDateString("pt-BR");
      const existing = map.get(data) || { data, label };
      existing.ibovespa_acumulado = valor;
      map.set(data, existing);
    }

    return Array.from(map.values()).sort((a: any, b: any) => a.data.localeCompare(b.data));
  }, [carteiraRows, cdiRecords, ibovespaData, carteiraInfo]);

  /** Evolução do patrimônio (líquido) até a data de referência. */
  const patrimonioChartData = useMemo(
    () => serieDePatrimonio(carteiraRows, dataReferenciaISO),
    [carteiraRows, dataReferenciaISO],
  );

  /** Cada grupo passa pelo mesmo motor de carteira, para a rentabilidade da
   *  linha ser comparável com a do card (time-weighted, não ganho/capital). */
  const alocacaoCategoria = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) return [];

    const gruposIdx = new Map<string, number[]>();
    productList.forEach((p, i) => {
      const cat = p.analysisProduct?.categoria_nome || "Outros";
      if (!gruposIdx.has(cat)) gruposIdx.set(cat, []);
      gruposIdx.get(cat)!.push(i);
    });

    // Categorias ainda sem motor entram só com o valor em custódia.
    const comMotor = new Set(gruposIdx.keys());
    const extrasMap = new Map<string, number>();
    for (const c of allCustodiaForCategoria) {
      if (comMotor.has(c.categoria_nome)) continue;
      const valor = c.custodia_no_dia != null ? c.custodia_no_dia : c.valor_investido;
      extrasMap.set(c.categoria_nome, (extrasMap.get(c.categoria_nome) || 0) + valor);
    }

    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows,
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
      extras: Array.from(extrasMap, ([nome, patrimonio]) => ({ nome, patrimonio })),
      // Cada categoria é uma carteira e termina no fim dela, não no da carteira de Investimentos.
      periodoPorGrupo: periodoPorCategoria,
    });
  }, [productList, allProductRows, allCustodiaForCategoria, calendario, cdiRecords, carteiraInfo, dataReferenciaISO,
    periodoPorCategoria]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const renderStatusMessage = () => {
    if (!carteiraInfo) return null;
    if (carteiraInfo.status === "Ativa") {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          Período de Análise: De {fmtDate(carteiraInfo.data_inicio)} a {fmtDate(carteiraInfo.data_calculo)}
          <LinguetaDeData data={periodo.lingueta} dataGlobal={periodo.dataGlobal} />
        </p>
      );
    }
    if (carteiraInfo.status === "Não Iniciada") {
      return (
        <p className="text-sm text-muted-foreground mt-1">
          Data selecionada anterior ao início dos seus investimentos. Início em {fmtDate(carteiraInfo.data_inicio)}
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

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Carteira de Investimentos</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <p className="text-muted-foreground">Você ainda não possui investimentos cadastrados.</p>
          <button
            onClick={() => abrirBoleta()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Cadastrar primeira operação
          </button>
        </div>
      </div>
    );
  }

  const showContent = carteiraInfo?.status === "Ativa" || carteiraInfo?.status === "Encerrada";
  const dataLabel = fmtDate(carteiraInfo?.data_calculo ?? null);

  const summaryCards = [
    { label: "Patrimônio", value: fmtBrlValue(resumo.patrimonio) },
    { label: "Ganho Financeiro", value: fmtBrlValue(resumo.ganho) },
    { label: "Rentabilidade", value: fmtPctValue(resumo.rent) },
    { label: "CDI Acumulado", value: fmtPctValue(resumo.cdiAcum) },
    { label: "% do CDI", value: fmtPctValue(resumo.sobreCdi) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Carteira de Investimentos</h1>
        {renderStatusMessage()}
      </div>

      {showContent && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {summaryCards.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-bold text-foreground">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Gráficos lado a lado: rentabilidade (metade) + patrimônio */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HistoricoRentabilidadeChart
              dados={chartData}
              chaveSerie="carteira_acumulado"
              rotuloSerie="Investimentos"
            />

            <PatrimonioChart dados={patrimonioChartData} />
          </div>

          {/* Tabela de rentabilidade: mesmo layout das demais lâminas, com anos anteriores */}
          <RentabilidadeDetailTable rows={detailRows} tituloLabel="Investimentos" />

          {/* O bloco por Instituicao saiu daqui e vive agora na Posicao Consolidada. */}
          <AlocacaoBloco
            titulo="Posição Consolidada por Categoria"
            colunaLabel="Categoria"
            linhas={alocacaoCategoria}
            totalPatrimonio={alocacaoCategoria.reduce((s, l) => s + l.patrimonio, 0)}
            totalGanho={resumo.ganho}
            totalRent={resumo.rent}
            totalCdi={resumo.cdiAcum}
            totalSobreCdi={resumo.sobreCdi}
            dataLabel={dataLabel}
            linguetaTotal={periodo.lingueta}
            dataGlobal={periodo.dataGlobal}
          />
        </>
      )}
    </div>
  );
};

export { default as CarteiraRendaFixa } from "./CarteiraRendaFixaPage";
export { default as CarteiraRendaVariavel } from "./CarteiraAcoesPage";
export { default as CarteiraFundos } from "./CarteiraFundosPage";
export { default as CarteiraMoedas } from "./CarteiraMoedasPage";
export const CarteiraTesouroDireto = () => <PageStub title="Tesouro Direto" />;
export { default as CarteiraAnaliseIndividual } from "./AnaliseIndividualPage";
export { default as Movimentacoes } from "./MovimentacoesPage";
export { default as Eventos } from "./EventosPage";
export { default as Configuracoes } from "./ConfiguracoesPage";
export const Usuario = () => <PageStub title="Usuário" />;
export { default as Admin } from "./AdminPage";
export { default as Custodia } from "./CustodiaPage";
export { default as ControleCarteiras } from "./ControleCarteirasPage";

const PageStub = ({ title }: { title: string }) => (
  <div>
    <h1 className="text-lg font-semibold text-foreground">{title}</h1>
  </div>
);
