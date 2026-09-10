import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type Aviso =
  | { tipo: "semCotas"; fundo: Sugestao; erro: string | null }
  | { tipo: "emCarga" };

/**
 * Escolha do fundo.
 *
 * Numa APLICACAO nao ha lista: todo fundo e achado pela busca, que varre o catalogo inteiro da
 * CVM (8.571 classes abertas, nao exclusivas, de publico geral ou qualificado) por nome ou CNPJ.
 *
 * Escolher um fundo SEM serie de cotas nao seleciona nada. Abre um aviso com duas saidas:
 *
 * - "Adicionar" dispara a carga das cotas desde 02/01/2023 NO SERVIDOR e fecha a boleta. A carga
 *   anda sozinha (funcao `carga-cotas-fundo`, encadeada pelo pg_net) e sobrevive a boleta
 *   fechada, a pagina recarregada e a aba fechada.
 * - "Cancelar" volta para a boleta com o campo limpo, para o cliente escolher outro fundo.
 *
 * Escolher um fundo cuja carga ainda esta ANDANDO abre outro aviso, que fecha a boleta. O estado
 * vem do banco (`carga_cotas_ate`), e nao da memoria da tela, justamente para valer quando o
 * cliente voltar depois.
 *
 * Numa SAIDA e o oposto: a lista mostra so os fundos com saldo na data, e nao ha busca no
 * catalogo - nao se resgata de um fundo em que nunca se aplicou.
 *
 * O CNPJ aparece na lista e continua visivel depois de escolhido. Dois fundos da mesma casa tem
 * nomes parecidos ("Trend DI II", "Trend DI"), e o que os separa sem ambiguidade e o CNPJ.
 */
