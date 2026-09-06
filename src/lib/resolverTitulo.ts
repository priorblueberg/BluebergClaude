import { supabase } from "@/integrations/supabase/client";

/**
 * Identidade de um papel de renda fixa. E a mesma chave unica da tabela: dois clientes que
 * comprem o MESMO papel caem no mesmo registro, em vez de duplica-lo.
 */
export interface IdentidadeDoTitulo {
  produto_id: string;
  emissor_id: string | null;
  modalidade: string;
  indexador: string | null;
  taxa: number;
  vencimento: string;
  pagamento: string | null;
}

/**
 * Devolve o id do titulo no cadastro compartilhado, criando-o se for a primeira vez que
 * alguem compra esse papel. Devolve null quando nao foi possivel gravar - o chamador deve
 * ABORTAR a operacao: com os termos vivendo no cadastro, uma movimentacao sem titulo ficaria
 * sem onde guarda-los.
 */
export async function resolverTitulo(
  identidade: IdentidadeDoTitulo,
  extras: { preco_emissao: number | null; nome: string | null; criado_por: string }
): Promise<string | null> {
  const { data: jaExiste } = await supabase
    .from("cadastro_de_titulos")
    .select("id")
    .match(identidade as any)
    .maybeSingle();
  if (jaExiste) return (jaExiste as any).id;

  const { data: criado, error } = await supabase
    .from("cadastro_de_titulos")
    .insert({ ...identidade, ...extras } as any)
    .select("id")
    .maybeSingle();
  if (error || !criado) {
    console.error("nao foi possivel cadastrar o titulo", error);
    return null;
  }
  return (criado as any).id;
}
