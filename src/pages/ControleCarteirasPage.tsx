import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";

interface CarteiraRow {
  id: string;
  nome_carteira: string;
  data_inicio: string | null;
  data_limite: string | null;
  resgate_total: string | null;
  data_calculo: string | null;
  status: string;
}

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("pt-BR");
};

export default function ControleCarteirasPage() {
  const [rows, setRows] = useState<CarteiraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { appliedVersion, dataReferencia } = useDataReferencia();

  useEffect(() => {
    supabase
      .from("controle_de_carteiras")
      .select("id, nome_carteira, data_inicio, data_limite, resgate_total, data_calculo, status, categorias(nome)")
      .order("nome_carteira")
      .then(({ data }) => {
        if (data) {
          setRows(
            data.map((r: any) => ({
              id: r.id,
              nome_carteira: r.nome_carteira,
              data_inicio: r.data_inicio,
              data_limite: r.data_limite,
              resgate_total: r.resgate_total,
              data_calculo: r.data_calculo,
              status: r.status,
            }))
          );
        }
        setLoading(false);
      });
  }, [appliedVersion]);

  const headers = ["Carteira", "Data Início", "Data Limite", "Resgate Total", "Data Cálculo", "Status"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Controle de Carteiras</h1>
          <p className="text-xs text-muted-foreground">Visão das carteiras ativas do usuário</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Data de Referência</p>
          <p className="text-sm font-medium text-foreground">{dataReferencia.toLocaleDateString("pt-BR")}</p>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              {headers.map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">Nenhuma carteira registrada.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className={`border-t border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/30"}`}>
                  <td className="px-4 py-2 text-foreground">{r.nome_carteira}</td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(r.data_inicio)}</td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(r.data_limite)}</td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(r.resgate_total)}</td>
                  <td className="px-4 py-2 text-foreground">{fmtDate(r.data_calculo)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${r.status === "Ativa" ? "bg-[hsl(145,63%,32%)]/15 text-[hsl(145,63%,32%)]" : "bg-destructive/15 text-destructive"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
