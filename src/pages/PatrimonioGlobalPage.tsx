/**
 * Patrimônio Global: o primeiro pedaço do módulo de finanças pessoais dentro do Blueberg
 * (Daniel, 21/09/2026).
 *
 * Nesta primeira versão é a tabela "Patrimônio por Conta" do dashboard local
 * (`financas-pessoais/_dashboard/index.html`): o saldo de fim de mês de cada conta, um quadro por
 * ano, do mais recente para o mais antigo.
 *
 * O dado mora em OUTRO projeto Supabase, e o navegador não fala com ele: a edge function
 * `patrimonio-pessoal` lê com uma chave que fica nos secrets dela e só responde a admin. O
 * porquê está no cabeçalho da função.
 *
 * A linha de investimentos é a exceção: vem do portfólio **Pessoal** do próprio Blueberg, pelo
 * mesmo `useCarteiraInvestimentos` da Carteira de Investimentos - o valor de cada mês é o
 * patrimônio que aquela tela mostraria no último dia dele.
 *
 * Só dá para calcular com o Pessoal EM USO. A RLS de `movimentacoes` enxerga apenas o portfólio
 * em uso (`invest.portfolio_ativo()`), e os motores rodam no navegador. Com outro portfólio em
 * uso, a linha fica em branco e a página oferece a troca - somar o portfólio errado seria pior:
 * com o Maurício em uso, o dinheiro dele entraria como patrimônio do Daniel.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaginaCabecalho } from "@/components/PaginaPadrao";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  fimDeMesDaCarteira, montarPatrimonioPorConta, resumoDoPatrimonio, serieDoPatrimonio,
  type AnoDoPatrimonio, type Modulo, type PatrimonioPorConta, type SaldoMensal,
} from "@/lib/patrimonioGlobal";
import PatrimonioChart from "@/components/PatrimonioChart";
import { useCarteiraInvestimentos } from "@/hooks/useCarteiraInvestimentos";
import { usePortfolios } from "@/hooks/usePortfolios";

/** O portfólio cujo patrimônio entra na tabela. Pelo nome, enquanto for o único jeito de dizer. */
const NOME_DO_PORTFOLIO = "Pessoal";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

const fmtBrl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Valor({ v, forte = false }: { v: number | null; forte?: boolean }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const texto = fmtBrl(v);
  return (
    <span className={v < 0 ? "text-destructive" : undefined}>
      {forte ? <strong>{texto}</strong> : texto}
    </span>
  );
}

/**
 * Classes da `RentabilidadeDetailTable`, a tabela por ano das lâminas de carteira: o mesmo cartão,
 * o mesmo cabeçalho com o ano na primeira coluna e os meses centralizados. Duas diferenças, e as
 * duas por causa do conteúdo:
 *  - colunas mais largas (rótulo de 200px, mês de 100px): aqui cabem "Investimentos (portfólio
 *    Pessoal)" e valores de sete dígitos, que nos 130/80px de lá passariam por cima do vizinho;
 *  - sem a coluna "No Ano": saldo não se soma no ano, e lá mesmo a linha de Patrimônio mostra "—"
 *    nela. Onze linhas de travessão não informariam nada.
 */
const K = {
  cartao: "rounded-md border border-border bg-card p-6",
  rotuloCab: "text-xs font-semibold whitespace-nowrap w-[200px] min-w-[200px]",
  rotulo: "text-xs font-medium whitespace-nowrap w-[200px] min-w-[200px]",
  mesCab: "text-xs font-semibold text-center whitespace-nowrap w-[100px] min-w-[100px]",
  mes: "text-xs text-center whitespace-nowrap w-[100px] min-w-[100px] tabular-nums",
  total: "bg-muted/50 font-semibold",
};

const MODULOS: { chave: Modulo; rotulo: string }[] = [
  { chave: "caixa", rotulo: "Caixa" },
  { chave: "investimentos", rotulo: "Investimentos" },
];

