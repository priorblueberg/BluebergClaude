-- Evento corporativo de QUANTIDADE nao pode ter duas linhas.
--
-- O que aconteceu. Em 10/09/2026 a ingestao passou a gravar `data_aprovacao`, coluna que faz
-- parte do indice unico `eventos_de_ativos_unico`. Os eventos gravados em 08/09 com a coluna
-- NULA deixaram de colidir com a versao nova que chegava preenchida, e ganharam uma segunda
-- copia ao lado. Deu tres pares: PETR4 (grupamento de 2000 e desdobramento de 2008) e KLBN11
-- (desdobramento 5:1 de 2014). O indice e NULLS NOT DISTINCT, mas isso so iguala nulo com nulo;
-- nulo contra data continua sendo chave diferente.
--
-- Por que nao e duplicata inofensiva. O `fatorDesde` do motor multiplica TODAS as linhas com
-- data-ex posterior a data consultada - nao escolhe uma. Com duas copias do 5:1 da Klabin, uma
-- compra anterior a 25/03/2014 sairia com a quantidade multiplicada por 25. Hoje nao afeta
-- ninguem porque as tres datas-ex sao anteriores a primeira compra do cliente e a serie de
-- precos comeca em 2023 - mas bastaria uma boleta antiga.
--
-- Qual copia fica. A de 08/09, que carrega `ja_refletido_no_preco = true`, e a marca esta certa:
-- evento com data-ex anterior ao primeiro pregao da nossa serie ja esta embutido nela por
-- construcao. A copia nova cede a `data_aprovacao` antes de sair, para que a proxima rodada do
-- sync colida no indice unico e seja descartada, preservando a marca. E a mesma protecao que o
-- `limpar` do sync-acoes da as linhas marcadas e as manuais.


with pares as (
  select ticker, tipo, data_ex
    from invest.eventos_de_ativos
   where classe = 'QUANTIDADE'
   group by 1, 2, 3
  having count(*) = 2
     and count(*) filter (where ja_refletido_no_preco) = 1
),
fica as (
  select e.id, e.ticker, e.tipo, e.data_ex
    from invest.eventos_de_ativos e
    join pares p using (ticker, tipo, data_ex)
   where e.classe = 'QUANTIDADE' and e.ja_refletido_no_preco
),
sai as (
  select e.id, e.ticker, e.tipo, e.data_ex, e.data_aprovacao
    from invest.eventos_de_ativos e
    join pares p using (ticker, tipo, data_ex)
   where e.classe = 'QUANTIDADE' and not e.ja_refletido_no_preco
),
herdar as (
  update invest.eventos_de_ativos e
     set data_aprovacao = coalesce(e.data_aprovacao, s.data_aprovacao)
    from fica f
    join sai s using (ticker, tipo, data_ex)
   where e.id = f.id
  returning e.id
)
delete from invest.eventos_de_ativos where id in (select id from sai);

-- A trava. Dois eventos de quantidade do mesmo tipo, no mesmo papel e na mesma data-ex sao o
-- mesmo evento: desdobramento nao e declarado em duas vias. O indice nao serve de arbitro do
-- upsert (o arbitro continua sendo `eventos_de_ativos_unico`, com a chave inteira, que as
-- parcelas gemeas de JCP da Itausa exigem) - ele existe para a copia estourar em vez de entrar
-- calada. Rotina que erra alto e melhor que rotina que erra em silencio.
create unique index if not exists eventos_de_ativos_quantidade_unico
    on invest.eventos_de_ativos (ticker, tipo, data_ex)
 where classe = 'QUANTIDADE';

