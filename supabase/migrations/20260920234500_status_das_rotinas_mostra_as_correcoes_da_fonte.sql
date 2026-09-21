-- Correcao de fonte que ninguem ve e pior que a fonte errada: seis meses depois vira numero
-- magico na serie, sem dono e sem motivo. O `/admin` passa a listar os vetos de evento e as
-- correcoes de cotacao, com o motivo inteiro.
--
-- O corpo repete o da migracao `status_das_rotinas_para_o_admin` com o bloco
-- `correcoes_da_fonte` no fim.
create or replace function invest.status_das_rotinas()
returns jsonb
language plpgsql
stable security definer
set search_path to 'invest', 'cron', 'pg_catalog', 'public'
as $function$
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
    ), '[]'::jsonb),
    -- O que nos corrigimos da fonte, e por que. Sao poucos de proposito: cada linha aqui e um
    -- lugar onde a nossa base discorda do que a BRAPI manda.
    'correcoes_da_fonte', jsonb_build_object(
      'eventos_vetados', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'ticker', v.ticker, 'classe', v.classe, 'tipo', v.tipo,
                 'data_ex', v.data_ex, 'motivo', v.motivo, 'criado_em', v.criado_em)
                 order by v.ticker, v.data_ex)
        from invest.eventos_vetados v
      ), '[]'::jsonb),
      'cotacoes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'ticker', k.ticker, 'ate', k.ate, 'fator', k.fator,
                 'motivo', k.motivo, 'criado_em', k.criado_em)
                 order by k.ticker, k.ate)
        from invest.correcoes_de_cotacao k
      ), '[]'::jsonb)
    )
  ) into resultado;

  return resultado;
end;
$function$;
