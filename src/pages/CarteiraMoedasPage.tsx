import { useState } from "react";
import { useCarteiraMoedas } from "@/hooks/useCarteiraMoedas";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import PosicaoDetalheDialog from "@/components/PosicaoDetalheDialog";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useDetalheDaLamina } from "@/hooks/useDetalheDaLamina";

export default function CarteiraMoedasPage() {
  const { carteiraInfo, carteiraRows, allProductRows, posicoes, productList, cdiRecords, calendario, periodo, loading } = useCarteiraMoedas();
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  // Clique na posição abre a mesma gaveta de detalhes da Posição Consolidada.
  const [codigoAberto, setCodigoAberto] = useState<string | null>(null);
  const detalhe = useDetalheDaLamina({
    codigo: codigoAberto, productList, allProductRows, calendario, cdiRecords,
    dataGlobal: periodo?.dataGlobal ?? dataReferenciaISO,
  });

  const linhas: LinhaCarteira[] = posicoes.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: p.codigo_custodia,
    nome: p.nome,
    detalhe: p.ativo ? p.saldoFormatado : null,
    custodiante: p.custodiante,
    patrimonio: p.patrimonio,
    ganho: p.ganho,
    rentabilidade: p.rentabilidade,
    ativo: p.ativo,
    lingueta: p.lingueta,
  }));

  return (
    <>
      <CarteiraCategoriaView
        titulo="Moedas"
        labelSerie="Moedas"
        labelColuna="Posição"
        tituloTabela="Moedas na carteira"
        carteiraInfo={carteiraInfo}
        periodo={periodo}
        carteiraRows={carteiraRows}
        allProductRows={allProductRows}
        cdiRecords={cdiRecords}
        linhas={linhas}
        loading={loading}
        mensagemVazio="Nenhuma posição em moeda. Cadastre a primeira compra para acompanhar a variação cambial."
        nota="Saldo em moeda não rende juros: todo o ganho aqui é variação cambial, medida pela cotação de venda do Banco Central. Em dia sem cotação publicada a posição repete a última conhecida."
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
