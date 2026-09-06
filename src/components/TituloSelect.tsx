import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, PlusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface TituloCadastrado {
  id: string;
  nome: string;
  emissor_id: string | null;
  emissor_nome: string | null;
  modalidade: string;
  indexador: string | null;
  taxa: number;
  vencimento: string;
  pagamento: string;
  preco_emissao: number;
}

const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const fmtData = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");

/**
 * Busca de titulo de renda fixa sobre `cadastro_de_titulos`.
 *
 * O titulo e do EMISSOR, nao de quem comprou: um CDB do Bradesco a 102% do CDI com vencimento
 * em 31/12/2029 e um so papel, e varios clientes compram o mesmo. Por isso, escolhendo um
 * titulo existente os termos vem preenchidos e travados - quem edita a operacao dele e o
 * cliente, quem define o papel foi o emissor.
 *
 * A primeira opcao da lista e sempre "Cadastrar novo <produto>", como na boleta do Gorila:
 * e por ali que o primeiro cliente cria o papel, que a partir dai fica disponivel para todos.
 */
export default function TituloSelect({
  produtoId,
  produtoNome,
  value,
  onSelecionar,
  onCadastrarNovo,
  cadastrandoNovo,
  disabled,
  hasError,
}: {
  produtoId: string;
  produtoNome: string;
  value: string;
  onSelecionar: (t: TituloCadastrado) => void;
  onCadastrarNovo: () => void;
  cadastrandoNovo: boolean;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [titulos, setTitulos] = useState<TituloCadastrado[]>([]);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!produtoId) { setTitulos([]); return; }
    let vivo = true;
    supabase
      .from("cadastro_de_titulos")
      .select("id, nome, emissor_id, modalidade, indexador, taxa, vencimento, pagamento, preco_emissao, emissores(nome)")
      .eq("produto_id", produtoId)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        if (!vivo || !data) return;
        setTitulos((data as any[]).map((t) => ({
          id: t.id, nome: t.nome, emissor_id: t.emissor_id,
          emissor_nome: t.emissores?.nome ?? null,
          modalidade: t.modalidade, indexador: t.indexador, taxa: Number(t.taxa),
          vencimento: t.vencimento, pagamento: t.pagamento, preco_emissao: Number(t.preco_emissao),
        })));
      });
    return () => { vivo = false; };
  }, [produtoId]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const selecionado = useMemo(() => titulos.find((t) => t.id === value) ?? null, [titulos, value]);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return titulos;
    return titulos.filter((t) =>
      normalizar(t.nome).includes(termo) || normalizar(t.emissor_nome ?? "").includes(termo));
  }, [titulos, busca]);

  const borda = hasError ? "border-destructive" : "border-border";

  // Escolhido, ou cadastrando um novo: nos dois casos o campo de busca sai de cena.
  if ((selecionado || cadastrandoNovo) && !aberto) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-md border ${borda} bg-background px-3 py-2 ${disabled ? "opacity-60" : ""}`}>
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {selecionado ? selecionado.nome : `Novo ${produtoNome}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {selecionado
              ? `${selecionado.emissor_nome ?? "sem emissor"} · vence ${fmtData(selecionado.vencimento)}`
              : "Preencha as características abaixo"}
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => { setBusca(""); setAberto(true); }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Trocar título"
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
        disabled={disabled || !produtoId}
        placeholder={produtoId ? "Busque pelo título ou emissor" : "Selecione o produto primeiro"}
        className={`w-full rounded-md border ${borda} bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60`}
      />
      {aberto && !disabled && produtoId && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          <button
            type="button"
            onClick={() => { onCadastrarNovo(); setBusca(""); setAberto(false); }}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-muted"
          >
            <PlusCircle size={14} className="text-primary" />
            <span className="text-sm font-medium text-primary">Cadastrar novo {produtoNome}</span>
          </button>
          {filtrados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Nenhum título encontrado. Cadastre o novo acima.
            </p>
          ) : (
            filtrados.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onSelecionar(t); setBusca(""); setAberto(false); }}
                className="block w-full px-3 py-2 text-left hover:bg-muted"
              >
                <span className="block text-sm text-foreground">{t.nome}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.emissor_nome ?? "sem emissor"} · vence {fmtData(t.vencimento)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
