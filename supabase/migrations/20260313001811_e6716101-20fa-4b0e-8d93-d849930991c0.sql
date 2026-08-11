
-- Trigger function: sync dia_util from calendario_dias_uteis on insert/update
CREATE OR REPLACE FUNCTION public.sync_dia_util_from_calendario()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT dia_util INTO NEW.dia_util
  FROM public.calendario_dias_uteis
  WHERE data = NEW.data;

  -- If no match found in calendario, default to false
  IF NEW.dia_util IS NULL THEN
    NEW.dia_util := false;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on historico_cdi
CREATE TRIGGER trg_sync_dia_util
BEFORE INSERT OR UPDATE ON public.historico_cdi
FOR EACH ROW
EXECUTE FUNCTION public.sync_dia_util_from_calendario();

-- Update existing records
UPDATE public.historico_cdi h
SET dia_util = COALESCE(c.dia_util, false)
FROM public.calendario_dias_uteis c
WHERE h.data = c.data;
