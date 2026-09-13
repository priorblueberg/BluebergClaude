import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { useCarteiraInvestimentos } from "@/hooks/useCarteiraInvestimentos";
import { calcularAlocacaoPorGrupo } from "@/lib/alocacaoPorGrupo";
import CarteiraCategoriaView, { type LinhaCarteira } from "@/components/CarteiraCategoriaView";
import { useBoleta } from "@/contexts/BoletaContext";

/** O dashboard de cada carteira, aberto pelo clique na linha dela. */
const ROTA_DA_CARTEIRA: Record<string, string> = {
  "Renda Fixa": "/carteira/renda-fixa",
  "Fundos de Investimentos": "/carteira/fundos",
  "Moedas": "/carteira/moedas",
  "Renda Variável": "/carteira/renda-variavel",
  "Tesouro Direto": "/carteira/tesouro-direto",
};

/**
 * Carteira de Investimentos, no modelo de todas as carteiras (Daniel, 13/09/2026). A exceção é a lista:
 * em vez das posições, uma linha por carteira com o total dela, e o clique abre o dashboard da carteira.
 */
export const CarteiraVisaoGeral = () => {
  const navigate = useNavigate();
  const { abrirBoleta } = useBoleta();
  const { dataReferenciaISO } = useDataReferencia();

  // A carteira de Investimentos é montada num lugar só, junto com a Posição Consolidada: as
  // quatro carteiras por categoria somadas pelo mesmo motor (`useCarteiraInvestimentos`).
  const {
    carteiraInfo, notFound, loading, productList, allProductRows, calendario, periodo,
    periodoPorCategoria, carteiraRows, cdiRecords, allCustodiaForCategoria,
  } = useCarteiraInvestimentos();

  /** Cada carteira passa pelo mesmo motor, para a rentabilidade da linha ser comparável com a do card. */
  const porCarteira = useMemo(() => {
    if (!carteiraInfo?.data_inicio || !carteiraInfo?.data_calculo || calendario.length === 0) return [];

    const gruposIdx = new Map<string, number[]>();
    productList.forEach((p, i) => {
      const cat = p.analysisProduct?.categoria_nome || "Outros";
      if (!gruposIdx.has(cat)) gruposIdx.set(cat, []);
      gruposIdx.get(cat)!.push(i);
    });

    // Categorias ainda sem motor entram só com o valor em custódia.
    const comMotor = new Set(gruposIdx.keys());
    const extrasMap = new Map<string, number>();
    for (const c of allCustodiaForCategoria) {
      if (comMotor.has(c.categoria_nome)) continue;
      const valor = c.custodia_no_dia != null ? c.custodia_no_dia : c.valor_investido;
      extrasMap.set(c.categoria_nome, (extrasMap.get(c.categoria_nome) || 0) + valor);
    }

    return calcularAlocacaoPorGrupo({
      gruposIdx,
      allProductRows,
      calendario,
      cdiRecords,
      dataInicio: carteiraInfo.data_inicio,
      dataCalculo: carteiraInfo.data_calculo,
      dataReferencia: dataReferenciaISO,
      extras: Array.from(extrasMap, ([nome, patrimonio]) => ({ nome, patrimonio })),
      // Cada categoria é uma carteira e termina no fim dela, não no da carteira de Investimentos.
      periodoPorGrupo: periodoPorCategoria,
      manterEncerrados: true,
    });
  }, [productList, allProductRows, allCustodiaForCategoria, calendario, cdiRecords, carteiraInfo, dataReferenciaISO,
    periodoPorCategoria]);

  if (!loading && notFound) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Carteira de Investimentos</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <p className="text-muted-foreground">Você ainda não possui investimentos cadastrados.</p>
          <button
            onClick={() => abrirBoleta()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Cadastrar primeira operação
          </button>
        </div>
      </div>
    );
  }

  const linhas: LinhaCarteira[] = porCarteira.map((l) => ({
    chave: l.nome,
    nome: l.nome,
    custodiante: "",
    patrimonio: l.patrimonio,
    ganho: l.ganhoFinanceiro,
    rentabilidade: l.rentabilidade,
    ativo: l.patrimonio > 0.005,
    lingueta: l.lingueta ?? null,
  }));

  return (
    <CarteiraCategoriaView
      titulo="Carteira de Investimentos"
      labelSerie="Investimentos"
      labelColuna="Carteira"
      tituloTabela="Posição Consolidada por Carteira"
      carteiraInfo={carteiraInfo}
      periodo={periodo}
      carteiraRows={carteiraRows}
      allProductRows={allProductRows}
      cdiRecords={cdiRecords}
      linhas={linhas}
      loading={loading}
      mensagemVazio="Nenhuma carteira com posição na data selecionada."
      mostrarCustodiante={false}
      onClicarLinha={(chave) => {
        const rota = ROTA_DA_CARTEIRA[chave];
        if (rota) navigate(rota);
      }}
    />
  );
};

export { default as CarteiraRendaFixa } from "./CarteiraRendaFixaPage";
export { default as CarteiraRendaVariavel } from "./CarteiraAcoesPage";
export { default as CarteiraFundos } from "./CarteiraFundosPage";
export { default as CarteiraMoedas } from "./CarteiraMoedasPage";
export const CarteiraTesouroDireto = () => <PageStub title="Tesouro Direto" />;
export { default as CarteiraAnaliseIndividual } from "./AnaliseIndividualPage";
export { default as Movimentacoes } from "./MovimentacoesPage";
export { default as Eventos } from "./EventosPage";
export { default as Configuracoes } from "./ConfiguracoesPage";
export const Usuario = () => <PageStub title="Usuário" />;
export { default as Admin } from "./AdminPage";
export { default as Custodia } from "./CustodiaPage";
export { default as ControleCarteiras } from "./ControleCarteirasPage";

const PageStub = ({ title }: { title: string }) => (
  <div>
    <h1 className="text-lg font-semibold text-foreground">{title}</h1>
  </div>
);
