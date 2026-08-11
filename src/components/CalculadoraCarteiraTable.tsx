import { CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Props {
  rows: CarteiraRFRow[];
}

export default function CalculadoraCarteiraTable({ rows }: Props) {
  return (
    <div className="rounded-md border border-border overflow-auto max-h-[75vh]">
      <Table>
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="bg-muted">
            <TableHead className="text-xs whitespace-nowrap bg-muted">Data</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-center bg-muted">Dias Úteis</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">Líquido (1) Patrimônio</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">Líquido (2) Antes do resgate</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">R$ Rentabilidade diária</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">% Rentabilidade Diária</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">R$ Rentabilidade acumulada</TableHead>
            <TableHead className="text-xs whitespace-nowrap text-right bg-muted">% Rentabilidade acumulada</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.data} className={i % 2 === 0 ? "" : "bg-muted/30"}>
              <TableCell className="text-xs whitespace-nowrap">{formatDate(r.data)}</TableCell>
              <TableCell className="text-xs text-center">{r.diaUtil ? "Sim" : "Não"}</TableCell>
              <TableCell className="text-xs text-right font-mono">{fmtCurrency(r.liquido)}</TableCell>
              <TableCell className="text-xs text-right font-mono">{fmtCurrency(r.liquido2)}</TableCell>
              <TableCell className="text-xs text-right font-mono">
                {Math.abs(r.rentDiariaRS) > 0.001 ? fmtCurrency(r.rentDiariaRS) : "—"}
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                {Math.abs(r.rentDiariaPct) > 0.0000001
                  ? `${(r.rentDiariaPct * 100).toFixed(8)}%`
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                {Math.abs(r.rentAcumuladaRS) > 0.001 ? fmtCurrency(r.rentAcumuladaRS) : "—"}
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                {Math.abs(r.rentAcumuladaPct) > 0.00001
                  ? `${(r.rentAcumuladaPct * 100).toFixed(2)}%`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtCurrency(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}
