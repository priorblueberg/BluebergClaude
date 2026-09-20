-- A auditoria de proventos e a de eventos rodam toda semana, comparam a nossa base com a
-- declaracao da B3 e devolvem um JSON. O JSON ia para o `net._http_response`, que o pg_net
-- descarta em poucas horas: na pratica o resultado era jogado fora. No log do cron ficava
-- "succeeded", que e o que apareceria tambem com dez parcelas faltando.
--
-- Esta tabela e o alarme que faltava: cada execucao fica gravada, com o resumo e a lista do que
-- precisa de acao. Quem le e a tela de Admin.
create table if not exists invest.auditoria_execucoes (
  id uuid primary key default gen_random_uuid(),
  funcao text not null,
  executada_em timestamptz not null default now(),
  -- `false` quando a propria auditoria falhou (nao conseguiu olhar). Diferente de achar problema.
  ok boolean not null,
  -- Ha achado que pede acao? Separado de `ok` de proposito: auditoria que rodou bem e encontrou
  -- parcela faltando e `ok = true` com `alerta = true`.
  alerta boolean not null default false,
  resumo jsonb,
  achados jsonb,
  erro text
);

create index if not exists auditoria_execucoes_funcao_data
  on invest.auditoria_execucoes (funcao, executada_em desc);

alter table invest.auditoria_execucoes enable row level security;

-- Historico de rotina e informacao operacional, nao dado de cliente: so admin le, e ninguem
-- escreve pelo app. Quem grava e a edge function, com a service role, que ignora RLS.
drop policy if exists "admin le auditoria" on invest.auditoria_execucoes;
create policy "admin le auditoria" on invest.auditoria_execucoes
  for select using (invest.is_admin());

grant select on invest.auditoria_execucoes to authenticated;
grant all on invest.auditoria_execucoes to service_role;
