/**
 * Patrimônio por Conta: a tabela do dashboard de finanças pessoais, trazida para o Blueberg.
 *
 * A referência é `renderPatrimonioPorConta` em `financas-pessoais/_dashboard/index.html`, e esta
 * função reproduz o que ela faz, com uma diferença deliberada: conta que está na base e não tem
 * linha na tabela é DEVOLVIDA, em `foraDaTabela`, em vez de sumir. O dashboard original descarta
 * em silêncio, e foi exatamente assim que a Custódia do Maurício (R$ 288 mil) ficou fora de uma
 * tabela sem ninguém perceber.
 *
 * O dado vem de `saldos_mensais`, do projeto de finanças pessoais, pela edge function
 * `patrimonio-pessoal` - nunca direto do navegador (ver o cabeçalho da função).
 *
 * Uma linha NÃO vem de lá: a de investimentos. Até 21/09/2026 ela era "XP Investimentos", o
 * saldo que o Daniel digitava todo mês em `saldos_mensais`, com a custódia do Maurício descontada.
 * Desde então é o patrimônio do portfólio **Pessoal** no próprio Blueberg, calculado pelos
 * motores - e a custódia do Maurício deixou de ser desconto, porque virou portfólio próprio.
 */

export interface SaldoMensal {
  /** Primeiro dia do mês, `AAAA-MM-01`. */
  ano_mes: string;
  instituicao: string;
  tipo_conta: string;
  saldo_final: number | string;
}

export interface LinhaDaConta {
  chave: string;
  rotulo: string;
  /** Doze posições, janeiro a dezembro. `null` é mês sem saldo registrado. */
  valores: (number | null)[];
}

export interface AnoDoPatrimonio {
  ano: number;
  linhas: LinhaDaConta[];
  /** Soma das contas com saldo no mês; `null` quando nenhuma tem. */
  total: (number | null)[];
}

export interface PatrimonioPorConta {
  /** Do ano mais recente para o mais antigo. */
  anos: AnoDoPatrimonio[];
  /** Combinações de instituição e tipo de conta que existem na base e não entram em linha nenhuma. */
  foraDaTabela: { instituicao: string; tipoConta: string; meses: number }[];
}

/** A ordem e os rótulos são os do dashboard de referência, linha a linha. */
export const CONTAS_DO_PATRIMONIO: { chave: string; rotulo: string; instituicao: string; tipoConta: string }[] = [
  { chave: "cc", rotulo: "Conta Corrente", instituicao: "Bradesco", tipoConta: "Conta Corrente" },
  { chave: "cc_xp", rotulo: "Conta Digital", instituicao: "XP Investimentos", tipoConta: "Conta Corrente" },
  // Não vem de `saldos_mensais`: é o portfólio Pessoal, passado de fora (ver `investimentos`).
  { chave: "portfolio", rotulo: "Investimentos (portfólio Pessoal)", instituicao: "", tipoConta: "" },
  { chave: "adriana", rotulo: "Conta Adriana", instituicao: "Conta Adriana", tipoConta: "Conta Corrente" },
  { chave: "mauricio", rotulo: "Conta Maurício", instituicao: "Conta Maurício", tipoConta: "Conta Corrente" },
  { chave: "luciana", rotulo: "Conta Luciana", instituicao: "Conta Luciana", tipoConta: "Conta Corrente" },
  { chave: "osvaldo", rotulo: "Conta Osvaldo Cruz", instituicao: "Conta Osvaldo Cruz", tipoConta: "Conta Corrente" },
  { chave: "samambaia", rotulo: "Conta Samambaia", instituicao: "Conta Samambaia", tipoConta: "Conta Corrente" },
  { chave: "previdencia", rotulo: "Conta Previdência", instituicao: "Conta Previdência", tipoConta: "Investimentos" },
];

/**
 * Combinações que existem na base e não têm linha POR DESENHO, cada uma com o motivo. Só estas
 * ficam fora de `foraDaTabela`; qualquer outra que aparecer é devolvida para a tela mostrar.
 */
const FORA_POR_DESENHO: Record<string, string> = {
  // O saldo da XP digitado à mão. Substituído em 21/09/2026 pelo portfólio Pessoal do Blueberg.
  "XP Investimentos|Investimentos": "substituída pelo portfólio Pessoal",
  // Os dólares da conta internacional. Também passam a vir do portfólio Pessoal, na carteira de
  // moedas (decisão do Daniel, 21/09/2026): o Blueberg deixa de separar a conta internacional.
  "XP Internacional|Investimentos": "substituída pelo portfólio Pessoal (moedas)",
  // Já estava DENTRO do saldo acima ("ESCOPO: investido + Conta Investimento", na observação de
  // cada mês), então sai junto com ele.
  "XP Investimentos|Conta Investimento": "estava dentro do saldo da XP",
  // Dinheiro do Maurício guardado na XP do Daniel. É dele, não patrimônio do Daniel. Antes era
  // descontado do saldo da XP; agora vive no portfólio Maurício do Blueberg e simplesmente não
  // entra aqui.
  "Conta Maurício|Investimentos": "custódia do Maurício, fora do patrimônio do Daniel",
};

