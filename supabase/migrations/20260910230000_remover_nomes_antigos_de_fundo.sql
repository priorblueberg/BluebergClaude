-- Desfaz 20260910210000_nomes_antigos_de_fundo.sql.
--
-- A busca pelos nomes antigos foi descartada no mesmo dia (decisao do Daniel, 10/09/2026): na
-- adaptacao a Resolucao CVM 175 o nome muda mas o CNPJ nao, entao a busca e todas as telas ficam
-- so com o nome ATUAL, e a mensagem de "nenhum fundo encontrado" sugere buscar pelo CNPJ.
-- Aplicar so depois que o site publicado deixar de chamar `buscar_fundos`.
drop function if exists invest.buscar_fundos(text, integer);
drop table if exists invest.nomes_de_fundo;
