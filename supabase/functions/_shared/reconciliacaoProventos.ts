/**
 * Reconciliacao de proventos: o que a B3 declara contra o que a base tem.
 *
 * Vive separado das duas funcoes que a usam - `sync-acoes`, que COMPLETA a base, e
 * `auditoria-proventos`, que so RELATA - por dois motivos. O primeiro e nao ter duas copias
 * divergindo, que ja aconteceu neste projeto. O segundo e poder testar: aqui nao ha fetch, nao
 * ha banco e nao ha Deno, entao o vitest roda isto direto.
 *
 * Nao e detalhe de organizacao. Esta funcao teve TRES defeitos em 09/09/2026, todos com a mesma
 * assinatura - inserir linha a mais em silencio - e todos pegos conferindo numero a numero,
 * porque nao havia teste. Os tres estao no arquivo de teste ao lado, cada um com o caso que o
 * denuncia.
 */

/** Uma parcela que ja esta na nossa base. */
export interface ParcelaNossa {
  dataEx: string;
  tipo: string;
  valor: number;
  aprovacao: string | null;
}

/** Uma parcela declarada pela B3. O tipo e generico para o chamador anexar o que quiser. */
export interface ParcelaDeclarada {
  dataEx: string;
  tipo: string;
  valor: number;
  aprovacao: string | null;
}

export interface ResultadoReconciliacao<T> {
  /** Declaradas pela B3 que a base nao tem. Prontas para inserir. */
  faltantes: T[];
  /** Linhas nossas sem par na B3. NAO se apaga nada por isso - so se mostra. */
  sobrando: { dataEx: string; tipo: string; nossas: ParcelaNossa[] }[];
}

/**
 * Quanto dois valores podem diferir e ainda serem a MESMA parcela.
 *
 * A tolerancia e ABSOLUTA, e isso importa. O erro nao e proporcional ao valor: e a BRAPI
 * arredondando na SEXTA casa decimal, o que limita a diferenca a 5e-7 seja qual for o provento.
 * Uma tolerancia relativa erra nos dois extremos - passou em 0,313115 (1,5e-6 relativo) e
 * falhou em 0,018975 (1,0e-5 relativo), sendo exatamente o mesmo fenomeno.
 *
 * Medido em 09/09/2026 sobre 8.320 parcelas de 67 empresas: os unicos pares de valores
 * distintos separados por menos de 1e-6 diferem por 1e-11 a 1e-10, residuo do rateio da propria
 * declaracao - e abaixo da precisao da coluna, que e numeric(18,8). Nao existe caso em que esta
 * tolerancia funda parcelas economicamente diferentes.
 */
export const TOLERANCIA_VALOR = 1e-6;

export const mesmoValor = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA_VALOR;

const chaveDe = (dataEx: string, tipo: string) => `${dataEx}|${tipo}`;

/**
 * Compara por CONTAGEM dentro de (data-ex, tipo), com o valor casado por tolerancia.
 *
 * Tem que ser por contagem, e nao por upsert. A razao e concreta: o endpoint da B3 nao publica
 * data de pagamento, entao a linha vinda dela tem esse campo nulo. Como o indice unico inclui
 * essa coluna, ela seria uma CHAVE DIFERENTE da linha equivalente da BRAPI e entraria ao lado
 * dela - dobrando o provento em vez de completar. Deduplicacao por chave nao protege disso.
 *
 * @param piso  data-ex minima. Parcela anterior e descartada: abaixo do piso nada e calculado.
 */
export function reconciliarProventos<T extends ParcelaDeclarada>(
  nossas: ParcelaNossa[],
  declaradas: T[],
  piso?: string,
): ResultadoReconciliacao<T> {
  const porChaveNossa = new Map<string, ParcelaNossa[]>();
  for (const n of nossas) {
    const k = chaveDe(n.dataEx, n.tipo);
    const lista = porChaveNossa.get(k);
    if (lista) lista.push(n);
    else porChaveNossa.set(k, [n]);
  }

  const porChaveDeles = new Map<string, T[]>();
  for (const d of declaradas) {
    const k = chaveDe(d.dataEx, d.tipo);
    const lista = porChaveDeles.get(k);
    if (lista) lista.push(d);
    else porChaveDeles.set(k, [d]);
  }

  const faltantes: T[] = [];
  const sobrando: ResultadoReconciliacao<T>["sobrando"] = [];

  for (const [k, parcelas] of porChaveDeles) {
    const pendentes = [...(porChaveNossa.get(k) ?? [])];

    // 1a passada: casa por VALOR (com tolerancia) e aprovacao IGUAL. E o que da a atribuicao
    // correta quando o mesmo valor aparece duas vezes na mesma data-ex por programas
    // diferentes - o caso do ITSA4 em 05/03/2025, em que caem a ultima parcela do programa
    // aprovado em 19/02/2024 e a primeira do aprovado em 10/02/2025.
    const sobraram: T[] = [];
    for (const parcela of parcelas) {
      const i = pendentes.findIndex((n) =>
        n.aprovacao === parcela.aprovacao && mesmoValor(n.valor, parcela.valor));
      if (i >= 0) pendentes.splice(i, 1);
      else sobraram.push(parcela);
    }

    // 2a passada: o que sobrou consome as linhas restantes de mesmo VALOR, seja qual for a
    // aprovacao delas. Sem isto, toda parcela que a BRAPI publica com aprovacao nula viraria
    // "faltante" e entraria como duplicata, DOBRANDO o provento. A contagem manda; a aprovacao
    // so decide QUAL parcela recebe a atribuicao.
    for (const parcela of sobraram) {
      const i = pendentes.findIndex((n) => mesmoValor(n.valor, parcela.valor));
      if (i >= 0) { pendentes.splice(i, 1); continue; }
      if (!piso || parcela.dataEx >= piso) faltantes.push(parcela);
    }

    if (pendentes.length) {
      sobrando.push({ dataEx: parcelas[0].dataEx, tipo: parcelas[0].tipo, nossas: pendentes });
    }
  }

  return { faltantes, sobrando };
}
