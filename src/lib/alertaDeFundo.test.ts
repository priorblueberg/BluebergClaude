import { describe, expect, it } from "vitest";
import { fundoSemCotaDesde, quantidadeSugeridaNaMigracao } from "./alertaDeFundo";

/** Dias corridos com fim de semana fora dos dias úteis. */
function calendario(de: string, ate: string) {
  const dias = [];
  for (let d = new Date(de + "T00:00:00Z"); d.toISOString().slice(0, 10) <= ate; d.setUTCDate(d.getUTCDate() + 1)) {
    const semana = d.getUTCDay();
    dias.push({ data: d.toISOString().slice(0, 10), dia_util: semana !== 0 && semana !== 6 });
  }
  return dias;
}

describe("fundo sem cota da CVM", () => {
  const cal = calendario("2026-08-24", "2026-09-11");

  it("5 dias úteis sem cota além do atraso da CVM: avisa com a data da última cota", () => {
    // Referência = 11/09 menos 2 dias úteis = 09/09. Depois de 02/09: 03, 04, 07, 08 e 09.
    expect(fundoSemCotaDesde(cal, "2026-09-02", "2026-09-11")).toBe("2026-09-02");
  });

  it("4 dias úteis: ainda é atraso", () => {
    expect(fundoSemCotaDesde(cal, "2026-09-03", "2026-09-11")).toBeNull();
  });

  it("cota do próprio atraso normal: não avisa", () => {
    expect(fundoSemCotaDesde(cal, "2026-09-09", "2026-09-11")).toBeNull();
  });

  it("segue a data global: no passado, o mesmo fundo estava em dia", () => {
    expect(fundoSemCotaDesde(cal, "2026-09-02", "2026-09-04")).toBeNull();
  });

  it("sem cota nenhuma, não há o que avisar", () => {
    expect(fundoSemCotaDesde(cal, null, "2026-09-11")).toBeNull();
  });
});

describe("quantidade sugerida na migração", () => {
  it("cota nova até 2% da antiga: a mesma quantidade (Kinea Advisory para a Subclasse II)", () => {
    expect(quantidadeSugeridaNaMigracao(70590.77770397, 1.5267928, 1.5302534)).toEqual({ quantidade: 70590.77770397, criterio: "mesma" });
  });

  it("cota reiniciada: a quantidade que preserva o valor", () => {
    expect(quantidadeSugeridaNaMigracao(1000, 10.4364972, 1)).toEqual({ quantidade: 10436.4972, criterio: "valor" });
  });

  it("sem cota antiga, a mesma quantidade", () => {
    expect(quantidadeSugeridaNaMigracao(500, null, 2).criterio).toBe("mesma");
  });
});
