import { useState, useMemo } from "react";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import type { CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import { buildCdiSeries, buildIbovespaSeries } from "@/lib/cdiCalculations";
import { buildCarteiraDetailRows } from "@/lib/detailRowsBuilder";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import PatrimonioChart, { serieDePatrimonio } from "@/components/PatrimonioChart";
import { useCarteiraRF } from "@/hooks/useCarteiraRF";
import { ProductDetail, type CustodiaProduct as AnalysisCustodiaProduct } from "@/pages/AnaliseIndividualPage";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CircleCheck, CircleX } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";



const PIE_COLORS = [
  "hsl(210, 100%, 45%)",
  "hsl(150, 60%, 40%)",
  "hsl(30, 90%, 50%)",
  "hsl(270, 60%, 50%)",
  "hsl(0, 70%, 50%)",
  "hsl(180, 60%, 40%)",
  "hsl(330, 70%, 50%)",
  "hsl(60, 70%, 45%)",
  "hsl(120, 50%, 35%)",
  "hsl(240, 50%, 55%)",
];

const CustomTooltipChart = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <p className="text-foreground font-medium mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color }} className="font-semibold">
            {entry.name}: {entry.value?.toFixed(2)}%
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const PieTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <p className="text-foreground font-medium">{payload[0].name}</p>
        <p className="font-semibold text-foreground">{payload[0].value.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
};



