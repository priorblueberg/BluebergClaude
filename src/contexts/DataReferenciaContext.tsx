import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { format, subDays } from "date-fns";

interface DataReferenciaContextType {
  dataReferencia: Date;
  setDataReferencia: (date: Date) => void;
  dataReferenciaISO: string; // yyyy-MM-dd
  /** Incremented each time the user applies the date — use as useEffect dep */
  appliedVersion: number;
  /** Call to trigger global recalculation */
  applyDataReferencia: () => void;
  /** True while the sync engine is recalculating */
  isRecalculating: boolean;
  setIsRecalculating: (v: boolean) => void;
}

const DataReferenciaContext = createContext<DataReferenciaContextType | null>(null);

export function DataReferenciaProvider({ children }: { children: ReactNode }) {
  const [dataReferencia, setDataReferencia] = useState<Date>(() => subDays(new Date(), 1));
  const [appliedVersion, setAppliedVersion] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const dataReferenciaISO = format(dataReferencia, "yyyy-MM-dd");

  const applyDataReferencia = useCallback(() => {
    setAppliedVersion((v) => v + 1);
  }, []);

  return (
    <DataReferenciaContext.Provider value={{ dataReferencia, setDataReferencia, dataReferenciaISO, appliedVersion, applyDataReferencia, isRecalculating, setIsRecalculating }}>
      {children}
    </DataReferenciaContext.Provider>
  );
}

export function useDataReferencia() {
  const ctx = useContext(DataReferenciaContext);
  if (!ctx) throw new Error("useDataReferencia must be used within DataReferenciaProvider");
  return ctx;
}
