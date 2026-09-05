import { describe, it, expect } from "vitest";
import { situacaoDaPosicao } from "@/lib/situacaoDaPosicao";

describe("situacaoDaPosicao", () => {
  it("posicao viva mostra o proprio saldo", () => {
    expect(situacaoDaPosicao(10_343.04, false)).toEqual({
      negativa: false, encerrada: false, valorExibido: 10_343.04,
    });
  });

  it("saldo zerado e encerramento, e exibe zero", () => {
    const s = situacaoDaPosicao(0, false);
    expect(s.encerrada).toBe(true);
    expect(s.negativa).toBe(false);
    expect(s.valorExibido).toBe(0);
  });

  it("encerrada no cadastro exibe zero mesmo com saldo residual positivo", () => {
    const s = situacaoDaPosicao(1_000, true);
    expect(s.encerrada).toBe(true);
    expect(s.valorExibido).toBe(0);
  });

  it("saldo NEGATIVO nao e encerramento: mostra o valor negativo", () => {
    // O caso do resgate orfao. Antes virava R$ 0,00 com selo "Liquidado".
    const s = situacaoDaPosicao(-11_326.29, false);
    expect(s.negativa).toBe(true);
    expect(s.encerrada).toBe(false);
    expect(s.valorExibido).toBe(-11_326.29);
  });

  it("negativo prevalece sobre o encerramento do cadastro", () => {
    // Senao bastava o papel estar marcado como encerrado para o rombo sumir da tela.
    const s = situacaoDaPosicao(-500, true);
    expect(s.negativa).toBe(true);
    expect(s.encerrada).toBe(false);
    expect(s.valorExibido).toBe(-500);
  });

  it("centavo de arredondamento continua sendo zero, nao negativo", () => {
    expect(situacaoDaPosicao(-0.004, false).negativa).toBe(false);
    expect(situacaoDaPosicao(-0.004, false).encerrada).toBe(true);
  });
});
