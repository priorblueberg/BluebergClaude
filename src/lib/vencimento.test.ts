import { describe, it, expect } from "vitest";
import { calcularRendaFixaDiario } from "./rendaFixaEngine";

/**
 * No VENCIMENTO o papel nao rende o proprio dia: quando o dia comeca o preco ja esta no
 * par. Venda antecipada, ao contrario, INCLUI o dia em que ocorre.
 *
 * Medido no Gorila em 31/08/2026 sobre dois CDBs de IPCA que venceram dentro da janela
 * observada. O valor entregue no vencimento e, no centavo, o do dia util ANTERIOR:
 *
 *   IPCA+3,80% venc. 15/06/2026 (seg) -> 1080,4422 = o nosso valor de 12/06 (sex)
 *   IPCA+4,90% venc. 31/03/2026 (ter) -> 1119,2972 = o nosso valor de 30/03 (seg)
 *
 * E a mesma convencao ja levantada no prefixado. Os testes abaixo usam prefixado porque
 * ele nao depende de serie de indice: a regra mora no motor, nao no indexador.
 */

function calendario(de: string, ate: string) {
  const out: { data: string; dia_util: boolean }[] = [];
  for (let t = Date.parse(de + "T00:00:00Z"); t <= Date.parse(ate + "T00:00:00Z"); t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const w = new Date(iso + "T00:00:00Z").getUTCDay();
    out.push({ data: iso, dia_util: w !== 0 && w !== 6 });
  }
  return out;
}

function serie(vencimento: string, dataCalculo: string) {
  const rows = calcularRendaFixaDiario({
    dataInicio: "2025-01-02",
    dataCalculo,
    taxa: 12,
    modalidade: "Prefixado",
    puInicial: 1000,
    calendario: calendario("2024-12-20", "2025-04-30"),
    movimentacoes: [{ data: "2025-01-02", tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
    pagamento: "No Vencimento",
    vencimento,
  });
  return new Map(rows.map((r) => [r.data, r]));
}

describe("convencao do vencimento", () => {
  it("no vencimento o PU nao anda: fica igual ao do dia util anterior", () => {
    const m = serie("2025-03-14", "2025-03-14");
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const noVencimento = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(noVencimento).toBeCloseTo(anterior, 8);
  });

  it("vencimento na segunda: iguala a sexta, sem render o fim de semana nem o proprio dia", () => {
    const m = serie("2025-03-17", "2025-03-17");
    expect(m.get("2025-03-17")!.puJurosPeriodicos).toBeCloseTo(m.get("2025-03-14")!.puJurosPeriodicos, 8);
  });

  it("dia util comum continua rendendo: a regra e so do vencimento", () => {
    const m = serie("2025-04-30", "2025-03-14");
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const hoje = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(hoje).toBeGreaterThan(anterior);
    expect(hoje / anterior).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });

  it("venda antecipada INCLUI o dia: quem resgata no dia X rende o dia X", () => {
    const rows = calcularRendaFixaDiario({
      dataInicio: "2025-01-02",
      dataCalculo: "2025-03-14",
      taxa: 12,
      modalidade: "Prefixado",
      puInicial: 1000,
      calendario: calendario("2024-12-20", "2025-04-30"),
      movimentacoes: [
        { data: "2025-01-02", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
        { data: "2025-03-14", tipo_movimentacao: "Resgate Total", valor: 10500 },
      ],
      pagamento: "No Vencimento",
      vencimento: "2025-04-30",
      dataResgateTotal: "2025-03-14",
    });
    const m = new Map(rows.map((r) => [r.data, r]));
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const noResgate = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(noResgate / anterior).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });
});
