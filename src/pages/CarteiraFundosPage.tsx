import { useState } from "react";
import { useCarteiraFundos } from "@/hooks/useCarteiraFundos";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import PosicaoDetalheDialog from "@/components/PosicaoDetalheDialog";
import { useAlertas } from "@/hooks/useAlertas";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useDetalheDeFundo } from "@/hooks/useDetalheDeFundo";

export default function CarteiraFundosPage() {
  const { carteiraInfo, carteiraRows, allProductRows, productList, cdiRecords, loading } = useCarteiraFundos();
  // Posicao com alerta de mudanca na composicao do fundo em aberto: a serie esta parada na
  // ultima cota ate o cliente informar o que aconteceu, e a linha precisa dizer isso.
  const { alertas } = useAlertas();
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  // Clique no fundo abre a mesma gaveta de detalhes da Posição Consolidada.
  const [codigoAberto, setCodigoAberto] = useState<string | null>(null);
  const { detalhe } = useDetalheDeFundo(codigoAberto);
  const aguardando = new Set(
    alertas.filter((a) => a.tipo === "mudanca_de_fundo").flatMap((a) => (a.detalhe.codigos_custodia ?? []).map(String)),
  );

  const linhas: LinhaCarteira[] = productList.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: String(p.analysisProduct.codigo_custodia),
    nome: p.nome,
    detalhe: aguardando.has(String(p.analysisProduct.codigo_custodia))
      ? "Aguardando informação sobre mudança no fundo (veja o sino)"
      : null,
    custodiante: p.custodiante,
    patrimonio: p.valorAtualizado,
    ganho: p.ganhoFinanceiro,
    rentabilidade: p.rentabilidade,
    ativo: p.ativo,
  }));

  return (
    <>
    <CarteiraCategoriaView
      titulo="Fundos de Investimentos"
      labelSerie="Fundos"
      labelColuna="Fundo"
      tituloTabela="Fundos na carteira"
      carteiraInfo={carteiraInfo}
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
