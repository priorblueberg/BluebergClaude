import { useMemo, useState } from "react";
import { percentualDoCdiPorCodigo } from "@/lib/detalheDaPosicao";
import { useCarteiraRF } from "@/hooks/useCarteiraRF";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import PosicaoDetalheDialog from "@/components/PosicaoDetalheDialog";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useDetalheDaLamina } from "@/hooks/useDetalheDaLamina";

/**
 * Lâmina de Renda Fixa, no modelo de todas as carteiras (Daniel, 13/09/2026). Clique no título abre a
 * mesma gaveta de detalhes da Posição Consolidada.
 */
export default function CarteiraRendaFixaPage() {
  const { carteiraInfo, carteiraRows, allProductRows, productList, cdiRecords, calendario, periodo, loading } = useCarteiraRF();
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const [codigoAberto, setCodigoAberto] = useState<string | null>(null);
  const detalhe = useDetalheDaLamina({
    codigo: codigoAberto, productList, allProductRows, calendario, cdiRecords,
    dataGlobal: periodo?.dataGlobal ?? dataReferenciaISO,
  });

  const sobreCdi = useMemo(
    () => percentualDoCdiPorCodigo(productList, cdiRecords, periodo?.dataGlobal ?? dataReferenciaISO),
    [productList, cdiRecords, periodo, dataReferenciaISO],
  );

  const linhas: LinhaCarteira[] = productList.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: String(p.analysisProduct.codigo_custodia),
    nome: p.nome,
    detalhe: null,
    custodiante: p.custodiante,
    patrimonio: p.valorAtualizado,
    ganho: p.ganhoFinanceiro,
    rentabilidade: p.rentabilidade,
    sobreCdi: sobreCdi.get(String(p.analysisProduct.codigo_custodia)) ?? null,
    ativo: p.ativo,
    lingueta: p.lingueta,
  }));

  return (
    <>
      <CarteiraCategoriaView
        titulo="Renda Fixa"
        labelSerie="Renda Fixa"
        labelColuna="Título"
        tituloTabela="Títulos na carteira"
        carteiraInfo={carteiraInfo}
        periodo={periodo}
        carteiraRows={carteiraRows}
        allProductRows={allProductRows}
        cdiRecords={cdiRecords}
        linhas={linhas}
        loading={loading}
        mensagemVazio="Nenhum título de renda fixa na carteira. Cadastre a primeira aplicação para acompanhar a posição diária."
        onClicarLinha={setCodigoAberto}
      />
      {codigoAberto && detalhe && user && (
        <PosicaoDetalheDialog
          open
          onClose={() => setCodigoAberto(null)}
          data={detalhe}
          userId={user.id}
          dataReferenciaISO={dataReferenciaISO}
          onDataChanged={() => applyDataReferencia()}
        />
      )}
    </>
  );
}
