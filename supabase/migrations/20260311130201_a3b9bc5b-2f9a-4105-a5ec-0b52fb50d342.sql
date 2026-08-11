
-- 1. Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 2. Add user_id to data tables (nullable initially for existing data)
ALTER TABLE public.custodia ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.movimentacoes ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.controle_de_carteiras ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Create function to check if email exists in profiles (public access, security definer)
CREATE OR REPLACE FUNCTION public.check_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE email = p_email
  )
$$;

-- 4. Drop old public RLS policies on custodia
DROP POLICY IF EXISTS "Custodia publicly readable" ON public.custodia;
DROP POLICY IF EXISTS "Custodia publicly insertable" ON public.custodia;
DROP POLICY IF EXISTS "Custodia publicly deletable" ON public.custodia;

-- 5. Drop old public RLS policies on movimentacoes
DROP POLICY IF EXISTS "Movimentacoes are publicly readable" ON public.movimentacoes;
DROP POLICY IF EXISTS "Movimentacoes are publicly insertable" ON public.movimentacoes;
DROP POLICY IF EXISTS "Movimentacoes publicly deletable" ON public.movimentacoes;

-- 6. Drop old public RLS policies on controle_de_carteiras
DROP POLICY IF EXISTS "controle_carteiras_select" ON public.controle_de_carteiras;
DROP POLICY IF EXISTS "controle_carteiras_insert" ON public.controle_de_carteiras;
DROP POLICY IF EXISTS "controle_carteiras_update" ON public.controle_de_carteiras;
DROP POLICY IF EXISTS "controle_carteiras_delete" ON public.controle_de_carteiras;

-- 7. New RLS policies for custodia (user-scoped)
CREATE POLICY "Users can read own custodia" ON public.custodia FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own custodia" ON public.custodia FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own custodia" ON public.custodia FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own custodia" ON public.custodia FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 8. New RLS policies for movimentacoes (user-scoped)
CREATE POLICY "Users can read own movimentacoes" ON public.movimentacoes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own movimentacoes" ON public.movimentacoes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own movimentacoes" ON public.movimentacoes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own movimentacoes" ON public.movimentacoes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9. New RLS policies for controle_de_carteiras (user-scoped)
CREATE POLICY "Users can read own carteiras" ON public.controle_de_carteiras FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own carteiras" ON public.controle_de_carteiras FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own carteiras" ON public.controle_de_carteiras FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own carteiras" ON public.controle_de_carteiras FOR DELETE TO authenticated USING (auth.uid() = user_id);
