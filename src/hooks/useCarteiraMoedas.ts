/**
 * Carrega e calcula a carteira de Moedas (posição em moeda estrangeira).
 *
 * Mesma forma de saída dos outros hooks de carteira: linhas diárias por posição
 * (no formato DailyRow) e as linhas consolidadas, para a lâmina Total somar
 * moedas, fundos e renda fixa pelo MESMO motor de carteira.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularCambioDiario, cambioRowsToDailyRows, moedaPorCodigo } from "@/lib/cambioEngine";
import { calcularCarteiraRendaFixa, CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import type { CdiRecord } from "@/lib/cdiCalculations";
import type { CarteiraInfo, ProductListItem } from "@/hooks/useCarteiraRF";
import { aplicarJanela } from "@/lib/periodo";
import { metricasDoProdutoNaJanela } from "@/lib/janelaDoProduto";

export interface PosicaoMoeda {
  codigo_custodia: string;
  nome: string;
  moeda: string;
  custodiante: string;
  patrimonio: number;
  ganho: number;
  rentabilidade: number;
  saldoMoeda: number;
  saldoFormatado: string;
  cotacao: number | null;
  ativo: boolean;
  /** false quando a posicao nao teve nenhum dia dentro da janela. */
  existiuNaJanela?: boolean;
}

let _moedasCachedVersion: number | null = null;
let _moedasCached: {
  carteiraInfo: CarteiraInfo | null;
  carteiraRows: CarteiraRFRow[];
  allProductRows: DailyRow[][];
  posicoes: PosicaoMoeda[];
  productList: ProductListItem[];
  cdiRecords: CdiRecord[];
} | null = null;

const TABELA_POR_MOEDA: Record<string, string> = {
  USD: "historico_dolar",
  EUR: "historico_euro",
};

