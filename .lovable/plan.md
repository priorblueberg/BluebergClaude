

## Plano: Corrigir status da carteira quando Poupança está ativa

### Problema
A Poupança tem `data_limite = 2040-12-31` (correto), mas `computeResgateTotal` retorna `null` para ela (sem vencimento, sem movimentação de "Resgate Total"). Na lógica de `syncControleCarteiras`, resultados `null` são ignorados (`if (rt) resgateDates.push(rt)`), então o `resgateTotal` da carteira fica como `2025-12-30` (último resgate dos outros ativos). Como `2025-12-30 <= hoje`, a carteira é marcada como "Encerrada".

A `data_limite = 2040-12-31` está sendo gravada corretamente na custódia e refletida na coluna `data_limite` da carteira. Porém, a coluna `resgate_total` da carteira é calculada apenas a partir de `computeResgateTotal`, que depende de vencimento ou movimentação de "Resgate Total" — nenhum dos quais existe para a Poupança ativa.

### Solução
Alterar a lógica de status em `syncControleCarteiras` (linhas 710-734 do `syncEngine.ts`):

**Se qualquer ativo da categoria NÃO tem resgate total (retorno null de computeResgateTotal), significa que esse ativo ainda está ativo e sem data de encerramento. Nesse caso, a carteira deve ser considerada "Ativa".**

Lógica proposta:
1. Contar quantos ativos retornaram `null` de `computeResgateTotal`
2. Se algum ativo retornou `null` (Poupança ativa sem resgate), a carteira permanece "Ativa" e `resgate_total` da carteira fica `null`
3. Só quando TODOS os ativos tiverem uma data de resgate definida é que se usa o maior resgate para determinar o status

### Alteração

**`src/lib/syncEngine.ts`** — função `syncControleCarteiras` (~linha 710):

```text
ANTES:
  resgateDates = [] (apenas datas não-null)
  resgateTotal = último da lista ordenada
  status baseado apenas em resgateTotal vs refDate

DEPOIS:
  Se algum ativo retornou null → resgateTotal = null, carteira "Ativa"
  Se todos retornaram data → resgateTotal = maior data, lógica normal
```

A mesma correção deve ser aplicada à função `syncCarteiraGeral` (que segue lógica idêntica nas linhas 780-784).

### Impacto
- A carteira "Renda Fixa" ficará "Ativa" enquanto a Poupança estiver sem resgate total
- A coluna `resgate_total` da carteira ficará vazia (null/—) quando houver ativo ativo sem resgate
- Nenhum impacto em cálculos — apenas no status de exibição da carteira
- Ativos já encerrados continuam sendo tratados normalmente

