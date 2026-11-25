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
} from "lucide-react";
import RecursoPage, { Painel, TabelaIlustrativa, LinhasIlustrativas } from "@/components/landing/RecursoPage";

/*
 * Paginas de recursos do institucional (Daniel, 25/11/2026). So o modulo de Investimentos: o Caixa
 * esta em standby. Cada afirmacao aqui tem que existir no app para o usuario comum - Tesouro Direto
 * (tela vazia) e cupom periodico em renda fixa (so admin) ficam de fora de proposito.
 */

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
        texto: "A valorização segue os dias úteis do mercado, com feriados nacionais, como fazem os bancos.",
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
        titulo: "Do cadastro ao vencimento",
        texto:
          "Você informa a data da aplicação, o valor, a taxa e o vencimento. A partir daí a Blueberg calcula sozinha a evolução do título até o último dia.",
        itens: [
          "Aplicações, resgates parciais e resgate total",
          "Saldo bruto atualizado pelo índice de cada dia",
          "Ganho acumulado e no mês, título a título",
          "Títulos vencidos saem da posição e ficam no histórico",
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
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Comparação justa com o CDI",
        texto:
          "Cada título é comparado com o CDI do mesmo período em que você esteve aplicado. Assim fica claro quem está entregando o prometido.",
        itens: [
          "Rentabilidade em percentual e em % do CDI",
          "Período do título: da primeira aplicação ao último dado divulgado",
          "Carteira de Renda Fixa consolidada, com gráfico de patrimônio",
        ],
        visual: (
          <Painel titulo="Carteira de Renda Fixa">
            <LinhasIlustrativas
              serieA={[0, 0.9, 1.9, 2.8, 3.9, 4.8, 5.9, 6.9, 7.8, 8.9, 10.0, 11.1]}
              serieB={[0, 0.85, 1.7, 2.6, 3.5, 4.4, 5.3, 6.2, 7.1, 8.0, 8.9, 9.8]}
              legendaA="Renda Fixa"
              legendaB="CDI"
            />
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
        titulo: "Aplicações, resgates e come-cotas",
        texto:
          "Lance as movimentações com a data e o valor. A quantidade de cotas é calculada pela cota do dia de cotização, e o come-cotas entra como uma saída de cotas.",
        itens: [
          "Saldo em cotas e em reais a cada dia",
          "Ganho no mês e acumulado por fundo",
          "Comparação com o CDI no período do fundo",
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
              ]}
            />
          </Painel>
        ),
      },
      {
        titulo: "Dado público, sem digitação",
        texto:
          "Você não precisa copiar cota de extrato. A Blueberg busca a informação na fonte oficial e mantém a série, para qualquer data que você quiser consultar.",
        itens: [
          "Série histórica de cotas",
          "Último dia divulgado indicado na tela",
          "O mesmo fundo em instituições diferentes, separado por custódia",
        ],
        visual: (
          <Painel titulo="Histórico da cota">
            <LinhasIlustrativas
              serieA={[100, 100.8, 101.9, 102.6, 103.9, 104.7, 105.8, 106.5, 107.9, 108.8, 109.6, 110.4]}
              serieB={[100, 100.85, 101.7, 102.6, 103.5, 104.4, 105.3, 106.2, 107.1, 108.0, 108.9, 109.8]}
              legendaA="Cota do fundo"
              legendaB="CDI"
            />
          </Painel>
        ),
      },
    ]}
  />
);

/* ---------- Acoes e Moedas ---------- */

export const RecursoAcoesMoedas = () => (
  <RecursoPage
    rotulo="Ações e Moedas"
    titulo={
      <>
        Bolsa e câmbio <span className="text-[#0a5eb8]">na mesma carteira</span>.
      </>
    }
    subtitulo="Ações negociadas na B3 e saldos em moeda estrangeira, valorizados com preço de mercado e cotação oficial, ao lado do resto dos seus investimentos."
    destaques={[
      {
        icon: CandlestickChart,
        titulo: "Ações da B3",
        texto: "Busque pelo código do papel e registre compras e vendas com quantidade e preço pago.",
      },
      {
        icon: Receipt,
        titulo: "Proventos",
        texto: "Dividendos, juros sobre capital próprio e rendimentos entram no seu histórico de eventos.",
      },
      {
        icon: Split,
        titulo: "Desdobramentos",
        texto: "Desdobramentos e grupamentos ajustam a quantidade sem distorcer a sua rentabilidade.",
      },
      {
        icon: DollarSign,
        titulo: "Moeda estrangeira",
        texto: "Compras e vendas de moeda valorizadas pela cotação divulgada pelo Banco Central.",
      },
    ]}
    secoes={[
      {
        titulo: "Rentabilidade a partir do preço que você pagou",
        texto:
          "O custo é o preço da sua compra, não o fechamento do dia. A rentabilidade de cada ação começa no que você efetivamente pagou.",
        itens: [
          "Posição por papel, com quantidade e saldo",
          "Ganho no mês e acumulado",
          "Proventos recebidos no histórico de eventos",
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
        titulo: "Câmbio pela cotação oficial",
        texto:
          "Registre a compra de moeda com a quantidade e o valor pago em reais. O saldo é atualizado todo dia pela cotação do Banco Central.",
        itens: [
          "Saldo em moeda e em reais",
          "Variação cambial do período",
          "Lâmina própria de Moedas, com o mesmo gráfico das demais categorias",
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
          "Tabela de rentabilidade mês a mês, ano a ano",
          "Alocação por categoria e por instituição, cada grupo com a sua rentabilidade",
          "Rentabilidade em % do CDI em cada linha",
        ],
        visual: (
          <Painel titulo="Carteira de Investimentos">
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                ["Patrimônio", "R$ 245.870,15"],
                ["Ganho no ano", "R$ 21.432,80"],
                ["% do CDI", "109,4%"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-[#f7f9fc] p-3">
                  <p className="text-[10px] text-[#8da4bf]">{k}</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-[#0a2540]">{v}</p>
                </div>
              ))}
            </div>
            <LinhasIlustrativas
              serieA={[0, 1.1, 1.8, 3.2, 4.1, 4.9, 6.3, 7.0, 8.4, 9.5, 10.2, 11.7]}
              serieB={[0, 0.85, 1.7, 2.6, 3.5, 4.4, 5.3, 6.2, 7.1, 8.0, 8.9, 9.8]}
              legendaA="Carteira"
              legendaB="CDI"
            />
          </Painel>
        ),
      },
      {
        titulo: "Posição consolidada e movimentações",
        texto:
          "Veja cada ativo com a instituição onde ele está, abra o detalhe de qualquer posição e confira o extrato de todas as operações que você registrou.",
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
