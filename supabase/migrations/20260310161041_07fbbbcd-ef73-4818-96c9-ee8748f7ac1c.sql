
-- Add nome_ativo and codigo_custodia columns to movimentacoes
ALTER TABLE public.movimentacoes ADD COLUMN nome_ativo text;
ALTER TABLE public.movimentacoes ADD COLUMN codigo_custodia integer;

-- Create custodia table
CREATE TABLE public.custodia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_custodia integer NOT NULL UNIQUE,
  data_inicio date NOT NULL,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  tipo_movimentacao text NOT NULL,
  instituicao_id uuid REFERENCES public.instituicoes(id),
  modalidade text,
  indexador text,
  taxa numeric,
  valor_investido numeric NOT NULL,
  preco_unitario numeric,
  quantidade numeric,
  vencimento date,
  emissor_id uuid REFERENCES public.emissores(id),
  pagamento text,
  nome text,
  categoria_id uuid NOT NULL REFERENCES public.categorias(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.custodia ENABLE ROW LEVEL SECURITY;

-- Public read/insert/delete for custodia (no auth yet)
CREATE POLICY "Custodia publicly readable" ON public.custodia FOR SELECT TO public USING (true);
CREATE POLICY "Custodia publicly insertable" ON public.custodia FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Custodia publicly deletable" ON public.custodia FOR DELETE TO public USING (true);

-- Allow delete on movimentacoes for admin purge
CREATE POLICY "Movimentacoes publicly deletable" ON public.movimentacoes FOR DELETE TO public USING (true);