export default function CarteiraRendaFixaPage() {
  const { dataReferenciaISO } = useDataReferencia();
  // Carga e cálculo agora vivem no hook, compartilhado com o dashboard Total.
  const {
    carteiraInfo, carteiraRows, allProductRows, cdiRecords,
    ibovespaData, productList, loading, allCustodiaForCategoria,
  } = useCarteiraRF();
  const [selectedProduct, setSelectedProduct] = useState<AnalysisCustodiaProduct | null>(null);
  const [seriesVisibility, setSeriesVisibility] = useState({ cdi: true, ibovespa: false });

  // Chart: Rentabilidade vs CDI vs Ibovespa
  /** O Gorila nao lista posicao que nao existiu na janela; aqui tambem nao. Papel que morreu
   *  DENTRO dela continua, com patrimonio zero e o ganho do periodo. */
  const posicoesDaJanela = useMemo(
    () => productList.filter((p) => p.existiuNaJanela !== false),
    [productList],
  );

  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio || carteiraRows.length === 0) return [];

    const cdiSeries = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);

    const enginePoints = carteiraRows
      // So dia util no grafico (ver AppPages).
      .filter(r => r.diaUtil && (r.liquido > 0 || r.liquido2 > 0))
      .map(r => ({
        data: r.data,
        label: new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR"),
        titulo_acumulado: parseFloat((r.rentAcumuladaPct * 100).toFixed(4)),
      }));

    const ibovMap = buildIbovespaSeries(ibovespaData, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);

    const map = new Map<string, any>();
    for (const p of cdiSeries) {
      map.set(p.data, { data: p.data, label: p.label, cdi_acumulado: p.cdi_acumulado });
    }
    for (const p of enginePoints) {
      const existing = map.get(p.data) || { data: p.data, label: p.label };
      existing.titulo_acumulado = p.titulo_acumulado;
      existing.label = existing.label || p.label;
      map.set(p.data, existing);
    }
    for (const [data, value] of ibovMap) {
      const existing = map.get(data) || { data, label: new Date(data + "T00:00:00").toLocaleDateString("pt-BR") };
      existing.ibovespa_acumulado = value;
      map.set(data, existing);
    }
    return Array.from(map.values()).sort((a: any, b: any) => a.data.localeCompare(b.data));
  }, [carteiraRows, cdiRecords, carteiraInfo, ibovespaData]);

  /** Mesma série da lâmina Investimentos: patrimônio diário até a data de referência. */
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

  // Allocation charts data
  const allocationData = useMemo(() => {
    const activeProducts = productList.filter(p => p.ativo && p.valorAtualizado > 0);
    const total = activeProducts.reduce((sum, p) => sum + p.valorAtualizado, 0);
    if (total === 0) return { estrategia: [], custodiante: [], emissor: [] };

    const groupBy = (key: (p: typeof activeProducts[0]) => string) => {
      const map = new Map<string, number>();
      for (const p of activeProducts) {
        const k = key(p) || "Não definido";
        map.set(k, (map.get(k) || 0) + p.valorAtualizado);
      }
      return Array.from(map.entries()).map(([name, value]) => ({
        name,
        value: parseFloat(((value / total) * 100).toFixed(1)),
      }));
    };

    return {
      estrategia: groupBy(p => p.estrategia || "Não definida"),
      custodiante: groupBy(p => p.custodiante),
      emissor: groupBy(p => p.emissor_nome),
    };
  }, [productList]);

  // Category allocation (RF vs other categories)
  const categoriaAllocation = useMemo(() => {
    // Use productList for RF value (calculated), allCustodiaForCategoria for other categories
    const rfTotal = productList.filter(p => p.ativo && p.valorAtualizado > 0).reduce((s, p) => s + p.valorAtualizado, 0);
    const otherMap = new Map<string, number>();
    for (const c of allCustodiaForCategoria) {
      if (c.categoria_nome === "Renda Fixa") continue;
      const val = c.custodia_no_dia != null ? c.custodia_no_dia : c.valor_investido;
      otherMap.set(c.categoria_nome, (otherMap.get(c.categoria_nome) || 0) + val);
    }
    const entries: [string, number][] = [];
    if (rfTotal > 0) entries.push(["Renda Fixa", rfTotal]);
    for (const [k, v] of otherMap) entries.push([k, v]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return [];
    return entries.map(([name, value]) => ({
      name,
      value: parseFloat(((value / total) * 100).toFixed(1)),
    }));
  }, [productList, allCustodiaForCategoria]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  const showContent = carteiraInfo && (carteiraInfo.status === "Ativa" || carteiraInfo.status === "Encerrada") && carteiraRows.length > 0;

  const fmtBrl = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const statusBadge = carteiraInfo ? (
    carteiraInfo.status === "Ativa" ? (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Ativa</Badge>
    ) : carteiraInfo.status === "Encerrada" ? (
      <Badge variant="destructive">Encerrada</Badge>
    ) : (
      <Badge variant="secondary">Não Iniciada</Badge>
    )
  ) : null;

  if (selectedProduct) {
    return (
      <ProductDetail
        product={selectedProduct}
        onBack={() => setSelectedProduct(null)}
        backLabel="Voltar para Carteira de Renda Fixa"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Renda Fixa</h1>
        {carteiraInfo && (
          carteiraInfo.status === "Não Iniciada" ? (
            <p className="text-sm text-muted-foreground mt-1">
              Data selecionada anterior ao início dos seus investimentos em Renda Fixa
            </p>
          ) : (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-muted-foreground">
                Período de Análise: De {fmtDate(carteiraInfo.data_inicio)} a {fmtDate(carteiraInfo.data_calculo)}
              </p>
              {statusBadge}
            </div>
          )
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      ) : !showContent ? (
        <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
          Nenhum dado disponível para o período selecionado.
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {(() => {
            let patrimonioValue: number | null = null;
            let rentValue: number | null = null;
            let ganhoValue: number | null = null;

            for (let i = carteiraRows.length - 1; i >= 0; i--) {
              if (carteiraRows[i].data <= dataReferenciaISO) {
                patrimonioValue = carteiraRows[i].liquido;
                rentValue = parseFloat((carteiraRows[i].rentAcumuladaPct * 100).toFixed(2));
                ganhoValue = carteiraRows[i].rentAcumuladaRS;
                break;
              }
            }

            const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
            const fmtPct = (v: number | null) =>
              v != null ? `${v.toFixed(2)}%` : "—";

            const cards = [
              { label: "Patrimônio", value: fmtBrl(patrimonioValue) },
              { label: "Ganho Financeiro", value: fmtBrl(ganhoValue) },
              { label: "Rentabilidade", value: fmtPct(rentValue) },
              { label: "CDI Acumulado", value: fmtPct(cdiAcum) },
            ];

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {cards.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                    <p className="text-lg font-semibold text-foreground">{c.value}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-md border border-border bg-card p-6">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Variação acumulada (%) no período</p>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={seriesVisibility.cdi}
                      onCheckedChange={(v) => setSeriesVisibility(prev => ({ ...prev, cdi: v }))}
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                    />
                    CDI
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={seriesVisibility.ibovespa}
                      onCheckedChange={(v) => setSeriesVisibility(prev => ({ ...prev, ibovespa: v }))}
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                    />
                    Ibovespa
                  </label>
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<CustomTooltipChart />} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="titulo_acumulado" name="Carteira RF" stroke="hsl(210, 100%, 45%)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
                    {seriesVisibility.cdi && (
                      <Line type="monotone" dataKey="cdi_acumulado" name="CDI" stroke="hsl(0, 0%, 55%)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} strokeDasharray="5 3" connectNulls />
                    )}
                    {seriesVisibility.ibovespa && (
                      <Line type="monotone" dataKey="ibovespa_acumulado" name="Ibovespa" stroke="hsl(30, 90%, 50%)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} strokeDasharray="3 2" connectNulls />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <PatrimonioChart dados={patrimonioChartData} comEspacador={false} />
          </div>

          {/* Detail Table */}
          <RentabilidadeDetailTable rows={detailRows} tituloLabel="Rentabilidade" />

          {/* Allocation Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Alocação por Estratégia", data: allocationData.estrategia },
              { title: "Alocação por Custodiante", data: allocationData.custodiante },
              { title: "Alocação por Emissor", data: allocationData.emissor },
              { title: "Alocação por Categoria", data: categoriaAllocation },
            ].map((chart) => (
              <div key={chart.title} className="rounded-md border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-foreground mb-2">{chart.title}</h3>
                {chart.data.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    Sem títulos de Renda Fixa em custódia para cálculo de alocação
                  </p>
                ) : (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chart.data}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          innerRadius={30}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${value}%`}
                          labelLine={{ strokeWidth: 0.5 }}
                          style={{ fontSize: 9 }}
                        >
                          {chart.data.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Posição Consolidada */}
          {posicoesDaJanela.length > 0 && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Posição Consolidada</h2>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[50px]">Status</TableHead>
                      <TableHead className="min-w-[250px]">Ativo</TableHead>
                      <TableHead className="min-w-[130px]">Valor Atualizado</TableHead>
                      <TableHead className="min-w-[130px]">Ganho Financeiro</TableHead>
                      <TableHead className="min-w-[110px]">Rentabilidade</TableHead>
                      <TableHead className="min-w-[150px]">Custodiante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posicoesDaJanela.map((row, i) => (
                      <TableRow key={i} className="cursor-pointer hover:bg-accent/50" onClick={() => setSelectedProduct(row.analysisProduct)}>
                        <TableCell>
                          <Badge
                            variant={row.ativo ? "default" : "secondary"}
                            className={row.ativo ? "bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-2 py-0.5" : "bg-muted text-muted-foreground text-[10px] px-2 py-0.5"}
                          >
                            {row.ativo ? "Em custódia" : "Liquidado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-foreground">{row.nome}</TableCell>
                        <TableCell className="text-foreground">{fmtBrl(row.valorAtualizado)}</TableCell>
                        <TableCell className="text-foreground">{fmtBrl(row.ganhoFinanceiro)}</TableCell>
                        <TableCell className="text-foreground">{row.rentabilidade.toFixed(2)}%</TableCell>
                        <TableCell className="text-foreground">{row.custodiante}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
