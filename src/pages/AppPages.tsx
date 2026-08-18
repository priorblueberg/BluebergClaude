import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useAuth } from "@/hooks/useAuth";
import { useCarteiraRF } from "@/hooks/useCarteiraRF";
import { buildCdiSeries } from "@/lib/cdiCalculations";
import { buildCarteiraDetailRows } from "@/lib/detailRowsBuilder";
import { calcularAlocacaoPorGrupo, type GrupoMetricas } from "@/lib/alocacaoPorGrupo";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

/** A carteira entra como série do gráfico — antes só CDI e Ibovespa eram plotados. */
const AVAILABLE_SERIES: SeriesConfig[] = [
  { key: "carteira_acumulado", label: "Investimentos", color: "hsl(210, 100%, 45%)" },
  { key: "cdi_acumulado", label: "CDI", color: "hsl(0, 0%, 55%)" },
  { key: "ibovespa_acumulado", label: "Ibovespa", color: "hsl(25, 95%, 53%)" },
];

const DONUT_COLORS = [
  "hsl(210, 100%, 45%)",
  "hsl(25, 95%, 53%)",
  "hsl(160, 84%, 39%)",
  "hsl(280, 65%, 55%)",
  "hsl(45, 93%, 47%)",
  "hsl(340, 75%, 55%)",
  "hsl(190, 90%, 42%)",
];

const CustomTooltipChart = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {Number(entry.value).toFixed(2)}%
        </p>
      ))}
    </div>
  );
};

const fmtBrlValue = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtPctValue = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");

const PatrimonioTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-foreground mb-1">{label}</p>
      <p className="text-xs text-primary">{fmtBrlValue(Number(payload[0].value))}</p>
    </div>
  );
};

const DonutTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-foreground">{p.name}</p>
      <p className="text-xs text-muted-foreground">
        {fmtBrlValue(p.patrimonio)} · {p.value.toFixed(2)}%
      </p>
    </div>
  );
};

