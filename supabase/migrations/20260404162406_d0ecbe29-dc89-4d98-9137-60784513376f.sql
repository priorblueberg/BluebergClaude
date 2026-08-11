
-- Tabela de lotes de poupança (controle FIFO)
CREATE TABLE public.poupanca_lotes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  custodia_id uuid REFERENCES public.custodia(id) ON DELETE CASCADE,
  codigo_custodia integer NOT NULL,
  data_aplicacao date NOT NULL,
  dia_aniversario integer NOT NULL,
  valor_principal numeric NOT NULL,
  valor_atual numeric NOT NULL,
  rendimento_acumulado numeric NOT NULL DEFAULT 0,
  ultimo_aniversario date,
  status text NOT NULL DEFAULT 'ativo',
  data_resgate date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para consultas frequentes
CREATE INDEX idx_poupanca_lotes_user_custodia_status 
  ON public.poupanca_lotes (user_id, custodia_id, status);

-- RLS
ALTER TABLE public.poupanca_lotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own poupanca_lotes"
  ON public.poupanca_lotes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own poupanca_lotes"
  ON public.poupanca_lotes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own poupanca_lotes"
  ON public.poupanca_lotes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own poupanca_lotes"
  ON public.poupanca_lotes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Tabela de histórico da Selic
CREATE TABLE public.historico_selic (
  data date NOT NULL PRIMARY KEY,
  taxa_anual numeric NOT NULL
);

ALTER TABLE public.historico_selic ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Selic history publicly readable"
  ON public.historico_selic FOR SELECT
  TO public
  USING (true);
