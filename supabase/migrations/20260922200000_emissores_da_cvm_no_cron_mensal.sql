-- A lista do BCB nao cobre quem emite debenture, CRI e CRA: securitizadora e companhia aberta nao
-- sao instituicao financeira. Em 22/09/2026, ao cadastrar as notas de negociacao do Daniel, os
-- emissores dos dois CRAs (VERT e Riza/Virgo) tiveram que ser criados a mao, e ele cortou:
-- "Nao podemos ter emissores que nao estao na fonte".
--
-- A fonte deles e o cadastro de companhias abertas da CVM
-- (`dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv`), carregado pela edge function
-- `sync-emissores-cvm`. A carga fica na funcao, e nao aqui no SQL, porque o arquivo e latin-1: o
-- `http` do Postgres o decodifica como UTF-8 e devolve caractere invalido em todo nome com acento.
--
-- Primeira carga em 22/09/2026: 2.462 emissores da CVM, com CNPJ, setor e situacao do registro.
-- Depois dela, todo emissor da base tem CNPJ e vem do BCB ou da CVM.
--
-- O cron mensal passa a fazer as duas cargas.
select cron.unschedule('bases-do-bcb-mensal');

select cron.schedule(
  'bases-de-emissores-mensal',
  '0 9 1 * *',
  $cron$
    select invest.sincronizar_bases_do_bcb();
    select invest.disparar_funcao('sync-emissores-cvm');
  $cron$
);
