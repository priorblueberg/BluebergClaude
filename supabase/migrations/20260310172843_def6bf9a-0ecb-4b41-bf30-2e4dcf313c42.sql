
CREATE TABLE public.controle_de_carteiras (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  categoria_id uuid NOT NULL REFERENCES public.categorias(id),
  nome_carteira text NOT NULL,
  data_inicio date,
  data_limite date,
  resgate_total date,
  data_calculo date,
  status text NOT NULL DEFAULT 'Ativa',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.controle_de_carteiras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "controle_carteiras_select" ON public.controle_de_carteiras FOR SELECT TO public USING (true);
CREATE POLICY "controle_carteiras_insert" ON public.controle_de_carteiras FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "controle_carteiras_update" ON public.controle_de_carteiras FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "controle_carteiras_delete" ON public.controle_de_carteiras FOR DELETE TO public USING (true);
