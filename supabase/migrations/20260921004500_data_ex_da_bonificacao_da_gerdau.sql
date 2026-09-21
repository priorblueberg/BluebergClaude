-- A bonificacao de 20% da Gerdau tem data-ex 18/04/2024, e nao 17/04.
--
-- A BRAPI manda 17/04 porque e isso que ela tem no campo que vira data-ex aqui - e 17/04 e o
-- ULTIMO DIA COM DIREITO, nao o primeiro sem. Duas fontes independentes dizem 18/04: a B3
-- declara `lastDatePrior` 17/04/2024 (aprovacao em 16/04), e a fonte de serie usada na
-- conferencia de 20/09/2026 marca o evento em 18/04/2024.
--
-- E a propria serie concorda: tanto a nossa quanto a independente vem DIVIDIDAS por 1,2 ate
-- 17/04 inclusive (19,0583 e 18,7583 sao 22,87 e 22,51 divididos) e nominais a partir de 18/04.
-- Preco do ultimo dia com direito e preco pre-bonificacao, entao a divisao ate 17/04 e o que se
-- espera de uma data-ex em 18/04.
--
-- O que o erro fazia: `fatorDesde` multiplica quem comprou ANTES da data-ex. Com 17/04, quem
-- comprasse em 17/04 - com direito - nao receberia as acoes da bonificacao, e a posicao sairia
-- 20% menor. Nao afeta ninguem hoje, porque a unica compra de GGBR4 e de 02/01/2023.
--
-- O preco nao muda: o evento esta marcado como ja refletido, e continua.

update invest.eventos_de_ativos
   set data_ex = '2024-04-18',
       evidencia = 'Data-ex corrigida de 17/04 para 18/04/2024 em 20/09/2026. A B3 declara '
                || '`lastDatePrior` 17/04 (ultimo dia COM direito, aprovado em 16/04) e a fonte '
                || 'independente marca o evento em 18/04. As duas series vem divididas por 1,2 '
                || 'ate 17/04 inclusive e nominais a partir de 18/04, que e o que se espera de '
                || 'uma data-ex em 18/04. A marca de ja refletido no preco continua valendo.'
 where classe = 'QUANTIDADE' and ticker = 'GGBR4' and tipo = 'BONIFICACAO'
   and data_ex = '2024-04-17' and fator = 1.2;

-- Sem o veto a proxima rodada traz a versao de 17/04 de volta, ao lado da corrigida: o dedup do
-- sync casa por (tipo, data-ex), e 17/04 e uma data-ex diferente de 18/04.
insert into invest.eventos_vetados (ticker, classe, tipo, data_ex, motivo)
values ('GGBR4', 'QUANTIDADE', 'BONIFICACAO', '2024-04-17',
        'Data-ex errada por um dia. A BRAPI manda 17/04/2024, que e o ultimo dia COM direito; a '
     || 'data-ex e 18/04, confirmada pela B3 e por fonte independente, e a linha certa ja esta '
     || 'na base. Sem este veto a versao de 17/04 voltaria ao lado dela.')
on conflict (ticker, classe, tipo, data_ex) do nothing;
