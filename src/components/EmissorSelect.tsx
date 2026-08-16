import { useEffect, useRef, useState } from "react";
import { PlusCircle, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CadastrarEmissorModal from "./CadastrarEmissorModal";

interface Emissor {
  id: string;
  nome: string;
}

interface EmissorSelectProps {
  value: string;
  /** Recebe o id e o nome, porque a boleta monta o nome do ativo com o emissor. */
  onChange: (id: string, nome: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
}

const LIMITE = 30;

/** Espelha a coluna gerada invest.emissores.nome_busca (lower + sem acento). */
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

/**
 * Campo de pesquisa de emissor sobre invest.emissores (~1,6 mil nomes do Banco
 * Central + os que o proprio usuario cadastrou). A busca e server-side: carregar
 * a tabela inteira a cada abertura da boleta seria desperdicio.
 * Quando a pesquisa nao acha nada, oferece "Cadastrar Novo Emissor".
 */
export default function EmissorSelect({
  value,
  onChange,
  placeholder = "Pesquisar emissor...",
  disabled,
  hasError,
}: EmissorSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Emissor[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Resolve o rotulo do emissor ja selecionado (ex.: boleta carregada de uma
  // custodia existente), que pode nao estar no resultado corrente da busca.
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
    supabase
      .from("emissores")
      .select("id, nome")
      .eq("id", value)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado && data) setSelectedLabel(data.nome);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Busca com debounce enquanto o dropdown esta aberto.
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(async () => {
      const tokens = sanitizar(normalizar(search))
        .split(/\s+/)
        .filter(Boolean);

      let query = supabase.from("emissores").select("id, nome").eq("ativo", true);
      for (const token of tokens) {
        query = query.ilike("nome_busca", `%${token}%`);
      }

      const { data, error } = await query.order("nome").limit(LIMITE);
      if (cancelado) return;
      if (error) console.error("Erro ao buscar emissores", error);
      setOptions(data ?? []);
      setBuscando(false);
    }, 250);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [search, open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (emissor: Emissor) => {
    onChange(emissor.id, emissor.nome);
    setSelectedLabel(emissor.nome);
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
              <p className="text-sm text-muted-foreground mb-2">Nenhum emissor encontrado</p>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(true);
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Cadastrar Novo Emissor
              </button>
            </div>
          )}
        </div>
      )}

      <CadastrarEmissorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        nomeInicial={search}
        onCriado={(emissor) => handleSelect(emissor)}
      />
    </div>
  );
}
