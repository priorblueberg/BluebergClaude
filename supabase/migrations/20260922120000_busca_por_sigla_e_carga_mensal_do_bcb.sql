-- Duas coisas que a sessao de 22/09/2026 mostrou faltarem nas bases de referencia:
--
-- 1. A BUSCA SO ACHA A RAZAO SOCIAL. O Daniel procurou "BNDES" e nao veio nada: na base esta
--    "BANCO NACIONAL DO DESENVOLVIMENTO ECONOMICO E SOCIAL". Ninguem guarda razao social; guarda
--    a sigla e o apelido. A sigla e derivavel do proprio nome (as iniciais das palavras que
--    contam), entao ela vira coluna gerada e vale para toda linha que entrar depois. O apelido,
--    que nao se deriva ("nubank" para NU PAGAMENTOS), fica numa coluna que se preenche a mao.
--
-- 2. A CARGA DO BCB E UMA FOTO. `emissores` e `instituicoes` foram carregadas em 16/08/2026 da
--    lista de instituicoes EM FUNCIONAMENTO. Quem entra em liquidacao sai dessa lista, e o titulo
--    emitido por ela continua na carteira - foi o caso do Banco Master. Em 22/09/2026 carreguei a
--    mao a base irma (servico `regimes_especiais`). Agora as duas cargas viram rotina mensal, com
--    a marca "(em liquidacao extrajudicial)" aplicada tambem em quem ja estava cadastrado.
--
-- A rotina NAO apaga nem desativa ninguem: instituicao que some da lista do BCB continua aqui,
-- porque pode haver posicao boletada com ela.

-- ── 1. Busca por sigla e apelido ─────────────────────────────────────────────────────────────

