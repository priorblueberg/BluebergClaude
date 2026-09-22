/**
 * Caixa: o primeiro módulo do Blueberg ao lado de Investimentos (Daniel, 21/09/2026). Os dois se
 * encontram no Patrimônio Global.
 *
 * Duas visões na mesma rota, escolhidas no seletor e guardadas na URL (`/caixa?conta=cc`), para a
 * página de uma conta ter endereço próprio:
 *  - TODAS AS CONTAS: o desenho da Carteira de Investimentos (`CarteiraCategoriaView`), com as
 *    peças trocadas pelo que faz sentido para dinheiro em conta - o mapa está em `src/lib/caixa.ts`;
 *  - UMA CONTA: o mesmo desenho, com a tabela como ponte de saldo (Saldo Anterior + Receitas -
 *    Despesas + Transferência entre contas = Saldo Final) e o extrato do ano no lugar das categorias.
 *
 * Os dados vêm do banco de finanças pessoais pela edge function `patrimonio-pessoal`, que só
 * responde a admin. A data de referência fica travada em D0 aqui, como no Patrimônio Global: só o
 * módulo de Investimentos escolhe data (ver `AppHeader`).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import PatrimonioChart from "@/components/PatrimonioChart";
import {
  CONTAS_DO_CAIXA, montarCaixa, montarConta,
  type DespesaDaCategoria, type MovimentoDaConta, type MovimentoDoMes,
} from "@/lib/caixa";
import type { SaldoMensal } from "@/lib/patrimonioGlobal";

// ── Peças comuns às duas visões ──────────────────────────────────────────────────────────────

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MESES_LONGOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const fmtBrl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtData = (iso: string) => iso.split("-").reverse().join("/");
const fmtMes = (ym: string) => `${MESES_LONGOS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;
/** Último dia do mês `AAAA-MM`, em ISO. */
const fimDoMes = (ym: string) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};
/** "Período de Análise: de DD/MM/AAAA a DD/MM/AAAA". */
const fmtPeriodo = (de: string, ate: string) => `Período de Análise: de ${fmtData(de)} a ${fmtData(ate)}`;

const COR_ENTRA = "hsl(152, 55%, 40%)";
const COR_SAI = "hsl(0, 65%, 55%)";

/** Classes da tabela por ano das lâminas (`RentabilidadeDetailTable`), com a coluna "No Ano". */
const K = {
  cartao: "rounded-md border border-border bg-card p-6",
  rotuloCab: "text-xs font-semibold whitespace-nowrap w-[180px] min-w-[180px]",
  rotulo: "text-xs font-medium whitespace-nowrap w-[180px] min-w-[180px]",
  mesCab: "text-xs font-semibold text-center whitespace-nowrap w-[96px] min-w-[96px]",
  mes: "text-xs text-center whitespace-nowrap w-[96px] min-w-[96px] tabular-nums",
  destaqueCab: "text-xs font-semibold text-center whitespace-nowrap bg-muted/50 w-[110px] min-w-[110px]",
  destaque: "text-xs text-center font-semibold whitespace-nowrap bg-muted/50 w-[110px] min-w-[110px] tabular-nums",
};

/** Negativo em vermelho, positivo em verde - só no extrato (Daniel, 21/09/2026). */
const corDoValor = (v: number | null) =>
  v == null || v === 0 ? "" : v < 0 ? "text-destructive" : "text-[hsl(152,55%,35%)]";
const negativo = (xs: (number | null)[]) => xs.map((x) => (x == null ? null : -x || 0));

function Celula({ v, className, parcial }: { v: number | null; className: string; parcial?: boolean }) {
  return (
    <TableCell className={`${className}${parcial ? " italic" : ""}`}
      title={parcial ? "Parcial: o mês ainda não fechou; calculado pela ponte" : undefined}>
      {fmtBrl(v)}{parcial && v != null ? "*" : ""}
    </TableCell>
  );
}

interface LinhaAnual {
  rotulo: string; meses: (number | null)[]; noAno: number | null; destaque?: boolean;
  /** Meses com valor parcial, em itálico e com asterisco. */
  parcial?: boolean[];
}

