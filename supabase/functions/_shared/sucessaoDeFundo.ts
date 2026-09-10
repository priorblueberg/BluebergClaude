/**
 * Sucessao INEQUIVOCA entre fundos: o nivel 1 da regra de mudanca de fundo.
 *
 * Na adaptacao a Resolucao CVM 175 fundos trocaram de CNPJ ou viraram subclasse de outro, e
 * nenhum arquivo da CVM registra a ligacao. Em quase todos os casos so o cotista sabe o que
 * aconteceu (divisao em subclasses, fator de conversao, liquidacao) - esses viram alerta no
 * Sininho. Mas ha casos em que os numeros nao deixam duvida, e neles perguntar ao cliente e
 * burocracia: o Kinea Advisory para em 10/04/2025 e a Subclasse II nasce no dia util seguinte com
 * a cota continua (+0,23%), o mesmo patrimonio (R$ 411,3 mi -> 410,9 mi) e os mesmos cotistas
 * (12.189 -> 12.155), sem nenhum outro candidato. Esses sao costurados sozinhos.
 *
 * "Inequivoca" e tudo ao mesmo tempo:
 *   - uma serie para e outra nasce ate `maxDiasUteis` depois;
 *   - cota, patrimonio e numero de cotistas batem dentro das tolerancias;
 *   - o antecessor tem cotistas suficientes para o numero ser uma impressao digital (fundo de um
 *     cotista so bate com qualquer outro fundo de um cotista so);
 *   - o par e UNICO nos dois sentidos: o antecessor so tem esse sucessor, e o sucessor so tem
 *     esse antecessor.
 *
 * A tolerancia de cota e apertada de proposito: e ela que exclui o fator de conversao, que
 * precisaria mexer na quantidade do cliente. A de patrimonio e cotistas exclui a divisao em
 * subclasses, em que cada parte fica com um pedaco.
 *
 * Medido de dez/2024 a jul/2025: 17 sucessoes inequivocas entre 2.557 series que pararam, e
 * nenhuma ambigua.
 *
 * Arquivo puro, sem Deno nem Supabase, para rodar no vitest.
 */

export interface PontaDeSerie {
  /** `${cnpj}|${subclasse}` - a identidade da serie no informe. */
  chave: string;
  cnpj: string;
  subclasse: string;
  /** Ultima cota positiva (antecessor) ou primeira (sucessor). */
  data: string;
  cota: number;
  pl: number;
  cotistas: number;
}

export interface Sucessao {
  antecessor: PontaDeSerie;
  sucessor: PontaDeSerie;
  diasUteis: number;
  evidencias: {
    variacao_cota: number;
    diferenca_pl: number;
    diferenca_cotistas: number;
    dias_uteis_entre: number;
  };
}

export interface CriterioDeSucessao {
  tolCota: number;
  tolPl: number;
  tolCotistas: number;
  minCotistas: number;
  maxDiasUteis: number;
}

/** Calibrado na medicao de dez/2024 a jul/2025 (ver `_learnings` do vault, 10/09/2026). */
export const CRITERIO_DE_SUCESSAO: CriterioDeSucessao = {
  tolCota: 0.01,
  tolPl: 0.02,
  tolCotistas: 0.02,
  minCotistas: 50,
  maxDiasUteis: 3,
};

export const chaveDaSerie = (cnpj: string, subclasse: string | null | undefined) => `${cnpj}|${subclasse ?? ""}`;

/** Uma linha do informe diario ja lida: so o que a sucessao usa. */
export interface LinhaDoInforme {
  cnpj: string;
  subclasse: string;
  data: string;
  cota: number;
  pl: number;
  cotistas: number;
}

/**
 * As pontas das series numa janela de dias uteis: quem PAROU dentro dela (a ultima cota positiva
 * e anterior ao ultimo dia) e quem NASCEU (a primeira e posterior ao primeiro dia). Quem publica a
 * janela inteira nao e nem uma coisa nem outra.
 */
export function pontasDaJanela(
  linhas: LinhaDoInforme[],
  diasUteis: string[],
): { paradas: PontaDeSerie[]; nascidas: PontaDeSerie[] } {
  const dias = [...diasUteis].sort();
  if (!dias.length) return { paradas: [], nascidas: [] };
  const inicio = dias[0];
  const fim = dias[dias.length - 1];
  const porChave = new Map<string, { primeira: LinhaDoInforme; ultima: LinhaDoInforme }>();
  for (const l of linhas) {
    if (!(l.cota > 0) || !(l.pl > 0) || l.data < inicio || l.data > fim) continue;
    const chave = chaveDaSerie(l.cnpj, l.subclasse);
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { primeira: l, ultima: l });
    } else {
      if (l.data < atual.primeira.data) atual.primeira = l;
      if (l.data > atual.ultima.data) atual.ultima = l;
    }
  }
  const ponta = (chave: string, l: LinhaDoInforme): PontaDeSerie =>
    ({ chave, cnpj: l.cnpj, subclasse: l.subclasse, data: l.data, cota: l.cota, pl: l.pl, cotistas: l.cotistas });
  const paradas: PontaDeSerie[] = [];
  const nascidas: PontaDeSerie[] = [];
  for (const [chave, { primeira, ultima }] of porChave) {
    if (ultima.data < fim) paradas.push(ponta(chave, ultima));
    if (primeira.data > inicio) nascidas.push(ponta(chave, primeira));
  }
  return { paradas, nascidas };
}

