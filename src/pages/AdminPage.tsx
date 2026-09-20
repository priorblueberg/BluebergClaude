/**
 * Admin: o estado operacional do sistema numa tela só (Daniel, 20/09/2026).
 *
 * A porta é a mesma do resto do app, e de propósito. O acesso não é uma segunda senha guardada no
 * front - que iria para o bundle público e não valeria nada -, é o papel `admin` em
 * `invest.user_roles`, conferido no servidor pela `invest.is_admin()`. O `AdminRoute` barra a rota,
 * e a própria função de leitura levanta exceção para quem não é admin.
 *
 * Três blocos, na ordem em que uma coisa quebra:
 *
 *  1. Auditorias - o que a comparação semanal com a B3 encontrou. Até 20/09/2026 elas rodavam,
 *     devolviam um JSON e ele era descartado em horas pelo pg_net: o detector existia e o alarme
 *     não. Agora cada execução fica em `invest.auditoria_execucoes` e aparece aqui.
 *  2. Rotinas - os crons, com a última execução e o status.
 *  3. Séries de mercado - a última data de cada uma. Série parada é a falha mais silenciosa que
 *     existe aqui: a tela continua calculando, só que com dado velho.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaginaCabecalho, TabelaCartao } from "@/components/PaginaPadrao";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

interface Cron {
  nome: string;
  agenda: string;
  ativo: boolean;
  ultima_execucao: string | null;
  ultimo_status: string | null;
  mensagem: string | null;
}

interface Serie {
  tabela: string;
  ultima_data: string | null;
}

interface Auditoria {
  funcao: string;
  executada_em: string;
  ok: boolean;
  alerta: boolean;
  resumo: Record<string, number> | null;
  achados: unknown[] | null;
  erro: string | null;
}

interface Status {
  crons: Cron[];
  series: Serie[];
  auditorias: Auditoria[];
}

const fmtQuando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const fmtData = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—";

/** Dias corridos entre a data e hoje, para a coluna de atraso das séries. */
function diasAtras(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00").getTime();
  return Math.floor((Date.now() - d) / 86400000);
}

function Selo({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {texto}
    </span>
  );
}

export default function AdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc("status_das_rotinas" as never);
    if (error) setErro(error.message);
    else setStatus(data as unknown as Status);
    setCarregando(false);
  }

  useEffect(() => { void carregar(); }, []);

  const auditorias = status?.auditorias ?? [];
  const crons = status?.crons ?? [];
  const series = status?.series ?? [];
  const cronsComFalha = crons.filter((c) => c.ultimo_status && c.ultimo_status !== "succeeded");

  return (
    <div className="space-y-6">
      <PaginaCabecalho
        titulo="Admin"
        subtitulo="Estado das rotinas, das auditorias e das séries de mercado"
        acao={
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void carregar()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        }
      />

      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {erro}
        </p>
      )}
      {carregando && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!carregando && !erro && (
        <>
          {/* 1. Auditorias */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-foreground">Auditorias contra a B3</h2>
            {auditorias.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma execução registrada ainda. Elas rodam aos sábados.
              </p>
            ) : (
              <div className="space-y-2">
                {auditorias.map((a) => {
                  const expandido = aberto === a.funcao;
                  const temAchado = (a.achados?.length ?? 0) > 0;
                  return (
                    <div key={a.funcao} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                      <button
                        type="button"
                        onClick={() => setAberto(expandido ? null : a.funcao)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                      >
                        {temAchado
                          ? (expandido ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />)
                          : <span className="w-4 shrink-0" />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground">{a.funcao}</span>
                          <span className="block text-xs text-muted-foreground">
                            {fmtQuando(a.executada_em)}
                            {a.resumo && " · " + Object.entries(a.resumo)
                              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}
                          </span>
                        </span>
                        {!a.ok
                          ? <Selo ok={false} texto="a auditoria falhou" />
                          : a.alerta
                            ? <Selo ok={false} texto={`${a.achados?.length ?? 0} para olhar`} />
                            : <Selo ok texto="sem achado" />}
                      </button>
                      {a.erro && (
                        <p className="border-t border-border px-4 py-3 text-xs text-destructive">{a.erro}</p>
                      )}
                      {expandido && temAchado && (
                        <pre className="max-h-80 overflow-auto border-t border-border bg-muted/30 px-4 py-3 text-[11px] leading-5 text-foreground">
                          {JSON.stringify(a.achados, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Rotinas */}
          <section className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-foreground">Rotinas</h2>
              {cronsComFalha.length > 0
                ? <Selo ok={false} texto={`${cronsComFalha.length} com falha`} />
                : <Selo ok texto={`${crons.length} rodando`} />}
            </div>
            <TabelaCartao>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Rotina</TableHead>
                    <TableHead className="text-xs">Agenda</TableHead>
                    <TableHead className="text-xs">Última execução</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crons.map((c) => (
                    <TableRow key={c.nome}>
                      <TableCell className="text-sm font-medium">
                        {c.nome}
                        {!c.ativo && <span className="ml-2 text-xs text-destructive">desativada</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.agenda}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {fmtQuando(c.ultima_execucao)}
                      </TableCell>
                      <TableCell>
                        {c.ultimo_status
                          ? <Selo ok={c.ultimo_status === "succeeded"} texto={c.ultimo_status} />
                          : <span className="text-xs text-muted-foreground">sem histórico</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabelaCartao>
          </section>

          {/* 3. Séries */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-foreground">Séries de mercado</h2>
            <TabelaCartao>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Tabela</TableHead>
                    <TableHead className="text-xs">Última data</TableHead>
                    <TableHead className="text-xs text-right">Dias atrás</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {series.map((s) => {
                    const dias = diasAtras(s.ultima_data);
                    return (
                      <TableRow key={s.tabela}>
                        <TableCell className="text-sm font-medium">{s.tabela}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums">
                          {fmtData(s.ultima_data)}
                        </TableCell>
                        {/* Sem semáforo aqui de propósito: cada série tem a sua defasagem normal
                            (cota de fundo em D-2 pela CVM, CDI em D-1), e pintar tudo de vermelho
                            treinaria quem lê a ignorar a cor. O número é o que informa. */}
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {dias == null ? "—" : dias}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TabelaCartao>
          </section>
        </>
      )}
    </div>
  );
}
