import { useState } from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import {
  PRESETS, ROTULO_PRESET, PresetPeriodo, deBR, fmtBR, periodoDoPreset,
} from "@/lib/periodo";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Seletor de período no formato do Gorila: os atalhos aplicam na hora, e o intervalo livre
 * fica atrás de "Personalizado...", com um Aplicar próprio.
 *
 * O teto é D-1 (ver `limiteISO`). O Gorila deixa pedir o dia corrente; aqui só entra dia
 * fechado, então o campo de fim recusa data maior que ontem.
 */
export function SeletorPeriodo({ disabled = false }: { disabled?: boolean }) {
  const { periodo, periodoStaged, setPeriodoStaged, aplicarPreset, applyDataReferencia, limite } = useDataReferencia();
  const [aberto, setAberto] = useState(false);
  const [custom, setCustom] = useState(false);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const rotulo = periodo.preset === "custom"
    ? `${fmtBR(periodo.inicio)} - ${fmtBR(periodo.fim)}`
    : periodo.preset === "inicio"
      ? `${ROTULO_PRESET.inicio} | até ${fmtBR(periodo.fim)}`
      : `${ROTULO_PRESET[periodo.preset]} | ${fmtBR(periodo.inicio)} - ${fmtBR(periodo.fim)}`;

  const abrir = (v: boolean) => {
    setAberto(v);
    if (v) {
      setCustom(periodo.preset === "custom");
      setDe(fmtBR(periodo.inicio) || "");
      setAte(fmtBR(periodo.fim));
      setErro(null);
    }
  };

  const escolher = (p: PresetPeriodo) => {
    setCustom(false);
    setErro(null);
    aplicarPreset(p);
    const novo = periodoDoPreset(p);
    setDe(fmtBR(novo.inicio) || "");
    setAte(fmtBR(novo.fim));
    setAberto(false);
  };

  const aplicarCustom = () => {
    const i = deBR(de);
    const f = deBR(ate);
    if (!i || !f) return setErro("Use dd/mm/aaaa nas duas datas.");
    if (i > f) return setErro("A data inicial não pode ser depois da final.");
    if (f > limite) return setErro(`A data final não pode passar de ${fmtBR(limite)} (só dia fechado).`);
    setErro(null);
    setPeriodoStaged({ inicio: i, fim: f, preset: "custom" });
    // aplica no próximo tick, com o staged já no contexto
    setTimeout(() => applyDataReferencia(), 0);
    setAberto(false);
  };

  return (
    <DropdownMenu open={aberto} onOpenChange={abrir}>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground bg-background hover:border-primary outline-none disabled:opacity-40"
        style={{ transition: "border-color 120ms linear" }}
      >
        <CalendarIcon size={14} strokeWidth={1.5} className="text-muted-foreground" />
        <span className="whitespace-nowrap">{rotulo}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[248px] p-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => escolher(p)}
            className={`w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent ${
              periodo.preset === p ? "text-primary font-medium" : "text-foreground"
            }`}
            style={{ transition: "background-color 120ms linear" }}
          >
            {ROTULO_PRESET[p]}
          </button>
        ))}

        <button
          onClick={() => setCustom((v) => !v)}
          className={`w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent ${
            custom || periodo.preset === "custom" ? "text-primary font-medium" : "text-foreground"
          }`}
          style={{ transition: "background-color 120ms linear" }}
        >
          Personalizado...
        </button>

        {custom && (
          <div className="border-t border-border mt-1 pt-2 px-2 pb-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                value={de}
                onChange={(e) => setDe(e.target.value)}
                placeholder="dd/mm/aaaa"
                className="w-[92px] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                value={ate}
                onChange={(e) => setAte(e.target.value)}
                placeholder="dd/mm/aaaa"
                className="w-[92px] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            {erro && <p className="text-[11px] text-destructive leading-snug">{erro}</p>}
            <div className="flex justify-end">
              <button
                onClick={aplicarCustom}
                className="rounded-md border border-primary px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground bg-background"
                style={{ transition: "all 120ms linear" }}
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
