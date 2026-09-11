import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { GrupoMetricas } from "@/lib/alocacaoPorGrupo";
import LinguetaDeData from "@/components/LinguetaDeData";

const DONUT_COLORS = [
  "hsl(210, 100%, 45%)",
  "hsl(25, 95%, 53%)",
  "hsl(160, 84%, 39%)",
  "hsl(280, 65%, 55%)",
  "hsl(45, 93%, 47%)",
  "hsl(340, 75%, 55%)",
  "hsl(190, 90%, 42%)",
];

const fmtBrlValue = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtPctValue = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : "—");

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

/**
 * Tabela de alocação de um agrupamento (2/3) com a rosca ao lado (1/3).
 *
 * Vivia dentro de AppPages; saiu para cá em 07/09/2026, quando o bloco por Instituição foi do
 * dashboard para a Posição Consolidada e as duas páginas passaram a precisar dele.
 */
export default function AlocacaoBloco({
  titulo,
  colunaLabel,
  linhas,
  totalPatrimonio,
  totalRent,
  totalGanho,
  totalCdi,
  totalSobreCdi,
  dataLabel,
  linguetaTotal,
  dataGlobal,
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
  /** Fim do total quando ele termina antes da data global (lingueta cinza). */
  linguetaTotal?: string | null;
  dataGlobal?: string | null;
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
                  <TableCell className="whitespace-nowrap text-xs text-right">
                    {l.alocacao.toFixed(2)}%
                    <LinguetaDeData data={l.lingueta} dataGlobal={dataGlobal} />
                  </TableCell>
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
                  <TableCell className="whitespace-nowrap text-xs text-right">
                    100,00%
                    <LinguetaDeData data={linguetaTotal} dataGlobal={dataGlobal} />
                  </TableCell>
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
