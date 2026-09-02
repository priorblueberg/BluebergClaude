import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export interface PontoPatrimonio {
  data: string;
  label: string;
  patrimonio: number;
}

const fmtBrl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PatrimonioTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
      <p className="text-xs text-primary">{fmtBrl(Number(payload[0].value))}</p>
    </div>
  );
};

/**
 * Evolução diária do patrimônio. É o mesmo gráfico nas três lâminas
 * (Investimentos, Renda Fixa e Fundos) - antes a Renda Fixa tinha uma versão
 * própria, mensal em barras, que não conversava com as demais.
 *
 * `comEspacador` reserva a altura da linha de controles do gráfico ao lado,
 * para as duas bases ficarem alinhadas quando ficam lado a lado.
 */
export default function PatrimonioChart({
  dados,
  comEspacador = true,
}: {
  dados: PontoPatrimonio[];
  comEspacador?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Patrimônio</h2>
        <p className="mt-1 text-xs text-muted-foreground">Evolução do patrimônio no período</p>
      </div>
      {comEspacador && <div className="mt-3 h-[26px]" aria-hidden="true" />}
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados}>
            <defs>
              <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(210, 100%, 45%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(210, 100%, 45%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
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
              width={80}
              tickFormatter={(v) =>
                Number(v).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
              }
            />
            <Tooltip content={<PatrimonioTooltip />} />
            <Area
              type="monotone"
              dataKey="patrimonio"
              name="Patrimônio"
              stroke="hsl(210, 100%, 45%)"
              strokeWidth={2}
              fill="url(#gradPatrimonio)"
              dot={false}
              activeDot={{ r: 4, fill: "hsl(210, 100%, 45%)", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Série de patrimônio a partir das linhas do motor de carteira, **só em dia útil**.
 *
 * O motor emite linha todo dia do calendário; fim de semana virava ponto repetido, o que
 * inchava a série (978 pontos contra 673 de pregão no consolidado) sem acrescentar
 * informação. Mesma regra do gráfico de rentabilidade.
 */
export function serieDePatrimonio(
  carteiraRows: { data: string; diaUtil?: boolean; liquido: number; liquido2: number }[],
  ateData: string,
): PontoPatrimonio[] {
  return carteiraRows
    .filter((r) => r.diaUtil !== false && r.data <= ateData && (r.liquido > 0 || r.liquido2 > 0))
    .map((r) => ({
      data: r.data,
      label: new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR"),
      patrimonio: parseFloat(r.liquido.toFixed(2)),
    }));
}
