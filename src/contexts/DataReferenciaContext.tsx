import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { format, startOfDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface DataReferenciaContextType {
  dataReferencia: Date;
  setDataReferencia: (date: Date) => void;
  dataReferenciaISO: string; // yyyy-MM-dd
  /** Penultimo dia util. Teto da data de referencia. */
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
 * Aproximacao sincrona do penultimo dia util, contando de hoje para tras e incluindo hoje
 * quando hoje e dia util.
 *
 * Serve so para o primeiro render ter um valor plausivel. O calendario do banco
 * (`calendario_dias_uteis`, a mesma fonte que os motores usam) corrige em seguida, inclusive
 * feriado - duplicar a tabela de feriados aqui seria uma quarta copia, fadada a divergir.
 */
export function penultimoDiaUtilAprox(hoje: Date): Date {
  const d = startOfDay(hoje);
  let achados = 0;
  for (;;) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && ++achados === 2) return d;
    d.setDate(d.getDate() - 1);
  }
}

export function DataReferenciaProvider({ children }: { children: ReactNode }) {
  // Penultimo dia util: e a data mais recente sem buraco em nenhuma fonte, e por isso o teto.
  //
  // O amarrador e a cota de fundo: a CVM publica a do dia D no dia util D+1. Entao no ultimo
  // dia util a cota dele ainda nao saiu. Em 05/09/2026 (sabado) o ultimo dia util era 04/09 e
  // a serie de cotas parava em 03/09 - era exatamente esse dia faltando que respondia pelos
  // R$ 227,88 de divergencia contra o Gorila, cuja fonte de cota chega antes da nossa.
  //
  // Recuando mais um dia util, todas as fontes ja fecharam e os dois lados olham a mesma foto.
  // Decisao do Daniel em 05/09/2026.
  const [dataReferencia, setDataReferencia] = useState<Date>(() => penultimoDiaUtilAprox(new Date()));
  const [maxDate, setMaxDate] = useState<Date>(() => penultimoDiaUtilAprox(new Date()));
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
      .lte("data", hojeISO)
      .order("data", { ascending: false })
      .limit(2)
      .then(({ data }) => {
        // [0] e o ultimo dia util, [1] o penultimo - que e o teto.
        const penultimo = data?.[1]?.data;
        if (!vivo || !penultimo) return; // sem calendario, fica a aproximacao
        const exato = startOfDay(parseISO(penultimo));
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
