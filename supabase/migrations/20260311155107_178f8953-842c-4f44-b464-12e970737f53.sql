
ALTER TABLE public.custodia DROP COLUMN IF EXISTS carteira;
ALTER TABLE public.custodia ALTER COLUMN alocacao_patrimonial TYPE text USING alocacao_patrimonial::text;
