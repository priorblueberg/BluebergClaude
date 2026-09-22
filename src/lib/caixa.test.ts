import { describe, expect, it } from "vitest";
import { CONTAS_DO_CAIXA, montarCaixa, montarConta } from "./caixa";
import { CONTAS_DO_PATRIMONIO, type SaldoMensal } from "./patrimonioGlobal";

const s = (ano_mes: string, instituicao: string, tipo_conta: string, saldo_final: number): SaldoMensal =>
  ({ ano_mes, instituicao, tipo_conta, saldo_final });

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
      [],
    );
    expect(c.anos[0].saldo[7]).toBe(10759.81);
    expect(c.resumo.saldo).toEqual({ valor: 10759.81, label: "ago/26" });
  });

  it("resultado por mês e somas do ano; mês sem movimento fica null", () => {
    const c = montarCaixa([], [
      { mes: "2026-01", receitas: 21223.66, despesas: 14407.4, lancamentos: 146 },
      { mes: "2026-03", receitas: 19554.74, despesas: 449299.26, lancamentos: 149 },
    ], []);
    const a = c.anos[0];
    expect(a.resultado[0]).toBe(6816.26);
    expect(a.resultado[1]).toBeNull();
    expect(a.resultado[2]).toBe(-429744.52);
    expect(a.receitasNoAno).toBe(40778.4);
    expect(a.despesasNoAno).toBe(463706.66);
    expect(a.resultadoNoAno).toBe(-422928.26);
    expect(c.resumo).toMatchObject({ ano: 2026, ateLabel: "mar/26", resultado: -422928.26 });
  });

  it("categorias do ano mais recente, com participação e média pelos meses com movimento", () => {
    const c = montarCaixa(
      [],
      [
        { mes: "2025-12", receitas: 0, despesas: 999, lancamentos: 1 },
        { mes: "2026-01", receitas: 0, despesas: 300, lancamentos: 2 },
        { mes: "2026-02", receitas: 0, despesas: 100, lancamentos: 1 },
      ],
      [
        { mes: "2025-12", categoria: "Lazer", valor: 999 },
        { mes: "2026-01", categoria: "Alimentação", valor: 200 },
        { mes: "2026-01", categoria: "Lazer", valor: 100 },
        { mes: "2026-02", categoria: "Alimentação", valor: 100 },
      ],
    );
    expect(c.categoriasDoAno?.ano).toBe(2026);
    expect(c.categoriasDoAno?.itens).toEqual([
      { categoria: "Alimentação", valor: 300, pct: 75, mediaMensal: 150 },
      { categoria: "Lazer", valor: 100, pct: 25, mediaMensal: 50 },
    ]);
  });

  it("sem dado nenhum devolve vazio sem quebrar", () => {
    const c = montarCaixa([], [], []);
    expect(c.anos).toEqual([]);
    expect(c.resumo.saldo).toBeNull();
    expect(c.categoriasDoAno).toBeNull();
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
