-- Mudanca na composicao do fundo: detectar, avisar e deixar o cliente informar o fundo novo.
--
-- Na adaptacao a Resolucao CVM 175 fundos trocaram de CNPJ ou viraram subclasse de outro fundo
-- no meio da serie (o Kinea Advisory virou a Subclasse II de outra classe em 11/04/2025), e
-- nenhum arquivo da CVM registra a ligacao. A decisao de 10/09/2026 foi nao inferir o sucessor:
-- a ferramenta detecta que a serie mudou e pergunta ao cliente pelo Sininho.

-- 1. A subclasse passa a fazer parte da identidade do fundo.
--
-- Subclasse nao tem CNPJ: e a mesma classe com cotistas, prazos e taxas diferentes, e cota
-- diferente. O catalogo precisa listar cada uma para o cliente achar a dele, e com UNIQUE so no
-- CNPJ as cinco subclasses do Kinea nao cabiam. NULLS NOT DISTINCT mantem uma unica linha
-- "sem subclasse" por CNPJ.
alter table invest.cadastro_de_fundos drop constraint if exists cadastro_de_fundos_cnpj_classe_key;
alter table invest.cadastro_de_fundos
  add constraint cadastro_de_fundos_cnpj_subclasse_key unique nulls not distinct (cnpj_classe, cvm_id_subclasse);

-- 2. O que foi detectado, uma vez por fundo e por ultima cota. E dado publico (a serie da CVM),
-- entao qualquer usuario autenticado le.
create table if not exists invest.mudancas_de_fundo (
  id uuid primary key default gen_random_uuid(),
  fundo_id uuid not null references invest.cadastro_de_fundos(id) on delete cascade,
  ultima_cota_em date not null,
  sinal text not null check (sinal in ('cota_zero', 'virou_subclasses', 'serie_parou')),
  evidencias jsonb not null default '{}'::jsonb,
  detectada_em timestamptz not null default now(),
  unique (fundo_id, ultima_cota_em)
);
alter table invest.mudancas_de_fundo enable row level security;
drop policy if exists mudancas_de_fundo_read on invest.mudancas_de_fundo;
create policy mudancas_de_fundo_read on invest.mudancas_de_fundo for select to authenticated using (true);
grant select on invest.mudancas_de_fundo to authenticated;
grant all on invest.mudancas_de_fundo to service_role;

-- 3. Alertas do Sininho, por usuario.
--
-- So o servidor cria alerta. O dono le e muda o status - e so o status: o GRANT de update por
-- coluna impede que o cliente reescreva o titulo ou o detalhe que o detector gravou.
-- UNIQUE (user_id, tipo, referencia_id) faz o detector rodar quantas vezes quiser sem duplicar,
-- e impede que um alerta descartado reabra para a mesma mudanca.
create table if not exists invest.alertas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  referencia_id uuid,
  titulo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  status text not null default 'aberto' check (status in ('aberto', 'resolvido', 'descartado')),
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  unique (user_id, tipo, referencia_id)
);
create index if not exists alertas_user_status_idx on invest.alertas (user_id, status);
alter table invest.alertas enable row level security;
drop policy if exists alertas_dono_le on invest.alertas;
create policy alertas_dono_le on invest.alertas for select to authenticated using (user_id = auth.uid());
drop policy if exists alertas_dono_atualiza on invest.alertas;
create policy alertas_dono_atualiza on invest.alertas for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on invest.alertas to authenticated;
grant update (status, resolvido_em) on invest.alertas to authenticated;
grant all on invest.alertas to service_role;
