import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { format, startOfDay, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface DataReferenciaContextType {
  dataReferencia: Date;
  setDataReferencia: (date: Date) => void;
  dataReferenciaISO: string; // yyyy-MM-dd
  /**
   * Teto da CONSULTA: hoje (D0). Pode conter dado provisorio - ver `maxDataOficial`.
   *
   * Decisao do Daniel em 08/09/2026: a rentabilidade de hoje pode ser consultada mesmo com a
   * fonte ainda nao tendo publicado o dia. Os motores ja sabem lidar com isso - percorrem o
   * calendario ate a data de calculo e repetem o ultimo valor conhecido, marcando o dia como
   * estimado para NAO fabricar variacao (`cotaEstimada` no fundoEngine).
   */
  maxDate: Date;
  /**
   * Teto do CADASTRO de operacao: o ultimo dia em que todas as fontes ja fecharam.
   *
   * Consultar com dado provisorio e aceitavel; gravar operacao contra ele nao e. O numero da
   * consulta se corrige sozinho quando o oficial chega, mas a operacao fica gravada com o que
   * havia no momento.
   *
   * ACOES SAO EXCECAO e nao passam por este teto (decisao do Daniel em 08/09/2026): o preco da
   * compra ou venda e DIGITADO pelo cliente, nao sai da nossa serie. Dado provisorio ali afeta
   * so a marcacao a mercado, nunca o lancamento.
   */
  maxDataOficial: Date;
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
  // Duas datas diferentes, e a distincao entre elas e a regra inteira.
  //
  // `maxDate` (consulta) e HOJE. `maxDataOficial` (cadastro) e o penultimo dia util - a data
  // mais recente sem buraco em nenhuma fonte.
  //
  // O amarrador do oficial e a cota de fundo: a CVM publica a do dia D no dia util D+1. Entao
  // no ultimo dia util a cota dele ainda nao saiu. Em 05/09/2026 (sabado) o ultimo dia util era
  // 04/09 e a serie de cotas parava em 03/09 - era exatamente esse dia faltando que respondia
  // pelos R$ 227,88 de divergencia contra o Gorila, cuja fonte de cota chega antes da nossa.
  //
  // Ate 08/09/2026 o penultimo dia util era o teto das DUAS coisas, e por isso nao dava para
  // ver a rentabilidade de hoje. A separacao veio da decisao do Daniel: consulta vai ate D0
  // com dado provisorio, cadastro continua exigindo dado fechado.
  //
  // O DEFAULT e D0 (decisao do Daniel em 11/09/2026). Ate entao abria no penultimo dia util,
  // porque a cota de fundo atrasada deixava o CDI andar sozinho no ultimo dia. Com o periodo por
  // produto (`src/lib/periodo.ts`) cada produto para no proprio ultimo dado e o benchmark para
  // junto, entao o atraso da fonte deixou de distorcer a tela e o motivo do default sumiu.
  const [dataReferencia, setDataReferencia] = useState<Date>(() => startOfDay(new Date()));
  const [maxDataOficial, setMaxDataOficial] = useState<Date>(() => penultimoDiaUtilAprox(new Date()));
  const [maxDate] = useState<Date>(() => startOfDay(new Date()));
  const [appliedVersion, setAppliedVersion] = useState(0);
  const [isRecalculating, setIsRecalculating] = useState(false);

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
        // [0] e o ultimo dia util, [1] o penultimo - que e o teto do CADASTRO.
        const penultimo = data?.[1]?.data;
        if (!vivo || !penultimo) return; // sem calendario, fica a aproximacao
        setMaxDataOficial(startOfDay(parseISO(penultimo)));
      });
    return () => {
      vivo = false;
    };
  }, []);

  const definirDataReferencia = useCallback(
    (date: Date) => {
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
        maxDataOficial,
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
