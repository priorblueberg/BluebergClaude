
CREATE TABLE public.historico_poupanca_rendimento (
  data date NOT NULL PRIMARY KEY,
  rendimento_mensal numeric NOT NULL
);

ALTER TABLE public.historico_poupanca_rendimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Poupanca rendimento publicly readable"
ON public.historico_poupanca_rendimento
FOR SELECT
TO public
USING (true);
