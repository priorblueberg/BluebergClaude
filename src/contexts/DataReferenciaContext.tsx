import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { format, startOfDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface DataReferenciaContextType {
  dataReferencia: Date;
  setDataReferencia: (date: Date) => void;
  dataReferenciaISO: string; // yyyy-MM-dd
  /** Ultimo dia util anterior a hoje. Teto da data de referencia. */
  maxDate: Date;
  /** Incremented each time the user applies the date — use as useEffect dep */
  appliedVersion: number;
  /** Call to trigger global recalculation */
  applyDataReferencia: () => void;
  /** True while the sync engine is recalculating */
  isRecalculating: boolean;
  setIsRecalculating: (v: boolean) => void;
}

const DataReferenciaContext = createContext<DataReferenciaContextType | null>(null);

/**
 * Aproximacao sincrona do ultimo dia util: volta um dia e pula fim de semana.
 *
 * Serve so para o primeiro render ter um valor plausivel. O calendario do banco
 * (`calendario_dias_uteis`, a mesma fonte que os motores usam) corrige em seguida, inclusive
 * feriado - duplicar a tabela de feriados aqui seria uma quarta copia, fadada a divergir.
 */
function diaUtilAnteriorAprox(hoje: Date): Date {
  const d = startOfDay(hoje);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

export function DataReferenciaProvider({ children }: { children: ReactNode }) {
  // D-1 dia util: e a ultima data em que o dado esta fechado dos dois lados. Em D0 nem o BCB
  // nem a CVM publicaram o dia, entao comparar com o Gorila em D0 e comparar duas fotos
  // incompletas - e incompletas de formas diferentes, porque a fonte de cota dele chega antes
  // da nossa. Decisao do Daniel em 05/09/2026.
  const [dataReferencia, setDataReferencia] = useState<Date>(() => diaUtilAnteriorAprox(new Date()));
  const [maxDate, setMaxDate] = useState<Date>(() => diaUtilAnteriorAprox(new Date()));
  const [appliedVersion, setAppliedVersion] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);
  // Se o usuario ja escolheu uma data, a chegada do calendario nao pode puxar a escolha dele.
  const escolhidaPeloUsuario = useRef(false);

  useEffect(() => {
    let vivo = true;
    const hojeISO = format(startOfDay(new Date()), "yyyy-MM-dd");
    supabase
      .from("calendario_dias_uteis")
      .select("data")
      .eq("dia_util", true)
      .lt("data", hojeISO)
      .order("data", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo || !data?.data) return; // sem calendario, fica a aproximacao
        const exato = startOfDay(parseISO(data.data));
        setMaxDate(exato);
        if (!escolhidaPeloUsuario.current) setDataReferencia(exato);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const definirDataReferencia = useCallback(
    (date: Date) => {
      escolhidaPeloUsuario.current = true;
      const d = startOfDay(date);
      setDataReferencia(d > maxDate ? maxDate : d);
    },
    [maxDate],
  );

  const dataReferenciaISO = format(dataReferencia, "yyyy-MM-dd");

  const applyDataReferencia = useCallback(() => {
    setAppliedVersion((v) => v + 1);
  }, []);

  return (
    <DataReferenciaContext.Provider
      value={{
        dataReferencia,
        setDataReferencia: definirDataReferencia,
        dataReferenciaISO,
        maxDate,
        appliedVersion,
        applyDataReferencia,
        isRecalculating,
        setIsRecalculating,
      }}
    >
      {children}
    </DataReferenciaContext.Provider>
  );
}

export function useDataReferencia() {
  const ctx = useContext(DataReferenciaContext);
  if (!ctx) throw new Error("useDataReferencia must be used within DataReferenciaProvider");
  return ctx;
}
