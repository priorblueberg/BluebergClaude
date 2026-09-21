-- Quando a FONTE inventa um evento corporativo.
--
-- O caso que criou isto, medido em 20/09/2026. A BRAPI publica para o BBDC4 uma BONIFICACAO de
-- fator 1,2 com data-ex em 07/02/2024, e nao existe. A B3 diz que a ultima bonificacao do
-- Bradesco e a de 2022 (1 para 10, que temos em 18/04/2022) - e, como o endpoint devolve o
-- evento MAIS RECENTE de cada rotulo, uma de 2024 apareceria se existisse. O que houve em
-- 07/02/2024 foi o resultado do 4o trimestre de 2023: a acao caiu de R$ 16,60 para R$ 13,96,
-- -15,9%, perto o bastante de 1/1,2 = -16,7% para enganar quem mede degrau.
--
-- Nao para no evento. A BRAPI **ajustou a propria serie** por ele: todo fechamento anterior a
-- 08/02/2024 vem dividido por 1,2000, conferido contra fonte independente em nove datas de
-- 01/2023 a 09/2026, com a quebra exatamente em 08/02/2024. Recarregar o papel traz tudo de
-- volta, entao corrigir a nossa copia nao adianta: a correcao tem de ser reaplicada a cada
-- leitura.
--
-- Por isso sao DUAS tabelas, e nao uma. O veto impede o evento de entrar; a correcao desfaz o
-- que a fonte ja fez no preco. Uma sem a outra deixa a base pior: so vetar tira a multiplicacao
-- da quantidade e deixa o degrau de +20% na serie em 08/02/2024, que viraria lucro do nada para
-- quem atravessasse a data.

create table if not exists invest.eventos_vetados (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  classe text not null default 'QUANTIDADE',
  tipo text not null,
  data_ex date not null,
  -- Obrigatorio de proposito: veto sem justificativa vira regra sem dono seis meses depois.
  motivo text not null,
  criado_em timestamptz not null default now(),
  unique (ticker, classe, tipo, data_ex)
);

create table if not exists invest.correcoes_de_cotacao (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  -- Exclusivo: vale para `data < ate`. A data da quebra medida na serie.
  ate date not null,
  -- Multiplica o preco lido da fonte. 1,2 desfaz uma divisao por 1,2.
  fator numeric not null check (fator > 0),
  motivo text not null,
  criado_em timestamptz not null default now(),
  unique (ticker, ate, fator)
);

alter table invest.eventos_vetados enable row level security;
alter table invest.correcoes_de_cotacao enable row level security;

-- Correcao de fonte e informacao operacional, nao dado de cliente: so admin le, e ninguem
-- escreve pelo app. Quem le no sync e a service role, que ignora RLS.
drop policy if exists "admin le vetos" on invest.eventos_vetados;
create policy "admin le vetos" on invest.eventos_vetados
  for select using (invest.is_admin());

drop policy if exists "admin le correcoes" on invest.correcoes_de_cotacao;
create policy "admin le correcoes" on invest.correcoes_de_cotacao
  for select using (invest.is_admin());

grant select on invest.eventos_vetados to authenticated;
grant all on invest.eventos_vetados to service_role;
grant select on invest.correcoes_de_cotacao to authenticated;
grant all on invest.correcoes_de_cotacao to service_role;

insert into invest.eventos_vetados (ticker, classe, tipo, data_ex, motivo)
values ('BBDC4', 'QUANTIDADE', 'BONIFICACAO', '2024-02-07',
        'Nao existe. A B3 declara como ultima bonificacao do Bradesco a de 2022 (1 para 10, '
     || 'ex 18/04/2022), e o endpoint devolve a mais recente de cada rotulo - uma de 2024 '
     || 'apareceria. A queda de 07/02/2024 (16,60 para 13,96, -15,9%) foi o resultado do 4T23, '
     || 'e o detector de degrau a confundiu com 1/1,2. Conferido em 20/09/2026.')
on conflict (ticker, classe, tipo, data_ex) do nothing;

insert into invest.correcoes_de_cotacao (ticker, ate, fator, motivo)
values ('BBDC4', '2024-02-08', 1.2,
        'A BRAPI ajustou a serie pelo evento inventado acima: todo fechamento anterior a '
     || '08/02/2024 vem dividido por 1,2000. Conferido contra fonte independente em nove datas '
     || 'de 01/2023 a 09/2026 (razao 1,2000 antes, 1,0000 depois). Multiplicar de volta na '
     || 'leitura, sempre, porque a recarga traz o erro de novo.')
on conflict (ticker, ate, fator) do nothing;

-- Tira o evento da base e desfaz o ajuste na serie que ja esta gravada. A partir daqui o sync
-- refaz as duas coisas sozinho a cada leitura, porque a correcao e aplicada no dado que chega
-- da fonte, e nao no que esta guardado.
--
-- CUIDADO: o update abaixo NAO e idempotente - rodar duas vezes multiplica duas vezes. Migracao
-- roda uma vez so; se precisar repetir por qualquer motivo, confira a serie antes.
delete from invest.eventos_de_ativos e
 using invest.eventos_vetados v
 where e.ticker = v.ticker and e.classe = v.classe and e.tipo = v.tipo and e.data_ex = v.data_ex;

update invest.cotacoes_acoes c
   set fechamento = c.fechamento * k.fator,
       abertura   = c.abertura * k.fator,
       maxima     = c.maxima * k.fator,
       minima     = c.minima * k.fator
  from invest.correcoes_de_cotacao k
 where c.ticker = k.ticker and c.data < k.ate;
