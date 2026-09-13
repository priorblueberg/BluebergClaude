import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useIbovespa } from "@/hooks/useIbovespa";
import type { ProductListItem } from "@/hooks/useCarteiraRF";
import type { DailyRow } from "@/lib/rendaFixaEngine";
import type { CdiRecord } from "@/lib/cdiCalculations";
import type { PosicaoDetalheData } from "@/components/PosicaoDetalheDialog";
import { SEM_DADOS, montarDetalheDaPosicao, type CadastroDaPosicao } from "@/lib/detalheDaPosicao";

/**
 * A gaveta de detalhes aberta pela lista de uma lâmina de carteira (Renda Fixa, Moedas, Ações).
 *
 * Os números saem da linha da própria lâmina e a conta é a da Posição Consolidada
 * (`montarDetalheDaPosicao`); daqui vem só o cadastro da posição, que a lista não carrega. Fundos tem
 * a própria (`useDetalheDeFundo`), com a série de cotas.
 */
export function useDetalheDaLamina({
  codigo,
  productList,
  allProductRows,
  calendario,
  cdiRecords,
  dataGlobal,
}: {
  /** Código de custódia da linha clicada, ou null com a gaveta fechada. */
  codigo: string | null;
  /** A lista da lâmina; `allProductRows` anda na mesma ordem. */
  productList: ProductListItem[];
  allProductRows: DailyRow[][];
  calendario: { data: string; dia_util: boolean }[];
  cdiRecords: CdiRecord[];
  dataGlobal: string;
}): PosicaoDetalheData | null {
  const { user } = useAuth();
  const { appliedVersion } = useDataReferencia();
  const ibovespa = useIbovespa();
  const [cadastro, setCadastro] = useState<CadastroDaPosicao | null>(null);

  useEffect(() => {
    if (!codigo || !user) {
      setCadastro(null);
      return;
    }
    let vivo = true;
    supabase
      .from("custodia")
      .select("codigo_custodia, data_inicio, categoria_id, fundo_id, moeda, acao_id, indexador, taxa, modalidade, pagamento, vencimento, categorias(nome), emissores(nome), cadastro_de_fundos(cnpj_classe)")
      .eq("user_id", user.id)
      .eq("codigo_custodia", codigo)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return;
        const r = data as any;
        setCadastro(r ? {
          codigo_custodia: String(r.codigo_custodia),
          data_inicio: r.data_inicio,
          categoria_id: r.categoria_id,
          categoria_nome: r.categorias?.nome ?? "",
          fundo_id: r.fundo_id ?? null,
          moeda: r.moeda ?? null,
          acao_id: r.acao_id ?? null,
          fundoCnpj: r.cadastro_de_fundos?.cnpj_classe ?? null,
          indexador: r.indexador ?? null,
          taxa: r.taxa ?? null,
          modalidade: r.modalidade ?? null,
          pagamento: r.pagamento ?? null,
          emissor_nome: r.emissores?.nome ?? null,
          vencimento: r.vencimento ?? null,
        } : null);
      });
    return () => { vivo = false; };
  }, [codigo, user, appliedVersion]);

  return useMemo(() => {
    if (!codigo || !cadastro || cadastro.codigo_custodia !== codigo) return null;
    const i = productList.findIndex((p) => String(p.analysisProduct.codigo_custodia) === codigo);
    if (i < 0) return null;
    const item = productList[i];
    return montarDetalheDaPosicao(cadastro, {
      nome: item.nome,
      valorAtualizado: item.valorAtualizado,
      ganhoFinanceiro: item.ganhoFinanceiro,
      rentabilidade: item.rentabilidade,
      custodiante: item.custodiante,
      ativo: item.ativo,
      dados: item.dados ?? SEM_DADOS,
      fim: item.fim ?? null,
      alertaSemCota: item.alertaSemCota ?? null,
      linhas: allProductRows[i] ?? [],
    }, { calendario, cdiRecords, ibovespa, dataGlobal });
  }, [codigo, cadastro, productList, allProductRows, calendario, cdiRecords, ibovespa, dataGlobal]);
}
