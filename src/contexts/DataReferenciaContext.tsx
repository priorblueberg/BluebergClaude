import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from "react";
import { Periodo, PresetPeriodo, periodoDoPreset, periodoPadrao, limiteISO } from "@/lib/periodo";

interface DataReferenciaContextType {
  /** Período de análise aplicado (o que as lâminas estão mostrando). */
  periodo: Periodo;
  /** Período em edição no seletor, ainda não aplicado. */
  periodoStaged: Periodo;
  setPeriodoStaged: (p: Periodo) => void;
  /** Escolhe um atalho e aplica na hora, como o Gorila. */
  aplicarPreset: (preset: PresetPeriodo) => void;
  /** Teto de qualquer seleção: D-1. */
  limite: string;

  /** Início da janela aplicada; null = "desde o início" (cada lâmina usa o seu). */
  periodoInicioISO: string | null;
  /** Fim da janela aplicada. É a "data de referência" de sempre. */
  dataReferenciaISO: string;
  /** Compat: o fim da janela como Date. */
  dataReferencia: Date;
  setDataReferencia: (d: Date) => void;

  /** Sobe a cada aplicação — use como dep de useEffect. */
  appliedVersion: number;
  applyDataReferencia: () => void;

  isRecalculating: boolean;
  setIsRecalculating: (v: boolean) => void;
}

const DataReferenciaContext = createContext<DataReferenciaContextType | null>(null);

export function DataReferenciaProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoPadrao());
  const [periodoStaged, setPeriodoStaged] = useState<Periodo>(() => periodoPadrao());
  const [appliedVersion, setAppliedVersion] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const limite = useMemo(() => limiteISO(), []);

  const applyDataReferencia = useCallback(() => {
    setPeriodo(periodoStaged);
    setAppliedVersion((v) => v + 1);
  }, [periodoStaged]);

  const aplicarPreset = useCallback((preset: PresetPeriodo) => {
    const p = periodoDoPreset(preset);
    setPeriodoStaged(p);
    setPeriodo(p);
    setAppliedVersion((v) => v + 1);
  }, []);

  /** Compat com telas que ainda mexem só na ponta final (cadastro, calculadora). */
  const setDataReferencia = useCallback((d: Date) => {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setPeriodoStaged((p) => ({ ...p, fim: s, preset: "custom" }));
  }, []);

  const valor: DataReferenciaContextType = {
    periodo,
    periodoStaged,
    setPeriodoStaged,
    aplicarPreset,
    limite,
    periodoInicioISO: periodo.inicio,
    dataReferenciaISO: periodo.fim,
    dataReferencia: new Date(periodo.fim + "T12:00:00"),
    setDataReferencia,
    appliedVersion,
    applyDataReferencia,
    isRecalculating,
    setIsRecalculating,
  };

  return <DataReferenciaContext.Provider value={valor}>{children}</DataReferenciaContext.Provider>;
}

export function useDataReferencia() {
  const ctx = useContext(DataReferenciaContext);
  if (!ctx) throw new Error("useDataReferencia must be used within DataReferenciaProvider");
  return ctx;
}
