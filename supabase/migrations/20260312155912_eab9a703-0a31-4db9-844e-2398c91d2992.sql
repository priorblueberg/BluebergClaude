
CREATE POLICY "Temp public insert for data load"
ON public.historico_cdi FOR INSERT TO anon
WITH CHECK (true);
