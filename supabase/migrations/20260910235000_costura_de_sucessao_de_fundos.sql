-- Costura automatica da serie de cotas quando a sucessao entre fundos e inequivoca.
--
-- Nivel 1 da regra de mudanca de fundo (decisao do Daniel, 10/09/2026). Quando uma serie para e
-- outra nasce ate 3 dias uteis depois com cota continua, mesmo patrimonio e mesmos cotistas, sem
-- outro candidato, as duas viram uma so: o Kinea Advisory (FIC cancelado) e a Subclasse II que o
-- sucedeu; a classe que criou subclasses (cenario B3) e a subclasse que ficou com todos os
-- cotistas. Todo o resto continua com o alerta no Sininho.
--
-- A costura e MATERIALIZADA: as cotas de um fundo sao copiadas para o outro, com a origem em
-- `fonte_fundo_id`. Assim a boleta, o motor e a carteira continuam lendo `cotas_fundos` como
-- sempre, sem saber que a serie foi costurada.

alter table invest.cotas_fundos
  add column if not exists fonte_fundo_id uuid references invest.cadastro_de_fundos(id) on delete cascade;
comment on column invest.cotas_fundos.fonte_fundo_id is
  'Nulo: cota publicada para este fundo. Preenchido: cota copiada do fundo ligado por sucessao.';

create table if not exists invest.sucessoes_de_fundo (
  id uuid primary key default gen_random_uuid(),
  antecessor_id uuid not null references invest.cadastro_de_fundos(id) on delete cascade,
  sucessor_id uuid not null references invest.cadastro_de_fundos(id) on delete cascade,
  ultima_cota_antecessor date not null,
  primeira_cota_sucessor date not null,
  origem text not null default 'automatica' check (origem in ('automatica', 'manual')),
  evidencias jsonb not null default '{}'::jsonb,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  desfeita_em timestamptz,
  check (antecessor_id <> sucessor_id),
  check (primeira_cota_sucessor > ultima_cota_antecessor)
);
-- Um fundo tem no maximo um sucessor e um antecessor ativos.
create unique index if not exists sucessoes_de_fundo_antecessor_ativa on invest.sucessoes_de_fundo (antecessor_id) where ativa;
create unique index if not exists sucessoes_de_fundo_sucessor_ativa on invest.sucessoes_de_fundo (sucessor_id) where ativa;
alter table invest.sucessoes_de_fundo enable row level security;
drop policy if exists sucessoes_de_fundo_read on invest.sucessoes_de_fundo;
create policy sucessoes_de_fundo_read on invest.sucessoes_de_fundo for select to authenticated using (true);
grant select on invest.sucessoes_de_fundo to authenticated;
grant all on invest.sucessoes_de_fundo to service_role;

-- Mantem a copia em dia: cota nova do sucessor (a partir da primeira dele) vale para o antecessor;
-- cota do antecessor (ate a ultima dele) vale para o sucessor. Nunca sobrescreve cota propria.
-- Cadeias (A -> B -> C) propagam sozinhas, porque a copia tambem dispara o gatilho.
create or replace function invest.propagar_cota_por_sucessao()
returns trigger
language plpgsql security definer set search_path = invest, public
as $$
declare
  s record;
begin
  for s in
    select antecessor_id as destino from invest.sucessoes_de_fundo
     where ativa and sucessor_id = new.fundo_id and new.data >= primeira_cota_sucessor
    union all
    select sucessor_id from invest.sucessoes_de_fundo
     where ativa and antecessor_id = new.fundo_id and new.data <= ultima_cota_antecessor
  loop
    insert into invest.cotas_fundos (fundo_id, data, valor_cota, fonte_fundo_id)
    values (s.destino, new.data, new.valor_cota, coalesce(new.fonte_fundo_id, new.fundo_id))
    on conflict (fundo_id, data) do update
      set valor_cota = excluded.valor_cota, fonte_fundo_id = excluded.fonte_fundo_id
      where invest.cotas_fundos.fonte_fundo_id is not null
        and invest.cotas_fundos.valor_cota is distinct from excluded.valor_cota;
  end loop;
  return null;
end;
$$;
drop trigger if exists cotas_fundos_sucessao on invest.cotas_fundos;
create trigger cotas_fundos_sucessao
  after insert or update of valor_cota on invest.cotas_fundos
  for each row execute function invest.propagar_cota_por_sucessao();

-- Copia o que ja existe quando a sucessao e gravada.
create or replace function invest.aplicar_sucessao(p_id uuid)
returns integer
language plpgsql security definer set search_path = invest, public
as $$
declare
  s invest.sucessoes_de_fundo%rowtype;
  n1 integer;
  n2 integer;
begin
  select * into s from invest.sucessoes_de_fundo where id = p_id and ativa;
  if not found then return 0; end if;
  insert into invest.cotas_fundos (fundo_id, data, valor_cota, fonte_fundo_id)
  select s.antecessor_id, c.data, c.valor_cota, coalesce(c.fonte_fundo_id, c.fundo_id)
    from invest.cotas_fundos c
   where c.fundo_id = s.sucessor_id and c.data >= s.primeira_cota_sucessor
  on conflict (fundo_id, data) do nothing;
  get diagnostics n1 = row_count;
  insert into invest.cotas_fundos (fundo_id, data, valor_cota, fonte_fundo_id)
  select s.sucessor_id, c.data, c.valor_cota, coalesce(c.fonte_fundo_id, c.fundo_id)
    from invest.cotas_fundos c
   where c.fundo_id = s.antecessor_id and c.data <= s.ultima_cota_antecessor
  on conflict (fundo_id, data) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end;
$$;

-- Desfaz: marca a sucessao como inativa e apaga so as cotas COPIADAS por ela.
create or replace function invest.desfazer_sucessao(p_id uuid)
returns integer
language plpgsql security definer set search_path = invest, public
as $$
declare
  s invest.sucessoes_de_fundo%rowtype;
  n integer;
begin
  update invest.sucessoes_de_fundo set ativa = false, desfeita_em = now()
   where id = p_id and ativa
  returning * into s;
  if not found then return 0; end if;
  delete from invest.cotas_fundos
   where (fundo_id = s.antecessor_id and fonte_fundo_id is not null and data >= s.primeira_cota_sucessor)
      or (fundo_id = s.sucessor_id and fonte_fundo_id is not null and data <= s.ultima_cota_antecessor);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function invest.aplicar_sucessao(uuid) from public, anon, authenticated;
revoke all on function invest.desfazer_sucessao(uuid) from public, anon, authenticated;
revoke all on function invest.propagar_cota_por_sucessao() from public, anon, authenticated;
grant execute on function invest.aplicar_sucessao(uuid) to service_role;
grant execute on function invest.desfazer_sucessao(uuid) to service_role;
