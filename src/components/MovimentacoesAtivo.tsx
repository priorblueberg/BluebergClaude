import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Movimentacao {
  id: string;
  data: string;
  tipo_movimentacao: string;
  quantidade: number | null;
  preco_unitario: number | null;
  valor: number;
}

interface Props {
  codigoCustodia: number;
}

export default function MovimentacoesAtivo({ codigoCustodia }: Props) {
  const [rows, setRows] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await supabase
        .from("movimentacoes")
        .select("id, data, tipo_movimentacao, quantidade, preco_unitario, valor")
        .eq("codigo_custodia", codigoCustodia)
        .order("data", { ascending: false });

      if (!error && data) {
        setRows(data as Movimentacao[]);
      }
      setLoading(false);
    };
    fetchData();
  }, [codigoCustodia]);

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("pt-BR");

  const fmtBrl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const fmtQty = (v: number | null) =>
    v !== null ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  return (
    <div className="space-y-3 mb-12">
      <h2 className="text-sm font-semibold text-foreground">Movimentações do Ativo</h2>
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Data</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Tipo Mov.</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Quantidade</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Preço Unitário</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Valor</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhuma movimentação encontrada.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/30"}`}>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtDate(r.data)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.tipo_movimentacao}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtQty(r.quantidade)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.preco_unitario !== null ? fmtBrl(r.preco_unitario) : "—"}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtBrl(r.valor)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
