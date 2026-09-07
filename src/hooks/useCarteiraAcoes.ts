/**
 * Carrega e calcula a carteira de Ações.
 *
 * Mesma forma de saída dos outros hooks de carteira: linhas diárias por posição (no formato
 * DailyRow) e as linhas consolidadas, para a lâmina Total somar ações, moedas, fundos e renda
 * fixa pelo MESMO motor de carteira.
 *
 * Uma custódia é de ação quando tem `acao_id` - o mesmo critério que o hook de moedas usa com
 * `moeda`. Preço, provento e evento corporativo vêm do cadastro apontado por ele.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { calcularAcoesDiario, acoesRowsToDailyRows, type Provento, type EventoCorporativo } from "@/lib/acoesEngine";
import { calcularCarteiraRendaFixa, CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import type { CdiRecord } from "@/lib/cdiCalculations";
import type { CarteiraInfo, ProductListItem } from "@/hooks/useCarteiraRF";
import { ateAData } from "@/lib/janelaDaCarteira";
import { metricasDoProdutoNaJanela } from "@/lib/janelaDoProduto";

export interface PosicaoAcao {
  codigo_custodia: string;
  nome: string;
  ticker: string;
  custodiante: string;
  patrimonio: number;
  ganho: number;
  rentabilidade: number;
  quantidade: number;
  quantidadeFormatada: string;
  preco: number | null;
  /** Provento recebido dentro da janela, bruto (o IR do JCP não é descontado, como no Gorila). */
  proventos: number;
  ativo: boolean;
  existiuNaJanela?: boolean;
}

let _acoesCachedVersion: number | null = null;
let _acoesCached: {
  carteiraInfo: CarteiraInfo | null;
  carteiraRows: CarteiraRFRow[];
  allProductRows: DailyRow[][];
  posicoes: PosicaoAcao[];
  productList: ProductListItem[];
  cdiRecords: CdiRecord[];
} | null = null;

