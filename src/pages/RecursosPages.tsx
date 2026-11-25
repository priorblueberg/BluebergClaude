import {
  Landmark,
  CalendarClock,
  Percent,
  Building2,
  Search,
  LineChart,
  RefreshCw,
  Receipt,
  CandlestickChart,
  Coins,
  Split,
  DollarSign,
  Gauge,
  Layers,
  History,
  Fingerprint,
  Clock,
  Scale,
  Database,
  Sigma,
  CalendarDays,
  Euro,
  Wallet,
} from "lucide-react";
import RecursoPage, {
  Painel,
  TabelaIlustrativa,
  LinhasIlustrativas,
  FormularioIlustrativo,
  KpisIlustrativos,
  FormulaCard,
} from "@/components/landing/RecursoPage";

/*
 * Paginas de recursos do institucional (Daniel, 25/11/2026). So o modulo de Investimentos: o Caixa
 * esta em standby. Cada afirmacao aqui tem que existir no app para o usuario comum - Tesouro Direto
 * (tela vazia) e cupom periodico em renda fixa (so admin) ficam de fora de proposito. A Metodologia
 * descreve as regras dos motores (src/lib/*Engine.ts); mudou o motor, revise o texto.
 */

const CDI_12M = [0, 0.85, 1.7, 2.6, 3.5, 4.4, 5.3, 6.2, 7.1, 8.0, 8.9, 9.8];

/* ---------- Renda Fixa ---------- */

