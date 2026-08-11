
CREATE TABLE public.historico_ibovespa (
  data date NOT NULL PRIMARY KEY,
  pontos numeric NOT NULL
);

ALTER TABLE public.historico_ibovespa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ibovespa history publicly readable"
  ON public.historico_ibovespa FOR SELECT
  TO public USING (true);

CREATE POLICY "Authenticated users can insert ibovespa"
  ON public.historico_ibovespa FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ibovespa"
  ON public.historico_ibovespa FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete ibovespa"
  ON public.historico_ibovespa FOR DELETE
  TO authenticated USING (true);
