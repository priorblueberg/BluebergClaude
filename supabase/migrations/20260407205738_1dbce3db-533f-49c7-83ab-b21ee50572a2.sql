-- 1. Move the "Poupança" product from Poupança category to Renda Fixa category
UPDATE public.produtos
SET categoria_id = '47b2c6b5-8b20-48e8-9d05-4b9f52747dda'
WHERE id = 'b75613e8-d1fc-4f94-8b05-bffc5e78b583';

-- 2. Inactivate the Poupança category
UPDATE public.categorias
SET ativa = false
WHERE id = 'a3626d46-97f7-4d32-ab2f-37027aee8846';

-- 3. Reclassify all custodia records from Poupança category to Renda Fixa
UPDATE public.custodia
SET categoria_id = '47b2c6b5-8b20-48e8-9d05-4b9f52747dda',
    alocacao_patrimonial = 'Renda Fixa',
    estrategia = 'Poupança'
WHERE categoria_id = 'a3626d46-97f7-4d32-ab2f-37027aee8846';

-- 4. Reclassify all movimentacoes from Poupança category to Renda Fixa
UPDATE public.movimentacoes
SET categoria_id = '47b2c6b5-8b20-48e8-9d05-4b9f52747dda'
WHERE categoria_id = 'a3626d46-97f7-4d32-ab2f-37027aee8846';

-- 5. Delete Poupança carteira records (they'll be absorbed into Renda Fixa on next sync)
DELETE FROM public.controle_de_carteiras
WHERE categoria_id = 'a3626d46-97f7-4d32-ab2f-37027aee8846';