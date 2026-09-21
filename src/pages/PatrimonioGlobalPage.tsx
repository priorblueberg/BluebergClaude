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
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaginaCabecalho, TabelaCartao } from "@/components/PaginaPadrao";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  fimDeMesDaCarteira, montarPatrimonioPorConta, type PatrimonioPorConta, type SaldoMensal,
} from "@/lib/patrimonioGlobal";
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

function TabelaDoPatrimonio({ patrimonio }: { patrimonio: PatrimonioPorConta }) {
  return (
    <>
      {patrimonio.anos.map((ano) => (
        <TabelaCartao key={ano.ano}>
          <div className="px-4 pt-3 text-xs font-bold text-foreground">{ano.ano}</div>
          {/* `table-fixed` com a primeira coluna de largura fixa: as colunas de um ano ficam
              embaixo das do outro, o que deixa comparar o mesmo mês entre anos de olho. */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 w-52 text-xs" />
                {MESES.map((m) => (
                  <TableHead key={m} className="h-8 text-right text-xs">{m}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ano.linhas.map((l) => (
                <TableRow key={l.chave}>
                  <TableCell className="whitespace-nowrap py-1.5 text-xs">{l.rotulo}</TableCell>
                  {l.valores.map((v, i) => (
                    <TableCell key={i} className="whitespace-nowrap py-1.5 text-right text-xs tabular-nums">
                      <Valor v={v} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell className="py-1.5 text-xs font-bold">Total</TableCell>
                {ano.total.map((v, i) => (
                  <TableCell key={i} className="whitespace-nowrap py-1.5 text-right text-xs tabular-nums">
                    <Valor v={v} forte />
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </TabelaCartao>
      ))}

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
    </>
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
          <h2 className="text-sm font-bold text-foreground">Patrimônio por Conta</h2>
          {pessoalEmUso
            ? <ComInvestimentos saldos={saldos} />
            : semInvestimentos && <TabelaDoPatrimonio patrimonio={semInvestimentos} />}
        </section>
      )}
    </div>
  );
}
