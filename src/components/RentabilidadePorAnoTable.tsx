/**
 * Rentabilidade por ano, uma linha por ano (Daniel, 19/09/2026).
 *
 * A gaveta de detalhes usava a `RentabilidadeDetailTable`, a mesma dos dashboards: um cartão por
 * ano, com o ano corrente aberto e os anteriores atrás de um "Anos anteriores". Para uma posição
 * isolada isso e muito para pouca informacao - e ainda trazia o "% do CDI", que ali nao interessa.
 *
 * Aqui e uma tabela so: um cabecalho de meses e uma linha por ano, rotulada pelo ano.
 */
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DetailRow } from "@/components/RentabilidadeDetailTable";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

export default function RentabilidadePorAnoTable({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;

  // Do mais recente para o mais antigo, como o Daniel prefere ver ano (memoria do vault).
  const anos = [...rows].sort((a, b) => b.year - a.year);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Tabela de Rentabilidade</h2>
      <p className="mt-1 text-xs text-muted-foreground">Rentabilidade mensal e do ano</p>

      <div className="mt-3 overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[64px] min-w-[64px] px-2 text-[11px] font-semibold">Ano</TableHead>
              {MESES.map((m) => (
                <TableHead key={m} className="w-[56px] min-w-[56px] px-1 text-center text-[11px] font-semibold">
                  {m}
                </TableHead>
              ))}
              <TableHead className="w-[68px] min-w-[68px] bg-muted/50 px-1 text-center text-[11px] font-semibold">
                No Ano
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {anos.map((row) => (
              <TableRow key={row.year}>
                <TableCell className="w-[64px] min-w-[64px] px-2 text-[11px] font-medium tabular-nums">
                  {row.year}
                </TableCell>
                {row.rentabilidadeMonths.map((v, i) => (
                  <TableCell
                    key={i}
                    className="w-[56px] min-w-[56px] px-1 text-center text-[11px] tabular-nums"
                  >
                    {fmtPct(v)}
                  </TableCell>
                ))}
                <TableCell className="w-[68px] min-w-[68px] bg-muted/50 px-1 text-center text-[11px] font-semibold tabular-nums">
                  {fmtPct(row.rentNoAno)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
