import { useEffect, useRef, useState } from "react";
import { PlusCircle, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CadastrarEntidadeModal, { type TipoEntidade } from "./CadastrarEntidadeModal";

interface Entidade {
  id: string;
  nome: string;
}

interface EntidadeSelectProps {
  /** "emissor" le invest.emissores; "instituicao" le invest.instituicoes. */
  tipo: TipoEntidade;
  value: string;
  /** Recebe o id e o nome, porque a boleta monta o nome do ativo com eles. */
  onChange: (id: string, nome: string) => void;
  /** Titulo do modal e texto do botao de cadastro, ex.: "Cadastrar Novo Emissor". */
  tituloCadastro: string;
  /** Rotulo do campo do modal, ex.: "Nome do Emissor". */
  labelCadastro: string;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
}

const LIMITE = 30;

/** Espelha as colunas geradas nome_busca do banco (lower + sem acento). */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** PostgREST quebra com virgula/parenteses dentro do valor do filtro. */
function sanitizar(termo: string): string {
  return termo.replace(/[,()%*\\"]/g, " ").trim();
}

function baseQuery(tipo: TipoEntidade) {
  return tipo === "emissor"
    ? supabase.from("emissores").select("id, nome").eq("ativo", true)
    : supabase.from("instituicoes").select("id, nome").eq("ativa", true);
}

/**
 * Campo de pesquisa sobre as tabelas de dimensao do Blueberg (~1,6 mil nomes da
 * lista de instituicoes autorizadas do Banco Central + o que o proprio usuario
 * cadastrou). A busca e server-side: carregar a tabela inteira a cada abertura da
 * boleta seria desperdicio. Quando nao acha nada, oferece o cadastro.
 */
export default function EntidadeSelect({
  tipo,
  value,
  onChange,
  tituloCadastro,
  labelCadastro,
  placeholder = "Pesquisar...",
  disabled,
  hasError,
}: EntidadeSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Entidade[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Resolve o rotulo do id ja selecionado (ex.: boleta carregada de uma custodia
  // existente), que pode nao estar no resultado corrente da busca.
  useEffect(() => {
    if (!value) {
      setSelectedLabel("");
      return;
    }
    const naLista = options.find((o) => o.id === value);
    if (naLista) {
      setSelectedLabel(naLista.nome);
      return;
    }
    let cancelado = false;
    baseQuery(tipo)
      .eq("id", value)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado && data) setSelectedLabel(data.nome);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tipo]);

  // Busca com debounce enquanto o dropdown esta aberto.
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(async () => {
      const tokens = sanitizar(normalizar(search)).split(/\s+/).filter(Boolean);

      let query = baseQuery(tipo);
      for (const token of tokens) {
        query = query.ilike("nome_busca", `%${token}%`);
      }

      const { data, error } = await query.order("nome").limit(LIMITE);
      if (cancelado) return;
      if (error) console.error("Erro ao buscar", error);
      setOptions(data ?? []);
      setBuscando(false);
    }, 250);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [search, open, tipo]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (entidade: Entidade) => {
    onChange(entidade.id, entidade.nome);
    setSelectedLabel(entidade.nome);
    setSearch("");
    setOpen(false);
  };

  const handleClear = () => {
    onChange("", "");
    setSelectedLabel("");
    setSearch("");
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={open ? search : selectedLabel}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={`input-field pl-9 pr-8 ${hasError ? "border-destructive ring-1 ring-destructive" : ""}`}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {buscando && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Buscando...</div>
          )}

          {!buscando &&
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => handleSelect(o)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                  o.id === value ? "bg-accent/50 font-medium" : ""
                }`}
              >
                {o.nome}
              </button>
            ))}

          {!buscando && options.length === 0 && (
            <div className="px-3 py-2">
              <p className="text-sm text-muted-foreground mb-2">Nenhum resultado encontrado</p>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(true);
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                {tituloCadastro}
              </button>
            </div>
          )}
        </div>
      )}

      <CadastrarEntidadeModal
        tipo={tipo}
        open={modalOpen}
        onOpenChange={setModalOpen}
        nomeInicial={search}
        titulo={tituloCadastro}
        labelCampo={labelCadastro}
        onCriado={(entidade) => handleSelect(entidade)}
      />
    </div>
  );
}
