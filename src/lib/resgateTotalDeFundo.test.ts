import { describe, expect, it } from "vitest";
import { ajustarResgatesTotais, posicaoNaData, TIPO_MUDANCA_DE_FUNDO } from "./posicaoDeFundo";

/** Cotas do Ágora Bolsa (08.909.429/0001-08) nas datas do teste validado contra o Gorila. */
const COTAS: Record<string, number> = {
  "2024-05-08": 2.9811555,
  "2024-10-01": 2.9,
  "2025-01-02": 2.7210104,
  "2026-02-25": 4.3455362,
};
const cotaEm = (d: string) => COTAS[d] ?? null;

const mov = (id: string, data: string, tipo: string, quantidade: number, valor: number, created_at = "2026-09-12T10:00:00Z") => ({
  id, fundo_id: "f1", data, data_cotizacao: data, tipo_movimentacao: tipo, quantidade, valor, created_at,
});

describe("Resgate Total de fundo acompanha o histórico", () => {
  const base = [
    mov("ap1", "2024-05-08", "Aplicação Inicial", 2683.52321776, 8000),
    mov("rt", "2025-01-02", "Resgate Total", 2683.52321776, 7301.89),
    mov("ap2", "2026-02-25", "Aplicação", 2301.21198852, 10000),
  ];

  it("já exato: nada muda", () => {
    expect(ajustarResgatesTotais(base, cotaEm)).toEqual([]);
  });

  it("aplicação com data anterior ao resgate total, lançada depois: o resgate passa a levar as cotas dela", () => {
    const movs = [...base, mov("ret", "2024-10-01", "Aplicação", 344.82758621, 1000, "2026-09-13T10:00:00Z")];
    const [ajuste] = ajustarResgatesTotais(movs, cotaEm);
    expect(ajuste.id).toBe("rt");
    expect(ajuste.quantidade).toBeCloseTo(3028.35080397, 8);
    expect(ajuste.valor).toBe(8240.17);
    expect(ajuste.preco_unitario).toBe(2.7210104);
    // Com o ajuste gravado, a posição fica zerada entre o resgate e a nova aplicação.
    const ajustado = movs.map((m) => (m.id === "rt" ? { ...m, quantidade: ajuste.quantidade, valor: ajuste.valor } : m));
    expect(posicaoNaData(ajustado, "2025-01-02").saldo).toBe(0);
    expect(posicaoNaData(ajustado, "2026-02-25").saldo).toBeCloseTo(2301.21198852, 8);
  });

  it("aplicação no próprio dia do resgate total, cadastrada depois dele, entra no fechamento", () => {
    const movs = [...base, mov("mesmoDia", "2025-01-02", "Aplicação", 100, 272.1, "2026-09-13T10:00:00Z")];
    const [ajuste] = ajustarResgatesTotais(movs, cotaEm);
    expect(ajuste.quantidade).toBeCloseTo(2783.52321776, 8);
    expect(posicaoNaData(movs.map((m) => (m.id === "rt" ? { ...m, quantidade: ajuste.quantidade } : m)), "2025-01-02").saldo).toBe(0);
  });

  it("aplicação posterior ao resgate total não mexe nele", () => {
    const movs = [...base, mov("depois", "2026-02-25", "Aplicação", 10, 43.46, "2026-09-13T10:00:00Z")];
    expect(ajustarResgatesTotais(movs, cotaEm)).toEqual([]);
  });

  it("resgate parcial anterior e exclusão de aplicação reduzem o resgate total", () => {
    const comParcial = [...base, mov("parcial", "2024-10-01", "Resgate", 683.52321776, 1982.22, "2026-09-13T10:00:00Z")];
    expect(ajustarResgatesTotais(comParcial, cotaEm)[0].quantidade).toBeCloseTo(2000, 8);
  });

  it("mudança de fundo antes do fechamento: o resgate leva a quantidade do fundo novo", () => {
    const movs = [
      mov("ap1", "2024-05-08", "Aplicação Inicial", 1000, 2981.16),
      { ...mov("mud", "2024-10-01", TIPO_MUDANCA_DE_FUNDO, 1500, 4350), fundo_id: "f2" },
      mov("rt", "2025-01-02", "Resgate Total", 1000, 2721.01),
    ];
    expect(ajustarResgatesTotais(movs, cotaEm)[0].quantidade).toBe(1500);
  });

  it("sem cota na data do resgate total, ele fica como está", () => {
    const movs = [...base, mov("ret", "2024-10-01", "Aplicação", 10, 29)];
    expect(ajustarResgatesTotais(movs, () => null)).toEqual([]);
  });
});