/** Tabela de alocação (2/3) + rosca (1/3), usada para Categoria e Instituição. */
function AlocacaoBloco({
  titulo,
  colunaLabel,
  linhas,
  totalPatrimonio,
  totalRent,
  totalGanho,
  totalCdi,
  totalSobreCdi,
  dataLabel,
}: {
  titulo: string;
  colunaLabel: string;
  linhas: GrupoMetricas[];
  totalPatrimonio: number;
  totalRent: number | null;
  totalGanho: number | null;
  totalCdi: number | null;
  totalSobreCdi: number | null;
  dataLabel: string;
}) {
  const donutData = linhas.map((l) => ({
    name: l.nome,
    value: parseFloat(l.alocacao.toFixed(2)),
    patrimonio: l.patrimonio,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 rounded-md border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Patrimônio e alocação por {colunaLabel.toLowerCase()} em {dataLabel}
        </p>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">{colunaLabel}</TableHead>
                <TableHead className="text-xs font-semibold text-right">Patrimônio</TableHead>
                <TableHead className="text-xs font-semibold text-right">Ganho Financeiro</TableHead>
                <TableHead className="text-xs font-semibold text-right">Rentabilidade</TableHead>
                <TableHead className="text-xs font-semibold text-right">CDI Acumulado</TableHead>
                <TableHead className="text-xs font-semibold text-right">% do CDI</TableHead>
                <TableHead className="text-xs font-semibold text-right">% de Alocação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.nome}>
                  <TableCell className="text-xs font-medium">{l.nome}</TableCell>
                  <TableCell className="text-xs text-right">{fmtBrlValue(l.patrimonio)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtBrlValue(l.ganhoFinanceiro)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(l.rentabilidade)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(l.cdiAcumulado)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(l.sobreCdi)}</TableCell>
                  <TableCell className="text-xs text-right">{l.alocacao.toFixed(2)}%</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-xs text-center text-muted-foreground">
                    Nenhuma posição na data selecionada.
                  </TableCell>
                </TableRow>
              )}
              {linhas.length > 0 && (
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell className="text-xs">Total</TableCell>
                  <TableCell className="text-xs text-right">{fmtBrlValue(totalPatrimonio)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtBrlValue(totalGanho)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(totalRent)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(totalCdi)}</TableCell>
                  <TableCell className="text-xs text-right">{fmtPctValue(totalSobreCdi)}</TableCell>
                  <TableCell className="text-xs text-right">100,00%</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">Alocação</h2>
        <p className="mt-1 text-xs text-muted-foreground">% do patrimônio</p>
        <div className="mt-4 h-64">
          {donutData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string) => <span className="text-muted-foreground">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">Sem dados</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const CarteiraVisaoGeral = () => {
  const { user } = useAuth();
  const [carteiraInfo, setCarteiraInfo] = useState<{
    nome_carteira: string;
    status: string;
    data_inicio: string | null;
    data_calculo: string | null;
  } | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeSeries, setActiveSeries] = useState<Set<string>>(
    new Set(["carteira_acumulado", "cdi_acumulado"])
  );
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const navigate = useNavigate();

  // Números vêm do mesmo hook que alimenta a carteira de Renda Fixa: uma fonte só.
  const {
    carteiraRows, allProductRows, cdiRecords, ibovespaData,
    productList, allCustodiaForCategoria, calendario, loading: dadosLoading,
  } = useCarteiraRF();

  useEffect(() => {
    if (!user) return;
    (async () => {
      setInfoLoading(true);
      const { data } = await supabase
        .from("controle_de_carteiras")
        .select("nome_carteira, status, data_inicio, data_calculo")
        .eq("nome_carteira", "Investimentos")
        .eq("user_id", user.id)
        .maybeSingle();

      setCarteiraInfo(data ?? null);
      setNotFound(!data);
      setInfoLoading(false);
    })();
  }, [appliedVersion, user]);

  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio || carteiraRows.length === 0) return [];

    const cdiSeries = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);

    const map = new Map<string, any>();
    for (const p of cdiSeries) {
      map.set(p.data, { data: p.data, label: p.label, cdi_acumulado: p.cdi_acumulado });
    }

    for (const r of carteiraRows) {
      if (r.liquido <= 0 && r.liquido2 <= 0) continue;
      const label = new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR");
      const existing = map.get(r.data) || { data: r.data, label };
      existing.carteira_acumulado = parseFloat((r.rentAcumuladaPct * 100).toFixed(4));
      map.set(r.data, existing);
    }

    if (ibovespaData.length > 0) {
      const base = ibovespaData[0].pontos;
      for (const item of ibovespaData) {
        const label = new Date(item.data + "T00:00:00").toLocaleDateString("pt-BR");
        const existing = map.get(item.data) || { data: item.data, label };
        existing.ibovespa_acumulado = parseFloat(((item.pontos / base - 1) * 100).toFixed(4));
        map.set(item.data, existing);
      }
    }

    return Array.from(map.values()).sort((a: any, b: any) => a.data.localeCompare(b.data));
  }, [carteiraRows, cdiRecords, ibovespaData, carteiraInfo]);

  /** Evolução do patrimônio (líquido) até a data de referência. */
  const patrimonioChartData = useMemo(() => {
    return carteiraRows
      .filter(r => r.data <= dataReferenciaISO && (r.liquido > 0 || r.liquido2 > 0))
      .map(r => ({
        data: r.data,
        label: new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR"),
        patrimonio: parseFloat(r.liquido.toFixed(2)),
      }));
  }, [carteiraRows, dataReferenciaISO]);

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
        rent = parseFloat((carteiraRows[i].rentAcumuladaPct * 100).toFixed(2));
        ganho = carteiraRows[i].rentAcumuladaRS;
        break;
      }
    }

    const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
    const sobreCdi = rent != null && cdiAcum != null && cdiAcum !== 0
      ? (rent / cdiAcum) * 100
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

    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows,
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
      extras: Array.from(extrasMap, ([nome, patrimonio]) => ({ nome, patrimonio })),
    });
  }, [productList, allProductRows, allCustodiaForCategoria, calendario, cdiRecords, carteiraInfo, dataReferenciaISO]);

  const alocacaoInstituicao = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) return [];

    const gruposIdx = new Map<string, number[]>();
    productList.forEach((p, i) => {
      const inst = p.custodiante || "—";
      if (!gruposIdx.has(inst)) gruposIdx.set(inst, []);
      gruposIdx.get(inst)!.push(i);
    });

    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows,
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
    });
  }, [productList, allProductRows, calendario, cdiRecords, carteiraInfo, dataReferenciaISO]);

  const toggleSeries = (key: string) => {
    setActiveSeries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const renderStatusMessage = () => {
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
            onClick={() => navigate("/cadastrar-transacao")}
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
            <div className="rounded-md border border-border bg-card p-6">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Variação acumulada (%) no período
                </p>
              </div>
              {/* Botões numa linha própria: no card estreito eles brigavam com o título */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {AVAILABLE_SERIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => toggleSeries(s.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium leading-none transition-colors ${
                      activeSeries.has(s.key)
                        ? "border-transparent text-primary-foreground"
                        : "border-border text-muted-foreground bg-muted/50 hover:bg-muted"
                    }`}
                    style={activeSeries.has(s.key) ? { backgroundColor: s.color } : undefined}
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 88%)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }}
                      axisLine={{ stroke: "hsl(215, 20%, 88%)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(215, 15%, 50%)" }}
                      axisLine={{ stroke: "hsl(215, 20%, 88%)" }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip content={<CustomTooltipChart />} />
                    <Legend
                      iconType="plainline"
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value: string) => <span className="text-muted-foreground">{value}</span>}
                    />
                    {AVAILABLE_SERIES.filter(s => activeSeries.has(s.key)).map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.color}
                        strokeWidth={s.key === "carteira_acumulado" ? 2 : 1.5}
                        strokeDasharray={s.key === "carteira_acumulado" ? undefined : "5 3"}
                        dot={false}
                        activeDot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-md border border-border bg-card p-6">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Patrimônio</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Evolução do patrimônio no período
                </p>
              </div>
              {/* Espaçador para alinhar a base do gráfico com o de rentabilidade */}
              <div className="mt-3 h-[26px]" aria-hidden="true" />
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={patrimonioChartData}>
                    <defs>
                      <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(210, 100%, 45%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(210, 100%, 45%)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 88%)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }}
                      axisLine={{ stroke: "hsl(215, 20%, 88%)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(215, 15%, 50%)" }}
                      axisLine={{ stroke: "hsl(215, 20%, 88%)" }}
                      tickLine={false}
                      width={80}
                      tickFormatter={(v) =>
                        Number(v).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
                      }
                    />
                    <Tooltip content={<PatrimonioTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="patrimonio"
                      name="Patrimônio"
                      stroke="hsl(210, 100%, 45%)"
                      strokeWidth={2}
                      fill="url(#gradPatrimonio)"
                      dot={false}
                      activeDot={{ r: 4, fill: "hsl(210, 100%, 45%)", strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Tabela de rentabilidade: mesmo layout das demais lâminas, com anos anteriores */}
          <RentabilidadeDetailTable rows={detailRows} tituloLabel="Investimentos" />

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
          />

          <AlocacaoBloco
            titulo="Posição Consolidada por Instituição"
            colunaLabel="Instituição"
            linhas={alocacaoInstituicao}
            totalPatrimonio={alocacaoInstituicao.reduce((s, l) => s + l.patrimonio, 0)}
            totalGanho={resumo.ganho}
            totalRent={resumo.rent}
            totalCdi={resumo.cdiAcum}
            totalSobreCdi={resumo.sobreCdi}
            dataLabel={dataLabel}
          />
        </>
      )}
    </div>
  );
};

export { default as CarteiraRendaFixa } from "./CarteiraRendaFixaPage";
export const CarteiraRendaVariavel = () => <PageStub title="Renda Variável" />;
export const CarteiraFundos = () => <PageStub title="Fundos de Investimentos" />;
export const CarteiraTesouroDireto = () => <PageStub title="Tesouro Direto" />;
export { default as CarteiraAnaliseIndividual } from "./AnaliseIndividualPage";
export { default as Movimentacoes } from "./MovimentacoesPage";
export { default as ProventosRecebidos } from "./ProventosRecebidosPage";
export { default as CadastrarTransacao } from "./CadastrarTransacaoPage";
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