export default function FundoSelect({
  fundos,
  value,
  onChange,
  disabled,
  hasError,
  permitirCatalogo = true,
  onFecharBoleta,
  abrirAoMontar = false,
}: {
  /** Os fundos ja carregados, que a boleta le do banco. Numa saida, os que tem saldo. */
  fundos: FundoOpcao[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  /** `false` numa saida: a lista vira os fundos com saldo e a busca no catalogo some. */
  permitirCatalogo?: boolean;
  /** Fecha a boleta inteira. Usado por "Adicionar" e pelo aviso de carga em andamento. */
  onFecharBoleta?: () => void;
  /** Foca a busca e abre a lista assim que o campo aparece. Numa aplicacao o fundo e o 1o passo. */
  abrirAoMontar?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  /**
   * O fundo escolhido pela busca. Sem isto o campo ficaria em branco depois de escolher: a prop
   * `fundos` so tem os fundos que a boleta leu ao abrir.
   */
  const [escolhido, setEscolhido] = useState<FundoOpcao | null>(null);

  const selecionado = useMemo(
    () => (escolhido?.id === value ? escolhido : fundos.find((f) => f.id === value) ?? null),
    [escolhido, fundos, value],
  );

  // So na montagem: reabrir a cada render roubaria o foco de quem ja esta em outro campo. O foco
  // dispara o `onFocus` do campo, que abre a lista com a dica de busca.
  useEffect(() => {
    if (abrirAoMontar && !value) entrada.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // tem os tres com frequencia ("FIC (RL)"), e basta o usuario digitar um deles para a
      // consulta virar um filtro malformado. Saem do termo, nao da busca: o `ilike` continua
      // casando o resto do nome.
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
      setSugestoes(((data ?? []) as {
        id: string; nome_curto: string; cnpj_classe: string; classificacao: string | null;
      }[]).map((f) => ({ id: f.id, nome: f.nome_curto, cnpj: f.cnpj_classe, classificacao: f.classificacao })));
      setBuscando(false);
    }, ESPERA_MS);

    return () => { vivo = false; clearTimeout(t); };
  }, [busca, permitirCatalogo]);

  const limparCampo = () => {
    setEscolhido(null);
    onChange("");
    setBusca("");
    setSugestoes([]);
  };

  const escolher = async (f: Sugestao) => {
    setBusca(""); setSugestoes([]); setAberto(false);
    setVerificando(true);
    try {
      // O estado vem do banco a cada escolha, e nao da busca: entre digitar e clicar, uma carga
      // pode ter comecado ou terminado - inclusive uma disparada numa aba ao lado.
      const [{ data: cadastro, error: eCadastro }, { count, error: eCotas }] = await Promise.all([
        supabase.from("cadastro_de_fundos")
          .select("carga_cotas_ate, carga_cotas_concluida_em, carga_cotas_erro")
          .eq("id", f.id)
          .maybeSingle(),
        supabase.from("cotas_fundos")
          .select("fundo_id", { count: "exact", head: true })
          .eq("fundo_id", f.id),
      ]);
      if (eCadastro || eCotas) throw new Error((eCadastro ?? eCotas)!.message);
      // As colunas de carga sao mais novas que os tipos gerados.
      const estado = cadastro as unknown as {
        carga_cotas_ate: string | null;
        carga_cotas_concluida_em: string | null;
        carga_cotas_erro: string | null;
      } | null;

      if (estado?.carga_cotas_ate && new Date(estado.carga_cotas_ate) > new Date()) {
        setAviso({ tipo: "emCarga" });
        return;
      }
      // Sem conclusao registrada conta como "sem cotas" mesmo que haja algumas linhas: e o caso
      // de uma carga que morreu no meio, e uma serie pela metade daria rentabilidade errada sem
      // dizer por que. "Adicionar" completa por upsert, sem duplicar o que ja existe.
      if (!estado?.carga_cotas_concluida_em || !count) {
        setAviso({ tipo: "semCotas", fundo: f, erro: estado?.carga_cotas_erro ?? null });
        return;
      }

      setEscolhido({ id: f.id, nome: f.nome, cnpj: f.cnpj });
      onChange(f.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível verificar o fundo.");
    } finally {
      setVerificando(false);
    }
  };

  const adicionar = () => {
    if (aviso?.tipo !== "semCotas") return;
    const { cnpj } = aviso.fundo;
    setAviso(null);
    limparCampo();
    // Sem `await`: a boleta fecha na hora e a carga anda no servidor. A resposta so confirma que
    // a primeira etapa rodou; se ela falhar, o aviso aparece mesmo com a boleta fechada, porque o
    // toast e global.
    void supabase.functions.invoke("carga-cotas-fundo", { body: { cnpj } }).then(({ data, error }) => {
      const r = data as { error?: string; precisaSubclasse?: string[] } | null;
      if (error || r?.error) {
        toast.error(`A carga das cotas não começou: ${error?.message ?? r?.error}`);
      } else if (r?.precisaSubclasse?.length) {
        toast.warning("Este CNPJ publica mais de uma subclasse. Cadastre-o pelo botão de cadastrar fundo.");
      }
    });
    toast.success("Cadastramento das cotas iniciado. Tente lançar a aplicação em alguns minutos.");
    onFecharBoleta?.();
  };

  const cancelar = () => {
    setAviso(null);
    limparCampo();
  };

  const fecharPorCarga = () => {
    setAviso(null);
    limparCampo();
    onFecharBoleta?.();
  };

  const borda = hasError ? "border-destructive" : "border-border";

  // Numa aplicacao a lista local nao existe: tudo vem da busca. Numa saida e o contrario.
  const daLista = permitirCatalogo ? [] : filtrados;
  const semNada = daLista.length === 0 && sugestoes.length === 0 && !buscando;
  const curto = busca.trim().length < MIN_BUSCA;

  const campo = selecionado && !aberto ? (
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
          onClick={() => { limparCampo(); setAberto(true); }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title="Trocar fundo"
        >
          <X size={14} />
        </button>
      )}
    </div>
  ) : (
    <div ref={ref} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={entrada}
        value={busca}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        disabled={disabled || verificando}
        placeholder={permitirCatalogo ? "Busque pelo nome ou CNPJ" : "Busque entre os fundos com saldo"}
        className={`w-full rounded-md border ${borda} bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60`}
      />
      {verificando && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          Verificando as cotas do fundo...
        </p>
      )}
      {aberto && !disabled && !verificando && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {daLista.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setEscolhido(f); onChange(f.id); setBusca(""); setAberto(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-muted"
            >
              <span className="block truncate text-sm text-foreground">{f.nome}</span>
              <span className="block text-xs text-muted-foreground">CNPJ {formatarCnpj(f.cnpj)}</span>
            </button>
          ))}

          {sugestoes.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => escolher(f)}
              className="block w-full px-3 py-2 text-left hover:bg-muted"
            >
              <span className="block truncate text-sm text-foreground">{f.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">
                CNPJ {formatarCnpj(f.cnpj)}{f.classificacao ? ` · ${f.classificacao}` : ""}
              </span>
            </button>
          ))}

          {buscando && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Procurando no catálogo...</p>
          )}
          {semNada && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {curto && permitirCatalogo
                ? `Digite ${MIN_BUSCA} caracteres para procurar entre os 8.571 fundos do catálogo.`
                : "Nenhum fundo encontrado."}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {campo}

      {/* Os botoes fazem o proprio trabalho. O `onOpenChange` so pega o Esc, e Esc vale como a
          saida mais branda de cada aviso: "Cancelar" num, "Fechar" no outro. */}
      <AlertDialog
        open={!!aviso}
        onOpenChange={(o) => { if (!o) (aviso?.tipo === "emCarga" ? fecharPorCarga : cancelar)(); }}
      >
        <AlertDialogContent>
          {aviso?.tipo === "semCotas" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Este fundo ainda não possui cotas cadastradas</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-1">
                    <p className="break-words">{aviso.fundo.nome}</p>
                    <p className="text-xs">CNPJ {formatarCnpj(aviso.fundo.cnpj)}</p>
                    {aviso.erro && (
                      <p className="pt-2 text-xs text-destructive">
                        A última tentativa não terminou: {aviso.erro}
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelar}>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={adicionar}>Adicionar</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {aviso?.tipo === "emCarga" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Cotas em processo de cadastramento</AlertDialogTitle>
                <AlertDialogDescription>Tente novamente em alguns minutos.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={fecharPorCarga}>Fechar</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
