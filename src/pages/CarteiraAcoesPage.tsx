import { useMemo, useState } from "react";
import { percentualDoCdiPorCodigo } from "@/lib/detalheDaPosicao";
import { useCarteiraAcoes } from "@/hooks/useCarteiraAcoes";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import PosicaoDetalheDialog from "@/components/PosicaoDetalheDialog";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useDetalheDaLamina } from "@/hooks/useDetalheDaLamina";

export default function CarteiraAcoesPage() {
  const { carteiraInfo, carteiraRows, allProductRows, posicoes, productList, cdiRecords, calendario, periodo, loading } = useCarteiraAcoes();
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  // Clique na posição abre a mesma gaveta de detalhes da Posição Consolidada.
  const [codigoAberto, setCodigoAberto] = useState<string | null>(null);
  const detalhe = useDetalheDaLamina({
    codigo: codigoAberto, productList, allProductRows, calendario, cdiRecords,
    dataGlobal: periodo?.dataGlobal ?? dataReferenciaISO,
  });

  const sobreCdi = useMemo(
    () => percentualDoCdiPorCodigo(productList, cdiRecords, periodo?.dataGlobal ?? dataReferenciaISO),
    [productList, cdiRecords, periodo, dataReferenciaISO],
  );

  const linhas: LinhaCarteira[] = posicoes.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: p.codigo_custodia,
    nome: p.nome,
    detalhe: p.ativo ? p.quantidadeFormatada : null,
    custodiante: p.custodiante,
    patrimonio: p.patrimonio,
    ganho: p.ganho,
    rentabilidade: p.rentabilidade,
    sobreCdi: sobreCdi.get(String(p.codigo_custodia)) ?? null,
    ativo: p.ativo,
    lingueta: p.lingueta,
  }));

  return (
    <>
      <CarteiraCategoriaView
        titulo="Ações"
        labelSerie="Ações"
        labelColuna="Posição"
        tituloTabela="Ações na carteira"
        carteiraInfo={carteiraInfo}
        periodo={periodo}
        carteiraRows={carteiraRows}
        allProductRows={allProductRows}
        cdiRecords={cdiRecords}
        linhas={linhas}
        loading={loading}
        mensagemVazio="Nenhuma posição em ações. Cadastre a primeira compra para acompanhar preço e proventos."
        nota="A posição vale quantidade x preço de fechamento. Dividendos e JCP entram no resultado na data-ex, que é o dia em que o preço cai - JCP entra bruto, como o Gorila exibe - o IR de 15% é retido na fonte. Desdobramentos e grupamentos ajustam a quantidade sem alterar o valor da posição."
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
