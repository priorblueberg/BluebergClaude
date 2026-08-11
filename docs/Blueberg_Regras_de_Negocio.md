# Blueberg — Documento Completo de Regras de Negócio

**Versão:** 1.0  
**Data:** Abril 2026  
**Plataforma:** Blueberg — Gerenciador de Investimentos

---

## Sumário

1. [Visão Geral da Plataforma](#1-visão-geral-da-plataforma)
2. [Autenticação e Onboarding](#2-autenticação-e-onboarding)
3. [Layout e Navegação](#3-layout-e-navegação)
4. [Cadastro de Transações](#4-cadastro-de-transações)
5. [Motor de Sincronização (syncEngine)](#5-motor-de-sincronização-syncengine)
6. [Motor de Cálculo — Renda Fixa](#6-motor-de-cálculo--renda-fixa)
7. [Motor de Cálculo — Poupança](#7-motor-de-cálculo--poupança)
8. [Motor de Carteira de Renda Fixa](#8-motor-de-carteira-de-renda-fixa)
9. [Página: Carteira de Renda Fixa](#9-página-carteira-de-renda-fixa)
10. [Página: Posição Consolidada](#10-página-posição-consolidada)
11. [Página: Movimentações](#11-página-movimentações)
12. [Página: Proventos Recebidos](#12-página-proventos-recebidos)
13. [Página: Custódia (Admin)](#13-página-custódia-admin)
14. [Página: Controle de Carteiras (Admin)](#14-página-controle-de-carteiras-admin)
15. [Página: Configurações](#15-página-configurações)
16. [Análise Individual de Ativos](#16-análise-individual-de-ativos)
17. [Calculadora (Admin)](#17-calculadora-admin)
18. [Regras Especiais e Restrições](#18-regras-especiais-e-restrições)

---

## 1. Visão Geral da Plataforma

### 1.1 O que é a Blueberg

A Blueberg é uma plataforma web de gestão de investimentos pessoais com foco em **acompanhamento diário** de rentabilidade. Diferente de agregadores de mercado, a Blueberg realiza cálculos próprios de rentabilidade utilizando motores de cálculo internos baseados em metodologia TWR (Time-Weighted Return).

### 1.2 Público-alvo

Investidores pessoa física que desejam acompanhar, de forma detalhada e precisa, a evolução diária de seus investimentos em Renda Fixa e Poupança.

### 1.3 Stack Tecnológica

| Componente | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 |
| Estilização | Tailwind CSS v3 + shadcn/ui |
| Backend | Lovable Cloud (Supabase) |
| Banco de Dados | PostgreSQL |
| Autenticação | Supabase Auth (email/senha) |
| Deploy | Lovable Cloud |

### 1.4 Categorias de Investimento Suportadas

| Categoria | Status |
|---|---|
| Renda Fixa | ✅ Implementado |
| Poupança | ✅ Implementado |
| Renda Variável | ❌ Não implementado |
| Fundos | ❌ Não implementado |

---

## 2. Autenticação e Onboarding

### 2.1 Modelo de Acesso

O acesso à plataforma é **controlado por administrador**. Não há cadastro público livre — o admin deve pré-registrar o email do usuário.

**Fluxo de autenticação:**

1. Usuário acessa a Landing Page
2. Clica em "Login" ou "Cadastre-se"
3. Na tela de login:
   - Se o email existe no sistema → permite login com email/senha
   - Se o email não existe → função RPC `check_email_exists` bloqueia o acesso
4. Após autenticação bem-sucedida, verifica existência de perfil na tabela `profiles`
5. Se não existe perfil → redireciona para Onboarding

### 2.2 Onboarding

O onboarding coleta informações obrigatórias do usuário:

| Campo | Obrigatório | Formato |
|---|---|---|
| Nome Completo | Sim | Texto livre |
| Data de Nascimento | Sim | dd/MM/yyyy |

Após preenchimento, cria registro na tabela `profiles` com:
- `user_id`: UUID do auth.users
- `nome_completo`: nome informado
- `data_nascimento`: data informada
- `email`: email do auth.users

### 2.3 Rotas Protegidas

Todas as rotas internas (`/carteira/*`, `/posicao-consolidada`, `/movimentacoes`, etc.) são protegidas:
- Sem autenticação → redireciona para `/auth`
- Autenticado sem perfil → redireciona para `/onboarding`
- Autenticado com perfil → acesso liberado

### 2.4 Controle de Admin

O sistema identifica o administrador por email hardcoded:
```
ADMIN_EMAIL = "daniel.prior.soares@gmail.com"
```

Funcionalidades exclusivas do admin:
- Páginas: Custódia, Controle de Carteiras, Admin, Calculadora
- Botão "Reprocessar" no header
- Edição/exclusão de movimentações automáticas

---

## 3. Layout e Navegação

### 3.1 Estrutura Geral

A aplicação possui três áreas principais:

```
┌──────────┬──────────────────────────────────┐
│          │         Header (AppHeader)       │
│ Sidebar  ├──────────────────────────────────┤
│ (App     │         SubTabs (se /carteira)   │
│ Sidebar) ├──────────────────────────────────┤
│          │                                  │
│          │         Conteúdo Principal       │
│          │         (Outlet / Páginas)       │
│          │                                  │
└──────────┴──────────────────────────────────┘
```

### 3.2 Sidebar (AppSidebar)

A sidebar é colapsável com duas larguras:
- **Expandida:** 220px (exibe ícone + texto)
- **Colapsada:** 56px (exibe apenas ícone)

**Itens de navegação:**

| Item | Rota | Visível para |
|---|---|---|
| Carteira de Investimentos | `/carteira/renda-fixa` | Todos |
| Posição Consolidada | `/posicao-consolidada` | Todos |
| Movimentações | `/movimentacoes` | Todos |
| Custódia | `/custodia` | Admin |
| Controle de Carteiras | `/controle-carteiras` | Admin |
| Proventos Recebidos | `/proventos` | Todos |
| Configurações | `/configuracoes` | Todos |
| Admin | `/admin` | Admin |
| Calculadora | `/calculadora` | Admin |

### 3.3 Header (AppHeader)

O header contém:

| Elemento | Descrição |
|---|---|
| Email do usuário | Dropdown com opção de logout |
| Botão "+ Cadastrar Transação" | Abre a página de cadastro de transação |
| Seletor "Posição em:" | Data de referência com calendário |
| Botão "Aplicar" | Aplica a data de referência selecionada |
| Botão "Reprocessar" (admin) | Recalcula TODAS as custódias e carteiras |
| Ícone de notificações | Indica se há processos pendentes |

### 3.4 Data de Referência

A Data de Referência é um conceito central da plataforma:

- **Valor padrão:** D-1 (ontem)
- **Data máxima permitida:** ontem (nunca a data atual)
- **Impacto:** Define até qual data os motores de cálculo processam
- **Contexto global:** Gerenciada pelo `DataReferenciaContext`, disponível para todas as páginas internas
- **Botão Aplicar:** Incrementa `appliedVersion`, disparando recálculo em todas as páginas que observam essa dependência
- **Overlay de recálculo:** Enquanto recalcula, exibe overlay semi-transparente com spinner

### 3.5 SubTabs

Visível apenas dentro de `/carteira/*`. Exibe abas por categoria de investimento:
- Atualmente: apenas "Renda Fixa"
- Preparado para: novas categorias futuras (Renda Variável, Fundos, etc.)

---

## 4. Cadastro de Transações

### 4.1 Pontos de Entrada

Existem dois pontos de entrada para cadastrar transações:

1. **Página dedicada** (`/cadastrar-transacao`): Formulário completo acessado via botão "+ Cadastrar Transação" no header ou pela sidebar
2. **Boleta rápida** (`BoletaCustodiaDialog`): Dialog modal acessado a partir da Posição Consolidada ou Custódia, com campos pré-preenchidos do ativo selecionado

### 4.2 Categorias e Tipos de Movimentação

| Categoria | Tipos de Movimentação |
|---|---|
| Renda Fixa | Aplicação, Resgate |
| Poupança | Aplicação, Resgate |

**Tipos de movimentação internos (gerados automaticamente):**
- `Aplicação Inicial`: primeira aplicação em um código de custódia
- `Aplicação`: aplicações subsequentes
- `Resgate`: resgate parcial
- `Resgate Total`: resgate total (fecha posição)
- `Resgate no Vencimento`: gerado automaticamente pelo motor quando `vencimento < data_referencia`

### 4.3 Fluxo de Aplicação — Renda Fixa

O formulário é **progressivo** (cada campo habilita o próximo):

```
Categoria do Produto *
  └─ Produto * (CDB, LCI, LCA, DPGE, LC, CRI, CRA)
       └─ Instituição *
            └─ Emissor *
                 └─ Modalidade * (Prefixado, Pós Fixado)
                      └─ [Se Pós Fixado] Indexador * (CDI, CDI+)
                           └─ Taxa (% a.a.) *
                                └─ Pagamento * (Mensal, Bimestral, Trimestral, Quadrimestral, Semestral, No Vencimento)
                                     └─ Vencimento *
                                          └─ Data da Aplicação *
                                               └─ Valor (R$) *
                                                    └─ Preço Unitário (R$) *
```

### 4.4 Fluxo de Aplicação — Poupança

Fluxo simplificado:

```
Categoria do Produto * (Poupança)
  └─ Produto (auto-selecionado: "Poupança")
       └─ Banco * (campo único que define Instituição e Emissor)
            └─ Data da Aplicação *
                 └─ Valor (R$) *
```

**Diferenças em relação à Renda Fixa:**
- Sem modalidade, indexador, taxa, pagamento, vencimento ou PU
- O "Banco" mapeia tanto Instituição quanto Emissor
- Data **não precisa** ser dia útil

### 4.5 Fluxo de Resgate

1. Usuário seleciona "Resgate" como tipo de operação
2. Sistema lista ativos com saldo > 0 na data de referência
3. Usuário seleciona o ativo
4. Sistema exibe saldo disponível (calculado pelo motor de cálculo)
5. Opção "Fechar Posição": preenche automaticamente o valor total do saldo
6. Usuário informa data e valor do resgate

**Validações de resgate:**
- Valor não pode exceder saldo disponível
- Data deve ser ≥ data de início do ativo
- Data deve ser dia útil (exceto Poupança)

### 4.6 Regras de Mapeamento Interno

| Entrada do Usuário | Armazenamento Interno |
|---|---|
| Modalidade "Pós Fixado" + Indexador "CDI" | `modalidade: "Pos Fixado"`, `indexador: "CDI"` |
| Modalidade "Pós Fixado" + Indexador "CDI+" | `modalidade: "Mista"`, `indexador: "CDI"` |
| Modalidade "Prefixado" | `modalidade: "Prefixado"`, `indexador: null` |

### 4.7 Nome do Ativo (buildNomeAtivo)

O nome do ativo é construído automaticamente:

**Renda Fixa:**
```
{Produto} {Emissor} {Modalidade} {Taxa}% - {Vencimento dd/MM/yyyy}
```
Exemplo: `CDB Banco Master Prefixado 12% a.a. – 30/12/2025`

**Poupança:**
```
Poupança {Banco}
```
Exemplo: `Poupança Banco Fator`

### 4.8 Código de Custódia

O `codigo_custodia` é um identificador numérico autoincremental que agrupa todas as movimentações de um mesmo ativo:

- **Primeira aplicação** em um ativo: sistema gera novo `codigo_custodia` (MAX + 1)
- **Aplicações subsequentes** no mesmo ativo: reutiliza o `codigo_custodia` existente
- **Tipo de movimentação da primeira aplicação:** sempre `"Aplicação Inicial"`
- **Aplicações seguintes:** tipo `"Aplicação"`

### 4.9 Validações

| Validação | Renda Fixa | Poupança |
|---|---|---|
| Data deve ser dia útil | ✅ Sim | ❌ Não |
| Data não pode ser futura | ✅ Sim | ✅ Sim |
| Valor > 0 | ✅ Sim | ✅ Sim |
| Preço Unitário > 0 | ✅ Sim | N/A |
| Taxa ≥ 0 | ✅ Sim | N/A |
| Campos obrigatórios preenchidos | ✅ Sim | ✅ Sim |

### 4.10 Pós-Salvamento (Sincronização)

Após salvar uma transação, o sistema executa automaticamente a cadeia de sincronização:

```
fullSyncAfterMovimentacao(userId, dataReferencia)
  ├─ syncCustodiaFromMovimentacao()
  ├─ syncResgateNoVencimento()
  ├─ syncManualResgatesTotais()
  ├─ syncPoupancaLotes()
  ├─ syncControleCarteiras()
  └─ syncCarteiraGeral()
```

---

## 5. Motor de Sincronização (syncEngine)

### 5.1 Visão Geral

O `syncEngine.ts` é o orquestrador central que mantém a consistência entre as tabelas `movimentacoes`, `custodia`, `poupanca_lotes` e `controle_de_carteiras`.

### 5.2 syncCustodiaFromMovimentacao

**Função:** Reconstrói/atualiza a tabela `custodia` a partir das movimentações do usuário.

**Regras de negócio:**

1. **Agrupamento:** Agrupa movimentações por `codigo_custodia`
2. **Aplicação Inicial:** Garante que a movimentação com a data mais antiga seja sempre do tipo "Aplicação Inicial"
3. **Valor Investido:** Calcula como soma das aplicações menos soma dos resgates:
   ```
   valor_investido = Σ(aplicações) - Σ(resgates)
   ```
4. **Estratégia derivada:**

   | Modalidade | Indexador | Estratégia |
   |---|---|---|
   | Prefixado | — | Prefixado |
   | Pos Fixado | CDI | Pós Fixado CDI |
   | Mista | CDI | Pós Fixado CDI + Taxa |

5. **Data de Início:** Data da "Aplicação Inicial"
6. **Data de Cálculo:** Data de referência atual
7. **Data Limite:** Vencimento do título ou data do resgate total (o que vier primeiro)
8. **Status:** Derivado da existência de resgate total ou vencimento atingido

### 5.3 syncResgateNoVencimento

**Função:** Cria automaticamente movimentações de "Resgate no Vencimento" quando o vencimento de um título já passou.

**Regras:**
1. Para cada custódia com `vencimento` definido e `vencimento < data_referencia`
2. Se **não existe** movimentação "Resgate no Vencimento" para aquele `codigo_custodia`
3. Executa o motor de cálculo (`rendaFixaEngine`) até a data de vencimento
4. Pega o valor do `liquido` (patrimônio) no último dia
5. Cria movimentação automática com:
   - `tipo_movimentacao: "Resgate no Vencimento"`
   - `valor`: patrimônio calculado no vencimento
   - `data`: data do vencimento
   - `origem: "Auto"`
   - `quantidade`: calculada via motor
   - `preco_unitario`: calculado via motor

### 5.4 syncManualResgatesTotais

**Função:** Recalcula o valor de movimentações "Resgate Total" manuais usando o motor de cálculo.

**Lógica:**
1. Para cada movimentação do tipo "Resgate Total"
2. Executa o motor de cálculo até a data do resgate
3. Atualiza o `valor` da movimentação com o patrimônio calculado

### 5.5 syncPoupancaLotes

**Função:** Reconstrói os lotes de poupança na tabela `poupanca_lotes` a partir das movimentações originais.

**Regras FIFO:**
1. Cada aplicação gera um lote com `valor_principal` = valor aplicado
2. Resgates consomem lotes na ordem FIFO (First In, First Out):
   - O lote mais antigo é consumido primeiro
   - Se o resgate > valor do lote, o lote é totalmente consumido e o residual passa para o próximo
3. Lotes com `valor_principal = 0` são marcados como resgatados (`status: "Resgatado"`)

### 5.6 syncControleCarteiras

**Função:** Atualiza a tabela `controle_de_carteiras` com o resumo por categoria.

**Campos calculados:**
- `data_inicio`: menor data de início entre todas as custódias da categoria
- `data_limite`: maior data limite (vencimento/resgate) entre as custódias
- `data_calculo`: data de referência atual
- `resgate_total`: soma dos resgates totais
- `status`:
  - `"Ativa"`: pelo menos uma custódia com saldo > 0
  - `"Encerrada"`: todas as custódias com saldo = 0
  - `"Não Iniciada"`: sem custódias

### 5.7 syncCarteiraGeral

**Função:** Cria/atualiza a carteira "Investimentos" que consolida TODAS as categorias.

### 5.8 recalculateAllForDataReferencia

**Função:** Botão "Reprocessar" (admin only). Executa o ciclo completo de sincronização para TODAS as custódias do usuário.

**Fluxo:**
1. Seta `isRecalculating = true` (exibe overlay)
2. Executa `fullSyncAfterMovimentacao` completo
3. Seta `isRecalculating = false`

---

## 6. Motor de Cálculo — Renda Fixa

### 6.1 Visão Geral

O `rendaFixaEngine.ts` é o motor de cálculo diário para títulos de renda fixa. Processa dia a dia, do início do título até a data de referência (ou vencimento), calculando rentabilidade, patrimônio e juros.

### 6.2 Sistema de Cota Virtual

O motor utiliza um sistema de **Cota Virtual** com dois níveis para calcular rentabilidade TWR (Time-Weighted Return) de forma precisa, mesmo com aportes e resgates intermediários.

**Dois níveis de cálculo:**

| Nível | Nome | Descrição |
|---|---|---|
| Nível 1 (C-E) | Após resgate | Valores finais do dia, após aplicar resgates |
| Nível 2 (F-H) | Antes do resgate | Valores antes de aplicar resgates |

### 6.3 Colunas Calculadas

| Coluna | ID | Descrição |
|---|---|---|
| Valor da Cota (1) | C | Cota virtual após resgate — base para % rentabilidade |
| Saldo de Cotas (1) | D | Quantidade de cotas após resgate |
| Líquido (1) | E | Patrimônio líquido do dia (valor final) |
| Valor da Cota (2) | F | Cota virtual antes do resgate |
| Saldo de Cotas (2) | G | Quantidade de cotas antes do resgate |
| Líquido (2) | H | Patrimônio antes do resgate |
| Aplicações | I | Valor aplicado no dia |
| QTD Cotas Compra | J | Cotas adquiridas = Aplicações / Valor da Cota anterior |
| Resgate | K | Capital resgatado (exclui juros) |
| QTD Cotas Resgate | L | Cotas consumidas pelo resgate |
| Rentabilidade diária (R$) | M | Ganho em reais no dia |
| R$ Rentabilidade acumulada | N | Soma acumulada dos ganhos diários |
| % Rentabilidade acumulada | O | (Valor Cota atual / Cota Inicial) - 1 |
| Multiplicador | P | Fator de rendimento diário |
| Juros Pago | T | Valor de juros periódicos pagos |
| Cupom Acumulado | S | Soma acumulada de juros pagos |
| Valor Investido | U | Capital líquido aportado |
| Resgate Limpo | V | Capital resgatado (sem juros) |
| Preço Unitário | W | PU do dia |
| QTD Aplicação | X | Aplicações / PU |
| QTD Resgate | Y | Resgates / PU |
| Base Econômica | — | Controle de capital para cálculo de juros |
| Rent. Diária (%) | — | Ganho diário / Líquido |
| Rent. Acumulada (2) | — | Composição diária de rentabilidade |

### 6.4 Modalidades e Fórmulas do Multiplicador

O multiplicador define o rendimento diário do título:

#### Prefixado
```
multiplicador = (1 + taxa/100)^(1/252) - 1
```
O multiplicador é constante para todos os dias úteis.

#### Pós Fixado CDI
```
multiplicador = CDI_diário_anterior × (taxa/100)
```
Onde:
```
CDI_diário = (1 + CDI_anual/100)^(1/252) - 1
```
- Usa o CDI do dia **anterior** (D-1)
- `taxa` é o percentual do CDI (ex: 103% do CDI → taxa = 103)

#### Mista (CDI + Spread)
```
multiplicador = (1 + CDI_diário_anterior) × (1 + taxa/100)^(1/252) - 1
```
- Combina CDI variável com spread fixo
- Exemplo: CDI + 9% a.a. → componente CDI varia diariamente, spread de 9% é fixo

### 6.5 Dias Não Úteis

Em dias não úteis (finais de semana e feriados):
- **Multiplicador = 0** (não há rendimento)
- **Valores mantidos** do dia anterior: Valor da Cota, PU, Líquido
- Aplicações e resgates registrados em dia não útil são processados normalmente

### 6.6 Pagamento de Juros Periódicos

O sistema suporta pagamento de juros (cupons) com as seguintes periodicidades:

| Periodicidade | Meses |
|---|---|
| Mensal | 1 |
| Bimestral | 2 |
| Trimestral | 3 |
| Quadrimestral | 4 |
| Semestral | 6 |
| No Vencimento | — |

**Geração de datas de pagamento:**
1. Parte da data de vencimento
2. Retroage de `N` em `N` meses
3. Usa o mesmo dia do mês do vencimento (ajustado se o mês tem menos dias)
4. Se a data cai em dia não útil, retroage para o dia útil anterior
5. Continua até antes da data de início

**Cálculo do juros pago:**
```
Juros Pago = Apoio Cupom - Base Econômica
```
Onde:
- `Apoio Cupom = Líquido anterior × (1 + multiplicador) + Aplicações`
- `Base Econômica = Σ(Aplicação Ex Cupom) - Σ(Resgate Ex Cupom)`
- `Aplicação Ex Cupom = (Aplicações / PU) × PU Inicial`
- `Resgate Ex Cupom = (Resgates / PU) × PU Inicial`

**Impacto no PU:**
- No dia do pagamento de juros, o PU é **resetado** para o PU inicial
- Isso reflete que o investidor "recebeu" os juros acumulados

### 6.7 Vencimento e Resgate no Vencimento

No dia do vencimento (`isFinalDay`):
- **Resgate automático:** Todo o patrimônio é resgatado
- `resgatesTotal = Líquido anterior × (1 + multiplicador) - Juros Pago`
- `saldoCotas1 = 0` (posição zerada)
- `liquido1 = 0` (patrimônio zerado)

### 6.8 Fórmulas Detalhadas

**Líquido (1) — Patrimônio do dia:**
```
Se data_inicio:
  Líquido(1) = Aplicações

Senão:
  Líquido(1) = Líquido_anterior × (1 + multiplicador) + Aplicações - Resgates - Juros_Pago
```

**Ganho Diário (R$):**
```
Ganho_Diário = Líquido(1) - Líquido_anterior - Aplicações + Resgates + Juros_Pago
```

**% Rentabilidade Acumulada:**
```
Rent_Acum(%) = (Valor_Cota_atual / Cota_Inicial) - 1
```

### 6.9 Parâmetros de Entrada (EngineInput)

| Parâmetro | Descrição |
|---|---|
| `dataInicio` | Data da primeira aplicação |
| `dataCalculo` | Data de referência (até onde calcular) |
| `taxa` | Taxa contratada (% a.a.) |
| `modalidade` | "Prefixado", "Pos Fixado", "Mista" |
| `puInicial` | Preço Unitário inicial |
| `calendario` | Lista de datas com flag dia_util |
| `movimentacoes` | Lista de aplicações e resgates |
| `dataResgateTotal` | Data do resgate total (se houver) |
| `pagamento` | Periodicidade de juros |
| `vencimento` | Data de vencimento do título |
| `indexador` | "CDI" ou null |
| `cdiRecords` | Histórico de CDI diário |
| `dataLimite` | Data máxima de processamento |

---

## 7. Motor de Cálculo — Poupança

### 7.1 Visão Geral

O `poupancaEngine.ts` calcula o rendimento de cadernetas de poupança seguindo as regras oficiais do Banco Central do Brasil.

### 7.2 Regra de Rendimento

A poupança rende exclusivamente no **dia de aniversário** de cada depósito:

| Condição | Rendimento Mensal |
|---|---|
| Selic > 8,5% a.a. | 0,5% a.m. + TR |
| Selic ≤ 8,5% a.a. | 70% da Selic mensal + TR |

### 7.3 Fontes de Dados

O motor utiliza três tabelas de dados históricos:

| Tabela | Descrição | Uso |
|---|---|---|
| `historico_poupanca_rendimento` | BCB Série 195 | Fonte primária de rendimento |
| `historico_selic` | Taxa Selic diária | Fallback para cálculo |
| `historico_tr` | Taxa Referencial mensal | Fallback para cálculo |

**Prioridade:** BCB Série 195 > cálculo via Selic + TR

### 7.4 Sistema de Lotes (FIFO)

Cada depósito na poupança gera um **lote** independente:

```typescript
interface PoupancaLote {
  codigo_custodia: number;
  data_aplicacao: string;      // Data do depósito
  valor_principal: number;     // Valor original depositado
  valor_atual: number;         // Valor atualizado com rendimentos
  dia_aniversario: number;     // Dia do mês em que rende
  rendimento_acumulado: number; // Total de rendimentos desde o início
  status: "Ativo" | "Resgatado";
}
```

**Regras FIFO para resgates:**
1. O lote **mais antigo** é resgatado primeiro
2. Se o resgate é menor que o valor do lote: reduz proporcionalmente
3. Se o resgate é maior que o valor do lote: consome inteiramente e passa ao próximo
4. Lotes com `valor_principal = 0` são marcados como `"Resgatado"`

### 7.5 Dia de Aniversário

| Dia de Depósito | Dia de Aniversário |
|---|---|
| Dias 1 a 28 | Mesmo dia |
| Dia 29 | Dia 1 do mês seguinte |
| Dia 30 | Dia 1 do mês seguinte |
| Dia 31 | Dia 1 do mês seguinte |

### 7.6 Reconstrução de Lotes

Os lotes são **reconstruídos** a cada sincronização a partir das movimentações originais via `buildPoupancaLotesFromMovs()`:

1. Filtra movimentações do tipo "Aplicação Inicial" e "Aplicação"
2. Cada uma gera um lote com o valor original
3. Resgates são aplicados em ordem FIFO
4. Isso evita double-counting em reprocessamentos

### 7.7 Precisão

Todos os cálculos de poupança utilizam **8 casas decimais** para manter consistência com os valores oficiais do BCB.

---

## 8. Motor de Carteira de Renda Fixa

### 8.1 Visão Geral

O `carteiraRendaFixaEngine.ts` consolida todos os produtos de Renda Fixa e Poupança em uma visão de carteira com rentabilidade diária agregada.

### 8.2 Metodologia TWR (Time-Weighted Return)

A rentabilidade da carteira é calculada usando composição diária:

**Rentabilidade Diária (%):**
```
Rent_Diária = Ganho_Diário / (Líquido_anterior + Aplicações_do_dia)
```

**Rentabilidade Acumulada (%):**
```
Rent_Acum = (1 + Rent_Acum_anterior) × (1 + Rent_Diária) - 1
```

### 8.3 Dados de Saída

Para cada dia, a carteira calcula:

| Dado | Descrição |
|---|---|
| Patrimônio | Soma dos Líquidos de todos os ativos |
| Ganho Diário (R$) | Soma dos ganhos diários de todos os ativos |
| Ganho Acumulado (R$) | Soma total de ganhos desde o início |
| Rentabilidade Diária (%) | TWR diária da carteira |
| Rentabilidade Acumulada (%) | TWR acumulada da carteira |
| CDI Acumulado (%) | CDI acumulado no mesmo período (benchmark) |

---

## 9. Página: Carteira de Renda Fixa

### 9.1 Visão Geral

A página principal da plataforma, exibe o panorama completo da carteira de Renda Fixa incluindo Poupança.

**Rota:** `/carteira/renda-fixa`

### 9.2 Cards de Resumo

| Card | Valor Exibido | Cálculo |
|---|---|---|
| Patrimônio | R$ XXX.XXX,XX | Soma dos Líquidos de todos os ativos na data de referência |
| Ganho Financeiro | R$ XXX.XXX,XX | Soma dos ganhos acumulados de todos os ativos |
| Rentabilidade | XX,XX% | TWR acumulada da carteira |
| CDI Acumulado | XX,XX% | CDI acumulado no período |

### 9.3 Gráfico: Histórico de Rentabilidade

- **Tipo:** Gráfico de linha
- **Eixo X:** Tempo (datas)
- **Eixo Y:** Rentabilidade acumulada (%)
- **Séries:**
  - Carteira RF (linha sólida azul)
  - CDI (linha tracejada cinza) — toggle on/off
  - Ibovespa (toggle on/off)
- **Interação:** Tooltip com valores ao passar o mouse

### 9.4 Gráfico: Patrimônio Mensal

- **Tipo:** Gráfico de barras
- **Eixo X:** Meses (JAN/24, FEV/24, etc.)
- **Eixo Y:** Patrimônio em R$
- **Dados:** Patrimônio no último dia útil de cada mês

### 9.5 Tabela de Rentabilidade Mensal

| Coluna | Descrição |
|---|---|
| Mês/Ano | Período |
| Patrimônio | Valor no final do mês |
| Ganho (R$) | Rentabilidade em reais no mês |
| Rentabilidade (%) | TWR do mês |
| CDI (%) | CDI acumulado no mês |
| % CDI | Rentabilidade / CDI × 100 |

### 9.6 Gráficos de Alocação (Pizza)

Quatro gráficos de pizza mostrando a composição da carteira:

1. **Por Produto:** CDB, LCI, LCA, DPGE, LC, Poupança, etc.
2. **Por Estratégia:** Prefixado, Pós Fixado CDI, Pós Fixado CDI + Taxa
3. **Por Instituição:** Bancos custodiantes
4. **Por Emissor:** Emissores dos títulos

### 9.7 Tabela Detalhada por Ativo

Tabela expandível com todos os ativos da carteira:

| Coluna | Descrição |
|---|---|
| Status | Ativa / Liquidado |
| Nome do Ativo | Nome completo construído pelo buildNomeAtivo |
| Patrimônio | Valor atualizado na data de referência |
| Ganho Financeiro | Rentabilidade acumulada em R$ |
| Rentabilidade (%) | TWR acumulada |
| CDI (%) | CDI acumulado no mesmo período |
| % do CDI | Percentual atingido do CDI |

**Toggle:** "Mostrar ativos liquidados" — exibe/oculta ativos já encerrados

**Drill-down:** Ao clicar em um ativo, abre a Análise Individual

---

## 10. Página: Posição Consolidada

### 10.1 Visão Geral

Exibe todos os ativos do usuário em uma tabela única com status e métricas.

**Rota:** `/posicao-consolidada`

### 10.2 Funcionalidades

- **Busca:** Campo de pesquisa por nome do ativo
- **Data de referência:** Exibida como subtítulo
- **Poupança consolidada:** Todas as contas de poupança aparecem como uma linha única

### 10.3 Colunas da Tabela

| Coluna | Descrição |
|---|---|
| Status | Badge: Ativa (verde), Liquidado (azul) |
| Ativo | Nome completo do ativo |
| Valor Atualizado | Patrimônio na data de referência |
| Ganho Financeiro | Rentabilidade em R$ |
| Rentabilidade | TWR acumulada (%) |
| Custodiante | Instituição financeira |
| % do Portfólio | Percentual do patrimônio total |

### 10.4 Ações Disponíveis

| Ação | Descrição |
|---|---|
| + Aplicação | Abre boleta pré-preenchida para nova aplicação |
| Resgate | Abre boleta pré-preenchida para resgate |
| Excluir | Remove a custódia e todas as movimentações associadas |

### 10.5 Diálogo de Detalhes

Ao clicar em uma linha, abre dialog com informações completas:
- Todos os campos da custódia
- Histórico de movimentações do ativo
- Valores calculados pelo motor

---

## 11. Página: Movimentações

### 11.1 Visão Geral

Extrato completo de todas as movimentações registradas no sistema.

**Rota:** `/movimentacoes`

### 11.2 Filtros

| Filtro | Opções |
|---|---|
| Nome do Ativo | Dropdown com todos os ativos |
| Tipo de Movimentação | Todos, Aplicação Inicial, Aplicação, Resgate, Resgate Total, Resgate no Vencimento |

### 11.3 Colunas

| Coluna | Descrição | Ordenável |
|---|---|---|
| Data | Data da movimentação | ✅ |
| Nome do Ativo | Nome construído | ✅ |
| Tipo Mov. | Tipo da movimentação | ✅ |
| Quantidade | Número de títulos/cotas | ✅ |
| Preço Unitário | PU na data | ✅ |
| Valor | Valor monetário | ✅ |

### 11.4 Origem das Movimentações

| Badge | Descrição | Editável | Excluível |
|---|---|---|---|
| Manual | Cadastrada pelo usuário | ✅ Sim | ✅ Sim |
| Auto | Gerada automaticamente pelo motor | ❌ Não | ❌ Não |

**Movimentações automáticas:** "Resgate no Vencimento" gerado pelo `syncResgateNoVencimento`

---

## 12. Página: Proventos Recebidos

### 12.1 Visão Geral

Lista todos os pagamentos de juros e rendimentos recebidos pelo investidor.

**Rota:** `/proventos`

### 12.2 Fontes de Proventos

| Fonte | Tipo | Descrição |
|---|---|---|
| Renda Fixa | Juros Periódicos | Cupons pagos em títulos com pagamento ≠ "No Vencimento" |
| Poupança | Rendimento | Rendimentos creditados a cada aniversário de lote |

### 12.3 Colunas

| Coluna | Descrição | Ordenável |
|---|---|---|
| Data | Data do pagamento | ✅ |
| Nome | Nome do ativo | ✅ |
| Tipo | "Juros Periódicos" ou "Rendimento" | ✅ |
| Valor Recebido | Montante recebido em R$ | ✅ |

---

## 13. Página: Custódia (Admin)

### 13.1 Visão Geral

Visão administrativa da tabela `custodia` com dados brutos.

**Rota:** `/custodia`  
**Acesso:** Apenas admin

### 13.2 Funcionalidades

- Visualização raw de todos os campos da tabela `custodia`
- **Boleta rápida:** Dialog para aplicação ou resgate rápido
- **Exclusão:** Remove custódia e todas as movimentações associadas
- **Campos exibidos:** Código, Nome, Produto, Modalidade, Taxa, Vencimento, PU, Valor Investido, Status, Data Início, Data Limite, Estratégia, Pagamento, Indexador

---

## 14. Página: Controle de Carteiras (Admin)

### 14.1 Visão Geral

Exibe as carteiras criadas automaticamente pelo motor de sincronização.

**Rota:** `/controle-carteiras`  
**Acesso:** Apenas admin

### 14.2 Colunas

| Coluna | Descrição |
|---|---|
| Nome da Carteira | Nome da categoria ou "Investimentos" (geral) |
| Data Início | Menor data de início entre os ativos |
| Data Limite | Maior data limite entre os ativos |
| Resgate Total | Soma dos resgates totais |
| Data Cálculo | Data de referência usada no último cálculo |
| Status | Ativa / Encerrada / Não Iniciada |

---

## 15. Página: Configurações

### 15.1 Visão Geral

Página de configurações do usuário.

**Rota:** `/configuracoes`

### 15.2 Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| Redefinir Movimentações | **AÇÃO DESTRUTIVA:** Apaga todas as custódias, movimentações e carteiras do usuário |

**Aviso:** A ação de redefinição é irreversível. Exige confirmação do usuário.

---

## 16. Análise Individual de Ativos

### 16.1 Visão Geral

Drill-down acessado a partir da tabela de ativos na Carteira de Renda Fixa. Exibe análise detalhada de um ativo específico.

### 16.2 Cards de Resumo

| Card | Descrição |
|---|---|
| Patrimônio | Valor atualizado do ativo |
| Ganho Financeiro | Rentabilidade acumulada em R$ |
| Rentabilidade | TWR acumulada (%) |

### 16.3 Gráfico

- **Tipo:** Gráfico de linha
- **Séries:** Ativo individual vs CDI acumulado
- **Período:** Da data de início até a data de referência

### 16.4 Tabela de Rentabilidade Detalhada

Utiliza o `detailRowsBuilder` para transformar o output do `rendaFixaEngine` em linhas agrupadas por mês:

| Coluna | Descrição |
|---|---|
| Período | Mês/Ano |
| Patrimônio | Valor no final do período |
| Ganho (R$) | Rentabilidade em reais |
| Rentabilidade (%) | TWR do período |
| CDI (%) | CDI no mesmo período |
| % do CDI | Percentual atingido |

---

## 17. Calculadora (Admin)

### 17.1 Visão Geral

Ferramenta administrativa para simular e inspecionar o cálculo completo de um ativo.

**Rota:** `/calculadora`  
**Acesso:** Apenas admin

### 17.2 Funcionalidades

- Seleciona um ativo existente da custódia
- Executa o motor de cálculo (`rendaFixaEngine`)
- Exibe **todas as colunas** do `DailyRow` em tabela completa
- Permite verificar dia a dia o cálculo de cotas, multiplicadores, juros, etc.
- Útil para depuração e validação de regras de negócio

---

## 18. Regras Especiais e Restrições

### 18.1 Poupança vs Renda Fixa

| Aspecto | Renda Fixa | Poupança |
|---|---|---|
| Imposto de Renda | ❌ Não implementado | ❌ Isento |
| IOF | ❌ Não implementado | ❌ Isento |
| Sistema de Cotas | ✅ Cota Virtual | ❌ Não usa |
| Preço Unitário | ✅ Sim | ❌ Não usa |
| Marcação a Mercado | ❌ Não implementado | ❌ N/A |
| Dia Útil obrigatório | ✅ Sim | ❌ Não |
| Motor de cálculo | rendaFixaEngine | poupancaEngine |
| Pagamento de juros | Configurable | Aniversário do lote |

### 18.2 Limites e Restrições

| Restrição | Valor |
|---|---|
| Data de referência máxima | D-1 (ontem) |
| Limite de registros por query | 1000 (Supabase default) |
| Precisão de cálculo — Poupança | 8 casas decimais |
| Precisão de cálculo — Renda Fixa | Ponto flutuante JavaScript |
| Dias úteis por ano (base) | 252 |

### 18.3 Funcionalidades Não Implementadas

| Funcionalidade | Status |
|---|---|
| Tributação (IR/IOF) | Não implementado |
| Marcação a Mercado | Não implementado |
| Renda Variável | Não implementado |
| Fundos de Investimento | Não implementado |
| Importação em lote (CSV/Excel) | Não implementado |
| Multi-moeda | Não implementado |
| Relatórios exportáveis | Não implementado |

### 18.4 Tabelas do Banco de Dados

| Tabela | Descrição |
|---|---|
| `profiles` | Dados do perfil do usuário |
| `custodia` | Posições de custódia (ativos) |
| `movimentacoes` | Todas as transações |
| `poupanca_lotes` | Lotes individuais de poupança |
| `controle_de_carteiras` | Carteiras consolidadas |
| `calendario_dias_uteis` | Calendário de dias úteis |
| `historico_cdi` | Histórico diário da taxa CDI |
| `historico_selic` | Histórico diário da taxa Selic |
| `historico_tr` | Histórico mensal da TR |
| `historico_poupanca_rendimento` | BCB Série 195 — rendimento poupança |
| `historico_ibovespa` | Histórico diário do Ibovespa |
| `categorias` | Categorias de investimento |
| `produtos` | Produtos financeiros |
| `instituicoes` | Instituições financeiras |
| `emissores` | Emissores de títulos |
| `user_settings` | Configurações do usuário |

---

*Documento gerado automaticamente a partir do código-fonte da plataforma Blueberg.*  
*Versão 1.0 — Abril 2026*
