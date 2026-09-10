-- Divisao em subclasses (cenario B4 da adaptacao a Resolucao CVM 175).
--
-- A classe cria subclasses e divide os cotistas entre elas. Cada cotista cai numa so, e so ele
-- sabe em qual - mas isso importa para frente, nao para tras: ate a vespera da divisao todo
-- cotista, de qualquer subclasse, tinha a mesma cota da classe, e no primeiro dia as subclasses
-- nascem com essa cota. Decisao do Daniel (10/09/2026): o cliente lanca a operacao antiga na
-- subclasse em que esta hoje, com o nome atual, e a ferramenta busca o historico da classe.
--
-- Uma divisao liga UM antecessor a VARIOS sucessores e so copia cota para tras (da classe para
-- as subclasses). A sucessao simples continua copiando nos dois sentidos.

alter table invest.sucessoes_de_fundo
  add column if not exists tipo text not null default 'sucessao' check (tipo in ('sucessao', 'divisao'));

-- Um antecessor tem no maximo UMA sucessao simples ativa; divisao pode ter varias.
drop index if exists invest.sucessoes_de_fundo_antecessor_ativa;
create unique index sucessoes_de_fundo_antecessor_ativa
  on invest.sucessoes_de_fundo (antecessor_id) where ativa and tipo = 'sucessao';

create or replace function invest.propagar_cota_por_sucessao()
returns trigger
language plpgsql security definer set search_path = invest, public
as $$
declare
  s record;
begin
  for s in
    -- Para frente (sucessor -> antecessor): so na sucessao simples.
    select antecessor_id as destino from invest.sucessoes_de_fundo
     where ativa and tipo = 'sucessao' and sucessor_id = new.fundo_id and new.data >= primeira_cota_sucessor
    union all
    -- Para tras (antecessor -> sucessor): nos dois tipos.
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

create or replace function invest.aplicar_sucessao(p_id uuid)
returns integer
language plpgsql security definer set search_path = invest, public
as $$
declare
  s invest.sucessoes_de_fundo%rowtype;
  n1 integer := 0;
  n2 integer;
begin
  select * into s from invest.sucessoes_de_fundo where id = p_id and ativa;
  if not found then return 0; end if;
  if s.tipo = 'sucessao' then
    insert into invest.cotas_fundos (fundo_id, data, valor_cota, fonte_fundo_id)
    select s.antecessor_id, c.data, c.valor_cota, coalesce(c.fonte_fundo_id, c.fundo_id)
      from invest.cotas_fundos c
     where c.fundo_id = s.sucessor_id and c.data >= s.primeira_cota_sucessor
    on conflict (fundo_id, data) do nothing;
    get diagnostics n1 = row_count;
  end if;
  insert into invest.cotas_fundos (fundo_id, data, valor_cota, fonte_fundo_id)
  select s.sucessor_id, c.data, c.valor_cota, coalesce(c.fonte_fundo_id, c.fundo_id)
    from invest.cotas_fundos c
   where c.fundo_id = s.antecessor_id and c.data <= s.ultima_cota_antecessor
  on conflict (fundo_id, data) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end;
$$;

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
   where (s.tipo = 'sucessao' and fundo_id = s.antecessor_id and fonte_fundo_id = s.sucessor_id and data >= s.primeira_cota_sucessor)
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
