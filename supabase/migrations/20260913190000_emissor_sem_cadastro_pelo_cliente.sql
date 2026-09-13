-- Emissor nao se cadastra pelo cliente (Daniel, 13/09/2026). A lista vem do Banco Central; a boleta deixou
-- de oferecer "Cadastrar Novo Emissor", e a garantia fica no banco, como nos termos dos titulos: sem
-- privilegio de INSERT para `authenticated`. O emissor ja criado por usuario continua visivel para ele.
drop policy if exists emissores_insert on invest.emissores;
revoke insert on invest.emissores from authenticated;
