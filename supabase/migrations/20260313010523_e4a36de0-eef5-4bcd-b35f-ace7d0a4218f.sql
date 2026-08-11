
-- Drop the trigger first
DROP TRIGGER IF EXISTS trg_sync_dia_util ON public.historico_cdi;

-- Drop the function
DROP FUNCTION IF EXISTS public.sync_dia_util_from_calendario();

-- Drop the column
ALTER TABLE public.historico_cdi DROP COLUMN dia_util;
