import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useAuth } from "@/hooks/useAuth";
import { useCarteiraRF } from "@/hooks/useCarteiraRF";
import { useCarteiraFundos } from "@/hooks/useCarteiraFundos";
import { useCarteiraMoedas } from "@/hooks/useCarteiraMoedas";
import { calcularCarteiraRendaFixa } from "@/lib/carteiraRendaFixaEngine";
import { HistoricoRentabilidadeChart } from "@/components/HistoricoRentabilidadeChart";
import { buildCdiSeries, buildIbovespaSeries } from "@/lib/cdiCalculations";
import { ateAData } from "@/lib/janelaDaCarteira";
import { buildCarteiraDetailRows } from "@/lib/detailRowsBuilder";
import { calcularAlocacaoPorGrupo } from "@/lib/alocacaoPorGrupo";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import AlocacaoBloco from "@/components/AlocacaoBloco";
import PatrimonioChart, { serieDePatrimonio } from "@/components/PatrimonioChart";
import { useBoleta } from "@/contexts/BoletaContext";
import LinguetaDeData from "@/components/LinguetaDeData";
import { dataGlobalEfetiva, periodoDaCarteira, type PeriodoDaCarteira } from "@/lib/periodo";




const fmtBrlValue = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtPctValue = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");



export const CarteiraVisaoGeral = () => {
  const { abrirBoleta } = useBoleta();
  const { user } = useAuth();
  const [carteiraInfoBruta, setCarteiraInfo] = useState<{
    nome_carteira: string;
    status: string;
    data_inicio: string | null;
    data_calculo: string | null;
  } | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const navigate = useNavigate();

  // Números vêm dos mesmos hooks que alimentam as lâminas por categoria: uma
  // fonte só por categoria, consolidadas aqui pelo motor de carteira.
  const {
    carteiraRows: rfCarteiraRows, allProductRows: rfProductRows, cdiRecords, ibovespaData,
    productList: rfProductList, allCustodiaForCategoria, calendario: rfCalendario,
    periodo: rfPeriodo, loading: rfLoading,
  } = useCarteiraRF();
  const {
    allProductRows: fundoProductRows, productList: fundoProductList,
    calendario: fundoCalendario, periodo: fundoPeriodo, loading: fundosLoading,
  } = useCarteiraFundos();
  const {
    allProductRows: moedaProductRows, productList: moedaProductList,
    periodo: moedaPeriodo, loading: moedasLoading,
  } = useCarteiraMoedas();
  const dadosLoading = rfLoading || fundosLoading || moedasLoading;

  const allProductRows = useMemo(
    () => [...rfProductRows, ...fundoProductRows, ...moedaProductRows],
    [rfProductRows, fundoProductRows, moedaProductRows],
  );
  const productList = useMemo(
    () => [...rfProductList, ...fundoProductList, ...moedaProductList],
    [rfProductList, fundoProductList, moedaProductList],
  );
  /** Calendário da união: os fundos começam antes da renda fixa nesta carteira. */
  const calendario = useMemo(() => {
    const map = new Map<string, { data: string; dia_util: boolean }>();
    for (const c of [...rfCalendario, ...fundoCalendario]) map.set(c.data, c);
    return Array.from(map.values()).sort((a, b) => a.data.localeCompare(b.data));
  }, [rfCalendario, fundoCalendario]);

  /**
   * Período da carteira de Investimentos: vai até o MAIOR fim entre as carteiras com posição
   * (`src/lib/periodo.ts`). A carteira que termina antes entra com o valor repetido - os motores
   * de cada produto rodam até a data global efetiva e repetem a última cota ou preço.
   */
  const periodo = useMemo(
    () => periodoDaCarteira(
      [rfPeriodo, fundoPeriodo, moedaPeriodo].filter((p): p is PeriodoDaCarteira => !!p),
      dataGlobalEfetiva(calendario, dataReferenciaISO),
    ),
    [rfPeriodo, fundoPeriodo, moedaPeriodo, calendario, dataReferenciaISO],
  );
  const carteiraInfo = useMemo(
    () => (carteiraInfoBruta && periodo.fim ? { ...carteiraInfoBruta, data_calculo: periodo.fim } : carteiraInfoBruta),
    [carteiraInfoBruta, periodo],
  );

  /** Consolidado: renda fixa e fundos passam pelo MESMO motor de carteira. */
  const carteiraRows = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) {
      return rfCarteiraRows;
    }
    return calcularCarteiraRendaFixa({
      productRows: allProductRows,
      calendario,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
    });
  }, [allProductRows, calendario, carteiraInfo, rfCarteiraRows]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setInfoLoading(true);
      const { data } = await supabase
        .from("controle_de_carteiras")
        .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
        .eq("nome_carteira", "Investimentos")
        .eq("user_id", user.id)
        .maybeSingle();

      setCarteiraInfo(ateAData(data as any, dataReferenciaISO));
      setNotFound(!data);
      setInfoLoading(false);
    })();
  }, [appliedVersion, user, dataReferenciaISO]);

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

  const detailRows = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo) return [];
    return buildCarteiraDetailRows(
      allProductRows, carteiraRows, cdiRecords,
      carteiraInfo.data_inicio, carteiraInfo.data_calculo,
    );
  }, [allProductRows, carteiraRows, cdiRecords, carteiraInfo]);

  const resumo = useMemo(() => {
    let patrimonio: number | null = null;
    let rent: number | null = null;
    let ganho: number | null = null;

    for (let i = carteiraRows.length - 1; i >= 0; i--) {
      if (carteiraRows[i].data <= dataReferenciaISO) {
        patrimonio = carteiraRows[i].liquido;
        rent = carteiraRows[i].rentAcumuladaPct * 100;
        ganho = carteiraRows[i].rentAcumuladaRS;
        break;
      }
    }

    const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
    // % do CDI com todas as casas; arredondar antes de dividir erra a segunda casa.
    const cdiExato = detailRows.length > 0 ? (detailRows[0].cdiAcumuladoExato ?? cdiAcum) : null;
    const sobreCdi = rent != null && cdiExato != null && cdiExato !== 0
      ? (rent / cdiExato) * 100
      : null;

    return { patrimonio, ganho, rent, cdiAcum, sobreCdi };
  }, [carteiraRows, detailRows, dataReferenciaISO]);

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

    // Cada categoria é uma carteira e termina no fim dela, não no da carteira de Investimentos.
    const periodoPorGrupo = new Map<string, PeriodoDaCarteira>();
    const marcar = (lista: typeof productList, per: PeriodoDaCarteira | null) => {
      if (!per) return;
      for (const p of lista) periodoPorGrupo.set(p.analysisProduct?.categoria_nome || "Outros", per);
    };
    marcar(rfProductList, rfPeriodo);
    marcar(fundoProductList, fundoPeriodo);
    marcar(moedaProductList, moedaPeriodo);

    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows,
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
      extras: Array.from(extrasMap, ([nome, patrimonio]) => ({ nome, patrimonio })),
      periodoPorGrupo,
    });
  }, [
    productList, allProductRows, allCustodiaForCategoria, calendario, cdiRecords, carteiraInfo, dataReferenciaISO,
    rfProductList, fundoProductList, moedaProductList, rfPeriodo, fundoPeriodo, moedaPeriodo,
  ]);

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

  if (infoLoading || dadosLoading) {
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
