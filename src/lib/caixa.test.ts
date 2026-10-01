import { describe, expect, it } from "vitest";
import { CONTAS_DO_CAIXA, montarCaixa, montarConta } from "./caixa";
import { CONTAS_DO_PATRIMONIO, type SaldoMensal } from "./patrimonioGlobal";

const s = (ano_mes: string, instituicao: string, tipo_conta: string, saldo_final: number): SaldoMensal =>
  ({ ano_mes, instituicao, tipo_conta, saldo_final });

/** Uma linha de extrato, que é a única fonte do consolidado desde 23/09/2026. */
const l = (
  data: string, valor: number, tipo: "Entrada" | "Saída",
  extra: Partial<{ conta: string; categoria: string; subcategoria: string; contabilizar: boolean }> = {},
) => ({
  data, descricao: "lançamento", conta: extra.conta ?? "Bradesco · Conta Corrente", valor, tipo,
  categoria: extra.categoria ?? "Alimentação", subcategoria: extra.subcategoria ?? "Supermercado",
  contabilizar: extra.contabilizar ?? true,
});

describe("montarCaixa", () => {
  it("o saldo é o subtotal Caixa do Patrimônio Global: sem previdência e sem investimentos", () => {
    const c = montarCaixa(
      [
        s("2026-08-01", "Bradesco", "Conta Corrente", 6538.68),
        s("2026-08-01", "XP Investimentos", "Conta Corrente", 4221.13),
        s("2026-08-01", "Conta Previdência", "Investimentos", 8855.72),
        s("2026-08-01", "XP Investimentos", "Investimentos", 1000000),
      ],
      [],
    );
    expect(c.anos[0].saldoFinal[7]).toBe(10759.81);
    expect(c.resumo.saldo).toEqual({ valor: 10759.81, label: "ago/26" });
  });

  it("a tabela de saldo por conta traz só as contas de caixa com saldo no ano, e o total", () => {
    const c = montarCaixa(
      [
        s("2026-08-01", "Bradesco", "Conta Corrente", 6538.68),
        s("2026-08-01", "XP Investimentos", "Conta Corrente", 4221.13),
        s("2026-08-01", "Conta Maurício", "Conta Corrente", 9231.51),
        // Fora do caixa: não pode aparecer na tabela.
        s("2026-08-01", "Conta Previdência", "Investimentos", 8855.72),
      ],
      [],
    );
    const contas = c.anos[0].contas;
    expect(contas.map((x) => x.rotulo)).toEqual([
      "Conta Corrente", "Conta Digital", "Conta Maurício", "Total",
    ]);
    expect(contas.at(-1)).toMatchObject({ total: true });
    expect(contas.at(-1)!.valores[7]).toBe(19991.32);
    expect(contas[0].valores[7]).toBe(6538.68);
    // Mês sem saldo fica em branco, não zerado.
    expect(contas[0].valores[0]).toBeNull();
  });

  it("entrada e saída são o que conta no resultado; o resto é transferência entre contas", () => {
    const c = montarCaixa([], [
      l("2026-01-10", 21223.66, "Entrada", { categoria: "Receita Empresa" }),
      l("2026-01-20", 14407.40, "Saída"),
      l("2026-01-25", 5000, "Saída", { categoria: "Transferência entre contas", contabilizar: false }),
      l("2026-01-25", 5000, "Entrada", { conta: "XP Investimentos · Conta Corrente",
        categoria: "Transferência entre contas", contabilizar: false }),
      l("2026-01-28", 900, "Saída", { categoria: "Conta Investimento", subcategoria: "Aporte", contabilizar: false }),
      l("2026-03-05", 19554.74, "Entrada"),
      l("2026-03-15", 449299.26, "Saída"),
    ]);
    const a = c.anos[0];
    expect(a.receitas[0]).toBe(21223.66);
    expect(a.despesas[0]).toBe(14407.40);
    // A transferência entre contas nem entra na conta do total: o que sobra é o aporte, que
    // cruza a fronteira do caixa.
    expect(a.outrosMovimentos[0]).toBe(-900);
    expect(a.receitas[1]).toBeNull();
    expect(a.receitasNoAno).toBe(40778.4);
    expect(a.despesasNoAno).toBe(463706.66);
    expect(c.resumo).toMatchObject({ ano: 2026, ateLabel: "mar/26" });
  });

  it("a ponte do mês usa o saldo do mês anterior", () => {
    const c = montarCaixa(
      [
        s("2026-01-01", "Bradesco", "Conta Corrente", 1000),
        s("2026-02-01", "Bradesco", "Conta Corrente", 1500),
      ],
      [l("2026-02-10", 500, "Entrada")],
    );
    const a = c.anos[0];
    expect(a.saldoAnterior[1]).toBe(1000);
    expect(a.saldoFinal[1]).toBe(1500);
    expect(a.saldoAnterior[5]).toBeNull(); // mês sem saldo e sem movimento
  });

  it("custódia do Maurício não é movimento do Daniel", () => {
    const c = montarCaixa([], [
      l("2026-04-01", 288000, "Entrada", { categoria: "Conta Maurício", subcategoria: "Custódia", contabilizar: false }),
      l("2026-04-02", 100, "Saída"),
    ]);
    // O mês existe por causa da saída, e a custódia não somou nada nele.
    expect(c.anos[0].outrosMovimentos[3]).toBe(0);
    expect(c.anos[0].despesas[3]).toBe(100);
  });

  it("guarda até quando cada conta tem lançamento", () => {
    const c = montarCaixa([], [
      l("2026-04-02", 100, "Saída"),
      l("2026-09-10", 50, "Saída", { conta: "XP Investimentos · Cartão de Crédito" }),
    ]);
    expect(c.atualizacao).toEqual([
      { conta: "XP Investimentos · Cartão de Crédito", ate: "2026-09-10" },
      { conta: "Bradesco · Conta Corrente", ate: "2026-04-02" },
    ]);
  });

  it("sem dado nenhum devolve vazio sem quebrar", () => {
    const c = montarCaixa([], []);
    expect(c.anos).toEqual([]);
    expect(c.resumo.saldo).toBeNull();
    expect(c.atualizacao).toEqual([]);
  });
});

