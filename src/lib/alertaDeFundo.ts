/**
 * Alerta de fundo sem cota da CVM (decisao do Daniel, 12/09/2026).
 *
 * Substituiu o sino, a costura automatica e a "Mudança de Fundo" dentro da posicao. A ferramenta nao
 * tenta adivinhar o que aconteceu com o fundo: quando a CVM para de publicar a cota dele, a posicao com
 * saldo mostra um "!" ao lado do nome, com o texto e duas saidas - encerrar a posicao (resgate com
 * "Fechar Posição" na data da ultima cota) ou migra-la para o fundo novo, que so o cliente sabe qual e.
 *
 * O alerta e calculado na leitura, com a serie do fundo: quando a cota volta, ele some sozinho.
 */

/** Dias uteis sem cota, alem do atraso normal da CVM, para o alerta aparecer. */
export const DIAS_UTEIS_SEM_COTA = 5;

/** Quantos dias uteis a CVM costuma levar para publicar a cota do dia. */
export const DIAS_UTEIS_DE_ATRASO_DA_CVM = 2;

/** Faixa em que a cota nova e "a mesma" da antiga na migracao: acima dela, houve conversao. */
export const FAIXA_MESMA_COTA = 0.02;

/** O que o alerta precisa para abrir as duas boletas. */
export interface AlertaSemCota {
  codigoCustodia: string;
  fundoId: string;
  fundoNome: string;
  instituicaoId: string | null;
  instituicaoNome: string;
  /** Data da ultima cota publicada. */
  ultimaCota: string;
  /** Valor da ultima cota publicada. */
  valorCota: number | null;
}

/**
 * Data da ultima cota quando o fundo esta sem cota da CVM, ou null.
 *
 * Conta os dias uteis depois da ultima cota ate a referencia, que e a data global menos o atraso normal
 * da CVM. Com DIAS_UTEIS_SEM_COTA ou mais, o fundo "parou". Sem cota nenhuma, nao ha o que avisar.
 */
export function fundoSemCotaDesde(
  calendario: { data: string; dia_util: boolean }[],
  ultimaCota: string | null,
  dataGlobal: string,
): string | null {
  if (!ultimaCota) return null;
  const uteis = calendario.filter((d) => d.dia_util && d.data <= dataGlobal).map((d) => d.data).sort();
  const referencia = uteis.length > DIAS_UTEIS_DE_ATRASO_DA_CVM ? uteis[uteis.length - 1 - DIAS_UTEIS_DE_ATRASO_DA_CVM] : null;
  if (!referencia) return null;
  const semCota = uteis.filter((d) => d > ultimaCota && d <= referencia).length;
  return semCota >= DIAS_UTEIS_SEM_COTA ? ultimaCota : null;
}

/**
 * Quantidade sugerida no fundo novo, que o cliente confere pelo extrato e pode corrigir: a mesma, se a
 * cota nova esta a ate 2% da antiga (subclasse que nasce com a cota da classe, FIC que vira subclasse);
 * senao, a quantidade que preserva o valor (houve fator de conversao).
 */
export function quantidadeSugeridaNaMigracao(
  saldo: number,
  cotaAntiga: number | null,
  cotaNova: number,
): { quantidade: number; criterio: "mesma" | "valor" } {
  if (!(cotaAntiga != null && cotaAntiga > 0) || !(cotaNova > 0)) return { quantidade: saldo, criterio: "mesma" };
  if (Math.abs(cotaNova / cotaAntiga - 1) <= FAIXA_MESMA_COTA) return { quantidade: saldo, criterio: "mesma" };
  return { quantidade: Math.round(((saldo * cotaAntiga) / cotaNova) * 1e8) / 1e8, criterio: "valor" };
}

/** Texto do alerta, depois do titulo com a data da ultima cota. */
export const TEXTO_FUNDO_SEM_COTA =
  "O fundo pode ter sido encerrado, incorporado a outro fundo, migrado para outro CNPJ ou dividido em " +
  "subclasses. Confirme com a corretora ou o gestor antes de registrar a mudança.";
