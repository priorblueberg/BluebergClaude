# US-001 - Gráfico "Histórico de Rentabilidade" da página de Investimentos

| | |
|---|---|
| **Página** | Carteira de Investimentos (`/carteira`, lâmina Total) |
| **Componente** | `CarteiraVisaoGeral` |
| **Tipo** | Documentação de comportamento existente (as-is) |
| **Status** | Em produção (www.blueberg.com.br) |
| **Última revisão** | 2026-08-25 |

---

## 1. Contexto

A página de Investimentos é a visão consolidada da carteira. O card "Histórico de Rentabilidade"
mostra a curva de retorno acumulado da carteira do usuário contra os benchmarks de mercado, no
mesmo eixo e na mesma base (variação percentual acumulada desde o início da carteira).

O gráfico não tem cálculo próprio. Ele desenha exatamente os números que a aba Renda Fixa usa,
vindos do hook `useCarteiraRF` - a fonte única. Isso é proposital: cópia de cálculo já divergiu
antes neste projeto.

Até 17/08/2026 esse card plotava só CDI e Ibovespa (a linha da carteira nunca era montada) e os
cards ao lado eram mock. Esta US documenta o comportamento depois da correção.

## 2. História

> **Como** investidor pessoa física acompanhando minha carteira,
> **quero** ver a rentabilidade acumulada dos meus investimentos na mesma linha do tempo do CDI e
> do Ibovespa,
> **para** saber se o meu dinheiro está rendendo acima ou abaixo do mercado no período.

## 3. Escopo

**Dentro:** as três séries do card, a janela de datas, os controles de ligar/desligar série,
tooltip, eixos e estados vazios.

**Fora:** o gráfico de Patrimônio (card ao lado), os cards de resumo, as tabelas de rentabilidade
e alocação, e o motor de cálculo de cada título (documentado em `Blueberg_Regras_de_Negocio.md`,
seções 6 e 8).

## 4. Onde vive no código

| Arquivo | Papel |
|---|---|
| `src/pages/AppPages.tsx` | `AVAILABLE_SERIES`, `chartData`, render do `LineChart`, chips de série |
| `src/hooks/useCarteiraRF.ts` | Carrega custódia, calendário, CDI, Ibovespa e roda os motores |
| `src/lib/carteiraRendaFixaEngine.ts` | Consolida os títulos e produz a rentabilidade acumulada |
| `src/lib/cdiCalculations.ts` | `buildCdiSeries` - a curva do CDI |
| `src/lib/syncEngine.ts` | Grava `controle_de_carteiras.data_calculo`, que fecha a janela |

## 5. Regras de negócio

### Janela do gráfico

- **RN-01.** A janela é `data_inicio` a `data_calculo` da carteira **Investimentos**
  (`controle_de_carteiras`). `data_inicio` é a aplicação mais antiga; `data_calculo` é o menor
  valor entre a data de referência escolhida no topo da tela e a data de encerramento da posição.
  O período aparece escrito abaixo do título da página ("Período de Análise: de X a Y").
- **RN-02.** Mudar a data de referência só reflete no gráfico depois de **aplicar** a data. O
  recálculo inteiro é refeito e o resultado fica em cache até a próxima aplicação.
- **RN-03.** Carteira com status "Não Iniciada" (data de referência anterior à primeira aplicação)
  não renderiza o gráfico - a tela mostra só a mensagem de status.

### Série "Investimentos" (a carteira)

- **RN-04.** É rentabilidade **time-weighted**, não ganho sobre capital. O motor consolida todos
  os títulos dia a dia e encadeia: `acumulada = (1 + acumulada_anterior) x (1 + diária) - 1`.
- **RN-05.** A rentabilidade diária é `ganho do dia / (líquido do dia anterior + aplicações do dia)`.
  Aportes e resgates entram na base do dia, então **entrada e saída de dinheiro não distorcem a
  curva** - é isso que a torna comparável com o CDI.
- **RN-06.** Dias sem posição (líquido zerado) não viram ponto da série. Antes da primeira
  aplicação e depois do encerramento total a linha simplesmente não existe.
- **RN-07.** O valor plotado é a rentabilidade acumulada em % com 4 casas de precisão interna; a
  exibição no tooltip é com 2 casas.
- **RN-08.** Hoje a série cobre Renda Fixa e Poupança. Categorias sem motor de cálculo entram no
  patrimônio e nas tabelas de alocação, mas **não** na curva de rentabilidade.

### Série "CDI"

- **RN-09.** Parte de um ponto zero no dia anterior ao início da carteira e acumula, a cada dia
  útil, o fator `(1 + taxa_anual/100) ^ (1/252) - 1`, com a taxa de `historico_cdi`.
- **RN-10.** Dia não útil não acumula fator, mas gera ponto no gráfico (a curva anda de patamar).
- **RN-11.** O CDI corre desde o primeiro dia da janela, enquanto o produto começa a render no dia
  seguinte à aplicação. É a convenção de mercado adotada na plataforma (produto em D+1, benchmark
  em D0) e explica a diferença de um dia entre as duas curvas no começo da série.

