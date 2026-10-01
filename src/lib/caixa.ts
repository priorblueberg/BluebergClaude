/**
 * O módulo Caixa: o dinheiro das contas, fora dos investimentos (Daniel, 21/09/2026).
 *
 * O dash segue o modelo da Carteira de Investimentos, trocando o que é de investimento pelo que é
 * de caixa:
 *
 *   Carteira de Investimentos        Caixa
 *   Patrimônio                       Saldo em Caixa
 *   Rentabilidade / % do CDI         Entradas e Saídas
 *   Histórico de Rentabilidade       Entradas e Saídas por mês
 *   Tabela de Rentabilidade por ano  Ponte de saldo do caixa por ano, com "No Ano"
 *   Lista de posições                Extrato de movimentações
 *
 * Duas fontes, e as duas vêm do banco de finanças pessoais pela edge function `patrimonio-pessoal`:
 *  - o SALDO é o subtotal "Caixa" do Patrimônio Global - a mesma conta, para os dois dashboards
 *    não poderem divergir;
 *  - o MOVIMENTO sai do extrato, linha a linha: entrada e saída são o que tem
 *    `contabilizar = true` (em qualquer conta, cartão incluído) e o resto é transferência entre
 *    contas. Desde 23/09/2026 é o mesmo recorte que alimenta o extrato da tela, para a tabela e a
 *    lista não poderem contar histórias diferentes.
 */
import { montarPatrimonioPorConta, type SaldoMensal } from "./patrimonioGlobal";

/** Uma linha do extrato, como a edge function devolve no recorte `extrato`. */
export interface Lancamento {
  data: string;
  descricao: string;
  conta: string;
  valor: number;
  tipo: string;
  categoria: string | null;
  subcategoria: string | null;
  /** `true` entra no resultado; `false` é transferência entre contas. */
  contabilizar: boolean;
}

/**
 * Um ano do caixa como PONTE de saldo, igual à da página de cada conta:
 *
 *   Saldo Anterior + Entradas - Saídas + Transferência entre contas = Saldo Final
 *
 * No consolidado a transferência entre contas do mesmo titular se anula (sai de uma, entra em
 * outra); o que sobra nessa linha é o dinheiro que cruza a fronteira do caixa - aporte e resgate
 * de investimento, principalmente.
 */
export interface AnoDoCaixa {
  ano: number;
  saldoAnterior: (number | null)[];
  receitas: (number | null)[];
  despesas: (number | null)[];
  /**
   * O que não é resultado e TAMBÉM não é transferência entre contas: aporte e resgate de
   * investimento, pagamento de fatura, promissória. É dinheiro que cruza a fronteira do caixa, e
   * por isso mexe no saldo.
   *
   * A transferência entre contas fica de fora da tabela do total (Daniel, 23/09/2026): "se saiu de
   * uma conta e foi pra outra, nada muda". Na página de UMA conta ela continua, porque ali ela não
   * se anula.
   */
  outrosMovimentos: (number | null)[];
  saldoFinal: (number | null)[];
  receitasNoAno: number | null;
  despesasNoAno: number | null;
  outrosNoAno: number | null;
  /**
   * Saldo Final - (Saldo Anterior + Entradas - Saídas + Transferências). Zero é a ponte fechando.
   * No consolidado ela não fecha hoje, por dois motivos conhecidos: o cartão entra como despesa na
   * data da compra e só sai do saldo quando a fatura é paga, e as contas personalizadas (Adriana,
   * Maurício, Luciana) têm saldo de recebível, com sinal próprio e
   * ajuste manual. A linha existe para a tabela não afirmar uma igualdade que não vale.
   */
  diferenca: (number | null)[];
  naoFecha: boolean;
  /**
   * O saldo de cada conta do caixa no fim de cada mês, na ordem do Patrimônio Global, com o total
   * por último. Conta sem nenhum saldo no ano fica de fora: linha em branco não diz nada
   * (Daniel, 24/09/2026).
   */
  contas: LinhaDeSaldo[];
}

/** Uma linha da tabela de saldo por conta: doze meses, janeiro a dezembro. */
export interface LinhaDeSaldo {
  rotulo: string;
  valores: (number | null)[];
  /** A linha do total, para a tabela destacar. */
  total?: boolean;
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
  };
  serieSaldo: { data: string; label: string; patrimonio: number }[];
  serieMovimento: { data: string; label: string; receitas: number; despesas: number }[];
  /** Até quando cada conta tem lançamento. */
  atualizacao: { conta: string; ate: string }[];
}

/**
 * Dinheiro do Maurício guardado com o Daniel: não é movimento dele. Mesma regra do dashboard
 * local e do recorte agregado da edge function.
 */
const ehCustodia = (l: Lancamento) => l.subcategoria === "Custódia";