function AnoDoPatrimonioTable({ ano }: { ano: AnoDoPatrimonio }) {
  return (
    <div className={K.cartao}>
      <h2 className="text-sm font-semibold text-foreground">Patrimônio por Conta — {ano.ano}</h2>
      <p className="mt-1 text-xs text-muted-foreground">Saldo de fim de mês de cada conta</p>
      <div className="mt-4 overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className={K.rotuloCab}>{ano.ano}</TableHead>
              {MESES.map((m) => (
                <TableHead key={m} className={K.mesCab}>{m}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Os dois módulos, cada um com o seu subtotal, e o Patrimônio Global fechando. */}
            {MODULOS.map((mod) => (
              <Fragment key={mod.chave}>
                {ano.linhas.filter((l) => l.modulo === mod.chave).map((l) => (
                  <TableRow key={l.chave}>
                    <TableCell className={`${K.rotulo} pl-6`}>{l.rotulo}</TableCell>
                    {l.valores.map((v, i) => (
                      <TableCell key={i} className={K.mes}><Valor v={v} /></TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="border-b-2">
                  <TableCell className={`${K.rotulo} font-semibold`}>{mod.rotulo}</TableCell>
                  {ano.subtotais[mod.chave].map((v, i) => (
                    <TableCell key={i} className={`${K.mes} font-semibold`}><Valor v={v} /></TableCell>
                  ))}
                </TableRow>
              </Fragment>
            ))}
            <TableRow className={K.total}>
              <TableCell className={K.rotulo}>Patrimônio Global</TableCell>
              {ano.total.map((v, i) => (
                <TableCell key={i} className={K.mes}><Valor v={v} forte /></TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const fmtPctComSinal = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function TabelaDoPatrimonio({ patrimonio }: { patrimonio: PatrimonioPorConta }) {
  const serie = useMemo(() => serieDoPatrimonio(patrimonio), [patrimonio]);
  const resumo = useMemo(() => resumoDoPatrimonio(patrimonio), [patrimonio]);
  const [anterioresAbertos, setAnterioresAbertos] = useState(false);
  const [maisRecente, ...anteriores] = patrimonio.anos;

  // Mesmo card das lâminas de carteira. A linha de baixo, o mês de referência, é a única coisa a
  // mais: o último Total pode ser de um mês ainda incompleto (regra 4.0 do instrucoes-projeto, o
  // patrimônio geral só fecha no fim do ciclo de importação), e sem o mês o número engana.
  // Os três no MESMO mês, para Caixa + Investimentos = Patrimônio Global na própria tela.
  const refMes = resumo.atual ? `fim de ${resumo.atual.label}` : null;
  const semSaldo = resumo.atual ? `sem saldo em ${resumo.atual.label}` : null;
  const cards = [
    {
      label: "Caixa",
      value: resumo.modulos.caixa != null ? fmtBrl(resumo.modulos.caixa) : "—",
      ref: resumo.modulos.caixa != null ? refMes : semSaldo,
    },
    {
      label: "Investimentos",
      value: resumo.modulos.investimentos != null ? fmtBrl(resumo.modulos.investimentos) : "—",
      ref: resumo.modulos.investimentos != null ? refMes : semSaldo,
    },
    {
      label: "Patrimônio Global",
      value: resumo.atual ? fmtBrl(resumo.atual.valor) : "—",
      ref: refMes,
    },
    {
      label: "% em relação ao mês anterior",
      value: fmtPctComSinal(resumo.variacaoPct),
      ref: resumo.atual && resumo.anterior ? `${resumo.atual.label} sobre ${resumo.anterior.label}` : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-2 text-lg font-bold text-foreground">{c.value}</p>
            {c.ref && <p className="mt-0.5 text-[11px] text-muted-foreground">{c.ref}</p>}
          </div>
        ))}
      </div>

      {/* O mesmo gráfico das lâminas de carteira, com um ponto por mês: o Total da tabela. */}
      {serie.length > 1 && <PatrimonioChart dados={serie} comEspacador={false} curva="linear" />}

      {maisRecente && <AnoDoPatrimonioTable ano={maisRecente} />}

      {/* Igual às lâminas: o ano mais recente aberto, os demais atrás de "Anos anteriores". */}
      {anteriores.length > 0 && (
        <Collapsible open={anterioresAbertos} onOpenChange={setAnterioresAbertos}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-200 ${anterioresAbertos ? "rotate-90" : ""}`}
            />
            Anos anteriores ({anteriores.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-6">
            {anteriores.map((ano) => <AnoDoPatrimonioTable key={ano.ano} ano={ano} />)}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* O dashboard de origem descarta em silêncio a conta que não tem linha. Aqui ela
          aparece: uma conta nova cadastrada na base não pode sumir do patrimônio sem aviso. */}
      {patrimonio.foraDaTabela.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Na base, mas sem linha nesta tabela e fora do total:{" "}
          {patrimonio.foraDaTabela
            .map((f) => `${f.instituicao} (${f.tipoConta}, ${f.meses} ${f.meses === 1 ? "mês" : "meses"})`)
            .join("; ")}
          .
        </p>
      )}
    </div>
  );
}

/**
 * A tabela com a linha de investimentos preenchida. Componente separado porque o hook dos motores
 * é pesado e só deve rodar quando o portfólio em uso é o Pessoal: montado condicionalmente, ele
 * não roda à toa com outro portfólio em uso.
 */
function ComInvestimentos({ saldos }: { saldos: SaldoMensal[] }) {
  const { carteiraRows, loading } = useCarteiraInvestimentos();
  const investimentos = useMemo(() => fimDeMesDaCarteira(carteiraRows), [carteiraRows]);
  const patrimonio = useMemo(
    () => montarPatrimonioPorConta(saldos, loading ? null : investimentos),
    [saldos, investimentos, loading],
  );
  return (
    <>
      {loading && (
        <p className="text-xs text-muted-foreground">Calculando o portfólio {NOME_DO_PORTFOLIO}…</p>
      )}
      <TabelaDoPatrimonio patrimonio={patrimonio} />
    </>
  );
}

export default function PatrimonioGlobalPage() {
  const [saldos, setSaldos] = useState<SaldoMensal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const { portfolios, ativo, carregando: carregandoPortfolios, ativar } = usePortfolios();

  const pessoal = portfolios.find((p) => p.nome.trim().toLowerCase() === NOME_DO_PORTFOLIO.toLowerCase());
  const pessoalEmUso = !!pessoal && ativo?.id === pessoal.id;

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("patrimonio-pessoal", { body: {} });
    if (error || !data?.ok) {
      setErro(data?.erro ?? error?.message ?? "falha ao ler o banco de finanças pessoais");
      setSaldos(null);
    } else {
      setSaldos(data.saldos as SaldoMensal[]);
    }
    setCarregando(false);
  };

  useEffect(() => { void carregar(); }, []);

  const semInvestimentos = useMemo(
    () => (saldos ? montarPatrimonioPorConta(saldos, null) : null),
    [saldos],
  );

  return (
    <div className="space-y-6">
      <PaginaCabecalho
        titulo="Patrimônio Global"
        subtitulo="Saldo de fim de mês de cada conta, das finanças pessoais e dos investimentos"
        acao={
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        }
      />

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {!carregandoPortfolios && !pessoalEmUso && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
          <span className="text-muted-foreground">
            {pessoal
              ? <>A linha de investimentos vem do portfólio <strong className="text-foreground">{NOME_DO_PORTFOLIO}</strong>, e o
                  portfólio em uso é <strong className="text-foreground">{ativo?.nome ?? "outro"}</strong>. Ela fica em branco até a troca.</>
              : <>Não há portfólio chamado <strong className="text-foreground">{NOME_DO_PORTFOLIO}</strong> nesta conta, então a
                  linha de investimentos fica em branco.</>}
          </span>
          {pessoal && (
            <Button size="sm" onClick={() => void ativar(pessoal.id, "/patrimonio-global")}>
              Usar o portfólio {NOME_DO_PORTFOLIO}
            </Button>
          )}
        </div>
      )}

      {carregando && !saldos && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}

      {saldos && (
        <section className="space-y-2">
          {pessoalEmUso
            ? <ComInvestimentos saldos={saldos} />
            : semInvestimentos && <TabelaDoPatrimonio patrimonio={semInvestimentos} />}
        </section>
      )}
    </div>
  );
}
