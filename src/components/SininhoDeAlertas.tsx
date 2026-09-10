import { useState } from "react";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAlertas, type Alerta } from "@/hooks/useAlertas";
import { fmtData } from "@/lib/validacaoBoleta";
import InformarMudancaFundoModal from "@/components/InformarMudancaFundoModal";

/**
 * O sino do cabecalho.
 *
 * Era decorativo, com a bolinha acesa o tempo todo. Passou a ser a caixa de alertas: a bolinha
 * so aparece quando ha alerta aberto, e cada alerta abre o fluxo que o resolve.
 */
export function SininhoDeAlertas() {
  const { alertas, carregar, marcar } = useAlertas();
  const [aberto, setAberto] = useState(false);
  const [emTratamento, setEmTratamento] = useState<Alerta | null>(null);

  return (
    <>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            className="relative text-muted-foreground hover:text-primary"
            style={{ transition: "color 120ms linear" }}
            title="Alertas"
            aria-label={alertas.length ? `${alertas.length} alerta(s)` : "Alertas"}
          >
            <Bell size={18} strokeWidth={1.5} />
            {alertas.length > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b border-border px-4 py-2 text-sm font-medium text-foreground">Alertas</div>
          {alertas.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum alerta no momento.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {alertas.map((a) => (
                <li key={a.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left hover:bg-muted"
                    onClick={() => { setAberto(false); setEmTratamento(a); }}
                  >
                    <p className="text-sm font-medium text-foreground">{a.titulo}</p>
                    {a.tipo === "mudanca_de_fundo" && (
                      <>
                        <p className="mt-0.5 truncate text-xs text-foreground">{a.detalhe.fundo_nome}</p>
                        <p className="text-xs text-muted-foreground">
                          Última cota publicada em {fmtData(a.detalhe.ultima_cota_em)}
                        </p>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {emTratamento?.tipo === "mudanca_de_fundo" && (
        <InformarMudancaFundoModal
          alerta={emTratamento}
          onFechar={() => setEmTratamento(null)}
          onMarcar={async (status) => { await marcar(emTratamento.id, status); }}
          onConcluido={async () => { setEmTratamento(null); await carregar(); }}
        />
      )}
    </>
  );
}
