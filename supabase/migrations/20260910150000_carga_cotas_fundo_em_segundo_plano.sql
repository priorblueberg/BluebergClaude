-- Carga da serie de cotas de um fundo em segundo plano, disparada pela boleta.
--
-- A boleta passou a funcionar assim: o cliente escolhe um fundo sem cotas, clica em "Adicionar",
-- a boleta fecha e a carga continua no servidor (funcao `carga-cotas-fundo`, encadeada pelo
-- pg_net). O estado dessa carga mora aqui porque a boleta reaberta - talvez depois de recarregar
-- a pagina - precisa saber se o fundo esta em carga.

alter table invest.cadastro_de_fundos
  add column if not exists carga_cotas_ate timestamptz,
  add column if not exists carga_cotas_concluida_em timestamptz,
  add column if not exists carga_cotas_erro text;

comment on column invest.cadastro_de_fundos.carga_cotas_ate is
  'Lease da carga de cotas em segundo plano. Cada etapa empurra o prazo; a ultima o limpa. Prazo vencido = carga morreu e o fundo pode ser adicionado de novo.';
comment on column invest.cadastro_de_fundos.carga_cotas_concluida_em is
  'Quando a serie de cotas foi carregada por inteiro. Nulo = a boleta trata o fundo como sem cotas cadastradas.';
comment on column invest.cadastro_de_fundos.carga_cotas_erro is
  'Motivo da ultima carga que nao terminou (ex.: CNPJ com mais de uma subclasse).';

-- Fundos que ja tem serie carregada E sincronizada antes deste mecanismo existir contam como
-- concluidos. Sem isto a boleta passaria a pedir carga dos fundos que o cliente ja usa.
-- Serie sem sincronizacao nao conta: em 10/09/2026 eram 4 sobras de teste com serie parcial ou
-- parada (uma terminava em 03/2024). Aceita-las como prontas deixaria a boleta usar cota velha;
-- tratadas como "sem cotas", o "Adicionar" completa a serie por upsert.
update invest.cadastro_de_fundos f
   set carga_cotas_concluida_em = now()
 where f.sincronizar_cotas
   and exists (select 1 from invest.cotas_fundos c where c.fundo_id = f.id)
   and f.carga_cotas_concluida_em is null;
