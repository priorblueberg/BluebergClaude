
CREATE TABLE public.historico_cdi (
  data date NOT NULL PRIMARY KEY,
  taxa_anual numeric(10,6) NOT NULL,
  dia_util boolean NOT NULL DEFAULT true
);

ALTER TABLE public.historico_cdi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view CDI history"
ON public.historico_cdi FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert CDI history"
ON public.historico_cdi FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update CDI history"
ON public.historico_cdi FOR UPDATE TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete CDI history"
ON public.historico_cdi FOR DELETE TO authenticated
USING (true);
