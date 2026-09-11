/**
 * A carteira de Investimentos: as quatro carteiras por categoria somadas pelo MESMO motor de carteira.
 *
 * Vivia dentro da lâmina de Investimentos (AppPages). Saiu para cá em 11/09/2026 porque a Posição
 * Consolidada tinha a própria cópia da conta, e as cópias já divergiam: ações entravam com ganho e
 * rentabilidade zero, moeda com rentabilidade money-weighted e o total não fechava com Investimentos.
 * Agora as duas telas leem daqui, e cada linha sai com o mesmo número da sua lâmina.
 *
 * O período segue `src/lib/periodo.ts`: cada carteira termina no próprio fim e a de Investimentos no
 * maior fim entre elas.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useCarteiraRF, type ProductListItem } from "@/hooks/useCarteiraRF";
import { useCarteiraFundos } from "@/hooks/useCarteiraFundos";
import { useCarteiraMoedas } from "@/hooks/useCarteiraMoedas";
import { useCarteiraAcoes } from "@/hooks/useCarteiraAcoes";
import { calcularCarteiraRendaFixa } from "@/lib/carteiraRendaFixaEngine";
import { buildCarteiraDetailRows } from "@/lib/detailRowsBuilder";
import { ateAData } from "@/lib/janelaDaCarteira";
import { dataGlobalEfetiva, periodoDaCarteira, type PeriodoDaCarteira } from "@/lib/periodo";
import type { DailyRow } from "@/lib/rendaFixaEngine";

export interface InfoDaCarteiraGeral {
  nome_carteira: string;
  status: string;
  data_inicio: string | null;
  data_calculo: string | null;
}

/** Uma posição de qualquer categoria, com as linhas diárias do motor dela. */
export interface ProdutoDaCarteira {
  item: ProductListItem;
  rows: DailyRow[];
}