export function useCarteiraAcoes() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const [carteiraInfo, setCarteiraInfo] = useState<CarteiraInfo | null>(_acoesCached?.carteiraInfo ?? null);
  const [carteiraRows, setCarteiraRows] = useState<CarteiraRFRow[]>(_acoesCached?.carteiraRows ?? []);
  const [allProductRows, setAllProductRows] = useState<DailyRow[][]>(_acoesCached?.allProductRows ?? []);
  const [posicoes, setPosicoes] = useState<PosicaoAcao[]>(_acoesCached?.posicoes ?? []);
  const [productList, setProductList] = useState<ProductListItem[]>(_acoesCached?.productList ?? []);
  const [cdiRecords, setCdiRecords] = useState<CdiRecord[]>(_acoesCached?.cdiRecords ?? []);
  const [loading, setLoading] = useState(_acoesCachedVersion === null);

  useEffect(() => {
    if (!user) return;
    if (_acoesCachedVersion === appliedVersion) return;
    (async () => {
      setLoading(true);

      const [{ data: cartBruto }, { data: custodiaData }] = await Promise.all([
        supabase
          .from("controle_de_carteiras")
          .select("nome_carteira, status, data_inicio, data_calculo, data_limite, resgate_total")
          .eq("nome_carteira", "Renda Variável")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("custodia")
          .select("id, codigo_custodia, nome, acao_id, data_inicio, data_calculo, resgate_total, valor_investido, instituicoes(nome), cadastro_de_acoes(ticker, nome)")
          .eq("user_id", user.id)
          .not("acao_id", "is", null),
      ]);

      const cartData = ateAData(cartBruto as any, dataReferenciaISO);

      const posicoesCustodia = (custodiaData || []).map((r: any) => ({
        codigo_custodia: String(r.codigo_custodia),
        nome: r.nome as string,
        ticker: (r.cadastro_de_acoes?.ticker as string) ?? "",
        nomeEmpresa: (r.cadastro_de_acoes?.nome as string) ?? "",
        data_inicio: r.data_inicio as string,
        resgate_total: r.resgate_total as string | null,
        custodiante: r.instituicoes?.nome || "—",
      }));

      const vazio = () => {
        setCarteiraInfo((cartData as CarteiraInfo) ?? null);
        setCarteiraRows([]); setAllProductRows([]); setPosicoes([]); setProductList([]); setCdiRecords([]);
        setLoading(false);
        _acoesCachedVersion = appliedVersion;
        _acoesCached = { carteiraInfo: (cartData as CarteiraInfo) ?? null, carteiraRows: [], allProductRows: [], posicoes: [], productList: [], cdiRecords: [] };
      };

      if (posicoesCustodia.length === 0 || !cartData?.data_inicio || !cartData?.data_calculo) {
        vazio();
        return;
      }

      const info = cartData as CarteiraInfo;
      const dataInicio = info.data_inicio!;
      const dataCalculo = info.data_calculo!;
      setCarteiraInfo(info);
      // As séries e o calendário vão desde o início REAL da carteira, não desde o começo da
      // janela: o motor por produto roda a vida inteira do papel (a quantidade vem das
      // movimentações acumuladas) e só o motor de carteira recorta pelo período.
      const inicioReal = ((cartBruto as any)?.data_inicio as string | null) ?? dataInicio;

      const tickers = Array.from(new Set(posicoesCustodia.map((p) => p.ticker).filter(Boolean)));
      const codigos = posicoesCustodia.map((p) => p.codigo_custodia);

      const [calRaw, movRaw, cdiRaw, precoRaw, provRaw, evtRaw] = await Promise.all([
        fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
          .gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("movimentacoes")
          .select("codigo_custodia, data, tipo_movimentacao, valor, quantidade, custos_operacao")
          .eq("user_id", user.id).in("codigo_custodia", codigos).order("data").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual")
          .gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("cotacoes_acoes").select("ticker, data, fechamento")
          .in("ticker", tickers).gte("data", inicioReal).lte("data", dataCalculo).order("data").range(de, ate)),
        // Proventos e eventos NÃO são recortados pela janela: um desdobramento anterior ao
        // início ainda define a quantidade de hoje, e o motor precisa dele para converter.
        fetchAllRows((de, ate) => supabase.from("proventos_acoes").select("ticker, tipo, valor, data_ex, data_pagamento")
          .in("ticker", tickers).order("data_ex").range(de, ate)),
        fetchAllRows((de, ate) => supabase.from("eventos_corporativos_acoes").select("ticker, tipo, fator, data_ex")
          .in("ticker", tickers).order("data_ex").range(de, ate)),
      ]);

      const calendario = calRaw.map((c: any) => ({ data: c.data, dia_util: c.dia_util }));
      const calMap = new Map<string, boolean>(calendario.map((c) => [c.data, c.dia_util]));
      const mergedCdi: CdiRecord[] = cdiRaw.map((c: any) => ({
        data: c.data, taxa_anual: Number(c.taxa_anual), dia_util: calMap.get(c.data) ?? false,
      }));

      const porTicker = <T,>(linhas: any[], f: (r: any) => T) => {
        const m = new Map<string, T[]>();
        for (const r of linhas) {
          const arr = m.get(r.ticker) || [];
          arr.push(f(r));
          m.set(r.ticker, arr);
        }
        return m;
      };

      const precosPorTicker = porTicker(precoRaw as any[], (r) => ({ data: r.data, fechamento: Number(r.fechamento) }));
      const proventosPorTicker = porTicker(provRaw as any[], (r): Provento => ({
        tipo: r.tipo, valor: Number(r.valor), data_ex: r.data_ex, data_pagamento: r.data_pagamento,
      }));
      const eventosPorTicker = porTicker(evtRaw as any[], (r): EventoCorporativo => ({
        tipo: r.tipo, fator: Number(r.fator), data_ex: r.data_ex,
      }));

      const movsPorCodigo = new Map<string, any[]>();
      for (const m of movRaw as any[]) {
        const arr = movsPorCodigo.get(String(m.codigo_custodia)) || [];
        arr.push(m);
        movsPorCodigo.set(String(m.codigo_custodia), arr);
      }

      const prodRows: DailyRow[][] = [];
      const lista: PosicaoAcao[] = [];
      const pList: ProductListItem[] = [];

      for (const p of posicoesCustodia) {
        const fim = p.resgate_total && p.resgate_total < dataCalculo ? p.resgate_total : dataCalculo;
        const rows = calcularAcoesDiario({
          dataInicio: p.data_inicio,
          dataCalculo: fim,
          calendario,
          precos: precosPorTicker.get(p.ticker) || [],
          proventos: (proventosPorTicker.get(p.ticker) || []).filter((x) => x.data_ex && x.data_ex <= fim),
          eventos: eventosPorTicker.get(p.ticker) || [],
          movimentacoes: (movsPorCodigo.get(p.codigo_custodia) || []).map((m) => ({
            data: m.data,
            tipo: m.tipo_movimentacao,
            valor: Number(m.valor),
            quantidade: m.quantidade != null ? Number(m.quantidade) : null,
            custos: m.custos_operacao != null ? Number(m.custos_operacao) : null,
          })),
        });

        prodRows.push(acoesRowsToDailyRows(rows));

        const ult = rows.length ? rows[rows.length - 1] : null;
        const m = metricasDoProdutoNaJanela(prodRows[prodRows.length - 1], calendario, dataInicio, dataCalculo);
        // "Encerrado" vem do SALDO calculado, não só do cadastro - mesma regra dos outros hooks.
        const encerrado = (!!p.resgate_total && p.resgate_total <= dataCalculo)
          || (m.existiuNaJanela && m.patrimonio <= 0.005);

        // Provento da JANELA, não da vida toda: é o que a linha da tabela mostra.
        const naJanela = rows.filter((r) => r.data >= dataInicio && r.data <= dataCalculo);
        const proventosJanela = naJanela.reduce((s, r) => s + r.proventoLiquido, 0);

        const qtd = encerrado ? 0 : (ult?.quantidade ?? 0);
        lista.push({
          codigo_custodia: p.codigo_custodia,
          nome: p.nome,
          ticker: p.ticker,
          custodiante: p.custodiante,
          patrimonio: encerrado ? 0 : m.patrimonio,
          ganho: m.ganho,
          rentabilidade: m.rentabilidade,
          quantidade: qtd,
          quantidadeFormatada: `${qtd.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ${qtd === 1 ? "ação" : "ações"}`,
          preco: ult?.preco ?? null,
          proventos: proventosJanela,
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
          emissor_nome: p.nomeEmpresa || p.ticker,
          analysisProduct: {
            id: p.codigo_custodia,
            nome: p.nome,
            codigo_custodia: p.codigo_custodia,
            data_inicio: p.data_inicio,
            data_calculo: fim,
            data_limite: null,
            valor_investido: ult?.valorInvestido ?? 0,
            taxa: null,
            indexador: p.ticker,
            vencimento: null,
            modalidade: "Ações",
            categoria_nome: "Renda Variável",
            produto_nome: "Ações",
            instituicao_nome: p.custodiante,
            resgate_total: p.resgate_total,
            preco_unitario: ult?.preco ?? null,
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
      _acoesCachedVersion = appliedVersion;
      _acoesCached = { carteiraInfo: info, carteiraRows: result, allProductRows: prodRows, posicoes: lista, productList: pList, cdiRecords: mergedCdi };
      setLoading(false);
    })();
  }, [user, appliedVersion]);

  return { carteiraInfo, carteiraRows, allProductRows, posicoes, productList, cdiRecords, loading };
}
