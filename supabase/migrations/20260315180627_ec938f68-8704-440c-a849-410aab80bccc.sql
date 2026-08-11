-- Criar tabela para dias da semana
CREATE TABLE public.dias_semana (
  id SMALLINT PRIMARY KEY,
  sigla TEXT NOT NULL UNIQUE,
  nome_completo TEXT NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.dias_semana ENABLE ROW LEVEL SECURITY;

-- Política de leitura pública
CREATE POLICY "Dias da semana são de leitura pública"
  ON public.dias_semana
  FOR SELECT
  TO public
  USING (true);