import { describe, expect, it } from "vitest";
import { fimDeMesDaCarteira, montarPatrimonioPorConta, type SaldoMensal } from "./patrimonioGlobal";

const s = (ano_mes: string, instituicao: string, tipo_conta: string, saldo_final: number): SaldoMensal =>
  ({ ano_mes, instituicao, tipo_conta, saldo_final });

describe("montarPatrimonioPorConta", () => {
  it("põe cada conta na sua linha e soma o total do mês", () => {
    const r = montarPatrimonioPorConta([
      s("2026-01-01", "Bradesco", "Conta Corrente", 5245.85),
      s("2026-01-01", "XP Investimentos", "Conta Corrente", 12142.07),
    ]);
    const ano = r.anos[0];
    expect(ano.ano).toBe(2026);
    expect(ano.linhas.find((l) => l.chave === "cc")!.valores[0]).toBe(5245.85);
    expect(ano.linhas.find((l) => l.chave === "cc_xp")!.valores[0]).toBe(12142.07);
    expect(ano.total[0]).toBe(17387.92);
  });

  it("mês sem saldo nenhum fica null, e não zero", () => {
    const r = montarPatrimonioPorConta([s("2026-01-01", "Bradesco", "Conta Corrente", 100)]);
    expect(r.anos[0].total[1]).toBeNull();
    expect(r.anos[0].linhas.find((l) => l.chave === "cc")!.valores[1]).toBeNull();
  });

  it("a linha de investimentos vem do portfólio, e não do saldo digitado da XP", () => {
    const r = montarPatrimonioPorConta(
      [
        s("2026-07-01", "Bradesco", "Conta Corrente", 9085.33),
        // o saldo manual da XP, a Conta Investimento e a custódia do Maurício saem por desenho
        s("2026-07-01", "XP Investimentos", "Investimentos", 1572678.49),
        s("2026-07-01", "XP Investimentos", "Conta Investimento", 525.5),
        s("2026-07-01", "Conta Maurício", "Investimentos", 280897.54),
        // a conta internacional também virou portfólio
        s("2026-07-01", "XP Internacional", "Investimentos", 100000),
      ],
      new Map([["2026-07", 125135]]),
    );
    const ano = r.anos[0];
    expect(ano.linhas.find((l) => l.chave === "portfolio")!.valores[6]).toBe(125135);
    expect(ano.total[6]).toBe(134220.33);
    expect(r.foraDaTabela).toEqual([]);
  });

  it("sem o portfólio, a linha de investimentos fica em branco e o resto continua", () => {
    const r = montarPatrimonioPorConta([s("2026-07-01", "Bradesco", "Conta Corrente", 100)], null);
    expect(r.anos[0].linhas.find((l) => l.chave === "portfolio")!.valores[6]).toBeNull();
    expect(r.anos[0].total[6]).toBe(100);
  });

  it("o período é o das contas: mês do portfólio anterior ao primeiro saldo não entra", () => {
    const r = montarPatrimonioPorConta(
      [s("2024-12-01", "Bradesco", "Conta Corrente", 100)],
      new Map([["2023-05", 999], ["2024-12", 50], ["2026-09", 70]]),
    );
    // 2023 não aparece; 2026 aparece porque o portfólio tem setembro, e 2025 fica no meio
    expect(r.anos.map((a) => a.ano)).toEqual([2026, 2025, 2024]);
    expect(r.anos[2].total[11]).toBe(150);
    expect(r.anos[0].total[8]).toBe(70);
  });

  it("conta que não tem linha é devolvida, e não descartada em silêncio", () => {
    const r = montarPatrimonioPorConta([
      s("2026-01-01", "Bradesco", "Conta Corrente", 100),
      s("2026-01-01", "Nubank", "Conta Corrente", 50),
      s("2026-02-01", "Nubank", "Conta Corrente", 60),
    ]);
    expect(r.foraDaTabela).toEqual([{ instituicao: "Nubank", tipoConta: "Conta Corrente", meses: 2 }]);
    // e não entra no total: a tabela só soma o que mostra
    expect(r.anos[0].total[0]).toBe(100);
  });

  it("anos do mais recente para o mais antigo, e saldo negativo preservado", () => {
    const r = montarPatrimonioPorConta([
      s("2025-01-01", "Conta Luciana", "Conta Corrente", -550),
      s("2026-01-01", "Conta Luciana", "Conta Corrente", -5567.3),
    ]);
    expect(r.anos.map((a) => a.ano)).toEqual([2026, 2025]);
    expect(r.anos[1].linhas.find((l) => l.chave === "luciana")!.valores[0]).toBe(-550);
  });

  it("aceita o saldo como texto, que é como o numeric chega pelo PostgREST", () => {
    const r = montarPatrimonioPorConta([
      { ano_mes: "2026-03-01", instituicao: "Bradesco", tipo_conta: "Conta Corrente", saldo_final: "110757.12" },
    ]);
    expect(r.anos[0].total[2]).toBe(110757.12);
  });
});

describe("fimDeMesDaCarteira", () => {
  it("pega o último dia calculado de cada mês", () => {
    const m = fimDeMesDaCarteira([
      { data: "2026-06-29", liquido: 10 },
      { data: "2026-06-30", liquido: 11 },
      { data: "2026-07-01", liquido: 12 },
      { data: "2026-07-21", liquido: 15 },
    ]);
    expect(m.get("2026-06")).toBe(11);
    expect(m.get("2026-07")).toBe(15);
  });

  it("independe da ordem de chegada", () => {
    const m = fimDeMesDaCarteira([
      { data: "2026-06-30", liquido: 11 },
      { data: "2026-06-02", liquido: 9 },
    ]);
    expect(m.get("2026-06")).toBe(11);
  });
});