export function sucessoesInequivocas(
  paradas: PontaDeSerie[],
  nascidas: PontaDeSerie[],
  diasUteis: string[],
  criterio: CriterioDeSucessao = CRITERIO_DE_SUCESSAO,
): Sucessao[] {
  const posicao = new Map(diasUteis.map((d, i) => [d, i] as const));
  const porAntecessor = new Map<string, Sucessao[]>();
  const porSucessor = new Map<string, Sucessao[]>();

  for (const a of paradas) {
    if (a.cotistas < criterio.minCotistas || !(a.cota > 0) || !(a.pl > 0)) continue;
    const ia = posicao.get(a.data);
    if (ia == null) continue;
    for (const s of nascidas) {
      if (s.chave === a.chave) continue;
      const is = posicao.get(s.data);
      if (is == null) continue;
      const gap = is - ia;
      if (gap < 1 || gap > criterio.maxDiasUteis) continue;
      const variacaoCota = s.cota / a.cota - 1;
      const diferencaPl = s.pl / a.pl - 1;
      const diferencaCotistas = (s.cotistas - a.cotistas) / a.cotistas;
      if (Math.abs(variacaoCota) > criterio.tolCota) continue;
      if (Math.abs(diferencaPl) > criterio.tolPl) continue;
      if (Math.abs(diferencaCotistas) > criterio.tolCotistas) continue;
      const sucessao: Sucessao = {
        antecessor: a,
        sucessor: s,
        diasUteis: gap,
        evidencias: {
          variacao_cota: variacaoCota,
          diferenca_pl: diferencaPl,
          diferenca_cotistas: diferencaCotistas,
          dias_uteis_entre: gap,
        },
      };
      porAntecessor.set(a.chave, [...(porAntecessor.get(a.chave) ?? []), sucessao]);
      porSucessor.set(s.chave, [...(porSucessor.get(s.chave) ?? []), sucessao]);
    }
  }

  return [...porAntecessor.values()]
    .filter((lista) => lista.length === 1 && porSucessor.get(lista[0].sucessor.chave)!.length === 1)
    .map((lista) => lista[0]);
}

// ── Divisao em subclasses (cenario B4) ──────────────────────────────────────────────────────
//
// A classe cria subclasses e DIVIDE os cotistas entre elas. Nenhuma subclasse sozinha fica com o
// patrimonio e os cotistas, entao a sucessao acima nao a reconhece - e nao deve: so o cotista sabe
// em que subclasse caiu. Mas para TRAS nao ha duvida: ate a vespera todo cotista tinha a cota da
// classe, e as subclasses nascem com ela. Por isso a divisao so costura para tras.
//
// Medido de dez/2024 a jul/2025: 47 divisoes, 15 limpas. Nas limpas a cota das subclasses no
// primeiro dia difere no maximo 0,03% da classe, e a maior subclasse fica com 90% ou mais dos
// cotistas. As que nao batem sao, em geral, divisao somada a incorporacao de FICs no mesmo dia
// (os cotistas aumentam), e ficam de fora.

export interface Divisao {
  antecessor: PontaDeSerie;
  sucessores: PontaDeSerie[];
  diasUteis: number;
  evidencias: {
    subclasses: number;
    maior_variacao_cota: number;
    diferenca_pl: number;
    diferenca_cotistas: number;
    dias_uteis_entre: number;
  };
}

/**
 * Divisao inequivoca: a serie SEM subclasse para, e duas ou mais subclasses do MESMO CNPJ nascem
 * ate `maxDiasUteis` depois, todas com a cota antiga (dentro de `tolCota`), com a SOMA de
 * patrimonio e de cotistas batendo com a classe, que precisa ter `minCotistas` ou mais.
 */
export function divisoesInequivocas(
  paradas: PontaDeSerie[],
  nascidas: PontaDeSerie[],
  diasUteis: string[],
  criterio: CriterioDeSucessao = CRITERIO_DE_SUCESSAO,
): Divisao[] {
  const posicao = new Map(diasUteis.map((d, i) => [d, i] as const));
  const out: Divisao[] = [];
  for (const a of paradas) {
    if (a.subclasse !== "" || a.cotistas < criterio.minCotistas || !(a.cota > 0) || !(a.pl > 0)) continue;
    const ia = posicao.get(a.data);
    if (ia == null) continue;
    const filhas = nascidas.filter((s) => {
      if (s.cnpj !== a.cnpj || !s.subclasse) return false;
      const is = posicao.get(s.data);
      return is != null && is - ia >= 1 && is - ia <= criterio.maxDiasUteis;
    });
    if (filhas.length < 2) continue;
    const maiorVariacao = Math.max(...filhas.map((s) => Math.abs(s.cota / a.cota - 1)));
    if (maiorVariacao > criterio.tolCota) continue;
    const diferencaPl = filhas.reduce((t, s) => t + s.pl, 0) / a.pl - 1;
    const diferencaCotistas = (filhas.reduce((t, s) => t + s.cotistas, 0) - a.cotistas) / a.cotistas;
    if (Math.abs(diferencaPl) > criterio.tolPl || Math.abs(diferencaCotistas) > criterio.tolCotistas) continue;
    const gap = Math.max(...filhas.map((s) => posicao.get(s.data)! - ia));
    out.push({
      antecessor: a,
      sucessores: filhas,
      diasUteis: gap,
      evidencias: {
        subclasses: filhas.length,
        maior_variacao_cota: maiorVariacao,
        diferenca_pl: diferencaPl,
        diferenca_cotistas: diferencaCotistas,
        dias_uteis_entre: gap,
      },
    });
  }
  return out;
}
