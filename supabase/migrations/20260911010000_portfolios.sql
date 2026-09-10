-- Portfolios: o conteiner acima das carteiras, no modelo do Gorila.
--
-- Decisao do Daniel em 10/09/2026 (levantamento de 07/09 em _decisions/2026-09-07-portfolios-multiplos.md
-- no vault): uma conta tem ate 10 portfolios, cada um com as proprias movimentacoes, custodia,
-- carteiras e alertas. "Carteira" continua sendo a classe de ativo, um nivel abaixo. Tudo o que ja
-- existe nasce no portfolio "Testes Blueberg".
--
-- O ISOLAMENTO MORA NA RLS, NAO NO APP. O app le essas tabelas em mais de 100 lugares filtrando so
-- por user_id. Filtrar cada leitura por portfolio deixaria um risco sem sintoma: um filtro esquecido
-- nao quebra nada, so mostra dois portfolios somados, e isso parece plausivel. Em vez disso o
-- portfolio em uso fica no perfil e a politica de cada tabela so enxerga as linhas dele. Leitura
-- esquecida continua certa, e gravacao sem portfolio_id cai no portfolio em uso pelo DEFAULT.

-- 1. A tabela.
create table if not exists invest.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (btrim(nome) <> '' and char_length(nome) <= 60),
  created_at timestamptz not null default now()
);
create unique index if not exists portfolios_nome_por_conta on invest.portfolios (user_id, lower(btrim(nome)));
create index if not exists portfolios_user_idx on invest.portfolios (user_id, created_at);
alter table invest.portfolios enable row level security;
drop policy if exists portfolios_dono on invest.portfolios;
create policy portfolios_dono on invest.portfolios for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Update so do nome: o dono nao troca o portfolio de conta.
grant select, insert, delete on invest.portfolios to authenticated;
grant update (nome) on invest.portfolios to authenticated;
grant all on invest.portfolios to service_role;

-- 2. Ate 10 por conta. O lock serializa duas criacoes simultaneas da mesma conta.
create or replace function invest.limitar_portfolios_por_conta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('portfolios:' || new.user_id::text, 0));
  if (select count(*) from invest.portfolios where user_id = new.user_id) >= 10 then
    raise exception 'Limite de 10 portfólios por conta.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists portfolios_limite on invest.portfolios;
create trigger portfolios_limite before insert on invest.portfolios
  for each row execute function invest.limitar_portfolios_por_conta();

-- 3. A conta nunca fica sem portfolio. Na exclusao da propria conta (cascata de auth.users) o dono
-- ja nao existe, e ai tudo pode ir embora.
create or replace function invest.proteger_ultimo_portfolio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id = old.user_id)
     and not exists (select 1 from invest.portfolios where user_id = old.user_id and id <> old.id) then
    raise exception 'A conta precisa ter pelo menos um portfólio.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
drop trigger if exists portfolios_ultimo on invest.portfolios;
create trigger portfolios_ultimo before delete on invest.portfolios
  for each row execute function invest.proteger_ultimo_portfolio();

-- 4. O portfolio em uso. Mora no perfil, e nao na URL nem no navegador, porque e a RLS que precisa
-- dele. Apagado o portfolio em uso, a referencia vira nula e vale o mais antigo.
alter table invest.profiles
  add column if not exists portfolio_ativo_id uuid references invest.portfolios(id) on delete set null;

create or replace function invest.portfolio_ativo()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.id
       from invest.profiles pr
       join invest.portfolios p on p.id = pr.portfolio_ativo_id and p.user_id = pr.user_id
      where pr.user_id = auth.uid()),
    (select p.id from invest.portfolios p where p.user_id = auth.uid() order by p.created_at, p.id limit 1)
  );
$$;
revoke all on function invest.portfolio_ativo() from public;
grant execute on function invest.portfolio_ativo() to authenticated, service_role;

-- 5. O que ja existe nasce em "Testes Blueberg".
insert into invest.portfolios (user_id, nome)
select u.user_id, 'Testes Blueberg'
  from (
    select user_id from invest.profiles
    union select user_id from invest.movimentacoes
    union select user_id from invest.custodia
    union select user_id from invest.controle_de_carteiras
    union select user_id from invest.poupanca_lotes
    union select user_id from invest.alertas
  ) u
 where u.user_id is not null
   and exists (select 1 from auth.users au where au.id = u.user_id)
   and not exists (select 1 from invest.portfolios p where p.user_id = u.user_id);

update invest.profiles pr set portfolio_ativo_id = p.id
  from invest.portfolios p
 where p.user_id = pr.user_id and pr.portfolio_ativo_id is null;

-- 6. portfolio_id nas tabelas do usuario. Apagar o portfolio apaga os dados dele.
do $$
declare t text;
begin
  foreach t in array array['movimentacoes', 'custodia', 'controle_de_carteiras', 'poupanca_lotes', 'alertas'] loop
    execute format('alter table invest.%I add column if not exists portfolio_id uuid references invest.portfolios(id) on delete cascade', t);
    execute format('update invest.%I x set portfolio_id = p.id from invest.portfolios p where p.user_id = x.user_id and x.portfolio_id is null', t);
    execute format('alter table invest.%I alter column portfolio_id set default invest.portfolio_ativo()', t);
    execute format('alter table invest.%I alter column portfolio_id set not null', t);
    execute format('create index if not exists %I on invest.%I (portfolio_id)', t || '_portfolio_idx', t);
  end loop;
