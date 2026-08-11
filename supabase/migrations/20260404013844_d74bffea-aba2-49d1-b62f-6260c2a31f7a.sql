ALTER TABLE public.custodia DROP CONSTRAINT custodia_codigo_custodia_key;
ALTER TABLE public.custodia ADD CONSTRAINT custodia_codigo_custodia_user_id_key UNIQUE (codigo_custodia, user_id);