-- Iniciais das palavras que contam, para o nome cujas iniciais sao a sigla de mercado:
-- "BANCO NACIONAL DO DESENVOLVIMENTO ECONOMICO E SOCIAL" -> "bndes", "CAIXA ECONOMICA FEDERAL"
-- -> "cef", "BANCO DO BRASIL S.A." -> "bb". Preposicoes e o tipo societario ficam de fora.
-- Nome de uma palavra so nao tem sigla, e sigla longa demais (cooperativa com nome de frase) nao
-- ajuda ninguem a achar.
create or replace function invest.sigla_do_nome(p_nome text)
returns text
language sql
immutable
as $$
  with palavras as (
    select p, n
    from unnest(string_to_array(
      regexp_replace(
        lower(translate(coalesce(p_nome, ''),
          'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
          'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
        '[^a-z0-9]+', ' ', 'g'),
      ' ')) with ordinality as t(p, n)
    where p <> ''
      and p not in ('de','do','da','dos','das','e','em','no','na','nos','nas','a','o','as','os',
                    'ao','aos','para','com','sa','s','ltda','me','epp','cia','eireli','filial')
  ), sigla as (
    select string_agg(left(p, 1), '' order by n) as s, count(*) as qtd from palavras
  )
  select case when qtd between 2 and 8 then s end from sigla;
$$;

comment on function invest.sigla_do_nome(text) is
  'Iniciais das palavras significativas do nome, usada na busca da boleta (BNDES, CEF, BB).';

alter table invest.emissores add column if not exists apelidos text;
alter table invest.instituicoes add column if not exists apelidos text;

comment on column invest.emissores.apelidos is
  'Como o mercado chama a instituicao, quando nao se deriva do nome (ex.: "nubank"). Separar por espaco.';
comment on column invest.instituicoes.apelidos is
  'Como o mercado chama a instituicao, quando nao se deriva do nome (ex.: "nubank"). Separar por espaco.';

-- O que a boleta procura: o nome sem acento, a sigla e os apelidos, no mesmo texto. Coluna gerada
-- nao pode referenciar outra coluna gerada, entao o nome e normalizado de novo aqui.
alter table invest.emissores add column if not exists termos_busca text
  generated always as (
    lower(translate(nome,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
    || ' ' || coalesce(invest.sigla_do_nome(nome), '')
    || ' ' || coalesce(lower(apelidos), '')
  ) stored;

alter table invest.instituicoes add column if not exists termos_busca text
  generated always as (
    lower(translate(nome,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
    || ' ' || coalesce(invest.sigla_do_nome(nome), '')
    || ' ' || coalesce(lower(apelidos), '')
  ) stored;

create index if not exists emissores_termos_trgm on invest.emissores using gin (termos_busca gin_trgm_ops);
create index if not exists instituicoes_termos_trgm on invest.instituicoes using gin (termos_busca gin_trgm_ops);

-- Os apelidos que a sigla nao alcanca. Lista curta de proposito: so o que o Daniel usaria na
-- boleta e nao esta no nome nem nas iniciais.
with apelido (cnpj, texto) as (values
  ('18236120', 'nubank nu'),
  ('92702067', 'banrisul'),
  ('04902979', 'basa'),
  ('08561701', 'pagbank pagseguro'),
  ('17351180', 'tribanco'),
  ('00360305', 'caixa cef')
)
update invest.emissores e set apelidos = a.texto
from apelido a where e.cnpj = a.cnpj and e.user_id is null and e.apelidos is null;

with apelido (cnpj, texto) as (values
  ('18236120', 'nubank nu'),
  ('92702067', 'banrisul'),
  ('04902979', 'basa'),
  ('08561701', 'pagbank pagseguro'),
  ('17351180', 'tribanco'),
  ('00360305', 'caixa cef')
)
update invest.instituicoes i set apelidos = a.texto
from apelido a where i.cnpj = a.cnpj and i.user_id is null and i.apelidos is null;

-- ── 2. Carga mensal das duas listas do BCB ───────────────────────────────────────────────────

-- Segmentos que entram em `instituicoes` (quem custodia ou intermedia). `emissores` leva a lista
-- inteira, porque qualquer uma pode emitir.
create or replace function invest.segmento_de_instituicao(p_segmento text)
returns boolean
language sql
immutable
as $$
  select p_segmento in (
    'Banco Múltiplo', 'Banco Comercial', 'Banco de Investimento', 'Banco de Câmbio',
    'Banco de Desenvolvimento', 'Banco Múltiplo Cooperativo', 'Banco Comercial Estrangeiro - Filial no país',
    'Banco do Brasil - Banco Múltiplo', 'Caixa Econômica Federal', 'BNDES',
    'Sociedade Corretora de TVM', 'Sociedade Distribuidora de TVM',
    'Cooperativa de Crédito', 'Instituição de Pagamento'
  );
$$;

create or replace function invest.sincronizar_bases_do_bcb()
returns jsonb
language plpgsql
security definer
set search_path to 'invest', 'extensions', 'public', 'pg_catalog'
as $$
declare
  recursos text[] := array['SedesBancoComMultCE', 'SedesSociedades', 'SedesCooperativas'];
  recurso text;
  url text;
  resposta extensions.http_response;
  novos_emissores int := 0;
  novas_instituicoes int := 0;
  novos_regimes int := 0;
  marcados int := 0;
  n int;
begin
  -- A extensao http corta em 5s por padrao, e esses recursos passam disso.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '30');

  create temp table bcb_em_funcionamento (cnpj text, nome text, segmento text) on commit drop;
  create temp table bcb_regimes (cnpj text, nome text, inicio text) on commit drop;

  foreach recurso in array recursos loop
    -- SedesCooperativas nao expoe SEGMENTO: pedir a coluna devolve HTML de erro.
    url := 'https://olinda.bcb.gov.br/olinda/servico/Instituicoes_em_funcionamento/versao/v1/odata/'
      || recurso || '?$format=json&$select=CNPJ,NOME_INSTITUICAO'
      || case when recurso = 'SedesCooperativas' then '' else ',SEGMENTO' end;

    resposta := extensions.http_get(url);
    if resposta.status <> 200 then
      raise exception 'BCB % devolveu status %', recurso, resposta.status;
    end if;

    insert into bcb_em_funcionamento (cnpj, nome, segmento)
    select v ->> 'CNPJ', btrim(v ->> 'NOME_INSTITUICAO'),
           coalesce(v ->> 'SEGMENTO', 'Cooperativa de Crédito')
    from jsonb_array_elements((resposta.content::jsonb) -> 'value') as v
    where coalesce(v ->> 'CNPJ', '') <> '' and coalesce(v ->> 'NOME_INSTITUICAO', '') <> '';

    get diagnostics n = row_count;
    -- Recurso vazio e sinal de mudanca na fonte, nao de mercado sem instituicoes.
    if n = 0 then
      raise exception 'BCB % veio sem linhas', recurso;
    end if;
  end loop;

  resposta := extensions.http_get(
    'https://olinda.bcb.gov.br/olinda/servico/regimes_especiais/versao/v1/odata/Regimes?$format=json');
  if resposta.status <> 200 then
    raise exception 'BCB regimes_especiais devolveu status %', resposta.status;
  end if;

  insert into bcb_regimes (cnpj, nome, inicio)
  select v ->> 'CnpjRaiz', btrim(v ->> 'NomeInstituicao'), v ->> 'Inicio'
  from jsonb_array_elements((resposta.content::jsonb) -> 'value') as v
  where coalesce(v ->> 'CnpjRaiz', '') <> '' and coalesce(v ->> 'NomeInstituicao', '') <> '';

  -- Em funcionamento: so o que ainda nao existe. Quem ja esta cadastrado nao e tocado, porque
  -- pode ter sido renomeado a mao (a marca de liquidacao, por exemplo).
  insert into invest.emissores (nome, cnpj, segmento, origem, ativo, user_id)
  select b.nome, b.cnpj, b.segmento, 'bcb', true, null
  from bcb_em_funcionamento b
  where not exists (
    select 1 from invest.emissores e where e.user_id is null and e.cnpj = b.cnpj
  )
  on conflict do nothing;
  get diagnostics novos_emissores = row_count;

  insert into invest.instituicoes (nome, cnpj, segmento, origem, ativa, user_id)
  select b.nome, b.cnpj, b.segmento, 'bcb', true, null
  from bcb_em_funcionamento b
  where invest.segmento_de_instituicao(b.segmento)
    and not exists (
      select 1 from invest.instituicoes i where i.user_id is null and i.cnpj = b.cnpj
    )
  on conflict do nothing;
  get diagnostics novas_instituicoes = row_count;

  -- Em liquidacao: entra quem falta, com a marca no proprio nome (a boleta so mostra o nome).
  insert into invest.emissores (nome, cnpj, segmento, origem, ativo, user_id)
  select r.nome || ' (em liquidação extrajudicial)', r.cnpj,
         'Em liquidação extrajudicial desde ' || r.inicio, 'bcb_regime_especial', true, null
  from bcb_regimes r
  where not exists (
    select 1 from invest.emissores e where e.user_id is null and e.cnpj = r.cnpj
  )
  on conflict do nothing;
  get diagnostics novos_regimes = row_count;

  -- E quem ja estava cadastrado como em funcionamento ganha a marca agora.
  update invest.emissores e
  set nome = e.nome || ' (em liquidação extrajudicial)',
      segmento = 'Em liquidação extrajudicial desde ' || r.inicio,
      origem = 'bcb_regime_especial'
  from bcb_regimes r
  where e.cnpj = r.cnpj and e.user_id is null and e.nome not like '%liquidação extrajudicial%';
  get diagnostics marcados = row_count;

  update invest.instituicoes i
  set nome = i.nome || ' (em liquidação extrajudicial)',
      segmento = 'Em liquidação extrajudicial desde ' || r.inicio,
      origem = 'bcb_regime_especial'
  from bcb_regimes r
  where i.cnpj = r.cnpj and i.user_id is null and i.nome not like '%liquidação extrajudicial%';

  return jsonb_build_object(
    'quando', now(),
    'novos_emissores', novos_emissores,
    'novas_instituicoes', novas_instituicoes,
    'novos_em_liquidacao', novos_regimes,
    'marcados_em_liquidacao', marcados
  );
end;
$$;

comment on function invest.sincronizar_bases_do_bcb() is
  'Recarrega emissores e instituicoes das duas listas do BCB (em funcionamento + regimes especiais). Mensal, pelo cron.';

revoke all on function invest.sincronizar_bases_do_bcb() from public;

-- Todo dia 1o, 09:00 UTC (06:00 de Brasilia), fora do horario dos crons de mercado.
select cron.schedule('bases-do-bcb-mensal', '0 9 1 * *', 'select invest.sincronizar_bases_do_bcb()');
