/**
 * Receitas e Despesas (Daniel, 24/09/2026): o resultado do mês aberto por categoria, e cada
 * categoria aberta em subcategorias ao clique.
 *
 * Mesma origem do Controle de Caixa Total - o recorte `extrato` da edge function
 * `patrimonio-pessoal`, com TODAS as contas e o cartão. Entra o que tem `contabilizar = true`, que
 * é a mesma regra dos cards de Entradas e Saídas do Caixa: os totais dos dois batem.
 *
 * A tabela de despesa veio primeiro, a pedido dele. A de receita usa a mesma função, trocando o
 * tipo.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { montarResultadoPorCategoria, type AnoDeResultado } from "@/lib/receitasDespesas";
import type { Lancamento } from "@/lib/caixa";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const fmtBrl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string) => iso.split("-").reverse().join("/");

/** As mesmas classes da tabela por ano do Caixa e das lâminas, com a coluna "No Ano". */
const K = {
  cartao: "rounded-md border border-border bg-card p-6",
  rotuloCab: "text-xs font-semibold whitespace-nowrap w-[220px] min-w-[220px]",
  rotulo: "text-xs font-medium whitespace-nowrap w-[220px] min-w-[220px]",
  mesCab: "text-xs font-semibold text-center whitespace-nowrap w-[96px] min-w-[96px]",
  mes: "text-xs text-center whitespace-nowrap w-[96px] min-w-[96px] tabular-nums",
  destaqueCab: "text-xs font-semibold text-center whitespace-nowrap bg-muted/50 w-[110px] min-w-[110px]",
  destaque: "text-xs text-center font-semibold whitespace-nowrap bg-muted/50 w-[110px] min-w-[110px] tabular-nums",
};

/**
 * Uma categoria e, escondidas até o clique, as subcategorias dela. O `Collapsible` do shadcn não
 * atravessa `<tbody>`, então o controle de aberto/fechado é nosso e as linhas filhas são linhas
 * normais da tabela.
 */
function LinhasDaCategoria({ linha, aberto, onToggle }: {
  linha: AnoDeResultado["categorias"][number];
  aberto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className={K.rotulo}>
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${aberto ? "rotate-90" : ""}`}
            />
            {linha.nome}
            <span className="text-[10px] font-normal text-muted-foreground">
              ({linha.subcategorias.length})
            </span>
          </span>
        </TableCell>
        {linha.meses.map((v, i) => <TableCell key={i} className={K.mes}>{fmtBrl(v)}</TableCell>)}
        <TableCell className={K.destaque}>{fmtBrl(linha.total)}</TableCell>
      </TableRow>
      {aberto && linha.subcategorias.map((s) => (
        <TableRow key={s.nome} className="bg-muted/20">
          <TableCell className={`${K.rotulo} pl-8 font-normal text-muted-foreground`}>{s.nome}</TableCell>
          {s.meses.map((v, i) => (
            <TableCell key={i} className={`${K.mes} text-muted-foreground`}>{fmtBrl(v)}</TableCell>
          ))}
          <TableCell className={`${K.destaque} font-normal text-muted-foreground`}>{fmtBrl(s.total)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function TabelaDoAno({ titulo, ano }: { titulo: string; ano: AnoDeResultado }) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const alternar = (nome: string) => setAbertas((s) => {
    const novo = new Set(s);
    if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
    return novo;
  });

  return (
    <div className={K.cartao}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-foreground">{titulo} — {ano.ano}</h2>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setAbertas((s) =>
            s.size ? new Set() : new Set(ano.categorias.map((c) => c.nome)))}
        >
          {abertas.size ? "Fechar todas" : "Abrir todas"}
        </button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className={K.rotuloCab}>{ano.ano}</TableHead>
              {MESES.map((m) => <TableHead key={m} className={K.mesCab}>{m}</TableHead>)}
              <TableHead className={K.destaqueCab}>No Ano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ano.categorias.map((c) => (
              <LinhasDaCategoria key={c.nome} linha={c}
                aberto={abertas.has(c.nome)} onToggle={() => alternar(c.nome)} />
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell className={K.rotulo}>Total</TableCell>
              {ano.totalPorMes.map((v, i) => <TableCell key={i} className={K.mes}>{fmtBrl(v)}</TableCell>)}
              <TableCell className={K.destaque}>{fmtBrl(ano.total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** O ano mais recente aberto e os demais atrás de "Anos anteriores", como nas lâminas. */
function TabelasPorAno({ titulo, anos }: { titulo: string; anos: AnoDeResultado[] }) {
  const [aberto, setAberto] = useState(false);
  const [primeiro, ...resto] = anos;
  if (!primeiro) return null;
  return (
    <>
      <TabelaDoAno titulo={titulo} ano={primeiro} />
      {resto.length > 0 && (
        <Collapsible open={aberto} onOpenChange={setAberto}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} />
            Anos anteriores ({resto.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-6">
            {resto.map((a) => <TabelaDoAno key={a.ano} titulo={titulo} ano={a} />)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

export default function ReceitasDespesasPage() {
  const [extrato, setExtrato] = useState<Lancamento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("patrimonio-pessoal", {
      body: { incluir: ["extrato"] },
    });
    if (error || !data?.ok) {
      setErro(data?.erro ?? error?.message ?? "falha ao ler o banco de finanças pessoais");
      setExtrato(null);
    } else {
      setExtrato(data.extrato ?? []);
    }
    setCarregando(false);
  };
  useEffect(() => { void carregar(); }, []);

  // `Automóvel` no topo: foi a categoria que o Daniel escolheu para conferir a tela (24/09/2026).
  const despesas = useMemo(
    () => (extrato ? montarResultadoPorCategoria(extrato, "Saída", "Automóvel") : null),
    [extrato],
  );
  const periodo = useMemo(() => {
    if (!extrato?.length) return null;
    const datas = extrato.filter((l) => l.contabilizar).map((l) => l.data).sort();
    return datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null;
  }, [extrato]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Receitas e Despesas</h1>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {periodo ? `Período de Análise: de ${fmtData(periodo.de)} a ${fmtData(periodo.ate)}` : ""}
        </p>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs"
          disabled={carregando} onClick={() => void carregar()}>
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{erro}</p>
        </div>
      )}
      {carregando && !despesas && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {despesas && (
        <>
          <TabelasPorAno titulo="Despesas por categoria" anos={despesas.anos} />
          {despesas.contas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Contas nesta tabela: {despesas.contas.join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