/** A categoria que, no total, se anula: saiu de uma conta e entrou em outra (Daniel, 23/09/2026). */
const TRANSFERENCIA = "Transferência entre contas";

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotulo = (ym: string) => `${MESES_CURTOS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const centavos = (n: number) => Math.round(n * 100) / 100 || 0;
const soma = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? centavos(v.reduce((a, b) => a + b, 0)) : null;
};

export function montarCaixa(saldos: SaldoMensal[], lancamentos: Lancamento[]): Caixa {
  type Mes = { receitas: number; despesas: number; transferencias: number; outros: number; lancamentos: number };
  const movPorMes = new Map<string, Mes>();
  const ultimaDoConta = new Map<string, string>();
  for (const l of lancamentos) {
    const conta = l.conta || "—";
    if (!ultimaDoConta.has(conta) || l.data > ultimaDoConta.get(conta)!) ultimaDoConta.set(conta, l.data);
    if (ehCustodia(l)) continue;
    const mes = l.data.slice(0, 7);
    const m = movPorMes.get(mes) ?? { receitas: 0, despesas: 0, transferencias: 0, outros: 0, lancamentos: 0 };
    m.lancamentos++;
    const entra = l.tipo === "Entrada";
    if (l.contabilizar) {
      if (entra) m.receitas += l.valor; else m.despesas += l.valor;
    } else if (l.categoria === TRANSFERENCIA) {
      m.transferencias += entra ? l.valor : -l.valor;
    } else {
      m.outros += entra ? l.valor : -l.valor;
    }
    movPorMes.set(mes, m);
  }
  for (const [mes, m] of movPorMes) {
    movPorMes.set(mes, {
      receitas: centavos(m.receitas), despesas: centavos(m.despesas),
      transferencias: centavos(m.transferencias), outros: centavos(m.outros), lancamentos: m.lancamentos,
    });
  }
  const atualizacao = [...ultimaDoConta.entries()]
    .map(([conta, ate]) => ({ conta, ate }))
    .sort((a, b) => b.ate.localeCompare(a.ate));

  // O saldo é o subtotal Caixa do Patrimônio Global, sem o portfólio.
  const patrimonio = montarPatrimonioPorConta(saldos, null);
  const contasPorAno = new Map<number, LinhaDeSaldo[]>();
  for (const a of patrimonio.anos) {
    const linhas: LinhaDeSaldo[] = a.linhas
      .filter((l) => l.modulo === "caixa" && l.valores.some((v) => v != null))
      .map((l) => ({ rotulo: l.rotulo, valores: l.valores }));
    if (linhas.length) linhas.push({ rotulo: "Total", valores: a.subtotais.caixa, total: true });
    contasPorAno.set(a.ano, linhas);
  }
  const saldoPorMes = new Map<string, number>();
  for (const a of patrimonio.anos) {
    a.subtotais.caixa.forEach((v, i) => {
      if (v != null) saldoPorMes.set(`${a.ano}-${String(i + 1).padStart(2, "0")}`, v);
    });
  }
  const meses = [...new Set([...saldoPorMes.keys(), ...movPorMes.keys()])].sort();
  if (!meses.length) {
    return {
      anos: [], periodo: null,
      resumo: { saldo: null, ano: null, ateLabel: null, receitas: null, despesas: null },
      serieSaldo: [], serieMovimento: [], atualizacao,
    };
  }

  const anoIni = Number(meses[0].slice(0, 4));
  const anoFim = Number(meses[meses.length - 1].slice(0, 4));
  const anos: AnoDoCaixa[] = Array.from({ length: anoFim - anoIni + 1 }, (_, i) => anoFim - i).map((ano) => {
    const ym = (a: number, i: number) => `${a}-${String(i + 1).padStart(2, "0")}`;
    const mesAnterior = (i: number) => (i === 0 ? ym(ano - 1, 11) : ym(ano, i - 1));
    const saldoFinal = Array.from({ length: 12 }, (_, i) => saldoPorMes.get(ym(ano, i)) ?? null);
    const receitas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.receitas ?? null);
    const despesas = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.despesas ?? null);
    const outrosMovimentos = Array.from({ length: 12 }, (_, i) => movPorMes.get(ym(ano, i))?.outros ?? null);
    // Mês ainda por vir (sem saldo e sem movimento) não tem Saldo Anterior, como na página da conta.
    const saldoAnterior = Array.from({ length: 12 }, (_, i) =>
      saldoFinal[i] == null && !movPorMes.has(ym(ano, i)) ? null : saldoPorMes.get(mesAnterior(i)) ?? null);
    const diferenca = saldoFinal.map((f, i) =>
      f == null || saldoAnterior[i] == null
        ? null
        : centavos(f - (saldoAnterior[i]! + (receitas[i] ?? 0) - (despesas[i] ?? 0) + (outrosMovimentos[i] ?? 0))));
    return {
      ano, saldoAnterior, receitas, despesas, outrosMovimentos, saldoFinal,
      receitasNoAno: soma(receitas),
      despesasNoAno: soma(despesas),
      outrosNoAno: soma(outrosMovimentos),
      diferenca,
      naoFecha: diferenca.some((d) => d != null && Math.abs(d) >= 0.01),
      contas: contasPorAno.get(ano) ?? [],
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
      saldo: ultimoSaldo ? { valor: saldoPorMes.get(ultimoSaldo)!, label: rotulo(ultimoSaldo) } : null,
      ano: anoDoResumo,
      ateLabel: ultimoMov ? rotulo(ultimoMov) : null,
      receitas: doAno?.receitasNoAno ?? null,
      despesas: doAno?.despesasNoAno ?? null,
    },
    serieSaldo: [...saldoPorMes.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([data, patrimonio]) => ({ data, label: rotulo(data), patrimonio })),
    serieMovimento: mesesComMov.map((m) => ({
      data: m, label: rotulo(m),
      receitas: movPorMes.get(m)!.receitas, despesas: movPorMes.get(m)!.despesas,
    })),
    atualizacao,
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
  { chave: "caju", rotulo: "Conta Caju", grupo: "Contas", temSaldo: true },
  { chave: "adriana", rotulo: "Conta Adriana", grupo: "Contas", temSaldo: true },
  { chave: "mauricio", rotulo: "Conta Maurício", grupo: "Contas", temSaldo: true },
  { chave: "luciana", rotulo: "Conta Luciana", grupo: "Contas", temSaldo: true },
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
   * contas personalizadas (Maurício, Luciana, Adriana) o saldo é um
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
