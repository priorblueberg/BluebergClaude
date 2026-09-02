import { useMemo, useState } from "react";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { buildCdiSeries, type CdiRecord } from "@/lib/cdiCalculations";
import { buildCarteiraDetailRows } from "@/lib/detailRowsBuilder";
import type { CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import RentabilidadeDetailTable from "@/components/RentabilidadeDetailTable";
import PatrimonioChart, { serieDePatrimonio } from "@/components/PatrimonioChart";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export interface LinhaCarteira {
  chave: string;
  nome: string;
  /** Linha de apoio abaixo do nome, ex.: o saldo na moeda. */
  detalhe?: string | null;
  custodiante: string;
  patrimonio: number;
  ganho: number;
  rentabilidade: number;
  ativo: boolean;
}

interface Props {
  titulo: string;
  /** Rótulo da série da carteira no gráfico e da coluna de nome na tabela. */
  labelSerie: string;
  labelColuna: string;
  tituloTabela: string;
  carteiraInfo: { data_inicio: string | null; data_calculo: string | null } | null;
  carteiraRows: CarteiraRFRow[];
  allProductRows: DailyRow[][];
  cdiRecords: CdiRecord[];
  linhas: LinhaCarteira[];
  loading: boolean;
  mensagemVazio: string;
  nota?: string;
}

const fmtBrl = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtPct = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");
const fmtData = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((e: any) => (
        <p key={e.dataKey} style={{ color: e.color }} className="font-semibold">
          {e.name}: {Number(e.value).toFixed(2)}%
        </p>
      ))}
    </div>
  );
};

/**
 * Lâmina de uma categoria com motor próprio (Fundos, Moedas).
 *
 * Mesma estrutura da lâmina Investimentos: cards, rentabilidade contra o CDI,
 * patrimônio, tabela mensal e a lista de posições. Fica num componente só para
 * as categorias não virarem cópias da mesma tela, que foi como as telas do
 * projeto já divergiram antes.
 */
export default function CarteiraCategoriaView({
  titulo, labelSerie, labelColuna, tituloTabela,
  carteiraInfo, carteiraRows, allProductRows, cdiRecords, linhas, loading,
  mensagemVazio, nota,
}: Props) {
  const { dataReferenciaISO } = useDataReferencia();
  const [mostrarEncerrados, setMostrarEncerrados] = useState(true);

  const chartData = useMemo(() => {
    if (!carteiraInfo?.data_inicio || carteiraRows.length === 0) return [];
    const cdiSeries = buildCdiSeries(cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo ?? undefined);
    const map = new Map<string, any>();
    for (const p of cdiSeries) map.set(p.data, { data: p.data, label: p.label, cdi_acumulado: p.cdi_acumulado });
    for (const r of carteiraRows) {
      // So dia util no grafico (ver AppPages).
      if (!r.diaUtil) continue;
      if (r.liquido <= 0 && r.liquido2 <= 0) continue;
      const label = new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR");
      const atual = map.get(r.data) || { data: r.data, label };
      atual.carteira_acumulado = parseFloat((r.rentAcumuladaPct * 100).toFixed(4));
      map.set(r.data, atual);
    }
    return Array.from(map.values()).sort((a, b) => a.data.localeCompare(b.data));
  }, [carteiraRows, cdiRecords, carteiraInfo]);

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
        rent = parseFloat((carteiraRows[i].rentAcumuladaPct * 100).toFixed(2));
        ganho = carteiraRows[i].rentAcumuladaRS;
        break;
      }
    }
    const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
    const sobreCdi = rent != null && cdiAcum ? (rent / cdiAcum) * 100 : null;
    return { patrimonio, ganho, rent, cdiAcum, sobreCdi };
  }, [carteiraRows, detailRows, dataReferenciaISO]);

  const visiveis = useMemo(
    () => linhas.filter((l) => mostrarEncerrados || l.ativo).sort((a, b) => b.patrimonio - a.patrimonio),
    [linhas, mostrarEncerrados],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!carteiraInfo || linhas.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{mensagemVazio}</p>
      </div>
    );
  }

  const cards = [
    { label: "Patrimônio", value: fmtBrl(resumo.patrimonio) },
    { label: "Ganho Financeiro", value: fmtBrl(resumo.ganho) },
    { label: "Rentabilidade", value: fmtPct(resumo.rent) },
    { label: "CDI Acumulado", value: fmtPct(resumo.cdiAcum) },
    { label: "% do CDI", value: fmtPct(resumo.sobreCdi) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Período de Análise: de {fmtData(carteiraInfo.data_inicio)} a {fmtData(carteiraInfo.data_calculo)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-2 text-lg font-bold text-foreground">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
          <p className="mt-1 text-xs text-muted-foreground">Variação acumulada (%) no período</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 88%)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "hsl(215, 15%, 50%)" }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="carteira_acumulado" name={labelSerie} stroke="hsl(210, 100%, 45%)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="cdi_acumulado" name="CDI" stroke="hsl(0, 0%, 55%)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <PatrimonioChart dados={patrimonioChartData} comEspacador={false} />
      </div>

      <RentabilidadeDetailTable rows={detailRows} tituloLabel={titulo} />

      <div className="rounded-md border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{tituloTabela}</h2>
          <button
            onClick={() => setMostrarEncerrados((v) => !v)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            {mostrarEncerrados ? "Ocultar encerrados" : "Mostrar encerrados"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labelColuna}</TableHead>
                <TableHead>Custodiante</TableHead>
                <TableHead className="text-right">Patrimônio</TableHead>
                <TableHead className="text-right">Ganho Financeiro</TableHead>
                <TableHead className="text-right">Rentabilidade</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="max-w-[320px] font-medium">
                    <span className="block truncate">{l.nome}</span>
                    {l.detalhe && <span className="block text-xs text-muted-foreground">{l.detalhe}</span>}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">{l.custodiante}</TableCell>
                  <TableCell className="text-right">{fmtBrl(l.patrimonio)}</TableCell>
                  <TableCell className="text-right">{fmtBrl(l.ganho)}</TableCell>
                  <TableCell className="text-right">{fmtPct(l.rentabilidade)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={l.ativo ? "default" : "secondary"}>{l.ativo ? "Ativo" : "Encerrado"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {nota && <p className="mt-3 text-xs text-muted-foreground">{nota}</p>}
      </div>
    </div>
  );
}
