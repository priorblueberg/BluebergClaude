import { RentabilidadeRow } from "@/lib/cdiCalculations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MONTH_HEADERS = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

function fmt(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2) + "%";
}

interface Props {
  rows: RentabilidadeRow[];
}

export default function RentabilidadeTable({ rows }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">
        Tabela de Rentabilidade
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Rentabilidade mensal e acumulada (%)
      </p>
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold whitespace-nowrap">CDI</TableHead>
              {MONTH_HEADERS.map((m) => (
                <TableHead key={m} className="text-xs font-semibold text-center whitespace-nowrap">
                  {m}
                </TableHead>
              ))}
              <TableHead className="text-xs font-semibold text-center whitespace-nowrap">No Ano</TableHead>
              <TableHead className="text-xs font-semibold text-center whitespace-nowrap">Acumulado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.year}>
                <TableCell className="text-xs font-medium whitespace-nowrap">
                  {row.year}
                </TableCell>
                {row.months.map((v, i) => (
                  <TableCell
                    key={i}
                    className="text-xs text-center whitespace-nowrap"
                  >
                    {fmt(v)}
                  </TableCell>
                ))}
                <TableCell className="text-xs text-center font-medium whitespace-nowrap">
                  {fmt(row.noAno)}
                </TableCell>
                <TableCell className="text-xs text-center font-medium whitespace-nowrap">
                  {fmt(row.acumulado)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
