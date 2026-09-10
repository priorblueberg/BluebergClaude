/**
 * Depois de gravar uma operacao de fundo: confere na hora se a serie daquele fundo mudou (CVM 175).
 *
 * Sem isto, quem lanca hoje uma posicao num fundo que ja parou so saberia na passada seguinte da
 * rotina diaria. A funcao do servidor tenta primeiro a costura automatica; sem sucessao
 * inequivoca, cria o alerta. Nao espera a resposta: se falhar, a rotina diaria confere de novo.
 */
import { supabase } from "@/integrations/supabase/client";

/** Evento que faz o Sininho reler os alertas. */
export const EVENTO_ALERTAS = "blueberg:alertas";

export function verificarMudancaDoFundo(fundoId: string): void {
  void supabase.functions.invoke("carga-cotas-fundo", { body: { fundoId, costura: "avancar" } })
    .then(() => window.dispatchEvent(new Event(EVENTO_ALERTAS)))
    .catch(() => undefined);
}
