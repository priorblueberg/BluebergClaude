-- Remove duplicates keeping the oldest record per (nome_carteira, user_id)
DELETE FROM controle_de_carteiras
WHERE id NOT IN (
  SELECT DISTINCT ON (nome_carteira, user_id) id
  FROM controle_de_carteiras
  ORDER BY nome_carteira, user_id, created_at ASC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE controle_de_carteiras
ADD CONSTRAINT unique_carteira_per_user UNIQUE (nome_carteira, user_id);