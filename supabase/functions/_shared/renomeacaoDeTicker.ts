/**
 * Casamento de resposta com pedido quando a fonte troca o codigo do papel.
 *
 * A BRAPI renomeia sozinha: pede-se ELET3 e ela responde AXIA3. Medido em 09/09/2026 sobre dez
 * tickers, sete voltaram com codigo diferente - ELET3->AXIA3, EMBR3->EMBJ3, NTCO3->NATU3,
 * BRFS3->MBRF3, MRFG3->MBRF3, CCRO3->MOTV3, WIZS3->WIZC3.
 *
 * Os dois endpoints em lote que o `sync-acoes` usa tratam isso de formas diferentes:
 *
 *   `/v2/stocks/historical`  devolve `requestedSymbol`, `symbol` e `changed` no topo. Nao ha
 *                            ambiguidade: a propria resposta diz a que pedido ela responde.
 *   `/quote`                 devolve SO `symbol`. Nao ha como saber qual pedido cada resposta
 *                            atende, e e para esse caso que esta funcao existe.
 *
 * Vive aqui, e nao dentro da funcao, para ter teste: errar este casamento nao produz erro
 * visivel, produz cotacao gravada no papel ERRADO - e ninguem procura por uma cotacao que esta
 * no lugar errado, so pela que falta.
 */

export interface CasamentoPorEliminacao {
  /** devolvido -> nosso. So contem os que a eliminacao resolveu sem ambiguidade. */
  dePara: Map<string, string>;
  /** Resolvidos, para o relatorio. */
  renomeados: { nosso: string; na_fonte: string }[];
  /** Nao resolvidos. Nada deve ser gravado para estes. */
  ambiguo: { pedidos_sem_resposta: string[]; devolvidos_sem_pedido: string[] } | null;
  /** Pedidos que a fonte simplesmente nao devolveu, ja descontadas as renomeacoes. */
  semResposta: string[];
}

/**
 * Casa por eliminacao: sobrou UM pedido sem resposta e UM devolvido que ninguem pediu.
 *
 * Com dois de cada lado a atribuicao seria chute - e um chute aqui grava o preco de um papel na
 * serie de outro. Por isso o caso ambiguo nao escolhe nenhum: devolve a lista para o relatorio
 * e deixa a rodada seguinte, ou uma pessoa, resolver.
 *
 * Nao usa semelhanca de codigo de proposito. BRFS3->MBRF3 e MRFG3->MBRF3 nao compartilham nada
 * util, e MRFG3->MBRF3 e um anagrama de MRFG que uma heuristica de prefixo erraria com
 * confianca. Contagem nao chuta; semelhanca chuta e parece certa.
 */
export function casarPorEliminacao(
  pedidos: string[],
  devolvidos: string[],
): CasamentoPorEliminacao {
  const setPedidos = new Set(pedidos);
  const setDevolvidos = new Set(devolvidos.filter(Boolean));

  const semResposta = pedidos.filter((t) => !setDevolvidos.has(t));
  const naoPedidos = [...setDevolvidos].filter((t) => !setPedidos.has(t));

  if (semResposta.length === 1 && naoPedidos.length === 1) {
    return {
      dePara: new Map([[naoPedidos[0], semResposta[0]]]),
      renomeados: [{ nosso: semResposta[0], na_fonte: naoPedidos[0] }],
      ambiguo: null,
      semResposta: [],
    };
  }

  if (naoPedidos.length) {
    return {
      dePara: new Map(),
      renomeados: [],
      ambiguo: { pedidos_sem_resposta: semResposta, devolvidos_sem_pedido: naoPedidos },
      // Sem saber quais dos ausentes foram renomeados, todos continuam sendo ausentes.
      semResposta,
    };
  }

  return { dePara: new Map(), renomeados: [], ambiguo: null, semResposta };
}
