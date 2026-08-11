CREATE TABLE public.historico_tr (
  data date NOT NULL PRIMARY KEY,
  taxa_mensal numeric NOT NULL
);

ALTER TABLE public.historico_tr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TR history publicly readable"
  ON public.historico_tr
  FOR SELECT
  TO public
  USING (true);
