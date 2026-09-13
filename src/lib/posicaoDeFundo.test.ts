import { describe, expect, it } from "vitest";
import {
  ajustarMovimentosDerivados, entradaDaMigracao, posicaoNaData, primeiraSaidaSemSaldo,
  TIPO_MIGRACAO_ENTRADA, TIPO_MIGRACAO_SAIDA,
} from "./posicaoDeFundo";

// Operacoes reais do Kinea do Daniel (extrato XP): o Advisory ate 10/04/2025 e a Subclasse II depois.
const antiga = [
  { id: "ap", fundo_id: "advisory", data: "2023-12-29", tipo_movimentacao: "Aplicação Inicial", quantidade: 110439.98299791 },
  { id: "res", fundo_id: "advisory", data: "2024-12-11", tipo_movimentacao: "Resgate", quantidade: 39849.20529394 },
];

describe("posição de fundo", () => {
  it("soma as entradas e subtrai as saídas", () => {
    expect(posicaoNaData(antiga, "2026-01-01")).toEqual({ fundoId: "advisory", saldo: 70590.77770397 });
  });

  it("a ordem de chegada dos movimentos não importa", () => {
    expect(posicaoNaData([...antiga].reverse(), "2026-01-01").saldo).toBeCloseTo(70590.77770397, 8);
  });
});

describe("migração de fundo", () => {
  const saida = {
    id: "sai", fundo_id: "advisory", data: "2025-04-11", tipo_movimentacao: TIPO_MIGRACAO_SAIDA,
    quantidade: 70590.77770397, valor: 107777.29, transferencia_id: "t1",
  };
  const cotaEm = (d: string) => (d === "2025-04-11" ? 1.5267928 : null);

  it("a saída fecha a posição antiga", () => {
    expect(posicaoNaData([...antiga, saida], "2025-04-10").saldo).toBeCloseTo(70590.77770397, 8);
    expect(posicaoNaData([...antiga, saida], "2025-04-11").saldo).toBe(0);
  });

  it("a saída acompanha o histórico anterior, como o resgate total", () => {
    const retro = { id: "retro", fundo_id: "advisory", data: "2024-01-10", tipo_movimentacao: "Aplicação", quantidade: 1000 };
    const [ajuste] = ajustarMovimentosDerivados([...antiga, saida, retro], cotaEm);
    expect(ajuste.id).toBe("sai");
    expect(ajuste.quantidade).toBeCloseTo(71590.77770397, 8);
    expect(ajuste.valor).toBe(Math.round(71590.77770397 * 1.5267928 * 100) / 100);
  });

  it("a saída nunca falta saldo", () => {
    expect(primeiraSaidaSemSaldo([...antiga, { ...saida, quantidade: 999999 }])).toBeNull();
  });

  it("a entrada acompanha a saída pelo fator, com o mesmo valor", () => {
    expect(entradaDaMigracao({ quantidade: 71590.77770397, valor: 109303.97 }, 1)).toEqual({ quantidade: 71590.77770397, valor: 109303.97 });
    expect(entradaDaMigracao({ quantidade: 1000, valor: 10436.5 }, 10.4364972)).toEqual({ quantidade: 10436.4972, valor: 10436.5 });
  });

  it("a entrada abre a posição nova e os resgates seguintes saem dela", () => {
    const nova = [
      { id: "ent", fundo_id: "subclasse-ii", data: "2025-04-11", tipo_movimentacao: TIPO_MIGRACAO_ENTRADA, quantidade: 70590.77770397 },
      { id: "res2", fundo_id: "subclasse-ii", data: "2025-04-23", tipo_movimentacao: "Resgate", quantidade: 48605.24652808 },
    ];
    expect(posicaoNaData(nova, "2025-04-23").saldo).toBeCloseTo(21985.53117589, 8);
    expect(primeiraSaidaSemSaldo(nova)).toBeNull();
    expect(primeiraSaidaSemSaldo(nova.filter((m) => m.id !== "ent"))?.id).toBe("res2");
  });
});