end $$;

-- 7. As chaves que precisam enxergar o portfolio.
--
-- controle_de_carteiras: com (nome_carteira, user_id) o recalculo de um portfolio sobrescrevia a
-- linha "Renda Fixa" do outro, em silencio. Alertas: um por portfolio, porque o cliente responde
-- dentro do portfolio em que a posicao esta.
--
-- custodia continua unica por (user_id, codigo_custodia): o codigo e sequencial POR CONTA e liga
-- movimentacoes a custodia. Reiniciar a contagem por portfolio criaria colisao.
alter table invest.controle_de_carteiras drop constraint if exists controle_de_carteiras_nome_carteira_user_id_key;
alter table invest.controle_de_carteiras drop constraint if exists controle_de_carteiras_portfolio_nome_key;
alter table invest.controle_de_carteiras
  add constraint controle_de_carteiras_portfolio_nome_key unique (portfolio_id, nome_carteira);
alter table invest.alertas drop constraint if exists alertas_user_id_tipo_referencia_id_key;
alter table invest.alertas drop constraint if exists alertas_portfolio_tipo_referencia_key;
alter table invest.alertas
  add constraint alertas_portfolio_tipo_referencia_key unique (portfolio_id, tipo, referencia_id);

-- 8. RLS: so o portfolio em uso.
do $$
declare t text;
begin
  foreach t in array array['movimentacoes', 'custodia', 'controle_de_carteiras', 'poupanca_lotes'] loop
    execute format('drop policy if exists own_rows on invest.%I', t);
    execute format($p$create policy own_rows on invest.%I for all to authenticated
      using (user_id = (select auth.uid()) and portfolio_id = (select invest.portfolio_ativo()))
      with check (user_id = (select auth.uid()) and portfolio_id = (select invest.portfolio_ativo()))$p$, t);
  end loop;
end $$;

drop policy if exists alertas_dono_le on invest.alertas;
create policy alertas_dono_le on invest.alertas for select to authenticated
  using (user_id = (select auth.uid()) and portfolio_id = (select invest.portfolio_ativo()));
drop policy if exists alertas_dono_atualiza on invest.alertas;
create policy alertas_dono_atualiza on invest.alertas for update to authenticated
  using (user_id = (select auth.uid()) and portfolio_id = (select invest.portfolio_ativo()))
  with check (user_id = (select auth.uid()) and portfolio_id = (select invest.portfolio_ativo()));

-- 9. Conta nova ganha o primeiro portfolio junto com o perfil.
create or replace function invest.criar_primeiro_portfolio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from invest.portfolios where user_id = new.user_id order by created_at, id limit 1;
  if v_id is null then
    insert into invest.portfolios (user_id, nome) values (new.user_id, 'Meu portfólio') returning id into v_id;
  end if;
  if new.portfolio_ativo_id is null then
    update invest.profiles set portfolio_ativo_id = v_id where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_primeiro_portfolio on invest.profiles;
create trigger profiles_primeiro_portfolio after insert on invest.profiles
  for each row execute function invest.criar_primeiro_portfolio();

-- 10. O que o app chama.

-- Troca o portfolio em uso (so para um portfolio da propria conta).
create or replace function invest.definir_portfolio_ativo(p_portfolio uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from invest.portfolios where id = p_portfolio and user_id = auth.uid()) then
    raise exception 'Portfólio não encontrado.' using errcode = 'P0001';
  end if;
  update invest.profiles set portfolio_ativo_id = p_portfolio where user_id = auth.uid();
end;
$$;

-- A tela de Portfolios precisa contar o que ha em cada um, e a RLS so mostra o portfolio em uso.
create or replace function invest.resumo_dos_portfolios()
returns table (id uuid, nome text, created_at timestamptz, ativo boolean, posicoes bigint, movimentacoes bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, p.created_at, p.id = invest.portfolio_ativo(),
         (select count(*) from invest.custodia c where c.portfolio_id = p.id),
         (select count(*) from invest.movimentacoes m where m.portfolio_id = p.id)
    from invest.portfolios p
   where p.user_id = auth.uid()
   order by p.created_at, p.id;
$$;

-- O proximo codigo de custodia olha a conta inteira. Pelo cliente, com a RLS, ele enxergaria so
-- o portfolio em uso e daria a um ativo novo o codigo de uma posicao de outro portfolio.
-- A faixa nova comeca em 100, como no app.
create or replace function invest.proximo_codigo_custodia()
returns text language sql stable security definer set search_path = '' as $$
  select (greatest(99, coalesce(max(n), 0)) + 1)::bigint::text
    from (
      select codigo_custodia::numeric as n from invest.movimentacoes
       where user_id = auth.uid() and codigo_custodia ~ '^\d+$'
      union all
      select codigo_custodia::numeric from invest.custodia
       where user_id = auth.uid() and codigo_custodia ~ '^\d+$'
    ) x;
$$;

revoke all on function invest.definir_portfolio_ativo(uuid) from public;
revoke all on function invest.resumo_dos_portfolios() from public;
revoke all on function invest.proximo_codigo_custodia() from public;
grant execute on function invest.definir_portfolio_ativo(uuid) to authenticated;
grant execute on function invest.resumo_dos_portfolios() to authenticated;
grant execute on function invest.proximo_codigo_custodia() to authenticated;
