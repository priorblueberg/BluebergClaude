import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { carregarFundo, PrecisaSubclasse } from "@/lib/carregarFundo";

export interface FundoOpcao {
  id: string;
  nome: string;
  cnpj: string;
}

/** 47715703000160 -> 47.715.703/0001-60. Devolve como veio se nao tiver 14 digitos. */
export function formatarCnpj(cnpj: string): string {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return cnpj ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const normalizar = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Espera o usuario parar de digitar antes de consultar o catalogo. */
const ESPERA_MS = 300;
const MIN_BUSCA = 3;
const MAX_SUGESTOES = 15;

interface Sugestao {
  id: string;
  nome: string;
  cnpj: string;
  classificacao: string | null;
}

/**
 * Escolha do fundo.
 *
 * Duas listas, e a diferenca entre elas e o desenho inteiro - a mesma de `AcaoSelect`:
 *
 * - A lista local mostra so os fundos JA CARREGADOS, que sao poucos e ja tem serie de cotas.
 * - A busca varre o CATALOGO da CVM (8.571 classes abertas, nao exclusivas, de publico geral ou
 *   qualificado), por nome ou CNPJ. Escolher um fundo que ainda nao foi carregado dispara a
 *   carga sob demanda.
 *
 * Ate 10/09/2026 havia uma lista so, filtrada localmente, e o comentario dizia que "a base de
 * fundos cadastrados e pequena e ja vem carregada com a boleta". Era verdade com 7 fundos. Com
 * 8.571 a premissa cai: a boleta baixaria o catalogo inteiro toda vez que abrisse.
 *
 * O CNPJ aparece na lista e continua visivel depois de escolhido. Dois fundos da mesma casa tem
 * nomes parecidos ("Trend DI II", "Trend DI"), e o que os separa sem ambiguidade e o CNPJ - que
 * e tambem por onde a cota e casada na serie da CVM.
 */
export default function FundoSelect({
  fundos,
  value,
  onChange,
  disabled,
  hasError,
  permitirCatalogo = true,
  onCarregado,
}: {
  /** Os fundos ja carregados, que a boleta le do banco. */
  fundos: FundoOpcao[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  /**
   * Numa saida a busca no catalogo nao faz sentido: nao se resgata de um fundo em que nunca se
   * aplicou, e oferecer o catalogo ali so daria caminho para erro.
   */
  permitirCatalogo?: boolean;
  /** Avisa a boleta para reler a lista de carregados depois de uma carga. */
  onCarregado?: () => Promise<void> | void;
}) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [carregando, setCarregando] = useState("");
  const [progresso, setProgresso] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selecionado = useMemo(() => fundos.find((f) => f.id === value) ?? null, [fundos, value]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return fundos;
    const digitos = termo.replace(/\D/g, "");
    return fundos.filter((f) => {
      const porNome = normalizar(f.nome).includes(termo);
      const porCnpj = digitos.length >= 2 && f.cnpj.replace(/\D/g, "").includes(digitos);
      return porNome || porCnpj;
    });
  }, [fundos, busca]);

  // Busca no catalogo, com espera. Sem ela, cada tecla digitada vira uma consulta.
  useEffect(() => {
    if (!permitirCatalogo) { setSugestoes([]); return; }
    const q = busca.trim();
    if (q.length < MIN_BUSCA) { setSugestoes([]); setBuscando(false); return; }

    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      // O CNPJ e gravado so com digitos, entao a pontuacao que o usuario digitar sai antes de
      // comparar - senao "47.715" nunca acharia "47715703000160".
      const digitos = q.replace(/\D/g, "");
      // Virgula e parenteses separam clausulas na sintaxe do `or` do PostgREST. Nome de fundo
      // tem os tres com frequencia ("MercadoLibre, Inc.", "FIC (RL)"), e basta o usuario digitar
      // um deles para a consulta virar um filtro malformado. Saem do termo, nao da busca: o
      // `ilike` continua casando o resto do nome.
      const seguro = q.replace(/[,()]/g, " ").trim();
      if (!seguro) { setSugestoes([]); setBuscando(false); return; }
      const filtro = digitos.length >= 3
        ? `nome_curto.ilike.%${seguro}%,cnpj_classe.ilike.%${digitos}%`
        : `nome_curto.ilike.%${seguro}%`;
      const { data } = await supabase
        .from("cadastro_de_fundos")
        .select("id, nome_curto, cnpj_classe, classificacao")
        .eq("ativo", true)
        .or(filtro)
        .order("nome_curto")
        .limit(MAX_SUGESTOES);
      if (!vivo) return;
      const jaNaLista = new Set(fundos.map((f) => f.id));
      setSugestoes(
        ((data ?? []) as { id: string; nome_curto: string; cnpj_classe: string; classificacao: string | null }[])
          .filter((f) => !jaNaLista.has(f.id))
          .map((f) => ({ id: f.id, nome: f.nome_curto, cnpj: f.cnpj_classe, classificacao: f.classificacao })),
      );
      setBuscando(false);
    }, ESPERA_MS);

    return () => { vivo = false; clearTimeout(t); };
  }, [busca, fundos, permitirCatalogo]);

  const escolherDoCatalogo = async (f: Sugestao) => {
    setCarregando(f.id);
    setProgresso("Buscando as cotas na CVM...");
    try {
      const r = await carregarFundo(f.cnpj, {
        aoProgredir: (cotas, mes) => setProgresso(`Carregando cotas... ${cotas} até agora (${mes}).`),
      });
      await onCarregado?.();
      onChange(r.fundoId);
      setBusca(""); setSugestoes([]); setAberto(false);
      toast.success(`Fundo carregado com ${r.cotas} cotas.`);
    } catch (e) {
      // Subclasse e decisao do usuario, e a boleta nao e lugar de perguntar: o modal de cadastro
      // ja tem a tela para isso.
      if (e instanceof PrecisaSubclasse) {
        toast.warning("Este CNPJ publica mais de uma subclasse. Cadastre-o pelo botão de cadastrar fundo.");
      } else {
        toast.error(e instanceof Error ? e.message : "Não foi possível carregar o fundo.");
      }
    } finally {
      setCarregando(""); setProgresso("");
    }
  };

  const borda = hasError ? "border-destructive" : "border-border";

  if (selecionado && !aberto) {
    return (
      <div
        className={`flex items-center justify-between gap-2 overflow-hidden rounded-md border ${borda} bg-background px-3 py-2 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{selecionado.nome}</p>
          <p className="text-xs text-muted-foreground">CNPJ {formatarCnpj(selecionado.cnpj)}</p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => { onChange(""); setBusca(""); setAberto(true); }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Trocar fundo"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  const semNada = filtrados.length === 0 && sugestoes.length === 0 && !buscando;

  return (
    <div ref={ref} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={busca}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        disabled={disabled || !!carregando}
        placeholder={permitirCatalogo ? "Busque pelo nome ou CNPJ" : "Busque entre os fundos com saldo"}
        className={`w-full rounded-md border ${borda} bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60`}
      />
      {carregando && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          {progresso}
        </p>
      )}
      {aberto && !disabled && !carregando && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {filtrados.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { onChange(f.id); setBusca(""); setAberto(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-muted"
            >
              <span className="block text-sm text-foreground">{f.nome}</span>
              <span className="block text-xs text-muted-foreground">CNPJ {formatarCnpj(f.cnpj)}</span>
            </button>
          ))}

          {sugestoes.length > 0 && (
            <p className="border-t border-border bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              No catálogo da CVM &middot; clique para carregar
            </p>
          )}
          {sugestoes.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => escolherDoCatalogo(f)}
              className="block w-full px-3 py-2 text-left hover:bg-muted"
            >
              <span className="block text-sm text-foreground">{f.nome}</span>
              <span className="block text-xs text-muted-foreground">
                CNPJ {formatarCnpj(f.cnpj)}{f.classificacao ? ` · ${f.classificacao}` : ""}
              </span>
            </button>
          ))}

          {buscando && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Procurando no catálogo...</p>
          )}
          {semNada && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {busca.trim().length < MIN_BUSCA && permitirCatalogo
                ? `Digite ${MIN_BUSCA} caracteres para procurar no catálogo.`
                : "Nenhum fundo encontrado."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
