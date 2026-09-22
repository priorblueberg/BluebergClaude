/**
 * O módulo Caixa: o dinheiro das contas, fora dos investimentos (Daniel, 21/09/2026).
 *
 * O dash segue o modelo da Carteira de Investimentos, trocando o que é de investimento pelo que é
 * de caixa:
 *
 *   Carteira de Investimentos        Caixa
 *   Patrimônio                       Saldo em Caixa
 *   Ganho Financeiro                 Resultado (receitas - despesas)
 *   Rentabilidade / % do CDI         Receitas e Despesas
 *   Histórico de Rentabilidade       Receitas e Despesas por mês
 *   Tabela de Rentabilidade por ano  Tabela do Caixa por ano, com "No Ano"
 *   Lista de posições                Despesas por categoria no ano
 *
 * Duas fontes, e as duas vêm do banco de finanças pessoais pela edge function `patrimonio-pessoal`:
 *  - o SALDO é o subtotal "Caixa" do Patrimônio Global - a mesma conta, para os dois dashboards
 *    não poderem divergir;
 *  - RECEITA e DESPESA são os lançamentos com `contabilizar = true`, de qualquer conta, cartão
 *    incluído, agregados por mês na própria função.
 */
import { montarPatrimonioPorConta, type SaldoMensal } from "./patrimonioGlobal";

export interface MovimentoDoMes {
  /** `AAAA-MM` */
  mes: string;
  receitas: number;
  despesas: number;
  lancamentos: number;
}

export interface DespesaDaCategoria {
  mes: string;
  categoria: string;
  valor: number;
}

export interface AnoDoCaixa {
  ano: number;
  saldo: (number | null)[];
  receitas: (number | null)[];
  despesas: (number | null)[];
  resultado: (number | null)[];
  receitasNoAno: number | null;
  despesasNoAno: number | null;
  resultadoNoAno: number | null;
}

export interface CategoriaDoAno {
  categoria: string;
  valor: number;
  /** Participação no total de despesas do ano, em %. */
  pct: number;
  /** Valor dividido pelos meses do ano que têm movimento. */
  mediaMensal: number;
}

