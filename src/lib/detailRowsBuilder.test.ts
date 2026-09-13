import { describe, expect, it } from "vitest";
import { buildDetailRowsFromEngine } from "./detailRowsBuilder";

const dia = (data: string, rentabilidadeDiaria: number) => ({
  data,
  diaUtil: true,
  liquido: 1000,
  aplicacoes: 0,
  resgates: 0,
  saldoCotas: 1,
  ganhoAcumulado: 0,
  ganhoDiario: 0,
  rentabilidadeDiaria,
});

describe("buildDetailRowsFromEngine - % do CDI", () => {
  it("divide a rentabilidade pelo CDI com todas as casas, no mes e no ano", () => {
    const linhas = [dia("2025-01-02", 0.0005), dia("2025-01-03", 0.0004), dia("2025-02-03", 0.0006)];
    const cdi = [
      { data: "2025-01-02", taxa_anual: 12.15, dia_util: true },
      { data: "2025-01-03", taxa_anual: 12.15, dia_util: true },
      { data: "2025-02-03", taxa_anual: 13.15, dia_util: true },
    ];
    const [ano] = buildDetailRowsFromEngine(linhas, cdi, "2025-01-02");

    const fator = (taxa: number) => Math.pow(1 + taxa / 100, 1 / 252) - 1;
    const rentJan = (1.0005 * 1.0004 - 1) * 100;
    const cdiJan = ((1 + fator(12.15)) ** 2 - 1) * 100;
    const rentAno = (1.0005 * 1.0004 * 1.0006 - 1) * 100;
    const cdiAno = ((1 + fator(12.15)) ** 2 * (1 + fator(13.15)) - 1) * 100;

    expect(ano.percentualCdiMonths?.[0]).toBeCloseTo((rentJan / cdiJan) * 100, 8);
    expect(ano.percentualCdiNoAno).toBeCloseTo((rentAno / cdiAno) * 100, 8);
    // Mes sem movimento nao tem % do CDI.
    expect(ano.percentualCdiMonths?.[5]).toBeNull();
  });
});