function TabelaDoAno({ titulo, ano, linhas }: {
  titulo: string; ano: number; linhas: LinhaAnual[];
}) {
  return (
    <div className={K.cartao}>
      <h2 className="text-sm font-semibold text-foreground">{titulo} — {ano}</h2>
      <div className="mt-4 overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className={K.rotuloCab}>{ano}</TableHead>
              {MESES.map((m) => <TableHead key={m} className={K.mesCab}>{m}</TableHead>)}
              <TableHead className={K.destaqueCab}>No Ano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.rotulo} className={l.destaque ? "bg-muted/40 font-semibold" : undefined}>
                <TableCell className={K.rotulo}>{l.rotulo}</TableCell>
                {l.meses.map((v, i) => <Celula key={i} v={v} className={K.mes} parcial={l.parcial?.[i]} />)}
                <Celula v={l.noAno} className={K.destaque} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** O ano mais recente aberto e os demais atrás de "Anos anteriores", como nas lâminas. */
function TabelasPorAno({ tabelas }: { tabelas: ReactNode[] }) {
  const [aberto, setAberto] = useState(false);
  const [primeira, ...resto] = tabelas;
  if (!primeira) return null;
  return (
    <>
      {primeira}
      {resto.length > 0 && (
        <Collapsible open={aberto} onOpenChange={setAberto}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} />
            Anos anteriores ({resto.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-6">{resto}</CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function Cards({ cards }: { cards: { label: string; value: number | null }[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
          <p className="mt-2 text-lg font-bold text-foreground">{fmtBrl(c.value)}</p>
        </div>
      ))}
    </div>
  );
}

const BarrasTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
          {p.name}: {fmtBrl(Number(p.value))}
        </p>
      ))}
    </div>
  );
};

/** Entradas e saídas mês a mês: linha reta, como o gráfico de patrimônio, com a área hachurada. */
function GraficoDeLinhas({ titulo, dados, entra, sai }: {
  titulo: string; dados: object[];
  entra: { chave: string; nome: string }; sai: { chave: string; nome: string };
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados}>
            <defs>
              {[["hachura-entra", COR_ENTRA], ["hachura-sai", COR_SAI]].map(([id, cor]) => (
                <pattern key={id} id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke={cor} strokeWidth="1.5" strokeOpacity="0.45" />
                </pattern>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 20%, 88%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }}
              axisLine={{ stroke: "hsl(215, 20%, 88%)" }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: "hsl(215, 15%, 50%)" }} axisLine={{ stroke: "hsl(215, 20%, 88%)" }}
              tickLine={false} width={80}
              tickFormatter={(v) => Number(v).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })} />
            <Tooltip content={<BarrasTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="linear" dataKey={entra.chave} name={entra.nome} stroke={COR_ENTRA} strokeWidth={2}
              fill="url(#hachura-entra)" fillOpacity={1} dot={false} />
            <Area type="linear" dataKey={sai.chave} name={sai.nome} stroke={COR_SAI} strokeWidth={2}
              fill="url(#hachura-sai)" fillOpacity={1} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}

function BotaoAtualizar({ carregando, onClick }: { carregando: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={carregando}>
      <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
      Atualizar
    </Button>
  );
}

// ── Todas as contas ──────────────────────────────────────────────────────────────────────────