describe("montarConta", () => {
  const mov = (mes: string, receitas: number, despesas: number, transferencias: number) =>
    ({ mes, receitas, despesas, transferencias, entradas: 0, saidas: 0, lancamentos: 1 });

  it("ponte de saldo: anterior + receitas - despesas + transferências = final", () => {
    const c = montarConta(
      [
        s("2026-07-01", "Bradesco", "Conta Corrente", 9085.33),
        s("2026-08-01", "Bradesco", "Conta Corrente", 6538.68),
      ],
      "cc",
      [mov("2026-08", 7117.33, 13250.70, 3586.72)],
    );
    const a = c.anos[0];
    expect(a.saldoAnterior[7]).toBe(9085.33); // o final de julho
    expect(a.saldoFinal[7]).toBe(6538.68);
    const ponte = a.saldoAnterior[7]! + a.receitas[7]! - a.despesas[7]! + a.transferencias[7]!;
    expect(Math.round(ponte * 100) / 100).toBe(6538.68);
    expect(a.diferenca[7]).toBe(0);
    expect(a.naoFecha).toBe(false);
  });

  it("mês que não fecha aparece como diferença", () => {
    // Conta Digital, out/2025: R$ 10,86 saíram sem registro (explicado na observação do saldo).
    const c = montarConta(
      [s("2025-09-01", "XP Investimentos", "Conta Corrente", 10.86), s("2025-10-01", "XP Investimentos", "Conta Corrente", 0)],
      "cc_xp",
      [],
    );
    const a = c.anos[0];
    expect(a.diferenca[9]).toBe(-10.86);
    expect(a.naoFecha).toBe(true);
  });

  it("o saldo anterior de janeiro é o final de dezembro do ano anterior; sem ele, fica em branco", () => {
    const c = montarConta(
      [s("2025-12-01", "Bradesco", "Conta Corrente", 1439.33), s("2026-01-01", "Bradesco", "Conta Corrente", 5245.85)],
      "cc",
      [],
    );
    const a2026 = c.anos.find((a) => a.ano === 2026)!;
    const a2025 = c.anos.find((a) => a.ano === 2025)!;
    expect(a2026.saldoAnterior[0]).toBe(1439.33);
    expect(a2025.saldoAnterior[11]).toBeNull(); // novembro/2025 não está na base deste teste
  });

  it("mês aberto ganha saldo final parcial pela ponte, se a conta fechou no último mês registrado", () => {
    // Conta Corrente, set/2026: 6.538,68 + 0,07 - 5.993,40 + 3.215,41 = 3.760,76, o saldo da tela do banco.
    const c = montarConta(
      [s("2026-07-01", "Bradesco", "Conta Corrente", 9085.33), s("2026-08-01", "Bradesco", "Conta Corrente", 6538.68)],
      "cc",
      [mov("2026-08", 7117.33, 13250.70, 3586.72), mov("2026-09", 0.07, 5993.40, 3215.41)],
    );
    const a = c.anos[0];
    expect(a.saldoFinal[8]).toBe(3760.76);
    expect(a.saldoFinalParcial[8]).toBe(true);
    expect(a.saldoFinalParcial[7]).toBe(false);
    expect(a.diferenca[8]).toBeNull();
    expect(a.naoFecha).toBe(false);
    expect(c.resumo.saldo).toEqual({ valor: 3760.76, label: "set/26", parcial: true });
  });

  it("conta que não fecha a ponte não ganha saldo parcial", () => {
    const c = montarConta(
      [s("2026-07-01", "Bradesco", "Conta Corrente", 100), s("2026-08-01", "Bradesco", "Conta Corrente", 150)],
      "cc",
      [mov("2026-08", 10, 0, 0), mov("2026-09", 10, 0, 0)],
    );
    expect(c.anos[0].saldoFinal[8]).toBeNull();
    expect(c.anos[0].diferencaNoAno).toBe(40);
  });

  it("cartão não tem saldo: só movimento", () => {
    const c = montarConta([s("2026-08-01", "Bradesco", "Conta Corrente", 1)], "cartao_xp", [mov("2026-04", 0, 5000, 0)]);
    expect(c.resumo.saldo).toBeNull();
    expect(c.serieSaldo).toEqual([]);
    expect(c.anos[0].despesasNoAno).toBe(5000);
  });

  it("toda conta do seletor tem a chave de uma linha do Patrimônio ou é cartão", () => {
    for (const conta of CONTAS_DO_CAIXA) {
      if (conta.temSaldo) expect(CONTAS_DO_PATRIMONIO.some((l) => l.chave === conta.chave)).toBe(true);
    }
  });
});