export const RecursoRendaFixa = () => (
  <RecursoPage
    rotulo="Renda Fixa"
    titulo={
      <>
        Seus títulos, valorizados <span className="text-[#0a5eb8]">todo dia útil</span>.
      </>
    }
    subtitulo="Cadastre CDBs, LCIs, LCAs e outros títulos bancários com os termos da sua nota e acompanhe o saldo, o ganho e a rentabilidade de cada um, dia a dia, até o vencimento."
    destaques={[
      {
        icon: Percent,
        titulo: "Todos os indexadores",
        texto: "Prefixado, percentual do CDI, CDI mais taxa e IPCA mais taxa, cada um com a sua conta.",
      },
      {
        icon: CalendarClock,
        titulo: "Calendário de dias úteis",
        texto: "A valorização segue os dias úteis do mercado, com os feriados nacionais de cada ano.",
      },
      {
        icon: Landmark,
        titulo: "Emissores oficiais",
        texto: "O emissor sai da lista de instituições autorizadas pelo Banco Central, com a razão social.",
      },
      {
        icon: Building2,
        titulo: "Por instituição",
        texto: "O mesmo título em duas corretoras vira duas posições, como no seu extrato.",
      },
    ]}
    secoes={[
      {
        titulo: "Cadastro com os dados da nota",
        texto:
          "Você digita o que está na nota de aplicação: produto, emissor, indexador, taxa, data e vencimento. Não precisa informar o valor de hoje, a Blueberg calcula.",
        itens: [
          "Emissor e instituição buscados por nome, sigla ou apelido",
          "Prefixado, pós-fixado no CDI e atrelado ao IPCA",
          "Aplicações adicionais e resgates parciais no mesmo título",
        ],
        visual: (
          <Painel titulo="Cadastrar Transação">
            <FormularioIlustrativo
              campos={[
                ["Categoria", "Renda Fixa"],
                ["Produto", "CDB"],
                ["Emissor", "Banco Exemplo S.A."],
                ["Instituição", "Corretora Exemplo"],
                ["Indexador", "CDI"],
                ["Taxa", "102,00% do CDI"],
                ["Data da aplicação", "02/01/2025"],
                ["Vencimento", "04/01/2028"],
                ["Valor", "R$ 25.000,00"],
                ["Pagamento", "No Vencimento"],
              ]}
              botao="Cadastrar"
            />
          </Painel>
        ),
      },
      {
        titulo: "Do cadastro ao vencimento",
        texto:
          "A partir do cadastro, cada título é atualizado pelo índice de cada dia útil até o vencimento, quando sai da posição e fica no histórico.",
        itens: [
          "Saldo bruto atualizado todo dia útil",
          "Ganho acumulado e no mês, título a título",
          "Vencimento em fim de semana ou feriado liquida no dia útil anterior",
        ],
        visual: (
          <Painel titulo="Renda Fixa">
            <TabelaIlustrativa
              cabecalho={["Título", "Saldo", "No mês", "% do CDI"]}
              linhas={[
                ["CDB 102% CDI", "R$ 25.418,30", "0,95%", "102,0%"],
                ["LCA 94% CDI", "R$ 18.204,77", "0,87%", "94,0%"],
                ["CDB IPCA + 6,10%", "R$ 31.870,12", "0,82%", "88,2%"],
                ["CDB Pré 13,20%", "R$ 12.655,40", "1,04%", "111,8%"],
                ["LCI CDI + 0,50%", "R$ 9.940,05", "0,92%", "104,9%"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "O detalhe de cada título",
        texto:
          "Abra qualquer título e veja a evolução dele desde a aplicação: saldo, ganho, rentabilidade e a comparação com o CDI no mesmo período.",
        itens: [
          "Rentabilidade em percentual e em % do CDI",
          "Período do título: da primeira aplicação ao último dado divulgado",
          "Todas as operações do título, na ordem em que aconteceram",
        ],
        visual: (
          <Painel titulo="CDB 102% CDI · Corretora Exemplo">
            <KpisIlustrativos
              itens={[
                ["Saldo bruto", "R$ 25.418,30"],
                ["Ganho", "R$ 2.418,30"],
                ["% do CDI", "101,98%"],
              ]}
            />
            <div className="mt-4">
              <LinhasIlustrativas
                serieA={[0, 0.88, 1.75, 2.66, 3.58, 4.5, 5.42, 6.35, 7.26, 8.17, 9.1, 10.0]}
                serieB={CDI_12M}
                legendaA="Título"
                legendaB="CDI"
              />
            </div>
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Fundos ---------- */

export const RecursoFundos = () => (
  <RecursoPage
    rotulo="Fundos de Investimento"
    titulo={
      <>
        Digite o CNPJ. <span className="text-[#0a5eb8]">O resto vem da CVM.</span>
      </>
    }
    subtitulo="Seus fundos acompanhados pela cota oficial, com cadastro e histórico puxados direto da base pública da Comissão de Valores Mobiliários."
    destaques={[
      {
        icon: Search,
        titulo: "Cadastro pelo CNPJ",
        texto: "Encontrou o fundo? Ele entra com nome, classe e a série de cotas.",
      },
      {
        icon: RefreshCw,
        titulo: "Cotas diárias",
        texto: "As cotas são atualizadas automaticamente, todos os dias, conforme a CVM divulga.",
      },
      {
        icon: LineChart,
        titulo: "Rentabilidade pela cota",
        texto: "O resultado é medido pela variação da cota, o mesmo critério do gestor do fundo.",
      },
    ]}
    secoes={[
      {
        titulo: "Um fundo novo em segundos",
        texto:
          "Informe o CNPJ da classe. A Blueberg busca o registro na CVM, traz o nome e carrega o histórico de cotas, sem você copiar nada de extrato.",
        itens: [
          "Busca na base pública da CVM",
          "Fundos com mais de uma subclasse pedem a escolha da certa",
          "Série de cotas carregada no cadastro e atualizada todo dia",
        ],
        visual: (
          <Painel titulo="Cadastrar Fundo">
            <FormularioIlustrativo
              campos={[
                ["CNPJ da classe", "00.000.000/0001-00"],
                ["Situação", "Fundo encontrado na CVM"],
                ["Nome", "Fundo Exemplo DI FIF RF"],
                ["Cotas carregadas", "Série completa"],
              ]}
              botao="Cadastrar fundo"
            />
          </Painel>
        ),
      },
      {
        titulo: "Aplicações, resgates e come-cotas",
        texto:
          "Lance as movimentações com a data e o valor. A quantidade de cotas é calculada pela cota do dia de cotização, e o come-cotas entra como uma saída de cotas.",
        itens: [
          "Saldo em cotas e em reais a cada dia",
          "Fechar posição resgata o saldo exato de cotas",
          "Aviso quando o fundo muda de CNPJ ou de classe na CVM",
        ],
        visual: (
          <Painel titulo="Fundos de Investimento">
            <TabelaIlustrativa
              cabecalho={["Fundo", "Cotas", "Saldo", "No ano"]}
              linhas={[
                ["Fundo DI", "8.412,551", "R$ 42.310,08", "10,4%"],
                ["Multimercado", "2.105,330", "R$ 15.902,44", "8,7%"],
                ["Crédito Privado", "5.660,912", "R$ 27.115,63", "11,9%"],
                ["Renda Fixa IPCA", "3.118,207", "R$ 11.406,90", "7,2%"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "A cota contra o CDI",
        texto:
          "Cada fundo é comparado com o CDI apenas nos dias em que você teve dinheiro nele. Período sem posição não conta para nenhum dos lados.",
        itens: [
          "Rentabilidade no mês, no ano e desde a aplicação",
          "Última cota divulgada indicada na tela",
          "O mesmo fundo em instituições diferentes, separado por custódia",
        ],
        visual: (
          <Painel titulo="Histórico da cota">
            <LinhasIlustrativas
              serieA={[0, 0.8, 1.9, 2.6, 3.9, 4.7, 5.8, 6.5, 7.9, 8.8, 9.6, 10.4]}
              serieB={CDI_12M}
              legendaA="Cota do fundo"
              legendaB="CDI"
            />
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Acoes ---------- */

export const RecursoAcoes = () => (
  <RecursoPage
    rotulo="Ações"
    titulo={
      <>
        A sua posição na bolsa, <span className="text-[#0a5eb8]">com a conta certa</span>.
      </>
    }
    subtitulo="Todo o catálogo da B3 disponível, preços atualizados durante o pregão e uma rentabilidade que considera proventos, desdobramentos e o preço que você realmente pagou."
    destaques={[
      {
        icon: CandlestickChart,
        titulo: "Catálogo da B3",
        texto: "Mais de 2.300 papéis negociados na bolsa, buscados pelo código ou pelo nome da empresa.",
      },
      {
        icon: Clock,
        titulo: "Preço durante o pregão",
        texto: "A cotação do dia é atualizada de hora em hora e confirmada pelo fechamento oficial.",
      },
      {
        icon: Receipt,
        titulo: "Proventos",
        texto: "Dividendos, juros sobre capital próprio e rendimentos, reconhecidos na data-ex.",
      },
      {
        icon: Fingerprint,
        titulo: "Identidade pelo ISIN",
        texto: "Se a empresa troca de código, o histórico da sua posição vem junto.",
      },
    ]}
    secoes={[
      {
        titulo: "Boleta no formato da nota de corretagem",
        texto:
          "Você registra a operação como ela aparece na nota: quantidade e preço unitário. Custos de corretagem e emolumentos entram no custo da posição.",
        itens: [
          "Compras e vendas, parciais ou totais",
          "Busca do papel pelo código ou pelo nome",
          "Papel novo tem o histórico de preços carregado na hora",
        ],
        visual: (
          <Painel titulo="Cadastrar Transação">
            <FormularioIlustrativo
              campos={[
                ["Categoria", "Renda Variável"],
                ["Papel", "PETR4 · Petrobras PN"],
                ["Tipo", "Compra"],
                ["Data", "14/03/2025"],
                ["Quantidade", "400"],
                ["Preço unitário", "R$ 36,12"],
                ["Instituição", "Corretora Exemplo"],
                ["Total", "R$ 14.448,00"],
              ]}
              botao="Cadastrar"
            />
          </Painel>
        ),
      },
      {
        titulo: "Rentabilidade a partir do preço que você pagou",
        texto:
          "O custo é o preço da sua compra, não o fechamento do dia. Se você comprou acima do fechamento, a diferença já aparece como resultado no próprio dia, como na sua corretora.",
        itens: [
          "Posição por papel, com quantidade e saldo",
          "Ganho no mês e acumulado, papel a papel",
          "Comparação com o Ibovespa e com o CDI",
        ],
        visual: (
          <Painel titulo="Renda Variável">
            <TabelaIlustrativa
              cabecalho={["Papel", "Qtd.", "Saldo", "No ano"]}
              linhas={[
                ["PETR4", "400", "R$ 15.124,00", "12,3%"],
                ["ITUB4", "300", "R$ 10.887,00", "9,8%"],
                ["WEGE3", "150", "R$ 7.954,50", "-3,1%"],
                ["VALE3", "200", "R$ 12.300,00", "4,6%"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Proventos e eventos corporativos",
        texto:
          "Quando a empresa paga um provento, o preço da ação cai na data-ex. A Blueberg soma o provento de volta no cálculo da rentabilidade para que essa queda não apareça como prejuízo. Desdobramentos e grupamentos ajustam a quantidade sem mexer no valor da posição.",
        itens: [
          "Proventos declarados lidos automaticamente para cada papel",
          "Data-ex para o cálculo, data de pagamento para o dinheiro",
          "Desdobramento de 2 para 1: o dobro de ações valendo a metade",
        ],
        visual: (
          <Painel titulo="Eventos · PETR4">
            <TabelaIlustrativa
              cabecalho={["Data-ex", "Tipo", "Por ação", "Recebido"]}
              linhas={[
                ["22/08", "Dividendos", "R$ 0,6200", "R$ 248,00"],
                ["22/08", "JCP", "R$ 0,1850", "R$ 74,00"],
                ["02/06", "Dividendos", "R$ 0,4100", "R$ 164,00"],
                ["14/04", "JCP", "R$ 0,2300", "R$ 92,00"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Contra o Ibovespa",
        texto:
          "A carteira de ações é medida contra o principal índice da bolsa, no mesmo período em que você teve posição. Dá para ver se a sua seleção de papéis está ganhando do mercado.",
        itens: [
          "Rentabilidade com proventos, mês a mês",
          "Ibovespa e CDI no mesmo gráfico",
          "Papel que trocou de código mantém todo o histórico",
        ],
        visual: (
          <Painel titulo="Carteira de Ações">
            <LinhasIlustrativas
              serieA={[0, 2.1, 0.8, 3.6, 5.2, 3.9, 6.8, 8.1, 6.9, 9.4, 11.2, 12.6]}
              serieB={[0, 1.4, -0.6, 1.9, 3.1, 1.8, 4.2, 5.0, 3.6, 5.9, 7.4, 8.1]}
              legendaA="Ações"
              legendaB="Ibovespa"
            />
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Moedas ---------- */

export const RecursoMoedas = () => (
  <RecursoPage
    rotulo="Moedas"
    titulo={
      <>
        Dólar e euro <span className="text-[#0a5eb8]">pela cotação oficial</span>.
      </>
    }
    subtitulo="Registre a moeda estrangeira que você comprou e acompanhe o valor em reais todos os dias, ao lado do resto dos seus investimentos."
    destaques={[
      {
        icon: DollarSign,
        titulo: "Dólar",
        texto: "Saldo em dólares convertido pela cotação de venda divulgada pelo Banco Central.",
      },
      {
        icon: Euro,
        titulo: "Euro",
        texto: "O mesmo tratamento para o saldo em euros, com a série oficial do Banco Central.",
      },
      {
        icon: Scale,
        titulo: "Variação cambial",
        texto: "O resultado é só a variação da moeda: saldo parado em moeda não rende juros.",
      },
    ]}
    secoes={[
      {
        titulo: "Compra e venda de moeda",
        texto:
          "Informe quanto você comprou na moeda e quanto pagou em reais. As vendas reduzem o saldo como resgates.",
        itens: [
          "Quantidade na moeda e valor em reais de cada operação",
          "Saldo por instituição",
          "Vendas parciais e totais",
        ],
        visual: (
          <Painel titulo="Cadastrar Transação">
            <FormularioIlustrativo
              campos={[
                ["Categoria", "Moedas"],
                ["Moeda", "Dólar"],
                ["Tipo", "Compra"],
                ["Data", "05/05/2025"],
                ["Quantidade", "US$ 3.500,00"],
                ["Valor pago", "R$ 19.880,00"],
              ]}
              botao="Cadastrar"
            />
          </Painel>
        ),
      },
      {
        titulo: "O seu patrimônio em reais, todo dia",
        texto:
          "O saldo em moeda é multiplicado pela cotação do dia. A lâmina de Moedas usa o mesmo gráfico e a mesma tabela das outras categorias.",
        itens: [
          "Saldo em moeda e em reais",
          "Variação cambial no mês e no acumulado",
          "Entra na carteira consolidada com as demais categorias",
        ],
        visual: (
          <Painel titulo="Moedas">
            <TabelaIlustrativa
              cabecalho={["Moeda", "Saldo", "Em reais", "No ano"]}
              linhas={[
                ["Dólar", "US$ 3.500,00", "R$ 18.725,00", "6,2%"],
                ["Euro", "€ 1.200,00", "R$ 7.044,00", "4,9%"],
              ]}
            />
            <div className="mt-5">
              <LinhasIlustrativas
                serieA={[0, 1.2, -0.4, 0.9, 2.3, 1.6, 3.1, 4.0, 3.2, 4.8, 5.5, 6.2]}
                serieB={CDI_12M}
                legendaA="Dólar"
                legendaB="CDI"
              />
            </div>
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Analise da Carteira ---------- */

export const RecursoAnalise = () => (
  <RecursoPage
    rotulo="Análise da Carteira"
    titulo={
      <>
        Tudo o que você investe, <span className="text-[#0a5eb8]">numa só visão</span>.
      </>
    }
    subtitulo="Renda fixa, fundos, ações e moedas consolidados, com a rentabilidade medida do jeito certo e o histórico completo de cada movimento."
    destaques={[
      {
        icon: Gauge,
        titulo: "Rentabilidade real",
        texto: "Medida pelo método que neutraliza aportes e resgates, o padrão do mercado.",
      },
      {
        icon: Layers,
        titulo: "Vários portfólios",
        texto: "Até 10 portfólios separados na mesma conta: o seu, o da família, o da aposentadoria.",
      },
      {
        icon: History,
        titulo: "Qualquer data",
        texto: "Escolha a data de referência e veja a carteira como ela estava naquele dia.",
      },
      {
        icon: Coins,
        titulo: "Eventos",
        texto: "Proventos, juros e vencimentos num só lugar, com a distribuição dos últimos 12 meses.",
      },
    ]}
    secoes={[
      {
        titulo: "Carteira de Investimentos",
        texto:
          "O painel principal soma todas as categorias e mostra quanto a carteira rendeu, mês a mês e no acumulado, contra o CDI e o Ibovespa.",
        itens: [
          "Patrimônio, ganho e rentabilidade consolidados",
          "Gráfico de patrimônio e de rentabilidade",
          "Rentabilidade em % do CDI",
        ],
        visual: (
          <Painel titulo="Carteira de Investimentos">
            <KpisIlustrativos
              itens={[
                ["Patrimônio", "R$ 245.870,15"],
                ["Ganho no ano", "R$ 21.432,80"],
                ["% do CDI", "109,4%"],
              ]}
            />
            <div className="mt-4">
              <LinhasIlustrativas
                serieA={[0, 1.1, 1.8, 3.2, 4.1, 4.9, 6.3, 7.0, 8.4, 9.5, 10.2, 11.7]}
                serieB={CDI_12M}
                legendaA="Carteira"
                legendaB="CDI"
              />
            </div>
          </Painel>
        ),
      },
      {
        titulo: "Mês a mês, ano a ano",
        texto:
          "A tabela de rentabilidade mostra cada mês com o patrimônio, o ganho, a rentabilidade da carteira, o CDI e o percentual do CDI.",
        itens: [
          "Histórico desde a primeira aplicação",
          "Mês com aporte grande não distorce a rentabilidade",
          "Mesma tabela em cada categoria",
        ],
        visual: (
          <Painel titulo="Rentabilidade mensal">
            <TabelaIlustrativa
              cabecalho={["", "Jul", "Ago", "Set", "Out", "Ano"]}
              linhas={[
                ["Carteira", "1,12%", "0,96%", "1,21%", "1,05%", "9,84%"],
                ["CDI", "1,07%", "1,16%", "1,09%", "1,14%", "9,02%"],
                ["% do CDI", "104,7%", "82,8%", "111,0%", "92,1%", "109,1%"],
                ["Ganho", "R$ 2.611", "R$ 2.268", "R$ 2.881", "R$ 2.531", "R$ 21.433"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Alocação com rentabilidade por grupo",
        texto:
          "Veja quanto do patrimônio está em cada categoria e em cada instituição, e quanto cada grupo rendeu no período em que teve posição.",
        itens: [
          "Por categoria: Renda Fixa, Fundos, Ações e Moedas",
          "Por instituição financeira",
          "Cada grupo comparado com o CDI do próprio período",
        ],
        visual: (
          <Painel titulo="Alocação por categoria">
            <div className="space-y-3">
              {[
                ["Renda Fixa", 39, "R$ 97.588,64", "11,2%"],
                ["Fundos", 39, "R$ 96.735,05", "10,1%"],
                ["Ações", 18, "R$ 46.265,50", "8,6%"],
                ["Moedas", 4, "R$ 25.769,00", "5,8%"],
              ].map(([nome, pct, valor, rent]) => (
                <div key={nome as string}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-[#0a2540]">{nome}</span>
                    <span className="tabular-nums text-[#4a6580]">
                      {valor} · {rent}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#eef2f6]">
                    <div className="h-2 rounded-full bg-[#0a5eb8]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Painel>
        ),
      },
      {
        titulo: "Posição consolidada e movimentações",
        texto:
          "Cada ativo com a instituição onde ele está, o detalhe de qualquer posição e o extrato de todas as operações que você registrou.",
        itens: [
          "Posição por ativo e instituição, com saldo e rentabilidade",
          "Extrato de movimentações com edição e exclusão",
          "Cadastro de operações direto do menu, em qualquer tela",
        ],
        visual: (
          <Painel titulo="Posição Consolidada">
            <TabelaIlustrativa
              cabecalho={["Ativo", "Instituição", "Saldo", "% Cart."]}
              linhas={[
                ["CDB 102% CDI", "Banco A", "R$ 25.418,30", "10,3%"],
                ["Fundo DI", "Corretora B", "R$ 42.310,08", "17,2%"],
                ["PETR4", "Corretora B", "R$ 15.124,00", "6,2%"],
                ["Dólar", "Banco C", "R$ 18.725,00", "7,6%"],
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Eventos da carteira",
        texto:
          "Tudo o que a carteira pagou ou vai pagar: proventos de ações, juros e vencimentos de renda fixa, organizados por data.",
        itens: [
          "Distribuição recebida nos últimos 12 meses",
          "Próximos vencimentos de renda fixa",
          "Histórico completo de eventos",
        ],
        visual: (
          <Painel titulo="Eventos">
            <TabelaIlustrativa
              cabecalho={["Data", "Evento", "Ativo", "Valor"]}
              linhas={[
                ["15/10", "Dividendos", "PETR4", "R$ 412,00"],
                ["30/09", "JCP", "ITUB4", "R$ 96,30"],
                ["02/09", "Vencimento", "LCA 94% CDI", "R$ 18.204,77"],
              ]}
            />
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Metodologia ---------- */

export const RecursoMetodologia = () => (
  <RecursoPage
    rotulo="Metodologia"
    titulo={
      <>
        Como a Blueberg <span className="text-[#0a5eb8]">calcula cada número</span>.
      </>
    }
    subtitulo="As regras de cálculo que estão por trás da sua carteira, sem caixa-preta. São as convenções do mercado financeiro brasileiro, aplicadas dia a dia, ativo por ativo."
    destaques={[
      {
        icon: Sigma,
        titulo: "Ponderada pelo tempo",
        texto: "Aportes e resgates não distorcem a rentabilidade. É o método dos fundos e dos gestores.",
      },
      {
        icon: CalendarDays,
        titulo: "Dias úteis",
        texto: "Juros contados em base 252 dias úteis, com o calendário de feriados de cada ano.",
      },
      {
        icon: Database,
        titulo: "Fontes oficiais",
        texto: "Banco Central, CVM, ANBIMA e B3: o dado vem de quem publica, sem intermediário.",
      },
      {
        icon: Wallet,
        titulo: "Valores brutos",
        texto: "Os saldos não descontam Imposto de Renda. A tributação de cada um é diferente e fica à parte.",
      },
    ]}
    secoes={[
      {
        titulo: "Rentabilidade ponderada pelo tempo",
        texto:
          "Dividir o ganho pelo total investido engana quando há aporte no meio do caminho. Por isso a Blueberg mede a carteira como se ela fosse uma cota: cada período rende sobre o que estava aplicado nele, e os períodos se multiplicam.",
        itens: [
          "Você aplica R$ 10.000 e a carteira sobe 10%: R$ 11.000",
          "Depois aporta R$ 89.000 e, no período seguinte, a carteira fica parada",
          "Ganho sobre investido: R$ 1.000 / R$ 99.000 = 1,01%",
          "Ponderada pelo tempo: 1,10 × 1,00 − 1 = 10%. É o que a sua gestão rendeu",
        ],
        visual: (
          <FormulaCard
            linhas={["R = (1 + r₁) × (1 + r₂) × … × (1 + rₙ) − 1", "rₜ = ganho do dia / saldo do início do dia"]}
            legenda={[
              ["R", "rentabilidade do período"],
              ["rₜ", "rentabilidade de cada dia, já sem o efeito do aporte ou do resgate"],
            ]}
          />
        ),
      },
      {
        titulo: "Percentual do CDI",
        texto:
          "O CDI de comparação é acumulado só nos dias em que o ativo teve posição. Segue a convenção de mercado: o produto começa a render no dia útil seguinte à aplicação, e o CDI de comparação conta desde o próprio dia da aplicação.",
        itens: [
          "% do CDI = rentabilidade do ativo / CDI acumulado no mesmo período",
          "Por isso um título a 101% do CDI aparece com um pouco menos de 101%",
          "Dia sem CDI divulgado: o produto rende pela taxa anterior, o CDI espera a divulgação",
        ],
        visual: (
          <FormulaCard
            linhas={["% do CDI = R_ativo / R_CDI", "R_CDI = ∏ (1 + CDI_d) − 1"]}
            legenda={[
              ["R_ativo", "rentabilidade ponderada pelo tempo do ativo"],
              ["CDI_d", "taxa diária do CDI divulgada pelo Banco Central"],
            ]}
          />
        ),
      },
      {
        titulo: "Renda fixa: um fator por dia útil",
        texto:
          "Títulos de renda fixa são marcados na curva: o saldo de hoje é o valor aplicado corrigido pelo fator de cada dia útil desde a aplicação, até o vencimento.",
        itens: [
          "Prefixado: a taxa anual convertida para dias úteis",
          "Pós-fixado: o percentual contratado aplicado ao CDI de cada dia",
          "CDI mais taxa: o CDI do dia combinado com a taxa diária",
          "IPCA mais taxa: inflação oficial e, enquanto o índice do mês não sai, a projeção da ANBIMA",
        ],
        visual: (
          <FormulaCard
            linhas={[
              "Pré    VB = P × (1 + i)^(du/252)",
              "% CDI  VB = P × ∏ (1 + p × CDI_d)",
              "CDI+   VB = P × ∏ (1 + CDI_d) × (1 + s)^(1/252)",
            ]}
            legenda={[
              ["P", "valor aplicado"],
              ["i", "taxa anual prefixada · du: dias úteis decorridos"],
              ["p", "percentual do CDI contratado · s: taxa anual sobre o CDI"],
            ]}
          />
        ),
      },
      {
        titulo: "Fundos, ações e moedas: quantidade × preço",
        texto:
          "Nesses ativos a posição é uma quantidade multiplicada por um preço de mercado. Muda a fonte do preço e o que mexe na quantidade.",
        itens: [
          "Fundos: cota oficial da CVM, já líquida das taxas do fundo; o come-cotas reduz a quantidade de cotas",
          "Ações: preço da B3; proventos somados de volta na data-ex para a rentabilidade, e o custo é o preço pago",
          "Desdobramentos e grupamentos: a quantidade é expressa em ações de hoje, então o valor nunca salta",
          "Moedas: saldo na moeda vezes a cotação de venda do Banco Central",
        ],
        visual: (
          <FormulaCard
            linhas={["Saldo = Q × Preço_d", "Q = valor aplicado / preço do dia da operação"]}
            legenda={[
              ["Q", "quantidade de cotas, ações ou unidades da moeda"],
              ["Preço_d", "cota do fundo, fechamento da ação ou cotação da moeda no dia"],
            ]}
          />
        ),
      },
      {
        titulo: "Cada ativo no seu período, dado provisório marcado",
        texto:
          "Cada ativo é calculado até o último dado válido dele: um fundo até a última cota divulgada, uma ação até o preço mais recente. O CDI de comparação para na mesma data.",
        itens: [
          "Enquanto a fonte não divulga o dia, repete-se o último valor como provisório",
          "Quando o dado oficial sai, ele substitui o provisório automaticamente",
          "A carteira consolidada vai até o ativo mais atualizado",
        ],
        visual: (
          <Painel titulo="Fontes de dados" ilustrativo={false}>
            <TabelaIlustrativa
              cabecalho={["Dado", "Fonte", "Atualização"]}
              linhas={[
                ["CDI e câmbio", "Banco Central", "Diária"],
                ["Cotas de fundos", "CVM", "Diária"],
                ["Projeção do IPCA", "ANBIMA", "Diária"],
                ["Ações e Ibovespa", "B3", "Durante o pregão"],
              ]}
            />
          </Painel>
        ),
      },
    ]}
  />
);
