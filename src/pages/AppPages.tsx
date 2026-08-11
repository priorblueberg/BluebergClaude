import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { ChevronUp, ChevronDown } from "lucide-react";
import { buildCdiSeries, CdiRecord } from "@/lib/cdiCalculations";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const summaryItems = [
  { label: "Patrimônio", value: "R$ 281.217,40" },
  { label: "Ganho no período (R$)", value: "R$ 16.775,70" },
  { label: "Rentabilidade no período", value: "6,34%" },
  { label: "CDI no período", value: "25,48%" },
  { label: "% Sobre CDI", value: "24,90%" },
];

const tableData = [
  { label: "Investimentos", values: ["0,42", "0,47", "0,56", "0,42", "0,89", "0,56", "0,66", "0,47", "0,43", "0,62", "0,52", "0,32", "6,34"] },
  { label: "CDI", values: ["1,01", "0,99", "1,06", "1,01", "1,02", "1,07", "0,91", "0,87", "0,84", "0,93", "0,79", "0,98", "25,48"] },
  { label: "% do CDI", values: ["41,6", "47,5", "52,8", "41,6", "87,3", "52,3", "72,5", "54,0", "51,2", "66,7", "65,8", "32,7", "24,90"] },
];

const months = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ", "No ano"];

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

const AVAILABLE_SERIES: SeriesConfig[] = [
  { key: "cdi_acumulado", label: "CDI", color: "hsl(210, 100%, 45%)" },
  { key: "ibovespa_acumulado", label: "Ibovespa", color: "hsl(25, 95%, 53%)" },
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

function buildIbovespaSeries(
  records: { data: string; pontos: number }[],
  dataInicio: string,
  dataCalculo?: string
): { data: string; label: string; ibovespa_acumulado: number }[] {
  if (records.length === 0) return [];

  const sorted = [...records].sort((a, b) => a.data.localeCompare(b.data));

  // Find the last record before or on dataInicio to use as base
  let baseIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].data <= dataInicio) baseIdx = i;
    else break;
  }
  if (baseIdx === -1) baseIdx = 0;

  const basePontos = sorted[baseIdx].pontos;
  const result: { data: string; label: string; ibovespa_acumulado: number }[] = [];

  for (let i = baseIdx; i < sorted.length; i++) {
    const rec = sorted[i];
    if (dataCalculo && rec.data > dataCalculo) break;
    result.push({
      data: rec.data,
      label: new Date(rec.data + "T00:00:00").toLocaleDateString("pt-BR"),
      ibovespa_acumulado: parseFloat((((rec.pontos / basePontos) - 1) * 100).toFixed(4)),
    });
  }

  return result;
}

export const CarteiraVisaoGeral = () => {
  const [carteiraInfo, setCarteiraInfo] = useState<{
    nome_carteira: string;
    status: string;
    data_inicio: string | null;
    data_calculo: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>([]);
  const [ibovespaRecords, setIbovespaRecords] = useState<{ data: string; pontos: number }[]>([]);
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(["cdi_acumulado", "ibovespa_acumulado"]));
  const { appliedVersion } = useDataReferencia();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("controle_de_carteiras")
        .select("nome_carteira, status, data_inicio, data_calculo")
        .eq("nome_carteira", "Investimentos")
        .maybeSingle();

      if (data) {
        setCarteiraInfo(data);
        setNotFound(false);

        // Fetch CDI and Ibovespa data within the period
        if (data.data_inicio) {
          const endDate = data.data_calculo || "2099-12-31";

          const [cdiRes, ibovRes, diasRes] = await Promise.all([
            supabase
              .from("historico_cdi")
              .select("data, taxa_anual")
              .gte("data", data.data_inicio)
              .lte("data", endDate)
              .order("data"),
            supabase
              .from("historico_ibovespa")
              .select("data, pontos")
              .gte("data", data.data_inicio)
              .lte("data", endDate)
              .order("data"),
            supabase
              .from("calendario_dias_uteis")
              .select("data, dia_util")
              .gte("data", data.data_inicio)
              .lte("data", endDate)
              .order("data"),
          ]);

          // Build CDI records with dia_util info
          const diasMap = new Map<string, boolean>();
          (diasRes.data || []).forEach((d: any) => diasMap.set(d.data, d.dia_util));

          const cdiMerged: CdiRecord[] = (cdiRes.data || []).map((r: any) => ({
            data: r.data,
            taxa_anual: r.taxa_anual,
            dia_util: diasMap.get(r.data) ?? true,
          }));

          setCdiRecords(cdiMerged);
          setIbovespaRecords(ibovRes.data || []);
        }
      } else {
        setCarteiraInfo(null);
        setNotFound(true);
      }
      setLoading(false);
    })();
  }, [appliedVersion]);

  // Build merged chart data
  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio) return [];

    const cdiPoints = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo || undefined);
    const ibovPoints = buildIbovespaSeries(ibovespaRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo || undefined);

    // Merge by date
    const dateMap = new Map<string, any>();

    for (const p of cdiPoints) {
      if (!dateMap.has(p.data)) dateMap.set(p.data, { data: p.data, label: p.label });
      dateMap.get(p.data)!.cdi_acumulado = p.cdi_acumulado;
    }
    for (const p of ibovPoints) {
      if (!dateMap.has(p.data)) dateMap.set(p.data, { data: p.data, label: p.label });
      dateMap.get(p.data)!.ibovespa_acumulado = p.ibovespa_acumulado;
    }

    return Array.from(dateMap.values()).sort((a, b) => a.data.localeCompare(b.data));
  }, [cdiRecords, ibovespaRecords, carteiraInfo]);

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

  if (loading) {
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

  const showContent = carteiraInfo?.status === "Ativa" || carteiraInfo?.status === "Encerrada";

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
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-bold text-foreground">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="rounded-md border border-border bg-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Variação acumulada (%) no período
                </p>
              </div>
              {/* Series selector */}
              <div className="flex items-center gap-2 flex-wrap">
                {AVAILABLE_SERIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => toggleSeries(s.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      activeSeries.has(s.key)
                        ? "border-transparent text-primary-foreground"
                        : "border-border text-muted-foreground bg-muted/50 hover:bg-muted"
                    }`}
                    style={activeSeries.has(s.key) ? { backgroundColor: s.color } : undefined}
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
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
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-md border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">Tabela de Rentabilidade</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Informações da rentabilidade por ano e meses
            </p>
            <div className="mt-4 overflow-x-auto">
              <div className="bg-muted rounded-t-md px-4 py-2 text-xs font-medium text-foreground">
                Ano: 2025
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="px-3 py-2 text-left font-medium">Rentabilidade</th>
                    {months.map((m) => (
                      <th key={m} className="px-3 py-2 text-center font-medium">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, i) => (
                    <tr key={row.label} className={i % 2 === 0 ? "bg-card" : "bg-muted/30"}>
                      <td className="px-3 py-2 text-foreground font-medium">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="px-3 py-2 text-center text-foreground">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
