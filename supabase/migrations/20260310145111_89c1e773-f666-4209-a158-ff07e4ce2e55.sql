
-- Categorias de produtos
CREATE TABLE public.categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categorias are publicly readable" ON public.categorias FOR SELECT USING (true);

-- Produtos (linked to categoria)
CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  categoria_id UUID NOT NULL REFERENCES public.categorias(id),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Produtos are publicly readable" ON public.produtos FOR SELECT USING (true);

-- Instituições
CREATE TABLE public.instituicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.instituicoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Instituicoes are publicly readable" ON public.instituicoes FOR SELECT USING (true);

-- Emissores
CREATE TABLE public.emissores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.emissores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Emissores are publicly readable" ON public.emissores FOR SELECT USING (true);

-- Movimentações (transaction records)
CREATE TABLE public.movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.categorias(id),
  tipo_movimentacao TEXT NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id),
  valor NUMERIC(15,2) NOT NULL,
  preco_unitario NUMERIC(15,2),
  instituicao_id UUID REFERENCES public.instituicoes(id),
  emissor_id UUID REFERENCES public.emissores(id),
  modalidade TEXT,
  taxa NUMERIC(8,4),
  pagamento TEXT,
  vencimento DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Movimentacoes are publicly readable" ON public.movimentacoes FOR SELECT USING (true);
CREATE POLICY "Movimentacoes are publicly insertable" ON public.movimentacoes FOR INSERT WITH CHECK (true);

-- Seed data
INSERT INTO public.categorias (nome) VALUES
  ('Renda Fixa'),
  ('Renda Variável'),
  ('Fundos de Investimentos'),
  ('Tesouro Direto');

INSERT INTO public.produtos (nome, categoria_id) 
SELECT p.nome, c.id 
FROM (VALUES ('CDB'), ('CRI'), ('CRA'), ('Debêntures'), ('LCI'), ('LCA'), ('LF')) AS p(nome)
CROSS JOIN public.categorias c WHERE c.nome = 'Renda Fixa';

INSERT INTO public.instituicoes (nome) VALUES
  ('Banco Bradesco'),
  ('Banco Itaú');

INSERT INTO public.emissores (nome) VALUES
  ('Banco Master'),
  ('Banco Panamericano');
