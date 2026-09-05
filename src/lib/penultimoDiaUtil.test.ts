import { describe, it, expect } from "vitest";
import { penultimoDiaUtilAprox } from "@/contexts/DataReferenciaContext";

/**
 * O teto da data de referencia e o penultimo dia util, nao o ultimo.
 *
 * O amarrador e a cota de fundo: a CVM publica a do dia D no dia util D+1, entao no ultimo
 * dia util ela ainda nao existe. Foi esse dia faltando que respondeu pelos R$ 227,88 de
 * divergencia contra o Gorila em 05/09/2026.
 *
 * Esta e a aproximacao sincrona (so fim de semana); feriado e corrigido pelo calendario do
 * banco. Os casos abaixo nao caem em feriado, entao valem para as duas.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const em = (s: string) => new Date(`${s}T12:00:00`);

describe("penultimoDiaUtilAprox", () => {
  it("no sabado, volta para a quinta", () => {
    // 05/09/2026 e sabado: uteis sao sexta 04 e quinta 03 -> penultimo e 03.
    expect(iso(penultimoDiaUtilAprox(em("2026-09-05")))).toBe("2026-09-03");
  });

  it("no domingo, tambem volta para a quinta", () => {
    expect(iso(penultimoDiaUtilAprox(em("2026-09-06")))).toBe("2026-09-03");
  });

  it("em dia util, conta o proprio dia como o ultimo", () => {
    // Quinta 03/09: uteis sao 03 e 02 -> penultimo e 02.
    expect(iso(penultimoDiaUtilAprox(em("2026-09-03")))).toBe("2026-09-02");
  });

  it("na segunda, atravessa o fim de semana", () => {
    // Segunda 14/09: uteis sao 14 e sexta 11 -> penultimo e 11.
    expect(iso(penultimoDiaUtilAprox(em("2026-09-14")))).toBe("2026-09-11");
  });

  it("na terca, o penultimo cai na sexta anterior", () => {
    // Terca 15/09: uteis sao 15 e 14 -> penultimo e 14.
    expect(iso(penultimoDiaUtilAprox(em("2026-09-15")))).toBe("2026-09-14");
  });

  it("nunca devolve sabado nem domingo", () => {
    for (let i = 0; i < 60; i++) {
      const d = new Date(2026, 0, 1 + i, 12);
      const r = penultimoDiaUtilAprox(d);
      expect(r.getDay()).not.toBe(0);
      expect(r.getDay()).not.toBe(6);
      expect(r < d).toBe(true);
    }
  });
});
