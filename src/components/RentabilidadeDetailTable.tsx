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

/** Linhas que a tabela sabe mostrar. "% do CDI" sai da rentabilidade e do CDI de cada período. */
export type LinhaDaTabela = "patrimonio" | "ganho" | "rentabilidade" | "cdi" | "percentualCdi";

const LINHAS_PADRAO: LinhaDaTabela[] = ["patrimonio", "ganho", "rentabilidade", "cdi"];

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2) + "%";
}

function fmtBrl(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const percentualDoCdi = (rent: number | null, cdi: number | null) =>
  rent != null && cdi != null && cdi > 0 ? (rent / cdi) * 100 : null;

interface Props {
  rows: DetailRow[];
  tituloLabel: string;
  /** Padrão: Patrimônio, Ganho Financeiro, Rentabilidade e CDI, como nas lâminas de carteira. */
  linhas?: LinhaDaTabela[];
  /** Colunas estreitas, para caber na gaveta de detalhes da posição sem rolagem. */
  compacto?: boolean;
}

const CLASSES = {
  normal: {
    cartao: "rounded-md border border-border bg-card p-6",
    mes: "text-xs text-center whitespace-nowrap w-[80px] min-w-[80px]",
    mesCab: "text-xs font-semibold text-center whitespace-nowrap w-[80px] min-w-[80px]",
    destaque: "text-xs text-center font-semibold whitespace-nowrap bg-muted/50 w-[100px] min-w-[100px]",
    destaqueCab: "text-xs font-semibold text-center whitespace-nowrap bg-muted/50 w-[100px] min-w-[100px]",
    rotulo: "text-xs font-medium whitespace-nowrap w-[130px] min-w-[130px]",
    rotuloCab: "text-xs font-semibold whitespace-nowrap w-[130px] min-w-[130px]",
  },
  compacto: {
    cartao: "rounded-md border border-border bg-card p-4",
    mes: "text-[11px] text-center whitespace-nowrap w-[56px] min-w-[56px] px-1",
    mesCab: "text-[11px] font-semibold text-center whitespace-nowrap w-[56px] min-w-[56px] px-1",
    destaque: "text-[11px] text-center font-semibold whitespace-nowrap bg-muted/50 w-[68px] min-w-[68px] px-1",
    destaqueCab: "text-[11px] font-semibold text-center whitespace-nowrap bg-muted/50 w-[68px] min-w-[68px] px-1",
    rotulo: "text-[11px] font-medium whitespace-nowrap w-[96px] min-w-[96px] px-2",
    rotuloCab: "text-[11px] font-semibold whitespace-nowrap w-[96px] min-w-[96px] px-2",
  },
};

function YearTable({ row, linhas, compacto }: { row: DetailRow; linhas: LinhaDaTabela[]; compacto: boolean }) {
  const k = compacto ? CLASSES.compacto : CLASSES.normal;
  const conteudo: Record<LinhaDaTabela, { rotulo: string; meses: string[]; ano: string }> = {
    patrimonio: { rotulo: "Patrimônio", meses: row.patrimonioMonths.map(fmtBrl), ano: "—" },
    ganho: { rotulo: "Ganho Financeiro", meses: row.ganhoFinanceiroMonths.map(fmtBrl), ano: fmtBrl(row.ganhoNoAno) },
    rentabilidade: { rotulo: "Rentabilidade", meses: row.rentabilidadeMonths.map(fmtPct), ano: fmtPct(row.rentNoAno) },
    cdi: { rotulo: "CDI", meses: row.cdiMonths.map(fmtPct), ano: fmtPct(row.cdiNoAno) },
    percentualCdi: {
      rotulo: "% do CDI",
      meses: row.rentabilidadeMonths.map((r, i) => fmtPct(percentualDoCdi(r, row.cdiMonths[i]))),
      ano: fmtPct(percentualDoCdi(row.rentNoAno, row.cdiNoAno)),
    },
  };

  return (
    <div className={k.cartao}>
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
              <TableHead className={k.rotuloCab}>{row.year}</TableHead>
              {MONTH_HEADERS.map((m) => (
                <TableHead key={m} className={k.mesCab}>{m}</TableHead>
              ))}
              <TableHead className={k.destaqueCab}>No Ano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((linha) => (
              <TableRow key={linha}>
                <TableCell className={k.rotulo}>{conteudo[linha].rotulo}</TableCell>
                {conteudo[linha].meses.map((v, i) => (
                  <TableCell key={i} className={k.mes}>{v}</TableCell>
                ))}
                <TableCell className={k.destaque}>{conteudo[linha].ano}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RentabilidadeDetailTable({ rows, linhas = LINHAS_PADRAO, compacto = false }: Props) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  const latestYear = rows[0];
  const previousYears = rows.slice(1);

  return (
    <div className={compacto ? "space-y-4" : "space-y-6"}>
      <YearTable row={latestYear} linhas={linhas} compacto={compacto} />

      {previousYears.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            />
            Anos anteriores ({previousYears.length})
          </CollapsibleTrigger>
          <CollapsibleContent className={compacto ? "mt-4 space-y-4" : "mt-4 space-y-6"}>
            {previousYears.map((row) => (
              <YearTable key={row.year} row={row} linhas={linhas} compacto={compacto} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
