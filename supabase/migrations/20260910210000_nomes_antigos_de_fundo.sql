-- Busca de fundo tambem pelos nomes ANTIGOS.
--
-- 83% do catalogo mudou de nome desde 02/01/2023 (7.047 de 8.445 FIFs abertos, medido em
-- 10/09/2026), quase todo na adaptacao a Resolucao CVM 175. O CNPJ nao muda, mas a nota de
-- aplicacao de 2023 que o cliente tem em maos traz o nome daquela epoca - e em 43% dos casos as
-- quatro primeiras palavras do nome antigo nem aparecem no atual.
--
-- O historico vem do `cad_fi_hist_denom_social.csv` da CVM (carga manual pela edge function
-- `cadastrar-fundo`, modo `{catalogo: "nomes"}`). So entram os nomes que valeram depois do
-- inicio da ferramenta.

create table if not exists invest.nomes_de_fundo (
  cnpj text not null,
  nome text not null,
  desde date,
  ate date not null,
  primary key (cnpj, nome, ate)
);
create index if not exists nomes_de_fundo_cnpj_idx on invest.nomes_de_fundo (cnpj);
alter table invest.nomes_de_fundo enable row level security;
drop policy if exists nomes_de_fundo_read on invest.nomes_de_fundo;
create policy nomes_de_fundo_read on invest.nomes_de_fundo for select to authenticated using (true);
grant select on invest.nomes_de_fundo to authenticated;
grant all on invest.nomes_de_fundo to service_role;

-- A busca da boleta. Primeiro o que casa pelo nome atual ou pelo CNPJ; depois o que so casa por
-- um nome antigo, trazendo esse nome e ate quando ele valeu para a tela mostrar "Antes: ...".
-- Fundo que mudou de nome mais de uma vez aparece uma vez so, com o nome antigo mais recente que
-- casou.
create or replace function invest.buscar_fundos(termo text, limite integer default 15)
returns table (
  id uuid, nome_curto text, cnpj_classe text, classificacao text, cvm_id_subclasse text,
  situacao text, data_inicio_situacao date, nome_antigo text, nome_antigo_ate date
)
language sql stable security invoker set search_path = invest, public
as $$
  with t as (
    select replace(replace(replace(trim(termo), '\', '\\'), '%', '\%'), '_', '\_') as q,
           regexp_replace(termo, '\D', '', 'g') as dig
  ),
  diretos as (
    select f.id, 0 as ordem, null::text as nome_antigo, null::date as ate
      from invest.cadastro_de_fundos f, t
     where f.ativo
       and length(t.q) > 0
       and (f.nome_curto ilike '%' || t.q || '%' or (length(t.dig) >= 3 and f.cnpj_classe like '%' || t.dig || '%'))
  ),
  antigos as (
    select distinct on (f.id) f.id, 1 as ordem, n.nome as nome_antigo, n.ate
      from invest.nomes_de_fundo n
      join invest.cadastro_de_fundos f on f.cnpj_classe = n.cnpj and f.ativo
      cross join t
     where length(t.q) > 0
       and n.nome ilike '%' || t.q || '%'
       and not exists (select 1 from diretos d where d.id = f.id)
     order by f.id, n.ate desc
  ),
  achados as (
    select * from diretos union all select * from antigos
  )
  select f.id, f.nome_curto, f.cnpj_classe, f.classificacao, f.cvm_id_subclasse,
         f.situacao, f.data_inicio_situacao, a.nome_antigo, a.ate
    from achados a join invest.cadastro_de_fundos f on f.id = a.id
   order by a.ordem, f.nome_curto
   limit greatest(1, least(coalesce(limite, 15), 50));
$$;
revoke all on function invest.buscar_fundos(text, integer) from public, anon;
grant execute on function invest.buscar_fundos(text, integer) to authenticated;
