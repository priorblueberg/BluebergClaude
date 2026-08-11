import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";

const MONTH_HEADERS = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

export interface DetailRow {
  year: number;
  patrimonioMonths: (number | null)[];
  ganhoFinanceiroMonths: (number | null)[];
  rentabilidadeMonths: (number | null)[];
  cdiMonths: (number | null)[];
  rentNoAno: number | null;
  rentAcumulado: number | null;
  cdiNoAno: number | null;
  cdiAcumulado: number | null;
  ganhoNoAno: number | null;
  ganhoAcumulado: number | null;
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2) + "%";
}

function fmtBrl(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Props {
  rows: DetailRow[];
  tituloLabel: string;
}

const monthCellClass = "text-xs text-center whitespace-nowrap w-[80px] min-w-[80px]";
const monthHeadClass = "text-xs font-semibold text-center whitespace-nowrap w-[80px] min-w-[80px]";
const highlightCellClass = "text-xs text-center font-semibold whitespace-nowrap bg-muted/50 w-[100px] min-w-[100px]";
const highlightHeadClass = "text-xs font-semibold text-center whitespace-nowrap bg-muted/50 w-[100px] min-w-[100px]";
const labelCellClass = "text-xs font-medium whitespace-nowrap w-[130px] min-w-[130px]";
const labelHeadClass = "text-xs font-semibold whitespace-nowrap w-[130px] min-w-[130px]";

function YearTable({ row }: { row: DetailRow }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">
        Tabela de Rentabilidade — {row.year}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Rentabilidade mensal e acumulada
      </p>
      <div className="mt-4 overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className={labelHeadClass}>{row.year}</TableHead>
              {MONTH_HEADERS.map((m) => (
                <TableHead key={m} className={monthHeadClass}>{m}</TableHead>
              ))}
              <TableHead className={highlightHeadClass}>No Ano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className={labelCellClass}>Patrimônio</TableCell>
              {row.patrimonioMonths.map((v, i) => (
                <TableCell key={i} className={monthCellClass}>{fmtBrl(v)}</TableCell>
              ))}
              <TableCell className={highlightCellClass}>—</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className={labelCellClass}>Ganho Financeiro</TableCell>
              {row.ganhoFinanceiroMonths.map((v, i) => (
                <TableCell key={i} className={monthCellClass}>{fmtBrl(v)}</TableCell>
              ))}
              <TableCell className={highlightCellClass}>{fmtBrl(row.ganhoNoAno)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className={labelCellClass}>Rentabilidade</TableCell>
              {row.rentabilidadeMonths.map((v, i) => (
                <TableCell key={i} className={monthCellClass}>{fmtPct(v)}</TableCell>
              ))}
              <TableCell className={highlightCellClass}>{fmtPct(row.rentNoAno)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className={labelCellClass}>CDI</TableCell>
              {row.cdiMonths.map((v, i) => (
                <TableCell key={i} className={monthCellClass}>{fmtPct(v)}</TableCell>
              ))}
              <TableCell className={highlightCellClass}>{fmtPct(row.cdiNoAno)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RentabilidadeDetailTable({ rows, tituloLabel }: Props) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  const latestYear = rows[0];
  const previousYears = rows.slice(1);

  return (
    <div className="space-y-6">
      <YearTable row={latestYear} />

      {previousYears.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
            Anos anteriores ({previousYears.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-6">
            {previousYears.map((row) => (
              <YearTable key={row.year} row={row} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
