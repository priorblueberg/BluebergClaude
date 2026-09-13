-- Fator de conversao da "Mudança de Fundo": quantidade no fundo novo / saldo no fundo antigo na data da
-- mudanca. Guardado para a quantidade ser recalculada quando uma movimentacao anterior entra, muda ou sai
-- (decisao do Daniel, 12/09/2026). Nulo nas demais movimentacoes.
alter table invest.movimentacoes add column if not exists fator_conversao numeric;

comment on column invest.movimentacoes.fator_conversao is
  'Mudança de Fundo: quantidade no fundo novo / saldo no fundo antigo. A quantidade é recalculada como saldo x fator quando o histórico anterior muda.';