function Consolidado() {
  const [dados, setDados] = useState<{
    saldos: SaldoMensal[];
    movimento: MovimentoDoMes[];
    despesaPorCategoria: DespesaDaCategoria[];
    atualizacao: { conta: string; ate: string }[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("patrimonio-pessoal", {
      body: { incluir: ["movimento"] },
    });
    if (error || !data?.ok) {
      setErro(data?.erro ?? error?.message ?? "falha ao ler o banco de finanças pessoais");
      setDados(null);
    } else {
      setDados({
        saldos: data.saldos ?? [],
        movimento: data.movimento ?? [],
        despesaPorCategoria: data.despesaPorCategoria ?? [],
        atualizacao: data.atualizacao ?? [],
      });
    }
    setCarregando(false);
  };
  useEffect(() => { void carregar(); }, []);

  const caixa = useMemo(
    () => (dados ? montarCaixa(dados.saldos, dados.movimento, dados.despesaPorCategoria) : null),
    [dados],
  );
  const r = caixa?.resumo;
  // O fim do período é o último lançamento da base, não o fim do mês.
  const ultimoLancamento = dados?.atualizacao.map((a) => a.ate).sort().at(-1) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {caixa?.periodo ? fmtPeriodo(`${caixa.periodo.de}-01`, ultimoLancamento ?? fimDoMes(caixa.periodo.ate)) : ""}
        </p>
        <BotaoAtualizar carregando={carregando} onClick={() => void carregar()} />
      </div>

      {erro && <Erro texto={erro} />}
      {carregando && !caixa && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {caixa && (
        <>
          <Cards cards={[
            { label: "Saldo em Caixa", value: r?.saldo?.valor ?? null },
            { label: `Receitas em ${r?.ano ?? "—"}`, value: r?.receitas ?? null },
            { label: `Despesas em ${r?.ano ?? "—"}`, value: r?.despesas == null ? null : -r.despesas },
            { label: `Resultado em ${r?.ano ?? "—"}`, value: r?.resultado ?? null },
          ]} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GraficoDeLinhas titulo="Receitas e Despesas"
              dados={caixa.serieMovimento}
              entra={{ chave: "receitas", nome: "Receitas" }} sai={{ chave: "despesas", nome: "Despesas" }} />
            <PatrimonioChart dados={caixa.serieSaldo} comEspacador={false} curva="linear"
              titulo="Saldo em Caixa" subtitulo="" />
          </div>

          <TabelasPorAno tabelas={caixa.anos.map((a) => (
            <TabelaDoAno key={a.ano} titulo="Caixa" ano={a.ano}
              linhas={[
                // Saldo não se soma no ano, como o Patrimônio na tabela das lâminas.
                { rotulo: "Saldo em Caixa", meses: a.saldo, noAno: null },
                { rotulo: "Receitas", meses: a.receitas, noAno: a.receitasNoAno },
                { rotulo: "Despesas", meses: negativo(a.despesas), noAno: a.despesasNoAno == null ? null : -a.despesasNoAno },
                { rotulo: "Resultado", meses: a.resultado, noAno: a.resultadoNoAno },
              ]} />
          ))} />

          {/* No lugar da lista de posições das lâminas: para onde o dinheiro foi no ano. */}
          {caixa.categoriasDoAno && caixa.categoriasDoAno.itens.length > 0 && (
            <div className={K.cartao}>
              <h2 className="text-sm font-semibold text-foreground">Despesas por categoria — {caixa.categoriasDoAno.ano}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Para onde o dinheiro foi no ano, da maior para a menor</p>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-semibold">Categoria</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Total no ano</TableHead>
                      <TableHead className="text-xs font-semibold text-right">% das despesas</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Média mensal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {caixa.categoriasDoAno.itens.map((c) => (
                      <TableRow key={c.categoria}>
                        <TableCell className="text-xs font-medium">{c.categoria}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{fmtBrl(c.valor)}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{fmtPct(c.pct)}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{fmtBrl(c.mediaMensal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Até quando cada conta tem lançamento. Sem isso, mês com cartão ainda não importado
              parece mês de pouca despesa. */}
          {dados && dados.atualizacao.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Lançamentos até: {dados.atualizacao.map((a) => `${a.conta} ${fmtData(a.ate)}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Uma conta ────────────────────────────────────────────────────────────────────────────────

interface LinhaDoExtrato {
  data: string;
  descricao: string;
  valor: number;
  tipo: string;
  categoria: string | null;
  subcategoria: string | null;
  contabilizar: boolean;
}

const TIPOS_DA_PONTE = ["Entrada", "Saída", "Transferência entre contas"] as const;
type TipoDaPonte = (typeof TIPOS_DA_PONTE)[number];
const TODOS = "__todos";
const SEM_CATEGORIA = "(sem categoria)";
const POR_PAGINA = 50;
interface FiltroDoExtrato { ano: string; mes: string; tipo: string; categoria: string; subcategoria: string }
const SEM_FILTRO: FiltroDoExtrato = { ano: TODOS, mes: TODOS, tipo: TODOS, categoria: TODOS, subcategoria: TODOS };

function Filtro({ valor, rotuloTodos, opcoes, onChange, largura }: {
  valor: string; rotuloTodos: string; opcoes: { valor: string; rotulo: string }[];
  onChange: (v: string) => void; largura: string;
}) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className={`h-8 text-xs ${largura}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS} className="text-xs">{rotuloTodos}</SelectItem>
        {opcoes.map((o) => <SelectItem key={o.valor} value={o.valor} className="text-xs">{o.rotulo}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ContaIndividual({ chave }: { chave: string }) {
  const conta = CONTAS_DO_CAIXA.find((c) => c.chave === chave)!;
  const [dados, setDados] = useState<{
    saldos: SaldoMensal[];
    movimento: MovimentoDaConta[];
    extrato: LinhaDoExtrato[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("patrimonio-pessoal", {
      body: { incluir: ["conta"], conta: chave },
    });
    if (error || !data?.ok) {
      setErro(data?.erro ?? error?.message ?? "falha ao ler o banco de finanças pessoais");
      setDados(null);
    } else {
      setDados({
        saldos: data.saldos ?? [],
        movimento: data.conta?.movimento ?? [],
        extrato: data.conta?.extrato ?? [],
      });
    }
    setCarregando(false);
  };
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [chave]);

  const c = useMemo(() => (dados ? montarConta(dados.saldos, chave, dados.movimento) : null), [dados, chave]);
  const r = c?.resumo;
  // O extrato com o Tipo da ponte: Entrada e Saída entram no resultado (`contabilizar`), o resto
  // é Transferência entre contas. O valor vai com sinal: o que sai da conta é negativo.
  const extrato = useMemo(() => (dados?.extrato ?? []).map((l) => ({
    ...l,
    tipoDaPonte: (!l.contabilizar ? "Transferência entre contas" : l.tipo === "Entrada" ? "Entrada" : "Saída") as TipoDaPonte,
    valorComSinal: l.tipo === "Entrada" ? l.valor : -l.valor,
  })), [dados]);
  const [filtro, setFiltro] = useState<FiltroDoExtrato>(SEM_FILTRO);
  const [pagina, setPagina] = useState(0);
  useEffect(() => setPagina(0), [filtro, dados]);
  const opcoes = useMemo(() => ({
    anos: [...new Set(extrato.map((l) => l.data.slice(0, 4)))].sort().reverse(),
    // Meses do ano escolhido, ou de todos.
    meses: [...new Set(extrato
      .filter((l) => filtro.ano === TODOS || l.data.startsWith(filtro.ano))
      .map((l) => l.data.slice(0, 7)))].sort().reverse(),
    categorias: [...new Set(extrato.map((l) => l.categoria ?? SEM_CATEGORIA))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    // Subcategorias da categoria escolhida, ou todas.
    subcategorias: [...new Set(extrato
      .filter((l) => filtro.categoria === TODOS || (l.categoria ?? SEM_CATEGORIA) === filtro.categoria)
      .map((l) => l.subcategoria ?? SEM_CATEGORIA))].sort((a, b) => a.localeCompare(b, "pt-BR")),
  }), [extrato, filtro.ano, filtro.categoria]);
  const filtrado = extrato.filter((l) =>
    (filtro.ano === TODOS || l.data.startsWith(filtro.ano))
    && (filtro.mes === TODOS || l.data.startsWith(filtro.mes))
    && (filtro.tipo === TODOS || l.tipoDaPonte === filtro.tipo)
    && (filtro.categoria === TODOS || (l.categoria ?? SEM_CATEGORIA) === filtro.categoria)
    && (filtro.subcategoria === TODOS || (l.subcategoria ?? SEM_CATEGORIA) === filtro.subcategoria));
  const paginas = Math.max(1, Math.ceil(filtrado.length / POR_PAGINA));
  const daPagina = filtrado.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const temFiltro = Object.values(filtro).some((v) => v !== TODOS);

  // Cards e gráfico na mesma língua da tabela: entrada e saída entram no resultado,
  // transferência só passa pela conta.
  const cards = [
    ...(conta.temSaldo
      ? [{ label: "Saldo", value: r?.saldo?.valor ?? null }]
      : []),
    { label: `Entradas em ${r?.ano ?? "—"}`, value: r?.receitas ?? null },
    { label: `Saídas em ${r?.ano ?? "—"}`, value: r?.despesas == null ? null : -r.despesas },
    { label: `Transferências em ${r?.ano ?? "—"}`, value: r?.transferencias ?? null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {c?.periodo
            ? fmtPeriodo(extrato.at(-1)?.data ?? `${c.periodo.de}-01`, extrato[0]?.data ?? fimDoMes(c.periodo.ate))
            : ""}
        </p>
        <BotaoAtualizar carregando={carregando} onClick={() => void carregar()} />
      </div>

      {erro && <Erro texto={erro} />}
      {carregando && !c && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {c && (
        <>
          <Cards cards={cards} />

          <div className={`grid grid-cols-1 gap-4${conta.temSaldo ? " lg:grid-cols-2" : ""}`}>
            <GraficoDeLinhas titulo="Entradas e Saídas"
              dados={c.serieMovimento}
              entra={{ chave: "receitas", nome: "Entradas" }} sai={{ chave: "despesas", nome: "Saídas" }} />
            {conta.temSaldo && (
              <PatrimonioChart dados={c.serieSaldo} comEspacador={false} curva="linear"
                titulo="Saldo" subtitulo="" />
            )}
          </div>

          <TabelasPorAno tabelas={c.anos.map((a) => (
            // A ponte do mês: Saldo Anterior + Entradas + Saídas (negativas) + Transferência = Saldo
            // Final. Saldo não se soma no ano: a coluna "No Ano" não tem Saldo Anterior nem Final.
            <TabelaDoAno key={a.ano} titulo={conta.rotulo} ano={a.ano}
              linhas={[
                // O anterior do mês seguinte a um parcial também é parcial.
                ...(conta.temSaldo ? [{
                  rotulo: "Saldo Anterior", meses: a.saldoAnterior, noAno: null,
                  parcial: a.saldoFinalParcial.map((_, i) => (i === 0 ? false : a.saldoFinalParcial[i - 1])),
                }] : []),
                { rotulo: "Entradas", meses: a.receitas, noAno: a.receitasNoAno },
                { rotulo: "Saídas", meses: negativo(a.despesas), noAno: a.despesasNoAno == null ? null : -a.despesasNoAno },
                { rotulo: "Transferência entre contas", meses: a.transferencias, noAno: a.transferenciasNoAno },
                ...(conta.temSaldo
                  ? [{ rotulo: "Saldo Final", meses: a.saldoFinal, noAno: null, destaque: true, parcial: a.saldoFinalParcial }]
                  : []),
                // Só no ano em que a ponte não fecha. Sem esta linha a tabela afirmaria uma igualdade
                // falsa - nas contas personalizadas o saldo é recebível, com regras próprias.
                ...(conta.temSaldo && a.naoFecha
                  ? [{ rotulo: "Diferença (não fecha)", meses: a.diferenca, noAno: a.diferencaNoAno }]
                  : []),
              ]} />
          ))} />

          {/* No lugar das categorias do consolidado: o extrato da conta, um ano por vez. */}
          <div className={K.cartao}>
            <h2 className="text-sm font-semibold text-foreground">Extrato</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Filtro valor={filtro.ano} rotuloTodos="Todos os anos" largura="w-[130px]"
                opcoes={opcoes.anos.map((a) => ({ valor: a, rotulo: a }))}
                onChange={(v) => setFiltro((f) => ({ ...f, ano: v, mes: TODOS }))} />
              <Filtro valor={filtro.mes} rotuloTodos="Todos os meses" largura="w-[150px]"
                opcoes={opcoes.meses.map((m) => ({ valor: m, rotulo: fmtMes(m) }))}
                onChange={(v) => setFiltro((f) => ({ ...f, mes: v }))} />
              <Filtro valor={filtro.tipo} rotuloTodos="Todos os tipos" largura="w-[210px]"
                opcoes={TIPOS_DA_PONTE.map((t) => ({ valor: t, rotulo: t }))}
                onChange={(v) => setFiltro((f) => ({ ...f, tipo: v }))} />
              <Filtro valor={filtro.categoria} rotuloTodos="Todas as categorias" largura="w-[200px]"
                opcoes={opcoes.categorias.map((c) => ({ valor: c, rotulo: c }))}
                onChange={(v) => setFiltro((f) => ({ ...f, categoria: v, subcategoria: TODOS }))} />
              <Filtro valor={filtro.subcategoria} rotuloTodos="Todas as subcategorias" largura="w-[220px]"
                opcoes={opcoes.subcategorias.map((c) => ({ valor: c, rotulo: c }))}
                onChange={(v) => setFiltro((f) => ({ ...f, subcategoria: v }))} />
              {temFiltro && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltro(SEM_FILTRO)}>
                  Limpar filtros
                </Button>
              )}
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table className="table-fixed min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold w-[8%]">Data</TableHead>
                    <TableHead className="text-xs font-semibold w-[36%]">Descrição</TableHead>
                    <TableHead className="text-xs font-semibold w-[16%]">Tipo</TableHead>
                    <TableHead className="text-xs font-semibold w-[14%]">Categoria</TableHead>
                    <TableHead className="text-xs font-semibold w-[15%]">Subcategoria</TableHead>
                    <TableHead className="text-xs font-semibold text-right w-[11%]">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daPagina.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs whitespace-nowrap tabular-nums">{fmtData(l.data)}</TableCell>
                      <TableCell className="text-xs truncate" title={l.descricao}>{l.descricao}</TableCell>
                      <TableCell className="text-xs truncate">{l.tipoDaPonte}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate" title={l.categoria ?? undefined}>{l.categoria ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate" title={l.subcategoria ?? undefined}>{l.subcategoria ?? "—"}</TableCell>
                      <TableCell className={`text-xs text-right whitespace-nowrap tabular-nums ${corDoValor(l.valorComSinal)}`}>
                        {fmtBrl(l.valorComSinal)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtrado.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                        Nenhum lançamento com esses filtros.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {filtrado.length > POR_PAGINA && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, filtrado.length)} de {filtrado.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-7 px-2" disabled={pagina === 0}
                    onClick={() => setPagina((p) => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span>Página {pagina + 1} de {paginas}</span>
                  <Button variant="outline" size="sm" className="h-7 px-2" disabled={pagina >= paginas - 1}
                    onClick={() => setPagina((p) => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── A página ─────────────────────────────────────────────────────────────────────────────────

const TODAS = "todas";

export default function CaixaPage() {
  const [params, setParams] = useSearchParams();
  const chave = params.get("conta");
  const conta = CONTAS_DO_CAIXA.find((c) => c.chave === chave) ?? null;

  const escolher = (v: string) => {
    if (v === TODAS) setParams({}, { replace: false });
    else setParams({ conta: v }, { replace: false });
  };
  const grupos = ["Contas", "Cartões"] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-lg font-semibold text-foreground">
          Caixa{conta ? <span className="text-muted-foreground"> · {conta.rotulo}</span> : null}
        </h1>
        <Select value={conta?.chave ?? TODAS} onValueChange={escolher}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS} className="text-xs">Todas as contas</SelectItem>
            {grupos.map((g) => (
              <SelectGroup key={g}>
                <SelectSeparator />
                <SelectLabel className="text-[11px] text-muted-foreground">{g}</SelectLabel>
                {CONTAS_DO_CAIXA.filter((c) => c.grupo === g).map((c) => (
                  <SelectItem key={c.chave} value={c.chave} className="text-xs">{c.rotulo}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {conta ? <ContaIndividual key={conta.chave} chave={conta.chave} /> : <Consolidado />}
    </div>
  );
}
