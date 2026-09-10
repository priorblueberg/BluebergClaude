/**
 * Carrega um fundo por CNPJ: ficha da CVM + backfill das cotas.
 *
 * O backfill e paginado do lado da edge function - ela processa alguns meses por chamada para
 * caber no tempo de execucao e devolve o proximo mes pendente. Quem faz o laco e o cliente, e
 * por isso ele vive aqui: a mesma sequencia e usada pelo modal de cadastro e pela busca da
 * boleta, e duas copias de um laco com ramo de subclasse e trava de voltas divergiriam.
 */
import { supabase } from "@/integrations/supabase/client";

export interface FundoCarregado {
  fundoId: string;
  nomeCurto: string | null;
  cotas: number;
}

/**
 * O mesmo CNPJ publicando mais de uma subclasse.
 *
 * Sem escolher, gravaria a cota de uma subclasse na posicao de outra - e o erro nao apareceria
 * como erro, so como rentabilidade um pouco diferente. Quem decide qual e a dele e o usuario,
 * entao isto sobe como caso proprio em vez de virar mensagem generica.
 */
export class PrecisaSubclasse extends Error {
  constructor(public readonly opcoes: string[]) {
    super("Este CNPJ publica mais de uma subclasse. Escolha qual é a sua.");
    this.name = "PrecisaSubclasse";
  }
}

interface Resposta {
  fundoId: string;
  nomeCurto: string | null;
  cotasInseridas: number;
  proximoMes: string | null;
  precisaSubclasse?: string[];
  error?: string;
}

async function chamar(payload: Record<string, unknown>): Promise<Resposta> {
  const { data, error } = await supabase.functions.invoke("cadastrar-fundo", { body: payload });
  if (error) throw new Error(error.message);
  const r = data as Resposta;
  if (r?.error) throw new Error(r.error);
  return r;
}

/** Trava de voltas: fundo antigo tem muitos meses, mas 20 chamadas ja cobrem o piso de 2023. */
const MAX_VOLTAS = 20;

export async function carregarFundo(
  cnpj: string,
  opcoes: {
    desde?: string | null;
    subclasse?: string | null;
    /** Chamado a cada volta do backfill, para a tela dizer o que esta acontecendo. */
    aoProgredir?: (cotas: number, mes: string) => void;
  } = {},
): Promise<FundoCarregado> {
  const digitos = cnpj.replace(/\D/g, "");
  if (digitos.length !== 14) throw new Error("Informe um CNPJ com 14 dígitos.");

  const { desde = null, subclasse = null, aoProgredir } = opcoes;
  let resposta = await chamar({ cnpj: digitos, desde, subclasse });
  if (resposta.precisaSubclasse?.length) throw new PrecisaSubclasse(resposta.precisaSubclasse);

  let cotas = resposta.cotasInseridas;
  for (let voltas = 0; resposta.proximoMes && voltas < MAX_VOLTAS; voltas++) {
    aoProgredir?.(cotas, resposta.proximoMes);
    resposta = await chamar({ cnpj: digitos, subclasse });
    cotas += resposta.cotasInseridas;
  }

  return { fundoId: resposta.fundoId, nomeCurto: resposta.nomeCurto, cotas };
}
