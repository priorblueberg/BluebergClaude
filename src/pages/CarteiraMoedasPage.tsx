import { useCarteiraMoedas } from "@/hooks/useCarteiraMoedas";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";

export default function CarteiraMoedasPage() {
  const { carteiraInfo, carteiraRows, allProductRows, posicoes, cdiRecords, loading } = useCarteiraMoedas();

  const linhas: LinhaCarteira[] = posicoes.filter((p) => p.existiuNaJanela !== false).map((p) => ({
    chave: p.codigo_custodia,
    nome: p.nome,
    detalhe: p.ativo ? p.saldoFormatado : null,
    custodiante: p.custodiante,
    patrimonio: p.patrimonio,
    ganho: p.ganho,
    rentabilidade: p.rentabilidade,
    ativo: p.ativo,
  }));

  return (
    <CarteiraCategoriaView
      titulo="Moedas"
      labelSerie="Moedas"
      labelColuna="Posição"
      tituloTabela="Moedas na carteira"
      carteiraInfo={carteiraInfo}
      carteiraRows={carteiraRows}
      allProductRows={allProductRows}
      cdiRecords={cdiRecords}
      linhas={linhas}
      loading={loading}
      mensagemVazio="Nenhuma posição em moeda. Cadastre a primeira compra para acompanhar a variação cambial."
      nota="Saldo em moeda não rende juros: todo o ganho aqui é variação cambial, medida pela cotação de venda do Banco Central. Em dia sem cotação publicada a posição repete a última conhecida."
    />
  );
}
