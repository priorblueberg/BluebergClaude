import { useMemo, useState } from "react";
import { percentualDoCdiPorCodigo } from "@/lib/detalheDaPosicao";
import { useCarteiraFundos } from "@/hooks/useCarteiraFundos";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import PosicaoDetalheDialog from "@/components/PosicaoDetalheDialog";
import AlertaFundoSemCota from "@/components/AlertaFundoSemCota";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useDetalheDeFundo } from "@/hooks/useDetalheDeFundo";

export default function CarteiraFundosPage() {
  const { carteiraInfo, carteiraRows, allProductRows, productList, cdiRecords, periodo, loading } = useCarteiraFundos();
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  // Clique no fundo abre a mesma gaveta de detalhes da Posição Consolidada.
  const [codigoAberto, setCodigoAberto] = useState<string | null>(null);
  const { detalhe } = useDetalheDeFundo(codigoAberto);

  // A mesma conta do % do CDI da gaveta: a rentabilidade do fundo sobre o CDI do periodo dele.
  const sobreCdi = useMemo(
    () => percentualDoCdiPorCodigo(productList, cdiRecords, periodo?.dataGlobal ?? dataReferenciaISO),
    [productList, cdiRecords, periodo, dataReferenciaISO],
  );

  const linhas: LinhaCarteira[] = productList.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: String(p.analysisProduct.codigo_custodia),
    sobreCdi: sobreCdi.get(String(p.analysisProduct.codigo_custodia)) ?? null,
    nome: p.nome,
    detalhe: null,
    // Fundo sem cota da CVM: "!" ao lado do nome, com encerrar ou migrar (Daniel, 12/09/2026).
    alerta: p.alertaSemCota ? <AlertaFundoSemCota alerta={p.alertaSemCota} /> : null,
    custodiante: p.custodiante,
    patrimonio: p.valorAtualizado,
    ganho: p.ganhoFinanceiro,
    rentabilidade: p.rentabilidade,
    ativo: p.ativo,
    lingueta: p.lingueta,
  }));

  return (
    <>
    <CarteiraCategoriaView
      titulo="Fundos de Investimentos"
      labelSerie="Fundos"
      labelColuna="Fundo"
      tituloTabela="Fundos na carteira"
      carteiraInfo={carteiraInfo}
      periodo={periodo}
      carteiraRows={carteiraRows}
      allProductRows={allProductRows}
      cdiRecords={cdiRecords}
      linhas={linhas}
      loading={loading}
      mensagemVazio="Nenhum fundo na carteira. Cadastre a primeira aplicação para acompanhar a posição diária."
      nota="A rentabilidade de cada fundo é money-weighted: o aporte entra na base do próprio dia, então não infla o retorno do mês em que o dinheiro chegou. A linha do gráfico e os cards acima são time-weighted, a mesma convenção das demais carteiras."
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
