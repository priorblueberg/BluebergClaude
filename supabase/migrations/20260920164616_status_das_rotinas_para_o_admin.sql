-- O app nao alcanca `cron.job` nem `cron.job_run_details`: nao estao no schema exposto pelo
-- PostgREST e nao tem RLS. Esta funcao e a unica porta, e ela so abre para admin.
--
-- SECURITY DEFINER com a checagem DENTRO: sem o `raise`, qualquer autenticado leria a operacao
-- inteira do sistema.
create or replace function invest.status_das_rotinas()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'invest', 'cron', 'pg_catalog', 'public'
as $$
declare
  resultado jsonb;
begin
  if not invest.is_admin() then
    raise exception 'apenas administradores';
  end if;

  select jsonb_build_object(
    'crons', coalesce((
      select jsonb_agg(x order by x ->> 'nome')
      from (
        select jsonb_build_object(
          'nome', j.jobname,
          'agenda', j.schedule,
          'ativo', j.active,
          'ultima_execucao', d.start_time,
          'ultimo_status', d.status,
          'mensagem', left(coalesce(d.return_message, ''), 200)
        ) as x
        from cron.job j
        left join lateral (
          select status, start_time, return_message
          from cron.job_run_details
          where jobid = j.jobid
          order by start_time desc
          limit 1
        ) d on true
      ) t
    ), '[]'::jsonb),
    -- Ultima data de cada serie de mercado. Serie parada e a falha silenciosa mais comum:
    -- a tela continua calculando, so que com dado velho.
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('tabela', c.table_name, 'ultima_data', ultima)
                       order by c.table_name)
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
       and t.table_type = 'BASE TABLE'
      cross join lateral (
        select (xpath('/row/m/text()', query_to_xml(
                 format('select max(data)::text as m from %I.%I', c.table_schema, c.table_name),
                 false, true, '')))[1]::text as ultima
      ) u
      where c.column_name = 'data' and c.table_schema = 'invest'
    ), '[]'::jsonb),
    'auditorias', coalesce((
      select jsonb_agg(x order by x ->> 'executada_em' desc)
      from (
        select distinct on (a.funcao) jsonb_build_object(
          'funcao', a.funcao,
          'executada_em', a.executada_em,
          'ok', a.ok,
          'alerta', a.alerta,
          'resumo', a.resumo,
          'achados', a.achados,
          'erro', a.erro
        ) as x
        from invest.auditoria_execucoes a
        order by a.funcao, a.executada_em desc
      ) t
    ), '[]'::jsonb)
  ) into resultado;

  return resultado;
end;
$$;

revoke all on function invest.status_das_rotinas() from public;
grant execute on function invest.status_das_rotinas() to authenticated;
