import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

/**
 * Escolha do papel, por ticker.
 *
 * O cadastro não é digitado: o usuário informa o ticker e a edge function `sync-acoes` traz
 * nome, moeda e bolsa da fonte, junto com a série de preços e os proventos. É a mesma decisão
 * do CNPJ nos emissores e do CNPJ nos fundos - quando o nome vem da fonte, a grafia deixa de
 * depender de quem digitou, e duas grafias não viram dois ativos.
 *
 * Cadastrar um papel novo é caro (a série inteira desde a estreia na bolsa), mas acontece uma
 * vez por papel; do segundo lançamento em diante ele já está na lista.
 */
export default function AcaoSelect({ value, onChange, disabled }: Props) {
  const [acoes, setAcoes] = useState<AcaoEscolhida[]>([]);
  const [ticker, setTicker] = useState("");
  const [buscando, setBuscando] = useState(false);

  const carregar = async () => {
    const { data } = await supabase
      .from("cadastro_de_acoes")
      .select("id, ticker, nome")
      .eq("ativo", true)
      .order("ticker");
    setAcoes((data as AcaoEscolhida[]) ?? []);
    return (data as AcaoEscolhida[]) ?? [];
  };

  useEffect(() => { carregar(); }, []);

  const buscar = async () => {
    const t = ticker.toUpperCase().trim();
    if (!/^[A-Z]{4}\d{1,2}$/.test(t)) {
      toast.error("Informe um ticker da B3, como PETR4 ou ITUB4.");
      return;
    }
    // Já cadastrado: só selecionar, sem pagar a carga de novo.
    const existente = acoes.find((a) => a.ticker === t);
    if (existente) {
      onChange(existente.id, existente.ticker, existente.nome);
      setTicker("");
      return;
    }

    setBuscando(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-acoes", { body: { ticker: t } });
      if (error) throw error;
      const item = (data as any)?.relatorio?.[0];
      if (!item || item.erro) throw new Error(item?.erro ?? "não foi possível carregar o papel");

      const lista = await carregar();
      const novo = lista.find((a) => a.ticker === t);
      if (!novo) throw new Error("o papel foi carregado mas não apareceu no cadastro");

      onChange(novo.id, novo.ticker, novo.nome);
      setTicker("");
      toast.success(`${novo.ticker} carregada: ${item.cotacoes_no_banco} pregões e ${item.proventos_no_banco} proventos.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível carregar o papel.");
    } finally {
      setBuscando(false);
    }
  };

  const selecionada = acoes.find((a) => a.id === value);

  return (
    <div className="flex flex-col gap-2">
      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const a = acoes.find((x) => x.id === e.target.value);
          onChange(a?.id ?? "", a?.ticker ?? "", a?.nome ?? "");
        }}
      >
        <option value="">{acoes.length ? "Selecione a ação" : "Nenhuma ação cadastrada ainda"}</option>
        {acoes.map((a) => (
          <option key={a.id} value={a.id}>{a.ticker} — {a.nome}</option>
        ))}
      </select>

      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
            placeholder="Ticker novo (ex.: PETR4)"
            className="h-9"
          />
          <Button type="button" variant="outline" size="sm" onClick={buscar} disabled={buscando || !ticker}>
            <Search size={14} className="mr-1" />
            {buscando ? "Carregando..." : "Buscar"}
          </Button>
        </div>
      )}

      {selecionada && (
        <p className="text-xs text-muted-foreground">{selecionada.nome}</p>
      )}
      {!disabled && (
        <p className="text-xs text-muted-foreground">
          O ticker traz nome, preços e proventos da fonte. A primeira carga de um papel leva
          alguns segundos; depois ele fica na lista.
        </p>
      )}
    </div>
  );
}