export interface Caixa {
  /** Do ano mais recente para o mais antigo. */
  anos: AnoDoCaixa[];
  periodo: { de: string; ate: string } | null;
  resumo: {
    saldo: { valor: number; label: string } | null;
    /** O ano dos cards de movimento: o mais recente com lançamento. */
    ano: number | null;
    ateLabel: string | null;
    receitas: number | null;
    despesas: number | null;
    resultado: number | null;
  };
  serieSaldo: { data: string; label: string; patrimonio: number }[];
  serieMovimento: { data: string; label: string; receitas: number; despesas: number }[];
  categoriasDoAno: { ano: number; itens: CategoriaDoAno[] } | null;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotulo = (ym: string) => `${MESES_CURTOS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const centavos = (n: number) => Math.round(n * 100) / 100 || 0;
const soma = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? centavos(v.reduce((a, b) => a + b, 0)) : null;
};

export function montarCaixa(
  saldos: SaldoMensal[],
  movimento: MovimentoDoMes[],
  despesaPorCategoria: DespesaDaCategoria[],
): Caixa {
  // O saldo é o subtotal Caixa do Patrimônio Global, sem o portfólio.
  const patrimonio = montarPatrimonioPorConta(saldos, null);
  const saldoPorMes = new Map<string, number>();
  for (const a of patrimonio.anos) {
    a.subtotais.caixa.forEach((v, i) => {
      if (v != null) saldoPorMes.set(`${a.ano}-${String(i + 1).padStart(2, "0")}`, v);
    });
  }
  const movPorMes = new Map(movimento.map((m) => [m.mes, m]));

  const meses = [...new Set([...saldoPorMes.keys(), ...movPorMes.keys()])].sort();
  if (!meses.length) {
    return {
      anos: [], periodo: null,
      resumo: { saldo: null, ano: null, ateLabel: null, receitas: null, despesas: null, resultado: null },
      serieSaldo: [], serieMovimento: [], categoriasDoAno: null,
    };
  }

  const anoIni = Number(meses[0].slice(0, 4));
  const anoFim = Number(meses[meses.length - 1].slice(0, 4));
  const anos: AnoDoCaixa[] = Array.from({ length: anoFim - anoIni + 1 }, (_, i) => anoFim - i).map((ano) => {
    const ym = (i: number) => `${ano}-${String(i + 1).padStart(2, "0")}`;
    const saldo = Array.from({ length: 12 }, (_, i) => saldoPorMes.get(ym(i)) ?? null);
    const receitas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(i))?.receitas ?? null);
    const despesas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(i))?.despesas ?? null);
    const resultado = receitas.map((r, i) =>
      r == null && despesas[i] == null ? null : centavos((r ?? 0) - (despesas[i] ?? 0)));
    return {
      ano, saldo, receitas, despesas, resultado,
      receitasNoAno: soma(receitas),
      despesasNoAno: soma(despesas),
      resultadoNoAno: soma(resultado),
    };
  });

  const ultimoSaldo = [...saldoPorMes.keys()].sort().at(-1);
  const mesesComMov = [...movPorMes.keys()].sort();
  const ultimoMov = mesesComMov.at(-1);
  const anoDoResumo = ultimoMov ? Number(ultimoMov.slice(0, 4)) : null;
  const doAno = anos.find((a) => a.ano === anoDoResumo);

  let categoriasDoAno: Caixa["categoriasDoAno"] = null;
  if (anoDoResumo != null) {
    const porCategoria = new Map<string, number>();
    for (const d of despesaPorCategoria) {
      if (Number(d.mes.slice(0, 4)) !== anoDoResumo) continue;
      porCategoria.set(d.categoria, (porCategoria.get(d.categoria) ?? 0) + d.valor);
    }
    const total = [...porCategoria.values()].reduce((a, b) => a + b, 0);
    const mesesNoAno = mesesComMov.filter((m) => Number(m.slice(0, 4)) === anoDoResumo).length || 1;
    categoriasDoAno = {
      ano: anoDoResumo,
      itens: [...porCategoria.entries()]
        .map(([categoria, valor]) => ({
          categoria,
          valor: centavos(valor),
          pct: total > 0 ? (valor / total) * 100 : 0,
          mediaMensal: centavos(valor / mesesNoAno),
        }))
        .sort((a, b) => b.valor - a.valor),
    };
  }

  return {
    anos,
    periodo: { de: meses[0], ate: meses[meses.length - 1] },
    resumo: {
      saldo: ultimoSaldo ? { valor: saldoPorMes.get(ultimoSaldo)!, label: rotulo(ultimoSaldo) } : null,
      ano: anoDoResumo,
      ateLabel: ultimoMov ? rotulo(ultimoMov) : null,
      receitas: doAno?.receitasNoAno ?? null,
      despesas: doAno?.despesasNoAno ?? null,
      resultado: doAno?.resultadoNoAno ?? null,
    },
    serieSaldo: [...saldoPorMes.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([data, patrimonio]) => ({ data, label: rotulo(data), patrimonio })),
    serieMovimento: mesesComMov.map((m) => ({
      data: m, label: rotulo(m),
      receitas: movPorMes.get(m)!.receitas, despesas: movPorMes.get(m)!.despesas,
    })),
    categoriasDoAno,
  };
}

// ── A página de uma conta ────────────────────────────────────────────────────────────────────

/**
 * As contas que o seletor do Caixa oferece. A chave é a mesma da linha no Patrimônio Global (de
 * onde vem o saldo) e a mesma da lista fechada na edge function (de onde vem o extrato). Cartão
 * não tem saldo: é movimento, e o pagamento da fatura aparece na conta que pagou.
 */
export const CONTAS_DO_CAIXA: {
  chave: string; rotulo: string; grupo: "Contas" | "Cartões"; temSaldo: boolean;
}[] = [
  { chave: "cc", rotulo: "Conta Corrente (Bradesco)", grupo: "Contas", temSaldo: true },
  { chave: "cc_xp", rotulo: "Conta Digital (XP)", grupo: "Contas", temSaldo: true },
  { chave: "adriana", rotulo: "Conta Adriana", grupo: "Contas", temSaldo: true },
  { chave: "mauricio", rotulo: "Conta Maurício", grupo: "Contas", temSaldo: true },
  { chave: "luciana", rotulo: "Conta Luciana", grupo: "Contas", temSaldo: true },
  { chave: "osvaldo", rotulo: "Conta Osvaldo Cruz", grupo: "Contas", temSaldo: true },
  { chave: "samambaia", rotulo: "Conta Samambaia", grupo: "Contas", temSaldo: true },
  { chave: "cartao_bradesco", rotulo: "Cartão Bradesco", grupo: "Cartões", temSaldo: false },
  { chave: "cartao_xp", rotulo: "Cartão XP", grupo: "Cartões", temSaldo: false },
];

export interface MovimentoDaConta {
  mes: string;
  entradas: number;
  saidas: number;
  lancamentos: number;
  /** `contabilizar = true`: entra no resultado. */
  receitas: number;
  despesas: number;
  /** O resto, líquido (entradas - saídas): fatura, aplicação e resgate, promissória, idas e vindas. */
  transferencias: number;
}

/**
 * Um ano da conta como uma PONTE de saldo, mês a mês (Daniel, 21/09/2026):
 *
 *   Saldo Anterior + Receitas - Despesas + Transferência entre contas = Saldo Final
 *
 * O Saldo Anterior de um mês é o Saldo Final do mês de antes - o de janeiro é o de dezembro do ano
 * anterior. Sem saldo no mês de antes, fica em branco.
 *
 * O mês ainda aberto (movimento sem saldo registrado, como setembro em 21/09/2026) ganha um Saldo
 * Final PARCIAL, calculado pela própria ponte - mas só quando a conta fechou a ponte no último mês
 * registrado. Nas contas personalizadas, em que o movimento não reproduz o saldo, a conta daria um
 * número inventado, e o mês fica em branco.
 *
 * Na coluna "No Ano" não há Saldo Anterior nem Saldo Final (Daniel, 21/09/2026): saldo não se soma.
 */
export interface AnoDaConta {
  ano: number;
  saldoAnterior: (number | null)[];
  receitas: (number | null)[];
  despesas: (number | null)[];
  transferencias: (number | null)[];
  saldoFinal: (number | null)[];
  /** O Saldo Final do mês é parcial: calculado pela ponte, o mês ainda não fechou. */
  saldoFinalParcial: boolean[];
  receitasNoAno: number | null;
  despesasNoAno: number | null;
  transferenciasNoAno: number | null;
  /**
   * Saldo Final - (Saldo Anterior + Receitas - Despesas + Transferências), onde há os dois saldos.
   * Zero é a ponte fechando. Existe para a tabela não afirmar uma igualdade que não vale: nas
   * contas personalizadas (Maurício, Luciana, Osvaldo Cruz, Samambaia, Adriana) o saldo é um
   * recebível com regras próprias - sinal invertido, custódia fora, ajuste manual - e o
   * movimento da categoria não o reproduz.
   */
  diferenca: (number | null)[];
  diferencaNoAno: number | null;
  /** Algum mês do ano, ou o ano, não fecha. */
  naoFecha: boolean;
}

export interface Conta {
  anos: AnoDaConta[];
  periodo: { de: string; ate: string } | null;
  resumo: {
    saldo: { valor: number; label: string; parcial: boolean } | null;
    ano: number | null;
    ateLabel: string | null;
    receitas: number | null;
    despesas: number | null;
    transferencias: number | null;
  };
  serieSaldo: { data: string; label: string; patrimonio: number }[];
  serieMovimento: { data: string; label: string; receitas: number; despesas: number }[];
}

export function montarConta(saldos: SaldoMensal[], chave: string, movimento: MovimentoDaConta[]): Conta {
  const saldoPorMes = new Map<string, number>();
  for (const a of montarPatrimonioPorConta(saldos, null).anos) {
    const linha = a.linhas.find((l) => l.chave === chave);
    linha?.valores.forEach((v, i) => {
      if (v != null) saldoPorMes.set(`${a.ano}-${String(i + 1).padStart(2, "0")}`, v);
    });
  }
  const movPorMes = new Map(movimento.map((m) => [m.mes, m]));
  const meses = [...new Set([...saldoPorMes.keys(), ...movPorMes.keys()])].sort();
  if (!meses.length) {
    return {
      anos: [], periodo: null,
      resumo: { saldo: null, ano: null, ateLabel: null, receitas: null, despesas: null, transferencias: null },
      serieSaldo: [], serieMovimento: [],
    };
  }

  const ym = (ano: number, i: number) => `${ano}-${String(i + 1).padStart(2, "0")}`;
  const mesAnterior = (ano: number, i: number) => (i === 0 ? ym(ano - 1, 11) : ym(ano, i - 1));
  const antesDe = (m: string) => mesAnterior(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1);
  const ponteDoMes = (m: string, anterior: number) => {
    const x = movPorMes.get(m);
    return centavos(anterior + (x?.receitas ?? 0) - (x?.despesas ?? 0) + (x?.transferencias ?? 0));
  };

  // Os meses abertos depois do último saldo registrado: saldo parcial pela ponte, se ela fechou
  // no último mês registrado.
  const parciais = new Set<string>();
  const ultimoRegistrado = [...saldoPorMes.keys()].sort().at(-1);
  if (ultimoRegistrado) {
    const antes = saldoPorMes.get(antesDe(ultimoRegistrado));
    const fechou = antes != null && Math.abs(ponteDoMes(ultimoRegistrado, antes) - saldoPorMes.get(ultimoRegistrado)!) < 0.01;
    if (fechou) {
      for (const m of [...movPorMes.keys()].sort()) {
        if (m <= ultimoRegistrado) continue;
        const anterior = saldoPorMes.get(antesDe(m));
        if (anterior == null) break;
        saldoPorMes.set(m, ponteDoMes(m, anterior));
        parciais.add(m);
      }
    }
  }

  const anoIni = Number(meses[0].slice(0, 4));
  const anoFim = Number(meses[meses.length - 1].slice(0, 4));
  const anos: AnoDaConta[] = Array.from({ length: anoFim - anoIni + 1 }, (_, i) => anoFim - i).map((ano) => {
    const saldoFinal = Array.from({ length: 12 }, (_, i) => saldoPorMes.get(ym(ano, i)) ?? null);
    // Mês ainda por vir (sem saldo e sem movimento) não tem Saldo Anterior: a linha acaba onde a
    // conta acaba.
    const saldoAnterior = Array.from({ length: 12 }, (_, i) =>
      saldoFinal[i] == null && !movPorMes.has(ym(ano, i)) ? null : saldoPorMes.get(mesAnterior(ano, i)) ?? null);
    const receitas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.receitas ?? null);
    const despesas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.despesas ?? null);
    const transferencias = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.transferencias ?? null);
    const saldoFinalParcial = Array.from({ length: 12 }, (_, i) => parciais.has(ym(ano, i)));
    const ponte = (ant: number | null, rec: number | null, desp: number | null, tr: number | null, fim: number | null) =>
      ant == null || fim == null ? null : centavos(fim - (ant + (rec ?? 0) - (desp ?? 0) + (tr ?? 0)));
    // O mês parcial fecha por construção: não entra na diferença.
    const diferenca = saldoFinal.map((f, i) =>
      saldoFinalParcial[i] ? null : ponte(saldoAnterior[i], receitas[i], despesas[i], transferencias[i], f));
    // A diferença do ano é a soma das do mês: a ponte encadeia, e o que sobra em cada mês se acumula.
    const diferencaNoAno = soma(diferenca);
    return {
      ano, saldoAnterior, receitas, despesas, transferencias, saldoFinal, saldoFinalParcial,
      receitasNoAno: soma(receitas),
      despesasNoAno: soma(despesas),
      transferenciasNoAno: soma(transferencias),
      diferenca, diferencaNoAno,
      naoFecha: [...diferenca, diferencaNoAno].some((d) => d != null && Math.abs(d) >= 0.01),
    };
  });

  const ultimoSaldo = [...saldoPorMes.keys()].sort().at(-1);
  const mesesComMov = [...movPorMes.keys()].sort();
  const ultimoMov = mesesComMov.at(-1);
  const anoDoResumo = ultimoMov ? Number(ultimoMov.slice(0, 4)) : null;
  const doAno = anos.find((a) => a.ano === anoDoResumo);

  return {
    anos,
    periodo: { de: meses[0], ate: meses[meses.length - 1] },
    resumo: {
      saldo: ultimoSaldo
        ? { valor: saldoPorMes.get(ultimoSaldo)!, label: rotulo(ultimoSaldo), parcial: parciais.has(ultimoSaldo) }
        : null,
      ano: anoDoResumo,
      ateLabel: ultimoMov ? rotulo(ultimoMov) : null,
      receitas: doAno?.receitasNoAno ?? null,
      despesas: doAno?.despesasNoAno ?? null,
      transferencias: doAno?.transferenciasNoAno ?? null,
    },
    serieSaldo: [...saldoPorMes.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([data, patrimonio]) => ({ data, label: rotulo(data), patrimonio })),
    serieMovimento: mesesComMov.map((m) => ({
      data: m, label: rotulo(m), receitas: movPorMes.get(m)!.receitas, despesas: movPorMes.get(m)!.despesas,
    })),
  };
}