export function useCarteiraMoedas() {
  const { user } = useAuth();
  const { appliedVersion, periodo } = useDataReferencia();
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_moedasCached?.carteiraInfo ?? null);
  const [carteiraRows, setCarteiraRows] = useState<CarteiraRFRow[]>(_moedasCached?.carteiraRows ?? []);
  const [allProductRows, setAllProductRows] = useState<DailyRow[][]>(_moedasCached?.allProductRows ?? []);
  const [posicoes, setPosicoes] = useState<PosicaoMoeda[]>(_moedasCached?.posicoes ?? []);
  const [productList, setProductList] = useState<ProductListItem[]>(_moedasCached?.productList ?? []);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>(_moedasCached?.cdiRecords ?? []);
  const [loading, setLoading] = useState(_moedasCachedVersion === null);

  useEffect(() => {
    if (!user) return;
    if (_moedasCachedVersion === appliedVersion) return;
    (async () => {
      setLoading(true);

      const [{ data: cartBruto }, { data: custodiaData }] = await Promise.all([
        supabase
          .from("controle_de_carteiras")
          .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
          .eq("nome_carteira", "Moedas")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("custodia")
          .select("id, codigo_custodia, nome, moeda, data_inicio, data_calculo, resgate_total, valor_investido, instituicoes(nome)")
          .eq("user_id", user.id)
          .not("moeda", "is", null),
      ]);

      const cartData = aplicarJanela(cartBruto as any, periodo);

      const posicoesCustodia = (custodiaData || []).map((r: any) => ({
        codigo_custodia: String(r.codigo_custodia),
        nome: r.nome as string,
        moeda: r.moeda as string,
        data_inicio: r.data_inicio as string,
        resgate_total: r.resgate_total as string | null,
        custodiante: r.instituicoes?.nome || "—",
      }));

      const vazio = () => {
        setCarteiraInfo((cartData as CarteiraInfo) ?? null);
        setCarteiraRows([]); setAllProductRows([]); setPosicoes([]); setProductList([]); setCdiRecords([]);
        setLoading(false);
        _moedasCachedVersion = appliedVersion;
        _moedasCached = { carteiraInfo: (cartData as CarteiraInfo) ?? null, carteiraRows: [], allProductRows: [], posicoes: [], productList: [], cdiRecords: [] };
      };

      if (posicoesCustodia.length === 0 || !cartData?.data_inicio || !cartData?.data_calculo) {
        vazio();
        return;
      }

      const info = cartData as CarteiraInfo;
      const dataInicio = info.data_inicio!;
      const dataCalculo = info.data_calculo!;
      setCarteiraInfo(info);
      // As series de mercado e o calendario vao desde o inicio REAL da carteira, nao desde o
      // comeco da janela: os motores por produto rodam a vida inteira do ativo (a quantidade
      // vem das movimentacoes acumuladas) e so o motor de carteira recorta pelo periodo.
      // Buscar a partir da janela apagava os fundos numa janela curta.
      const inicioReal = ((cartBruto as any)?.data_inicio as string | null) ?? dataInicio;

      const moedasUsadas = Array.from(new Set(posicoesCustodia.map((p) => p.moeda)));
      const codigos = posicoesCustodia.map((p) => p.codigo_custodia);

      const [calRaw, movRaw, cdiRaw, ...seriesRaw] = await Promise.all([
        fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("movimentacoes")
          .select("codigo_custodia, data, tipo_movimentacao, valor, quantidade, moeda")
          .eq("user_id", user.id).in("codigo_custodia", codigos).order("data").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual")
          .gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate)),
        ...moedasUsadas.map((m) =>
          fetchAllRows((de, ate) => supabase.from(TABELA_POR_MOEDA[m] as any).select("data, cotacao_venda")
            .gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate))),
      ]);

      const calendario = calRaw.map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
      const calMap = new Map<string, boolean>(calendario.map((c) => [c.data, c.dia_util]));
      const mergedCdi: CdiRecord[] = cdiRaw.map((c: any) => ({
        data: c.data, taxa_anual: Number(c.taxa_anual), dia_util: calMap.get(c.data) ?? false,
      }));

      const cotacoesPorMoeda = new Map<string, { data: string; cotacao: number }[]>();
      moedasUsadas.forEach((m, i) => {
        cotacoesPorMoeda.set(m, (seriesRaw[i] as any[]).map((r) => ({ data: r.data, cotacao: Number(r.cotacao_venda) })));
      });

      const movsPorCodigo = new Map<string, any[]>();
      for (const m of movRaw as any[]) {
        const arr = movsPorCodigo.get(String(m.codigo_custodia)) || [];
        arr.push(m);
        movsPorCodigo.set(String(m.codigo_custodia), arr);
      }

      const prodRows: DailyRow[][] = [];
      const lista: PosicaoMoeda[] = [];
      const pList: ProductListItem[] = [];

      for (const p of posicoesCustodia) {
        const fim = p.resgate_total && p.resgate_total < dataCalculo ? p.resgate_total : dataCalculo;
        const rows = calcularCambioDiario({
          dataInicio: p.data_inicio,
          dataCalculo: fim,
          calendario,
          cotacoes: cotacoesPorMoeda.get(p.moeda) || [],
          movimentacoes: (movsPorCodigo.get(p.codigo_custodia) || []).map((m) => ({
            data: m.data,
            tipo: m.tipo_movimentacao,
            valor: Number(m.valor),
            quantidade: m.quantidade != null ? Number(m.quantidade) : null,
          })),
        });

        prodRows.push(cambioRowsToDailyRows(rows));

        const ult = rows.length ? rows[rows.length - 1] : null;
        const encerrado = !!p.resgate_total && p.resgate_total <= dataCalculo;
        const infoMoeda = moedaPorCodigo(p.moeda);
        // Ganho e rentabilidade DA JANELA, pela mesma conta do card e dos grupos.
        const m = metricasDoProdutoNaJanela(prodRows[prodRows.length - 1], calendario, dataInicio, dataCalculo);
        lista.push({
          codigo_custodia: p.codigo_custodia,
          nome: p.nome,
          moeda: p.moeda,
          custodiante: p.custodiante,
          patrimonio: encerrado ? 0 : m.patrimonio,
          ganho: m.ganho,
          rentabilidade: m.rentabilidade,
          saldoMoeda: encerrado ? 0 : (ult?.saldoMoeda ?? 0),
          saldoFormatado: `${infoMoeda?.simbolo ?? p.moeda} ${(ult?.saldoMoeda ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          cotacao: ult?.cotacao ?? null,
          ativo: !encerrado,
          existiuNaJanela: m.existiuNaJanela,
        });

        pList.push({
          nome: p.nome,
          valorAtualizado: encerrado ? 0 : m.patrimonio,
          ganhoFinanceiro: m.ganho,
          rentabilidade: m.rentabilidade,
          existiuNaJanela: m.existiuNaJanela,
          custodiante: p.custodiante,
          ativo: !encerrado,
          estrategia: null,
          emissor_nome: infoMoeda?.nome ?? p.moeda,
          analysisProduct: {
            id: p.codigo_custodia,
            nome: p.nome,
            codigo_custodia: p.codigo_custodia,
            data_inicio: p.data_inicio,
            data_calculo: fim,
            data_limite: null,
            valor_investido: ult?.valorInvestido ?? 0,
            taxa: null,
            indexador: p.moeda,
            vencimento: null,
            modalidade: "Moeda",
            categoria_nome: "Moedas",
            produto_nome: "Moedas",
            instituicao_nome: p.custodiante,
            resgate_total: p.resgate_total,
            preco_unitario: ult?.cotacao ?? null,
            pagamento: null,
          } as any,
        });
      }

      const result = calcularCarteiraRendaFixa({ productRows: prodRows, calendario, dataInicio, dataCalculo });

      setAllProductRows(prodRows);
      setPosicoes(lista);
      setProductList(pList);
      setCarteiraRows(result);
      setCdiRecords(mergedCdi);
      _moedasCachedVersion = appliedVersion;
      _moedasCached = { carteiraInfo: info, carteiraRows: result, allProductRows: prodRows, posicoes: lista, productList: pList, cdiRecords: mergedCdi };
      setLoading(false);
    })();
  }, [user, appliedVersion]);

  return { carteiraInfo, carteiraRows, allProductRows, posicoes, productList, cdiRecords, loading };
}
