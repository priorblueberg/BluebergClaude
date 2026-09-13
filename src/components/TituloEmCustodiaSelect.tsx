import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/** Uma posicao de renda fixa do cliente, com os termos do titulo ja no formato do cadastro. */
export interface TituloEmCustodia {
  codigo_custodia: string;
  nome: string;
  titulo_id: string | null;
  data_inicio: string;
  vencimento: string | null;
  resgate_total: string | null;
  modalidade: string;
  indexador: string | null;
  taxa: number | null;
  pagamento: string;
  preco_emissao: number | null;
  instituicao_id: string | null;
  instituicao_nome: string | null;
  emissor_id: string | null;
  emissor_nome: string | null;
}

const fmtData = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");

const apoio = (t: TituloEmCustodia) =>
  `${t.instituicao_nome ?? "sem corretora"}${t.vencimento ? ` · vence ${fmtData(t.vencimento)}` : ""}`;

/**
 * Titulos que o cliente ja tem em custodia, para a "Aplicação Adicional" (Daniel, 13/09/2026).
 *
 * Cada linha e uma POSICAO, nao um papel: o mesmo CDB comprado em duas corretoras aparece duas
 * vezes, com a corretora embaixo do nome, porque a aplicacao adicional entra numa delas.
 */
export default function TituloEmCustodiaSelect({
  titulos,
  selecionado,
  onSelecionar,
  disabled,
  hasError,
}: {
  /** As posicoes que aceitam aplicacao na data digitada. */
  titulos: TituloEmCustodia[];
  selecionado: TituloEmCustodia | null;
  onSelecionar: (t: TituloEmCustodia) => void;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const borda = hasError ? "border-destructive" : "border-border";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((a) => !a)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border ${borda} bg-background px-3 py-2 text-left disabled:opacity-60`}
      >
        <div className="min-w-0">
          {selecionado ? (
            <>
              <p className="truncate text-sm text-foreground">{selecionado.nome}</p>
              <p className="truncate text-xs text-muted-foreground">{apoio(selecionado)}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Selecione o título</p>
          )}
        </div>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {aberto && !disabled && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {titulos.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Nenhum título deste produto em custódia na data da aplicação.
            </p>
          ) : (
            titulos.map((t) => (
              <button
                key={t.codigo_custodia}
                type="button"
                onClick={() => { onSelecionar(t); setAberto(false); }}
                className="block w-full px-3 py-2 text-left hover:bg-muted"
              >
                <span className="block truncate text-sm text-foreground">{t.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">{apoio(t)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
