-- Data de inicio verdadeira dos fundos adaptados a Resolucao CVM 175.
--
-- No `registro_classe` da CVM, a data de inicio - e ate a de constituicao - de uma classe
-- adaptada e a data da ADAPTACAO. O Bradesco RF LP Eucalipto, que funciona desde 2003, aparece
-- como iniciado em 15/05/2025; o ALOCC TNA II, em 26/06/2025. Medido em 10/09/2026: 1.966
-- classes abertas constituidas antes de 2023 estao com inicio a partir de 10/2024.
--
-- Com essa data a carga de cotas comecava em 2025 (serie cortada) e a boleta dizia que o fundo
-- "ainda nao existia" numa aplicacao de 2023. A data real vem do historico do cadastro antigo
-- (`cad_fi_hist_sit.csv`, inicio do funcionamento normal), gravada pela edge function
-- `cadastrar-fundo` no modo `{catalogo: "datas"}`. So ANTECIPA a data: nunca a empurra para depois.
create or replace function invest.corrigir_inicio_de_fundos(itens jsonb)
returns integer
language sql security definer set search_path = invest, public
as $$
  with x as (
    select * from jsonb_to_recordset(itens) as r(cnpj text, inicio date)
  ),
  u as (
    update invest.cadastro_de_fundos f
       set data_inicio = x.inicio
      from x
     where f.cnpj_classe = x.cnpj
       and f.cvm_id_subclasse is null
       and x.inicio is not null
       and (f.data_inicio is null or x.inicio < f.data_inicio)
    returning 1
  )
  select count(*)::integer from u;
$$;
revoke all on function invest.corrigir_inicio_de_fundos(jsonb) from public, anon, authenticated;
grant execute on function invest.corrigir_inicio_de_fundos(jsonb) to service_role;
