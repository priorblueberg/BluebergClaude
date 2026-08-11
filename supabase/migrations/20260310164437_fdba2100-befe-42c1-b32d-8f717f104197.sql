
-- Add missing columns to movimentacoes
ALTER TABLE public.movimentacoes ADD COLUMN IF NOT EXISTS indexador text;
ALTER TABLE public.movimentacoes ADD COLUMN IF NOT EXISTS quantidade numeric;
ALTER TABLE public.movimentacoes ADD COLUMN IF NOT EXISTS valor_extrato text;

-- Add new columns to custodia
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS resgate_total numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS status_variavel text;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS data_calculo date;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS multiplicador numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS amortizacao numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS rendimentos numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS alocacao_patrimonial numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS pu_inicial numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS carteira text;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS data_limite date;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS sigla_tesouro text;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS custodia_no_dia numeric;
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS estrategia text;

-- Create calendario_dias_uteis table
CREATE TABLE public.calendario_dias_uteis (
  data DATE PRIMARY KEY,
  dia_util BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.calendario_dias_uteis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dias uteis publicly readable"
  ON public.calendario_dias_uteis
  FOR SELECT
  TO public
  USING (true);

INSERT INTO public.calendario_dias_uteis (data, dia_util) VALUES
('2024-12-30', true),('2024-12-31', true),
('2025-01-01', false),('2025-01-02', true),('2025-01-03', true),('2025-01-04', false),('2025-01-05', false),
('2025-01-06', true),('2025-01-07', true),('2025-01-08', true),('2025-01-09', true),('2025-01-10', true),
('2025-01-11', false),('2025-01-12', false),('2025-01-13', true),('2025-01-14', true),('2025-01-15', true),
('2025-01-16', true),('2025-01-17', true),('2025-01-18', false),('2025-01-19', false),('2025-01-20', true),
('2025-01-21', true),('2025-01-22', true),('2025-01-23', true),('2025-01-24', true),('2025-01-25', false),
('2025-01-26', false),('2025-01-27', true),('2025-01-28', true),('2025-01-29', true),('2025-01-30', true),
('2025-01-31', true),('2025-02-01', false),('2025-02-02', false),('2025-02-03', true),('2025-02-04', true),
('2025-02-05', true),('2025-02-06', true),('2025-02-07', true),('2025-02-08', false),('2025-02-09', false),
('2025-02-10', true),('2025-02-11', true),('2025-02-12', true),('2025-02-13', true),('2025-02-14', true),
('2025-02-15', false),('2025-02-16', false),('2025-02-17', true),('2025-02-18', true),('2025-02-19', true),
('2025-02-20', true),('2025-02-21', true),('2025-02-22', false),('2025-02-23', false),('2025-02-24', true),
('2025-02-25', true),('2025-02-26', true),('2025-02-27', true),('2025-02-28', true),('2025-03-01', false),
('2025-03-02', false),('2025-03-03', false),('2025-03-04', false),('2025-03-05', true),('2025-03-06', true),
('2025-03-07', true),('2025-03-08', false),('2025-03-09', false),('2025-03-10', true),('2025-03-11', true),
('2025-03-12', true),('2025-03-13', true),('2025-03-14', true),('2025-03-15', false),('2025-03-16', false),
('2025-03-17', true),('2025-03-18', true),('2025-03-19', true),('2025-03-20', true),('2025-03-21', true),
('2025-03-22', false),('2025-03-23', false),('2025-03-24', true),('2025-03-25', true),('2025-03-26', true),
('2025-03-27', true),('2025-03-28', true),('2025-03-29', false),('2025-03-30', false),('2025-03-31', true),
('2025-04-01', true),('2025-04-02', true),('2025-04-03', true),('2025-04-04', true),('2025-04-05', false),
('2025-04-06', false),('2025-04-07', true),('2025-04-08', true),('2025-04-09', true),('2025-04-10', true),
('2025-04-11', true),('2025-04-12', false),('2025-04-13', false),('2025-04-14', true),('2025-04-15', true),
('2025-04-16', true),('2025-04-17', true),('2025-04-18', false),('2025-04-19', false),('2025-04-20', false),
('2025-04-21', false),('2025-04-22', true),('2025-04-23', true),('2025-04-24', true),('2025-04-25', true),
('2025-04-26', false),('2025-04-27', false),('2025-04-28', true),('2025-04-29', true),('2025-04-30', true),
('2025-05-01', false),('2025-05-02', true),('2025-05-03', false),('2025-05-04', false),('2025-05-05', true),
('2025-05-06', true),('2025-05-07', true),('2025-05-08', true),('2025-05-09', true),('2025-05-10', false),
('2025-05-11', false),('2025-05-12', true),('2025-05-13', true),('2025-05-14', true),('2025-05-15', true),
('2025-05-16', true),('2025-05-17', false),('2025-05-18', false),('2025-05-19', true),('2025-05-20', true),
('2025-05-21', true),('2025-05-22', true),('2025-05-23', true),('2025-05-24', false),('2025-05-25', false),
('2025-05-26', true),('2025-05-27', true),('2025-05-28', true),('2025-05-29', true),('2025-05-30', true),
('2025-05-31', false),('2025-06-01', false),('2025-06-02', true),('2025-06-03', true),('2025-06-04', true),
('2025-06-05', true),('2025-06-06', true),('2025-06-07', false),('2025-06-08', false),('2025-06-09', true),
('2025-06-10', true),('2025-06-11', true),('2025-06-12', true),('2025-06-13', true),('2025-06-14', false),
('2025-06-15', false),('2025-06-16', true),('2025-06-17', true),('2025-06-18', true),('2025-06-19', false),
('2025-06-20', true),('2025-06-21', false),('2025-06-22', false),('2025-06-23', true),('2025-06-24', true),
('2025-06-25', true),('2025-06-26', true),('2025-06-27', true),('2025-06-28', false),('2025-06-29', false),
('2025-06-30', true),('2025-07-01', true),('2025-07-02', true),('2025-07-03', true),('2025-07-04', true),
('2025-07-05', false),('2025-07-06', false),('2025-07-07', true),('2025-07-08', true),('2025-07-09', true),
('2025-07-10', true),('2025-07-11', true),('2025-07-12', false),('2025-07-13', false),('2025-07-14', true),
('2025-07-15', true),('2025-07-16', true),('2025-07-17', true),('2025-07-18', true),('2025-07-19', false),
('2025-07-20', false),('2025-07-21', true),('2025-07-22', true),('2025-07-23', true),('2025-07-24', true),
('2025-07-25', true),('2025-07-26', false),('2025-07-27', false),('2025-07-28', true),('2025-07-29', true),
('2025-07-30', true),('2025-07-31', true),('2025-08-01', true),('2025-08-02', false),('2025-08-03', false),
('2025-08-04', true),('2025-08-05', true),('2025-08-06', true),('2025-08-07', true),('2025-08-08', true),
('2025-08-09', false),('2025-08-10', false),('2025-08-11', true),('2025-08-12', true),('2025-08-13', true),
('2025-08-14', true),('2025-08-15', true),('2025-08-16', false),('2025-08-17', false),('2025-08-18', true),
('2025-08-19', true),('2025-08-20', true),('2025-08-21', true),('2025-08-22', true),('2025-08-23', false),
('2025-08-24', false),('2025-08-25', true),('2025-08-26', true),('2025-08-27', true),('2025-08-28', true),
('2025-08-29', true),('2025-08-30', false),('2025-08-31', false),('2025-09-01', true),('2025-09-02', true),
('2025-09-03', true),('2025-09-04', true),('2025-09-05', true),('2025-09-06', false),('2025-09-07', false),
('2025-09-08', true),('2025-09-09', true),('2025-09-10', true),('2025-09-11', true),('2025-09-12', true),
('2025-09-13', false),('2025-09-14', false),('2025-09-15', true),('2025-09-16', true),('2025-09-17', true),
('2025-09-18', true),('2025-09-19', true),('2025-09-20', false),('2025-09-21', false),('2025-09-22', true),
('2025-09-23', true),('2025-09-24', true),('2025-09-25', true),('2025-09-26', true),('2025-09-27', false),
('2025-09-28', false),('2025-09-29', true),('2025-09-30', true),('2025-10-01', true),('2025-10-02', true),
('2025-10-03', true),('2025-10-04', false),('2025-10-05', false),('2025-10-06', true),('2025-10-07', true),
('2025-10-08', true),('2025-10-09', true),('2025-10-10', true),('2025-10-11', false),('2025-10-12', false),
('2025-10-13', true),('2025-10-14', true),('2025-10-15', true),('2025-10-16', true),('2025-10-17', true),
('2025-10-18', false),('2025-10-19', false),('2025-10-20', true),('2025-10-21', true),('2025-10-22', true),
('2025-10-23', true),('2025-10-24', true),('2025-10-25', false),('2025-10-26', false),('2025-10-27', true),
('2025-10-28', true),('2025-10-29', true),('2025-10-30', true),('2025-10-31', true),('2025-11-01', false),
('2025-11-02', false),('2025-11-03', true),('2025-11-04', true),('2025-11-05', true),('2025-11-06', true),
('2025-11-07', true),('2025-11-08', false),('2025-11-09', false),('2025-11-10', true),('2025-11-11', true),
('2025-11-12', true),('2025-11-13', true),('2025-11-14', true),('2025-11-15', false),('2025-11-16', false),
('2025-11-17', true),('2025-11-18', true),('2025-11-19', true),('2025-11-20', false),('2025-11-21', true),
('2025-11-22', false),('2025-11-23', false),('2025-11-24', true),('2025-11-25', true),('2025-11-26', true),
('2025-11-27', true),('2025-11-28', true),('2025-11-29', false),('2025-11-30', false),('2025-12-01', true),
('2025-12-02', true),('2025-12-03', true),('2025-12-04', true),('2025-12-05', true),('2025-12-06', false),
('2025-12-07', false),('2025-12-08', true),('2025-12-09', true),('2025-12-10', true),('2025-12-11', true),
('2025-12-12', true),('2025-12-13', false),('2025-12-14', false),('2025-12-15', true),('2025-12-16', true),
('2025-12-17', true),('2025-12-18', true),('2025-12-19', true),('2025-12-20', false),('2025-12-21', false),
('2025-12-22', true),('2025-12-23', true),('2025-12-24', false),('2025-12-25', false),('2025-12-26', true),
('2025-12-27', false),('2025-12-28', false),('2025-12-29', true),('2025-12-30', true),('2025-12-31', false);
