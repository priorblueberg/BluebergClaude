import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark, PieChart, CandlestickChart, DollarSign, Gauge, Sigma } from "lucide-react";
import { Painel, TabelaIlustrativa, LinhasIlustrativas, KpisIlustrativos, FormulaCard } from "./RecursoPage";

/**
 * Resumo das paginas de recursos na home (Daniel, 25/11/2026): uma faixa de ponta a ponta para
 * cada pagina de /recursos, no mesmo formato das paginas internas (texto de um lado, tela do outro).
 * A ordem segue o menu do InstitucionalLayout.
 */

interface Resumo {
  to: string;
  rotulo: string;
  icon: ElementType;
  titulo: string;
  texto: string;
  itens: string[];
  visual: ReactNode;
}

const CDI = [0, 0.85, 1.7, 2.6, 3.5, 4.4, 5.3, 6.2, 7.1, 8.0, 8.9, 9.8];

const RESUMOS: Resumo[] = [
  {
    to: "/recursos/renda-fixa",
    rotulo: "Renda Fixa",
    icon: Landmark,
    titulo: "Seus títulos, valorizados todo dia útil",
    texto:
      "CDBs, LCIs, LCAs e outros títulos bancários cadastrados com os dados da nota e atualizados pelo índice de cada dia até o vencimento.",
    itens: ["Prefixado, % do CDI, CDI + taxa e IPCA + taxa", "Emissores da lista do Banco Central", "% do CDI título a título"],
    visual: (
      <TabelaIlustrativa
        cabecalho={["Título", "Saldo", "% do CDI"]}
        linhas={[
          ["CDB 102% CDI", "R$ 25.418,30", "102,0%"],
          ["LCA 94% CDI", "R$ 18.204,77", "94,0%"],
          ["CDB IPCA + 6,10%", "R$ 31.870,12", "88,2%"],
        ]}
      />
    ),
  },
  {
    to: "/recursos/fundos",
    rotulo: "Fundos",
    icon: PieChart,
    titulo: "Digite o CNPJ. O resto vem da CVM",
    texto:
      "O fundo entra com nome, classe e série de cotas puxados da base pública da CVM, e a cota é atualizada sozinha todos os dias.",
    itens: ["Cadastro pelo CNPJ", "Aplicações, resgates e come-cotas", "Aviso de mudança de CNPJ ou classe"],
    visual: (
      <LinhasIlustrativas
        serieA={[0, 0.8, 1.9, 2.6, 3.9, 4.7, 5.8, 6.5, 7.9, 8.8, 9.6, 10.4]}
        serieB={CDI}
        legendaA="Cota do fundo"
        legendaB="CDI"
      />
    ),
  },
  {
    to: "/recursos/acoes",
    rotulo: "Ações",
    icon: CandlestickChart,
    titulo: "A sua posição na bolsa, com a conta certa",
    texto:
      "Todo o catálogo da B3, preço atualizado durante o pregão e rentabilidade que considera proventos, desdobramentos e o preço que você pagou.",
    itens: ["Boleta no formato da nota de corretagem", "Proventos na data-ex", "Comparação com o Ibovespa"],
    visual: (
      <LinhasIlustrativas
        serieA={[0, 2.1, 0.8, 3.6, 5.2, 3.9, 6.8, 8.1, 6.9, 9.4, 11.2, 12.6]}
        serieB={[0, 1.4, -0.6, 1.9, 3.1, 1.8, 4.2, 5.0, 3.6, 5.9, 7.4, 8.1]}
        legendaA="Ações"
        legendaB="Ibovespa"
      />
    ),
  },
  {
    to: "/recursos/moedas",
    rotulo: "Moedas",
    icon: DollarSign,
    titulo: "Dólar e euro pela cotação oficial",
    texto:
      "A moeda estrangeira que você comprou, convertida todo dia pela cotação do Banco Central, ao lado dos outros investimentos.",
    itens: ["Saldo em moeda e em reais", "Variação cambial no mês e no acumulado", "Compras e vendas por instituição"],
    visual: (
      <TabelaIlustrativa
        cabecalho={["Moeda", "Saldo", "Em reais"]}
        linhas={[
          ["Dólar", "US$ 3.500,00", "R$ 18.725,00"],
          ["Euro", "€ 1.200,00", "R$ 7.044,00"],
        ]}
      />
    ),
  },
  {
    to: "/recursos/analise",
    rotulo: "Análise da Carteira",
    icon: Gauge,
    titulo: "Tudo o que você investe, numa só visão",
    texto:
      "Todas as categorias consolidadas, com rentabilidade mês a mês contra o CDI e o Ibovespa, alocação, posição por instituição e eventos.",
    itens: ["Até 10 portfólios separados", "A carteira em qualquer data", "Proventos, juros e vencimentos"],
    visual: (
      <KpisIlustrativos
        itens={[
          ["Patrimônio", "R$ 245.870,15"],
          ["Ganho no ano", "R$ 21.432,80"],
          ["% do CDI", "109,4%"],
        ]}
      />
    ),
  },
  {
    to: "/recursos/metodologia",
    rotulo: "Metodologia",
    icon: Sigma,
    titulo: "Como a Blueberg calcula cada número",
    texto:
      "As convenções do mercado brasileiro, sem caixa-preta: rentabilidade ponderada pelo tempo, base 252 dias úteis e dados de fontes oficiais.",
    itens: ["Aportes e resgates não distorcem a rentabilidade", "As fórmulas de cada indexador", "Banco Central, CVM, ANBIMA e B3"],
    visual: (
      <FormulaCard
        linhas={["R = (1 + r₁) × (1 + r₂) × … × (1 + rₙ) − 1"]}
        legenda={[["rₜ", "rentabilidade de cada dia, sem o efeito do aporte"]]}
      />
    ),
  },
];

const ResumoRecursos = () => (
  <div id="recursos" className="scroll-mt-20">
    <div className="max-w-3xl mx-auto px-6 pt-20 pb-4 text-center lg:pt-28">
      <h2 className="text-3xl md:text-4xl font-bold text-[#0a2540]">Conheça a plataforma</h2>
      <p className="mt-4 text-lg text-[#4a6580]">Cada classe de ativo com a sua conta, e uma visão única da carteira.</p>
    </div>

    {/* Uma faixa por pagina, alternando o fundo e o lado da tela, como nas paginas internas. */}
    {RESUMOS.map((r, i) => (
      <section key={r.to} className={i % 2 === 0 ? "py-20" : "bg-[#f7f9fc] py-20"}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className={i % 2 === 1 ? "lg:order-2" : ""}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0a5eb8]/10">
                  <r.icon className="h-5 w-5 text-[#0a5eb8]" />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0a5eb8]">{r.rotulo}</span>
              </div>
              <h3 className="text-3xl font-bold text-[#0a2540]">{r.titulo}</h3>
              <p className="mt-4 text-lg leading-relaxed text-[#4a6580]">{r.texto}</p>
              <ul className="mt-6 space-y-3">
                {r.itens.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[#4a6580]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a5eb8]" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                to={r.to}
                className="group mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#0a5eb8] hover:text-[#084a92]"
              >
                Saiba mais sobre {r.rotulo}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
            <div className={i % 2 === 1 ? "lg:order-1" : ""}>
              {r.to === "/recursos/metodologia" ? r.visual : <Painel titulo={r.rotulo}>{r.visual}</Painel>}
            </div>
          </div>
        </div>
      </section>
    ))}
  </div>
);

export default ResumoRecursos;
