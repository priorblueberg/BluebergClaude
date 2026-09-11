import { useCarteiraAcoes } from "@/hooks/useCarteiraAcoes";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";

export default function CarteiraAcoesPage() {
  const { carteiraInfo, carteiraRows, allProductRows, posicoes, cdiRecords, periodo, loading } = useCarteiraAcoes();

  const linhas: LinhaCarteira[] = posicoes.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: p.codigo_custodia,
    nome: p.nome,
    detalhe: p.ativo ? p.quantidadeFormatada : null,
    custodiante: p.custodiante,
    patrimonio: p.patrimonio,
    ganho: p.ganho,
    rentabilidade: p.rentabilidade,
    ativo: p.ativo,
    lingueta: p.lingueta,
  }));

  return (
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
    />
  );
}
