/**
 * O gráfico de "Histórico de Rentabilidade", em UM lugar só.
 *
 * Ele existia copiado em quatro telas - investimentos, carteira de renda fixa, carteira por
 * categoria e análise individual - e as quatro tinham divergido: duas mostravam seletor de
 * benchmark e duas não, uma usava botões e outra usava switch, e o eixo X saía com data completa
 * em três delas e apinhado em todas. Copiar um gráfico é fácil; mantê-lo em quatro cópias é o que
 * produz telas que deveriam ser iguais e não são.
 *
 * O que varia entre as telas é só a SÉRIE PRINCIPAL: a chave dela nos dados e como ela se chama.
 * O resto - CDI, Ibovespa, eixos, tooltip, cores - é igual por construção.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/** Uma linha do gráfico. `data` é ISO (YYYY-MM-DD) e é o que o eixo X usa. */
export interface PontoRentabilidade {
  data: string;
  label?: string;
  cdi_acumulado?: number | null;
  ibovespa_acumulado?: number | null;
  [serie: string]: string | number | null | undefined;
}

interface Props {
  dados: PontoRentabilidade[];
  /** Chave da série principal nos dados. Ex.: "carteira_acumulado", "titulo_acumulado". */
  chaveSerie: string;
  /** Como a série principal aparece na legenda. Ex.: "Investimentos", "Fundos", "Carteira RF". */
  rotuloSerie: string;
  /** Some com o Ibovespa do seletor quando a tela não tem a série. */
  temIbovespa?: boolean;
}

const COR_PRINCIPAL = "hsl(210, 100%, 45%)";
const COR_CDI = "hsl(0, 0%, 55%)";
const COR_IBOV = "hsl(25, 95%, 53%)";

const MESES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** ISO para MM/AA sem passar por `new Date`: o parse de "YYYY-MM-DD" vira UTC e, no fuso de
 *  Brasília, o dia 1º de um mês volta como o último dia do mês anterior. */
const mmAA = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

const Tooltipzinho = ({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-foreground">
        {label ? new Date(`${label}T00:00:00`).toLocaleDateString("pt-BR") : ""}
      </p>
      {payload.map((p) => (
        <p key={p.name} className="text-xs" style={{ color: p.color }}>
          {p.name}: {Number(p.value).toFixed(2)}%
        </p>
      ))}
    </div>
  );
};

export function HistoricoRentabilidadeChart({
  dados, chaveSerie, rotuloSerie, temIbovespa = true,
}: Props) {
  const series = useMemo(() => [
    { key: chaveSerie, label: rotuloSerie, color: COR_PRINCIPAL, tracejado: undefined as string | undefined },
    { key: "cdi_acumulado", label: "CDI", color: COR_CDI, tracejado: "5 3" },
    ...(temIbovespa
      ? [{ key: "ibovespa_acumulado", label: "Ibovespa", color: COR_IBOV, tracejado: "3 2" }]
      : []),
  ], [chaveSerie, rotuloSerie, temIbovespa]);

  // O Ibovespa começa desligado: quem abre a tela quer ver a carteira contra o CDI, e a terceira
  // linha ligada por padrão só polui. Ligar é um clique.
  const [ativas, setAtivas] = useState<Set<string>>(() => new Set([chaveSerie, "cdi_acumulado"]));

  const alternar = (key: string) => setAtivas((prev) => {
    const proximo = new Set(prev);
    if (proximo.has(key)) proximo.delete(key);
    else proximo.add(key);
    return proximo;
  });

  /**
   * Marcas mensais, calculadas em vez de delegadas ao recharts.
   *
   * O `interval="preserveStartEnd"` que estava nas quatro telas deixa o recharts escolher, e o
   * espaçamento sai de acordo com a densidade dos pontos, não do calendário: numa série de três
   * anos e meio ele produzia rótulos de dois em dois meses e meio, com datas quebradas no meio do
   * mês. Aqui a marca é sempre o PRIMEIRO ponto de cada mês, então o eixo fala em meses.
   */
  const marcasMensais = useMemo(() => {
    const vistos = new Set<string>();
    const marcas: string[] = [];
    for (const p of dados) {
      const mes = p.data.slice(0, 7);
      if (vistos.has(mes)) continue;
      vistos.add(mes);
      marcas.push(p.data);
    }
    // Série longa com marca em todo mês fica ilegível. O passo cresce até caber ~14 rótulos, e
    // sempre em múltiplos de mês, então o eixo continua mensal - só que de N em N meses.
    const passo = Math.ceil(marcas.length / 14) || 1;
    return marcas.filter((_, i) => i % passo === 0);
  }, [dados]);

  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Histórico de Rentabilidade</h2>
        <p className="mt-1 text-xs text-muted-foreground">Variação acumulada (%) no período</p>
      </div>

      {/* Numa linha própria: no card estreito os botões brigavam com o título. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {series.map((s) => (
          <button
            key={s.key}
            onClick={() => alternar(s.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium leading-none transition-colors ${
              ativas.has(s.key)
                ? "border-transparent text-primary-foreground"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
            style={ativas.has(s.key) ? { backgroundColor: s.color } : undefined}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="data"
              ticks={marcasMensais}
              tickFormatter={mmAA}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<Tooltipzinho />} />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value: string) => <span className="text-muted-foreground">{value}</span>}
            />
            {series.filter((s) => ativas.has(s.key)).map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.key === chaveSerie ? 2 : 1.5}
                strokeDasharray={s.tracejado}
                dot={false}
                activeDot={{ r: s.key === chaveSerie ? 4 : 3, strokeWidth: 0 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
