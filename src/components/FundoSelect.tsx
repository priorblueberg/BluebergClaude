import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

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

/**
 * Campo de busca do fundo, com nome e CNPJ.
 *
 * Era um `<select>` que so mostrava o nome curto. Dois fundos da mesma casa tem nomes
 * parecidos ("Trend DI II", "Trend DI"), e o que os separa sem ambiguidade e o CNPJ - que
 * e tambem por onde a cota e casada na serie da CVM. Por isso ele aparece na lista e fica
 * visivel depois de escolhido.
 *
 * A filtragem e local: a base de fundos cadastrados e pequena e ja vem carregada com a
 * boleta. Busca por nome ou por CNPJ, com ou sem pontuacao.
 */
export default function FundoSelect({
  fundos,
  value,
  onChange,
  disabled,
  hasError,
}: {
  fundos: FundoOpcao[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
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

  const borda = hasError ? "border-destructive" : "border-border";

  if (selecionado && !aberto) {
    return (
      <div
        className={`flex items-center justify-between gap-2 rounded-md border ${borda} bg-background px-3 py-2 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <div className="min-w-0">
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

  return (
    <div ref={ref} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={busca}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        disabled={disabled}
        placeholder="Busque pelo nome ou CNPJ"
        className={`w-full rounded-md border ${borda} bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60`}
      />
      {aberto && !disabled && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {filtrados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum fundo encontrado.</p>
          ) : (
            filtrados.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { onChange(f.id); setBusca(""); setAberto(false); }}
                className="block w-full px-3 py-2 text-left hover:bg-muted"
              >
                <span className="block text-sm text-foreground">{f.nome}</span>
                <span className="block text-xs text-muted-foreground">CNPJ {formatarCnpj(f.cnpj)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
