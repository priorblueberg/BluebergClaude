-- Migracao de fundo por par de movimentacoes e fim da costura automatica (decisao do Daniel, 12/09/2026).
--
-- Quando o fundo para de receber cota da CVM, a tela avisa ao lado do nome e o cliente encerra ou migra a
-- posicao. A migracao grava "Migração (saída)" na posicao antiga e "Migração (entrada)" na do fundo novo,
-- ligadas por `transferencia_id`. A costura automatica (copia de cotas entre fundos) sai: cada fundo fica so
-- com a propria serie.

-- 1. Liga as duas pontas de uma migracao.
alter table invest.movimentacoes add column if not exists transferencia_id uuid;
create index if not exists movimentacoes_transferencia_id_idx
  on invest.movimentacoes (transferencia_id) where transferencia_id is not null;
comment on column invest.movimentacoes.transferencia_id is
  'Liga a "Migração (saída)" da posição antiga à "Migração (entrada)" da posição do fundo novo.';

-- 2. Fim da costura: nenhuma cota nova e copiada entre fundos.
drop trigger if exists cotas_fundos_sucessao on invest.cotas_fundos;

-- 3. As posicoes de teste que usavam cota copiada (Santa Fe Aquarius e BTG Hedge, subclasse A, em
--    02/01/2023) passam para a serie da classe antes da divisao, que e de onde a cota veio.
update invest.movimentacoes m
   set fundo_id = s.antecessor_id, nome_ativo = a.nome_curto
  from invest.sucessoes_de_fundo s
  join invest.cadastro_de_fundos a on a.id = s.antecessor_id
 where s.sucessor_id = m.fundo_id
   and exists (
     select 1 from invest.cotas_fundos c
      where c.fundo_id = m.fundo_id
        and c.data = coalesce(m.data_cotizacao, m.data)
        and c.fonte_fundo_id = s.antecessor_id
   );

update invest.custodia c
   set fundo_id = m.fundo_id, nome = m.nome_ativo
  from invest.movimentacoes m
 where m.codigo_custodia = c.codigo_custodia
   and m.user_id = c.user_id
   and m.fundo_id is not null
   and c.fundo_id is distinct from m.fundo_id
   and exists (select 1 from invest.cadastro_de_fundos f where f.id = m.fundo_id and f.situacao = 'Sucedido');

-- 4. Sai tudo o que a costura copiou e as ligacoes.
delete from invest.cotas_fundos where fonte_fundo_id is not null;
delete from invest.sucessoes_de_fundo;

-- 5. As series das classes antes da divisao em subclasses (criadas ocultas pela costura) passam a aparecer
--    na busca: e nelas que se lanca a posicao anterior a divisao, e o alerta leva a migracao para a subclasse.
update invest.cadastro_de_fundos
   set ativo = true,
       carga_cotas_concluida_em = coalesce(carga_cotas_concluida_em, now()),
       carga_cotas_ate = null
 where ativo = false and situacao = 'Sucedido';
