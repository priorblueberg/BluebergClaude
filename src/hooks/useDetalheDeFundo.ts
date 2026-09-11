/**
 * Detalhe de UMA posição de fundo, para abrir a gaveta fora da Posição Consolidada.
 *
 * A lâmina de Fundos de Investimentos não carrega o que a gaveta usa (CNPJ, última cota, série
 * da posição contra o CDI). Aqui a posição é lida e calculada com `calcularPosicaoDeFundo`, a
 * mesma conta da Posição Consolidada, então a gaveta mostra os mesmos números nas duas telas.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useIbovespa } from "@/hooks/useIbovespa";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { pisoDoCalendario } from "@/lib/ipcaSeries";
import type { CdiRecord } from "@/lib/cdiCalculations";
import { calcularPosicaoDeFundo, montarGraficoETabela, type PosicaoDeFundoCalculada } from "@/lib/detalheDaPosicao";
import type { PosicaoDetalheData } from "@/components/PosicaoDetalheDialog";

interface Base {
  codigoCustodia: string;
  nome: string;
  cnpj: string | null;
  dataInicio: string;
  categoriaId: string;
  fim: string;
  calculo: PosicaoDeFundoCalculada;
  cdiRecords: CdiRecord[];
}

const diasAntes = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export function useDetalheDeFundo(codigoCustodia: string | null): { detalhe: PosicaoDetalheData | null; carregando: boolean } {
  const { user } = useAuth();
  const { dataReferenciaISO, appliedVersion } = useDataReferencia();
  const ibovespa = useIbovespa();
  const [base, setBase] = useState<Base | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!user || !codigoCustodia) {
      setBase(null);
      return;
    }
    let vivo = true;
    setCarregando(true);
    (async () => {
      try {
        const { data: custodia } = await supabase
          .from("custodia")
          .select("codigo_custodia, nome, fundo_id, data_inicio, resgate_total, categoria_id, produtos(nome), cadastro_de_fundos(cnpj_classe, dias_cotizacao_aplicacao, dias_cotizacao_resgate)")
          .eq("user_id", user.id)
          .eq("codigo_custodia", codigoCustodia)
          .maybeSingle();
        const c = custodia as any;
        if (!c?.fundo_id) {
          if (vivo) setBase(null);
          return;
        }

        const movs = (await fetchAllRows((de, ate) => supabase
          .from("movimentacoes")
          .select("data, data_cotizacao, tipo_movimentacao, valor, quantidade, fundo_id, created_at")
          .eq("user_id", user.id)
          .eq("codigo_custodia", codigoCustodia)
          .order("data")
          .range(de, ate))) as any[];
        const fundoIds = [...new Set([c.fundo_id as string, ...movs.map((m) => m.fundo_id as string | null).filter((id): id is string => !!id)])];

        const [cotas, calendarioRaw, cdiRaw] = await Promise.all([
          fetchAllRows((de, ate) => supabase.from("cotas_fundos").select("fundo_id, data, valor_cota")
            .in("fundo_id", fundoIds).lte("data", dataReferenciaISO).order("data").range(de, ate)),
          fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
            .gte("data", pisoDoCalendario(c.data_inicio)).lte("data", dataReferenciaISO).order("data").range(de, ate)),
          fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual")
            .gte("data", diasAntes(c.data_inicio, 5)).lte("data", dataReferenciaISO).order("data").range(de, ate)),
        ]);

        const calendario = (calendarioRaw as any[]).map((r) => ({ data: r.data as string, dia_util: !!r.dia_util }));
        const diaUtil = new Map(calendario.map((d) => [d.data, d.dia_util] as const));
        const cdiRecords: CdiRecord[] = (cdiRaw as any[]).map((r) => ({
          data: r.data,
          taxa_anual: Number(r.taxa_anual),
          dia_util: diaUtil.get(r.data) ?? true,
        }));
        const cotasPorFundo = new Map<string, { data: string; valor_cota: number }[]>();
        for (const r of cotas as any[]) {
          const lista = cotasPorFundo.get(r.fundo_id) || [];
          lista.push({ data: r.data, valor_cota: Number(r.valor_cota) });
          cotasPorFundo.set(r.fundo_id, lista);
        }

        const calculo = calcularPosicaoDeFundo({
          dataInicio: c.data_inicio,
          resgateTotal: c.resgate_total,
          fundoId: c.fundo_id,
          diasCotizacaoAplicacao: c.cadastro_de_fundos?.dias_cotizacao_aplicacao,
          diasCotizacaoResgate: c.cadastro_de_fundos?.dias_cotizacao_resgate,
          movimentacoes: movs.map((m) => ({
            data: m.data,
            tipo: m.tipo_movimentacao,
            valor: Number(m.valor),
            data_cotizacao: m.data_cotizacao ?? null,
            qtd_cotas: m.quantidade != null ? Number(m.quantidade) : null,
          })),
          movimentosDaPosicao: movs.filter((m) => m.fundo_id).map((m) => ({
            fundo_id: m.fundo_id,
            data: m.data,
            data_cotizacao: m.data_cotizacao ?? null,
            tipo_movimentacao: m.tipo_movimentacao,
            created_at: m.created_at ?? null,
          })),
          cotasPorFundo,
          calendario,
          dataReferenciaISO,
        });
        if (!vivo) return;
        if (!calculo) {
          setBase(null);
          return;
        }
        setBase({
          codigoCustodia: c.codigo_custodia,
          nome: c.nome || c.produtos?.nome || "",
          cnpj: c.cadastro_de_fundos?.cnpj_classe ?? null,
          dataInicio: c.data_inicio,
          categoriaId: c.categoria_id,
          fim: c.resgate_total && c.resgate_total < dataReferenciaISO ? c.resgate_total : dataReferenciaISO,
          calculo,
          cdiRecords,
        });
      } catch (erro) {
        console.error("Erro ao carregar o detalhe do fundo", erro);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [user, codigoCustodia, dataReferenciaISO, appliedVersion]);

  const detalhe = useMemo<PosicaoDetalheData | null>(() => {
    if (!base || base.codigoCustodia !== codigoCustodia) return null;
    const { grafico, cdiAcumuladoPct, tabela } = montarGraficoETabela({
      serie: base.calculo.serie,
      cdiRecords: base.cdiRecords,
      ibovespa,
      inicio: base.dataInicio,
      fim: base.fim,
      // Respeitar a data do produto: CDI, grafico e tabela param na ultima cota divulgada.
      ultimaDataDoProduto: base.calculo.dados.dataUltimoPreco,
    });
    return {
      tipo: "fundo",
      nome: base.nome,
      cnpj: base.cnpj,
      valorAtualizado: base.calculo.valorAtualizado,
      pnl: base.calculo.ganho,
      rentabilidadePct: base.calculo.rentabilidadePct,
      cdiAcumuladoPct,
      ultimoPreco: base.calculo.dados.ultimoPreco,
      dataUltimoPreco: base.calculo.dados.dataUltimoPreco,
      grafico,
      tabelaRentabilidade: tabela,
      dataInicio: base.dataInicio,
      codigoCustodia: base.codigoCustodia,
      categoriaId: base.categoriaId,
      indexador: null,
      taxa: null,
      modalidade: null,
      pagamento: null,
      emissor: null,
      vencimento: null,
    };
  }, [base, codigoCustodia, ibovespa]);

  return { detalhe, carregando };
}
