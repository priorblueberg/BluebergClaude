import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export interface AcaoEscolhida {
  id: string;
  ticker: string;
  nome: string;
}

interface Props {
  value: string;
  onChange: (id: string, ticker: string, nome: string) => void;
  disabled?: boolean;
}

/** Espera o usuario parar de digitar antes de consultar o catalogo. */
const ESPERA_MS = 300;
const MIN_BUSCA = 2;
const MAX_SUGESTOES = 15;

/**
 * Escolha do papel.
 *
 * Duas listas, e a diferenca entre elas e o desenho inteiro:
 *
 * - O `select` mostra so os papeis JA CARREGADOS (`sincronizar_cotacoes`), que sao poucos e ja
 *   tem serie de preco.
 * - A busca varre o CATALOGO inteiro da B3 (~2.332 papeis, atualizado semanalmente pelo
 *   `sync-base-mercado`), por ticker OU por nome. Escolher um papel que ainda nao foi carregado
 *   dispara a carga sob demanda.
 *
 * Ate 08/09/2026 havia uma lista so, e ela era o cadastro inteiro num `select`. Com 4 papeis
 * funcionava; com 2.332 viraria um dropdown inutilizavel. E buscar por nome nao existia - era
 * preciso saber o ticker de cor.
 *
 * O cadastro nao e digitado: o nome vem da fonte. E a mesma decisao do CNPJ nos emissores e nos
 * fundos - quando o nome vem da fonte, a grafia deixa de depender de quem digitou, e duas
 * grafias nao viram dois ativos.
 */
export default function AcaoSelect({ value, onChange, disabled }: Props) {
  const [carregadas, setCarregadas] = useState<AcaoEscolhida[]>([]);
  const [termo, setTermo] = useState("");
  const [sugestoes, setSugestoes] = useState<AcaoEscolhida[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [carregandoPapel, setCarregandoPapel] = useState("");

  const recarregarLista = async () => {
    const { data } = await supabase
      .from("cadastro_de_acoes")
      .select("id, ticker, nome")
      .eq("sincronizar_cotacoes", true)
      .order("ticker");
    const lista = (data as AcaoEscolhida[]) ?? [];
    setCarregadas(lista);
    return lista;
  };

  useEffect(() => { recarregarLista(); }, []);

  // Busca no catalogo, com espera. Sem ela, cada tecla digitada vira uma consulta.
  useEffect(() => {
    const q = termo.trim();
    if (q.length < MIN_BUSCA) { setSugestoes([]); setBuscando(false); return; }

    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      // `ativo` filtra papel deslistado: ele continua no catalogo para nao quebrar quem ja tem
      // posicao, mas nao deve aparecer para quem esta comprando agora.
      const { data } = await supabase
        .from("cadastro_de_acoes")
        .select("id, ticker, nome")
        .eq("ativo", true)
        .or(`ticker.ilike.%${q}%,nome.ilike.%${q}%`)
        .order("ticker")
        .limit(MAX_SUGESTOES);
      if (!vivo) return;
      setSugestoes((data as AcaoEscolhida[]) ?? []);
      setBuscando(false);
    }, ESPERA_MS);

    return () => { vivo = false; clearTimeout(t); };
  }, [termo]);

  const escolher = async (a: AcaoEscolhida) => {
    // Ja carregado: so selecionar, sem pagar a carga de novo.
    if (carregadas.some((c) => c.ticker === a.ticker)) {
      onChange(a.id, a.ticker, a.nome);
      setTermo(""); setSugestoes([]);
      return;
    }

    setCarregandoPapel(a.ticker);
    try {
      const { data, error } = await supabase.functions.invoke("sync-acoes", { body: { ticker: a.ticker } });
      if (error) throw error;
      const item = (data as {
        relatorio?: { erro?: string; cotacoes_no_banco?: number; proventos_no_banco?: number }[];
      })?.relatorio?.[0];
      if (!item || item.erro) throw new Error(item?.erro ?? "não foi possível carregar o papel");

      // Rede de seguranca: quem DEVE ligar `sincronizar_cotacoes` e o proprio `sync-acoes`, ao
      // gravar o papel. Confirmar aqui e idempotente e torna a tela independente da versao da
      // funcao publicada - sem isto, um papel carregado por uma versao antiga sumiria da lista
      // logo depois de a tela dizer que carregou, que e o pior jeito de falhar.
      await supabase.from("cadastro_de_acoes")
        .update({ sincronizar_cotacoes: true }).eq("ticker", a.ticker);

      // Releio em vez de confiar na sugestao: a carga resolve ticker renomeado, e o papel pode
      // ter entrado no cadastro sob o codigo atual, nao sob o que foi clicado.
      const lista = await recarregarLista();
      const novo = lista.find((x) => x.ticker === a.ticker) ?? lista.find((x) => x.id === a.id);
      if (!novo) throw new Error("o papel foi carregado mas não apareceu na lista");

      onChange(novo.id, novo.ticker, novo.nome);
      setTermo(""); setSugestoes([]);
      toast.success(`${novo.ticker} carregada: ${item.cotacoes_no_banco} pregões e ${item.proventos_no_banco} proventos.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível carregar o papel.");
    } finally {
      setCarregandoPapel("");
    }
  };

  const selecionada = carregadas.find((a) => a.id === value);

  return (
    <div className="flex flex-col gap-2">
      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const a = carregadas.find((x) => x.id === e.target.value);
          onChange(a?.id ?? "", a?.ticker ?? "", a?.nome ?? "");
        }}
      >
        <option value="">{carregadas.length ? "Selecione a ação" : "Nenhum papel carregado ainda"}</option>
        {carregadas.map((a) => (
          <option key={a.id} value={a.id}>{a.ticker} — {a.nome}</option>
        ))}
      </select>

      {!disabled && (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar por ticker ou nome (ex.: PETR4 ou Petrobras)"
              className="h-9 pl-7"
            />
          </div>

          {termo.trim().length >= MIN_BUSCA && (
            <div className="max-h-56 overflow-y-auto rounded-md border border-input">
              {buscando && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando...</p>}
              {!buscando && sugestoes.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum papel encontrado.</p>
              )}
              {!buscando && sugestoes.map((a) => {
                const jaTem = carregadas.some((c) => c.ticker === a.ticker);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => escolher(a)}
                    disabled={!!carregandoPapel}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span className="font-medium">{a.ticker}</span>
                    <span className="truncate text-xs text-muted-foreground">{a.nome}</span>
                    {carregandoPapel === a.ticker ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">carregando...</span>
                    ) : !jaTem ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">carregar</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {selecionada && <p className="text-xs text-muted-foreground">{selecionada.nome}</p>}
      {!disabled && (
        <p className="text-xs text-muted-foreground">
          Na primeira vez que um papel é usado, a série de preços e os proventos são buscados na
          fonte — leva alguns segundos. Depois ele fica na lista acima.
        </p>
      )}
    </div>
  );
}
