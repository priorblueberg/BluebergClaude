import { describe, expect, it } from "vitest";
import { textoConfirmacaoDeExclusao } from "./confirmacaoDeExclusao";

describe("confirmação de exclusão de movimentação", () => {
  const nbsp = (s: string) => s.replace(/ /g, " ");

  it("nomeia tipo, ativo, data e valor", () => {
    const texto = nbsp(textoConfirmacaoDeExclusao({
      tipo_movimentacao: "Resgate",
      nome_ativo: "SulAmérica Premium Plus",
      data: "2025-08-18",
      valor: 403833.22,
    }));
    expect(texto).toBe("A resgate de SulAmérica Premium Plus em 18/08/2025, no valor de R$ 403.833,22 será excluída. Esta ação não pode ser desfeita.");
  });

  it("aplicação inicial avisa que a posição inteira sai", () => {
    const texto = textoConfirmacaoDeExclusao({
      tipo_movimentacao: "Aplicação Inicial",
      nome_ativo: "SulAmérica Premium Plus",
      data: "2024-02-23",
      valor: 41725.88,
    });
    expect(texto).toMatch(/apaga TODAS as movimentações desse código/);
  });

  it("sem a linha, texto genérico", () => {
    expect(textoConfirmacaoDeExclusao(null)).toBe("Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.");
  });
});