export function useCarteiraInvestimentos() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const rf = useCarteiraRF();
  const fundos = useCarteiraFundos();
  const moedas = useCarteiraMoedas();
  const acoes = useCarteiraAcoes();

  const [infoBruta, setInfoBruta] = useState<InfoDaCarteiraGeral | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setInfoLoading(true);
      const { data } = await supabase
        .from("controle_de_carteiras")
        .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
        .eq("nome_carteira", "Investimentos")
        .eq("user_id", user.id)
        .maybeSingle();
      setInfoBruta(ateAData(data as any, dataReferenciaISO));
      setNotFound(!data);
      setInfoLoading(false);
    })();
  }, [appliedVersion, user, dataReferenciaISO]);

  // `productList` e `allProductRows` de cada hook andam na mesma ordem.
  const produtos = useMemo<ProdutoDaCarteira[]>(() => {
    const juntar = (lista: ProductListItem[], rows: DailyRow[][]) => lista.map((item, i) => ({ item, rows: rows[i] ?? [] }));
    return [
      ...juntar(rf.productList, rf.allProductRows),
      ...juntar(fundos.productList, fundos.allProductRows),
      ...juntar(moedas.productList, moedas.allProductRows),
      ...juntar(acoes.productList, acoes.allProductRows),
    ];
  }, [rf.productList, rf.allProductRows, fundos.productList, fundos.allProductRows,
    moedas.productList, moedas.allProductRows, acoes.productList, acoes.allProductRows]);

  const allProductRows = useMemo(() => produtos.map((p) => p.rows), [produtos]);
  const productList = useMemo(() => produtos.map((p) => p.item), [produtos]);

  /** Calendário da união: cada categoria busca o seu a partir do próprio início. */
  const calendario = useMemo(() => {
    const map = new Map<string, { data: string; dia_util: boolean }>();
    for (const c of [...rf.calendario, ...fundos.calendario, ...moedas.calendario, ...acoes.calendario]) {
      map.set(c.data, { data: c.data, dia_util: c.dia_util });
    }
    return Array.from(map.values()).sort((a, b) => a.data.localeCompare(b.data));
  }, [rf.calendario, fundos.calendario, moedas.calendario, acoes.calendario]);

  /**
   * Período da carteira de Investimentos: até o MAIOR fim entre as carteiras com posição. A carteira
   * que termina antes entra com o valor repetido, porque os motores de cada produto rodam até a data
   * global efetiva e repetem a última cota ou preço.
   */
  const periodo = useMemo(
    () => periodoDaCarteira(
      [rf.periodo, fundos.periodo, moedas.periodo, acoes.periodo].filter((p): p is PeriodoDaCarteira => !!p),
      dataGlobalEfetiva(calendario, dataReferenciaISO),
    ),
    [rf.periodo, fundos.periodo, moedas.periodo, acoes.periodo, calendario, dataReferenciaISO],
  );

  const carteiraInfo = useMemo(
    () => (infoBruta && periodo.fim ? { ...infoBruta, data_calculo: periodo.fim } : infoBruta),
    [infoBruta, periodo],
  );

  /** Cada categoria é uma carteira e termina no fim dela (usado na tabela por categoria). */
  const periodoPorCategoria = useMemo(() => {
    const mapa = new Map<string, PeriodoDaCarteira>();
    const marcar = (lista: ProductListItem[], per: PeriodoDaCarteira | null) => {
      if (!per) return;
      for (const p of lista) mapa.set(p.analysisProduct?.categoria_nome || "Outros", per);
    };
    marcar(rf.productList, rf.periodo);
    marcar(fundos.productList, fundos.periodo);
    marcar(moedas.productList, moedas.periodo);
    marcar(acoes.productList, acoes.periodo);
    return mapa;
  }, [rf.productList, rf.periodo, fundos.productList, fundos.periodo, moedas.productList, moedas.periodo,
    acoes.productList, acoes.periodo]);

  const carteiraRows = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) return [];
    return calcularCarteiraRendaFixa({
      productRows: allProductRows,
      calendario,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
    });
  }, [allProductRows, calendario, carteiraInfo]);

  const detailRows = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo) return [];
    return buildCarteiraDetailRows(allProductRows, carteiraRows, rf.cdiRecords, carteiraInfo.data_inicio, carteiraInfo.data_calculo);
  }, [allProductRows, carteiraRows, rf.cdiRecords, carteiraInfo]);

  /** Os cards: patrimônio, ganho, rentabilidade, CDI e % do CDI (com todas as casas). */
  const resumo = useMemo(() => {
    let patrimonio: number | null = null;
    let rent: number | null = null;
    let ganho: number | null = null;
    for (let i = carteiraRows.length - 1; i >= 0; i--) {
      if (carteiraRows[i].data <= dataReferenciaISO) {
        patrimonio = carteiraRows[i].liquido;
        rent = carteiraRows[i].rentAcumuladaPct * 100;
        ganho = carteiraRows[i].rentAcumuladaRS;
        break;
      }
    }
    const cdiAcum = detailRows.length > 0 ? detailRows[0].cdiAcumulado : null;
    const cdiExato = detailRows.length > 0 ? (detailRows[0].cdiAcumuladoExato ?? cdiAcum) : null;
    const sobreCdi = rent != null && cdiExato != null && cdiExato !== 0 ? (rent / cdiExato) * 100 : null;
    return { patrimonio, ganho, rent, cdiAcum, sobreCdi };
  }, [carteiraRows, detailRows, dataReferenciaISO]);

  return {
    carteiraInfo,
    notFound,
    loading: infoLoading || rf.loading || fundos.loading || moedas.loading || acoes.loading,
    produtos,
    allProductRows,
    productList,
    calendario,
    periodo,
    periodoPorCategoria,
    carteiraRows,
    detailRows,
    resumo,
    cdiRecords: rf.cdiRecords,
    ibovespaData: rf.ibovespaData,
    allCustodiaForCategoria: rf.allCustodiaForCategoria,
  };
}
