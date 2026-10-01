/**
 * Receitas e Despesas: o resultado do mês aberto por categoria e subcategoria (Daniel, 24/09/2026).
 *
 * A fonte é a mesma do Controle de Caixa Total - o recorte `extrato` da edge function
 * `patrimonio-pessoal`, linha a linha, de TODAS as contas, cartão incluído. Aqui não há saldo nem
 * ponte: é só o que entrou e o que saiu, somado por categoria.
 *
 * O que entra na conta é o que tem `contabilizar = true`. Transferência entre contas, aporte,
 * resgate, pagamento de fatura e empréstimo ficam de fora: movem dinheiro de lugar, não são
 * resultado. É a mesma regra dos cards de Entradas e Saídas do Caixa, então os números batem.
 */
import type { Lancamento } from "./caixa";

export const SEM_CATEGORIA = "Sem categoria";
export const SEM_SUBCATEGORIA = "Sem subcategoria";

export interface LinhaDeSubcategoria {
  nome: string;
  /** Doze posições, janeiro a dezembro. `null` é mês sem lançamento nessa linha. */
  meses: (number | null)[];
  total: number;
  lancamentos: number;
}

export interface LinhaDeCategoria extends LinhaDeSubcategoria {
  subcategorias: LinhaDeSubcategoria[];
}

export interface AnoDeResultado {
  ano: number;
  categorias: LinhaDeCategoria[];
  totalPorMes: (number | null)[];
  total: number;
}

const centavos = (n: number) => Math.round(n * 100) / 100 || 0;

/**
 * @param tipo "Saída" monta a tabela de despesa; "Entrada", a de receita.
 * @param primeira categoria que vai no topo da tabela, fora da ordem por valor. O Daniel pediu
 *   `Automóvel` em 24/09/2026 para conferir a primeira versão da tela.
 */
export function montarResultadoPorCategoria(
  lancamentos: Lancamento[],
  tipo: "Entrada" | "Saída",
  primeira?: string,
): { anos: AnoDeResultado[]; contas: string[] } {
  // ano -> categoria -> subcategoria -> 12 meses
  const porAno = new Map<number, Map<string, Map<string, { meses: number[]; n: number[] }>>>();
  const contas = new Set<string>();

  for (const l of lancamentos) {
    if (!l.contabilizar || l.tipo !== tipo) continue;
    contas.add(l.conta || "—");
    const ano = Number(l.data.slice(0, 4));
    const mes = Number(l.data.slice(5, 7)) - 1;
    const cat = l.categoria ?? SEM_CATEGORIA;
    const sub = l.subcategoria ?? SEM_SUBCATEGORIA;
    const categorias = porAno.get(ano) ?? new Map();
    const subs = categorias.get(cat) ?? new Map();
    const linha = subs.get(sub) ?? { meses: Array(12).fill(0), n: Array(12).fill(0) };
    linha.meses[mes] += l.valor;
    linha.n[mes] += 1;
    subs.set(sub, linha);
    categorias.set(cat, subs);
    porAno.set(ano, categorias);
  }

  const monta = (meses: number[], n: number[], nome: string): LinhaDeSubcategoria => ({
    nome,
    meses: meses.map((v, i) => (n[i] ? centavos(v) : null)),
    total: centavos(meses.reduce((a, b) => a + b, 0)),
    lancamentos: n.reduce((a, b) => a + b, 0),
  });

  const anos = [...porAno.entries()]
    .sort(([a], [b]) => b - a)
    .map(([ano, categorias]) => {
      const linhas: LinhaDeCategoria[] = [...categorias.entries()].map(([cat, subs]) => {
        const meses = Array(12).fill(0) as number[];
        const n = Array(12).fill(0) as number[];
        const subcategorias = [...subs.entries()]
          .map(([sub, x]) => {
            x.meses.forEach((v, i) => { meses[i] += v; n[i] += x.n[i]; });
            return monta(x.meses, x.n, sub);
          })
          .sort((a, b) => b.total - a.total);
        return { ...monta(meses, n, cat), subcategorias };
      });

      // Maior gasto primeiro, com a categoria pedida no topo.
      linhas.sort((a, b) => b.total - a.total);
      if (primeira) {
        const i = linhas.findIndex((l) => l.nome === primeira);
        if (i > 0) linhas.unshift(...linhas.splice(i, 1));
      }

      const totalPorMes = Array.from({ length: 12 }, (_, i) => {
        const v = linhas.map((l) => l.meses[i]).filter((x): x is number => x != null);
        return v.length ? centavos(v.reduce((a, b) => a + b, 0)) : null;
      });
      return {
        ano,
        categorias: linhas,
        totalPorMes,
        total: centavos(linhas.reduce((a, l) => a + l.total, 0)),
      };
    });

  return { anos, contas: [...contas].sort() };
}
