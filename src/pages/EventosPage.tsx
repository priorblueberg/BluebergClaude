import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useEventos, type TipoEvento } from "@/hooks/useEventos";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtBrl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Os tipos que contam como dinheiro recebido; resgate e come-cotas ficam de fora do total. */
const RECEBIDOS: TipoEvento[] = ["Pagamento de juros", "Vencimento"];

function Cartao({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground mb-1">{rotulo}</p>
      <p className="text-lg font-semibold text-foreground">{valor}</p>
    </div>
  );
}

export default function EventosPage() {
  const { eventos, vencimentos, loading } = useEventos();
  const { dataReferenciaISO } = useDataReferencia();
  const [filtro, setFiltro] = useState<TipoEvento | "Todos">("Todos");

  /** Janela de 12 meses terminando na data de referência, como no Gorila. */
  const doze = useMemo(() => {
    const fim = new Date(dataReferenciaISO + "T00:00:00");
    const de = new Date(fim);
    de.setFullYear(de.getFullYear() - 1);
    const deISO = de.toISOString().slice(0, 10);
    const naJanela = eventos.filter((e) => e.data > deISO && e.data <= dataReferenciaISO);

    const juros = naJanela.filter((e) => e.tipo === "Pagamento de juros").reduce((s, e) => s + e.valor, 0);
    const vencidos = naJanela.filter((e) => e.tipo === "Vencimento").reduce((s, e) => s + e.valor, 0);

    // Uma barra por mês da janela, mesmo os meses sem evento — senão o gráfico mente
    // sobre a regularidade dos pagamentos.
    const barras: { chave: string; rotulo: string; valor: number }[] = [];
    const cursor = new Date(fim.getFullYear(), fim.getMonth() - 11, 1);
    for (let i = 0; i < 12; i++) {
      const chave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      barras.push({ chave, rotulo: `${MESES[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}`, valor: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const porChave = new Map(barras.map((b) => [b.chave, b]));
    for (const e of naJanela) {
      if (!RECEBIDOS.includes(e.tipo)) continue;
      const b = porChave.get(e.data.slice(0, 7));
      if (b) b.valor += e.valor;
    }

    const mesesComAlgo = barras.filter((b) => b.valor > 0).length;
    const total = juros + vencidos;
    return { juros, vencidos, total, media: mesesComAlgo ? total / mesesComAlgo : 0, barras };
  }, [eventos, dataReferenciaISO]);

  const tipos = useMemo(
    () => ["Todos", ...Array.from(new Set(eventos.map((e) => e.tipo)))] as (TipoEvento | "Todos")[],
    [eventos],
  );
  const visiveis = useMemo(
    () => (filtro === "Todos" ? eventos : eventos.filter((e) => e.tipo === filtro)),
    [eventos, filtro],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Eventos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cupom, vencimento, resgate e come-cotas até {fmtData(dataReferenciaISO)}
        </p>
      </div>

      {loading ? (
        <div className="rounded-md border border-border p-8 text-center text-muted-foreground">Carregando...</div>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Distribuição nos últimos 12 meses</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Cartao rotulo="Pagamento de juros" valor={fmtBrl(doze.juros)} />
              <Cartao rotulo="Vencimentos" valor={fmtBrl(doze.vencidos)} />
              <Cartao rotulo="Média mensal" valor={fmtBrl(doze.media)} />
              <Cartao rotulo="Total" valor={fmtBrl(doze.total)} />
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={doze.barras} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis
                      tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => [fmtBrl(v), "Recebido"]}
                      contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
                    />
                    <Bar dataKey="valor" fill="hsl(210, 100%, 45%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium text-foreground mb-1">Vencimentos em renda fixa</h2>
            <p className="text-xs text-muted-foreground mb-2">Próximos 12 meses</p>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Ativo</TableHead>
                    <TableHead className="text-xs">Vencimento</TableHead>
                    <TableHead className="text-xs text-right">Valor investido</TableHead>
                    <TableHead className="text-xs">Custodiante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vencimentos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">
                        Nenhum vencimento nos próximos 12 meses.
                      </TableCell>
                    </TableRow>
                  ) : (
                    vencimentos.map((v) => (
                      <TableRow key={`${v.ativo}-${v.vencimento}`}>
                        <TableCell className="text-sm">{v.ativo}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{fmtData(v.vencimento)}</TableCell>
                        <TableCell className="text-sm text-right whitespace-nowrap">{fmtBrl(v.valorInvestido)}</TableCell>
                        <TableCell className="text-sm">{v.custodiante}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-sm font-medium text-foreground">Histórico de eventos</h2>
              <div className="flex gap-1">
                {tipos.map((t) => (
                  <button
                    key={t}
                    onClick={() => setFiltro(t)}
                    className={`rounded-md border px-2 py-0.5 text-xs ${
                      filtro === t
                        ? "border-primary text-primary font-medium"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                    style={{ transition: "all 120ms linear" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground ml-auto">{visiveis.length} eventos</span>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Evento</TableHead>
                    <TableHead className="text-xs">Ativo</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs text-right">Valor unitário</TableHead>
                    <TableHead className="text-xs text-right">Quantidade</TableHead>
                    <TableHead className="text-xs">Custodiante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-sm">
                        Nenhum evento no período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visiveis.map((e, i) => (
                      <TableRow key={`${e.data}-${e.ativo}-${e.tipo}-${i}`}>
                        <TableCell className="text-sm whitespace-nowrap">{fmtData(e.data)}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{e.tipo}</TableCell>
                        <TableCell className="text-sm">{e.ativo}</TableCell>
                        <TableCell className="text-sm text-right whitespace-nowrap">{fmtBrl(e.valor)}</TableCell>
                        <TableCell className="text-sm text-right whitespace-nowrap">
                          {e.valorUnitario != null ? fmtBrl(e.valorUnitario) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right whitespace-nowrap">
                          {e.quantidade != null
                            ? e.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 8 })
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{e.custodiante}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