### Série "Ibovespa"

- **RN-12.** É rebaseada na carteira: o primeiro pregão dentro da janela vale 0%, e cada dia
  seguinte é `(pontos do dia / pontos da base - 1) x 100`. Não é a variação do índice no ano.
- **RN-13.** A série só tem pontos em pregão. Em dias sem pregão a linha é interpolada
  (`connectNulls`), não quebra.

### Montagem e leitura do gráfico

- **RN-14.** As três séries são unidas por data em um único eixo X, ordenado por data crescente.
  O rótulo do eixo é dd/mm/aaaa e, por espaço, só primeiro e último são garantidos.
- **RN-15.** Eixo Y em % (variação acumulada). O tooltip mostra as séries ligadas naquele ponto,
  cada uma com 2 casas decimais e a cor da linha.
- **RN-16.** A linha da carteira é sólida e mais grossa (azul); os benchmarks são tracejados e
  finos (CDI cinza, Ibovespa laranja). A hierarquia visual é intencional: o dado do usuário é o
  protagonista, o mercado é referência.

### Interação

- **RN-17.** Cada série tem um chip de liga/desliga acima do gráfico. O padrão ao abrir a página é
  **Investimentos + CDI ligados, Ibovespa desligado**.
- **RN-18.** A escolha vale só enquanto a página está aberta - não é preferência persistida.
- **RN-19.** É permitido desligar todas as séries; o gráfico fica com os eixos e sem linha.

### Desempenho

- **RN-20.** O cálculo roda uma vez por data de referência aplicada e é compartilhado entre a
  página de Investimentos e a aba Renda Fixa (cache de módulo em `useCarteiraRF`). Navegar entre
  as duas não recalcula.

## 6. Critérios de aceite

```gherkin
Cenário: Curva da carteira contra o CDI
  Dado que tenho posição em Renda Fixa desde 03/01/2024
  E a data de referência aplicada é 20/08/2026
  Quando abro a página de Investimentos
  Então vejo o card "Histórico de Rentabilidade" com as séries Investimentos e CDI
  E o último ponto da série Investimentos é igual ao card "Rentabilidade"
  E o último ponto da série CDI é igual ao card "CDI Acumulado"

Cenário: Mesmos números da aba Renda Fixa
  Dado que Renda Fixa é a única categoria com motor de cálculo
  Quando comparo o gráfico da página de Investimentos com o da aba Renda Fixa
  Então as curvas são idênticas ponto a ponto

Cenário: Ligar o Ibovespa
  Dado que o chip Ibovespa está desligado
  Quando clico nele
  Então a série entra tracejada em laranja
  E o primeiro pregão da janela vale 0%

Cenário: Aporte no meio do período
  Dado que fiz um aporte relevante durante o período de análise
  Quando olho a curva no dia do aporte
  Então não há degrau de rentabilidade causado pela entrada de dinheiro
  E o gráfico de Patrimônio ao lado mostra o degrau

Cenário: Carteira ainda não iniciada
  Dado que a data de referência é anterior à minha primeira aplicação
  Quando abro a página
  Então não vejo o gráfico
  E vejo a mensagem com a data de início dos meus investimentos

Cenário: Data de referência ainda não aplicada
  Dado que troquei a data no seletor do topo sem aplicar
  Então o gráfico continua mostrando a janela anterior
```

## 7. Pontos de atenção

1. **Duas fontes de janela no mesmo bloco.** A rentabilidade usa `data_calculo` da carteira
   *Investimentos*; a série de patrimônio ao lado corta pela data de referência da tela. Hoje as
   duas coincidem, porque `data_calculo` é derivado da própria data de referência. Se entrar
   categoria sem motor, ou posição encerrada em data diferente, os dois gráficos podem terminar em
   dias distintos.
2. **Rentabilidade só de quem tem motor.** Enquanto Renda Variável e Fundos não tiverem motor, a
   curva descreve uma parte da carteira e os cards descrevem outra (o patrimônio inclui tudo).
   Vale avaliar um aviso na tela quando existir categoria fora do cálculo.
3. **Eixo X com muitos pontos.** A série é diária desde o início da carteira; em séries longas os
   rótulos ficam ilegíveis. Não há filtro de período (12m, YTD, tudo) - candidato natural a
   próxima US.
4. **Defasagem do benchmark.** O CDI vai até o último dia publicado pelo BCB (D+1). Em dia de
   publicação atrasada, a última data da janela pode ficar sem ponto de CDI.

## 8. Referências

- `docs/Blueberg_Regras_de_Negocio.md`, seções 6 (motor de Renda Fixa) e 8 (motor de carteira).
- Commits `0131d32` e `21914d9` - dashboard com dados reais e criação da série da carteira.
- Commit `eb7b114` - rentabilidade congela quando a posição é encerrada.