const chaveDe = (instituicao: string, tipoConta: string) => `${instituicao}|${tipoConta}`;
const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * @param investimentos patrimônio do portfólio Pessoal no fim de cada mês, por `AAAA-MM`. `null`
 *   quando não há como calcular (o portfólio em uso não é o Pessoal): a linha fica em branco.
 */
export function montarPatrimonioPorConta(
  saldos: SaldoMensal[],
  investimentos: Map<string, number> | null = null,
): PatrimonioPorConta {
  const linhaPorConta = new Map(
    CONTAS_DO_PATRIMONIO
      .filter((c) => c.instituicao)
      .map((c) => [chaveDe(c.instituicao, c.tipoConta), c.chave]),
  );

  // chave da linha -> "AAAA-MM" -> saldo
  const valores = new Map<string, Map<string, number>>(
    CONTAS_DO_PATRIMONIO.map((c) => [c.chave, new Map()]),
  );
  const fora = new Map<string, { instituicao: string; tipoConta: string; meses: number }>();
  // O período da tabela é o das CONTAS: começa no primeiro mês com saldo registrado. Antes disso
  // o "Total" seria só o portfólio, e pareceria patrimônio inteiro. Termina no último mês de
  // qualquer das duas fontes, para o mês corrente do portfólio aparecer.
  let primeiroMes: string | null = null;
  let ultimoMes: string | null = null;
  const marcar = (ym: string) => {
    if (!primeiroMes || ym < primeiroMes) primeiroMes = ym;
    if (!ultimoMes || ym > ultimoMes) ultimoMes = ym;
  };

  for (const s of saldos) {
    const ym = String(s.ano_mes).slice(0, 7);
    const valor = Number(s.saldo_final);
    if (!Number.isFinite(valor)) continue;
    const chave = chaveDe(s.instituicao, s.tipo_conta);

    const linha = linhaPorConta.get(chave);
    if (linha) {
      valores.get(linha)!.set(ym, valor);
      marcar(ym);
      continue;
    }
    if (!(chave in FORA_POR_DESENHO)) {
      const atual = fora.get(chave) ?? { instituicao: s.instituicao, tipoConta: s.tipo_conta, meses: 0 };
      atual.meses++;
      fora.set(chave, atual);
    }
  }

  if (investimentos && primeiroMes) {
    const linha = valores.get("portfolio")!;
    for (const [ym, valor] of investimentos) {
      if (ym < primeiroMes) continue;
      linha.set(ym, centavos(valor));
      marcar(ym);
    }
  }

  if (!primeiroMes || !ultimoMes) return { anos: [], foraDaTabela: [...fora.values()] };
  const anoIni = Number((primeiroMes as string).slice(0, 4));
  const anoFim = Number((ultimoMes as string).slice(0, 4));

  const resultado: AnoDoPatrimonio[] = Array.from({ length: anoFim - anoIni + 1 }, (_, i) => anoFim - i)
    .map((ano) => {
      const linhas: LinhaDaConta[] = CONTAS_DO_PATRIMONIO.map((c) => ({
        chave: c.chave,
        rotulo: c.rotulo,
        valores: Array.from({ length: 12 }, (_, i) =>
          valores.get(c.chave)!.get(`${ano}-${String(i + 1).padStart(2, "0")}`) ?? null),
      }));
      const total = Array.from({ length: 12 }, (_, i) => {
        const doMes = linhas.map((l) => l.valores[i]).filter((v): v is number => v != null);
        return doMes.length ? centavos(doMes.reduce((a, b) => a + b, 0)) : null;
      });
      return { ano, linhas, total };
    });

  return {
    anos: resultado,
    foraDaTabela: [...fora.values()].sort((a, b) => b.meses - a.meses),
  };
}

/**
 * O patrimônio da carteira no fim de cada mês: o valor do último dia calculado dentro do mês.
 * No mês corrente é o valor mais recente, e o mês ainda está aberto.
 */
export function fimDeMesDaCarteira(linhas: { data: string; liquido: number }[]): Map<string, number> {
  const porMes = new Map<string, { data: string; valor: number }>();
  for (const l of linhas) {
    if (!Number.isFinite(l.liquido)) continue;
    const ym = l.data.slice(0, 7);
    const atual = porMes.get(ym);
    if (!atual || l.data > atual.data) porMes.set(ym, { data: l.data, valor: l.liquido });
  }
  return new Map([...porMes].map(([ym, v]) => [ym, v.valor]));
}
