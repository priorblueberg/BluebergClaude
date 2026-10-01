import { describe, expect, it } from "vitest";
import { montarResultadoPorCategoria } from "./receitasDespesas";
import type { Lancamento } from "./caixa";

const l = (
  data: string, valor: number, tipo: "Entrada" | "Saída",
  categoria: string | null, subcategoria: string | null,
  extra: Partial<{ conta: string; contabilizar: boolean }> = {},
): Lancamento => ({
  data, descricao: "lançamento", conta: extra.conta ?? "Bradesco · Conta Corrente",
  valor, tipo, categoria, subcategoria, contabilizar: extra.contabilizar ?? true,
});

describe("montarResultadoPorCategoria", () => {
  it("soma por categoria e por mês, e abre em subcategorias", () => {
    const { anos } = montarResultadoPorCategoria([
      l("2026-01-10", 300, "Saída", "Automóvel", "Combustível"),
      l("2026-01-20", 120, "Saída", "Automóvel", "Estacionamento"),
      l("2026-03-05", 200, "Saída", "Automóvel", "Combustível"),
      l("2026-01-15", 50, "Saída", "Alimentação", "Refeição"),
    ], "Saída");

    expect(anos).toHaveLength(1);
    const auto = anos[0].categorias[0];
    expect(auto.nome).toBe("Automóvel");
    expect(auto.total).toBe(620);
    expect(auto.meses[0]).toBe(420);
    expect(auto.meses[1]).toBeNull();
    expect(auto.meses[2]).toBe(200);
    expect(auto.subcategorias.map((s) => [s.nome, s.total])).toEqual([
      ["Combustível", 500], ["Estacionamento", 120],
    ]);
    expect(anos[0].totalPorMes[0]).toBe(470);
    expect(anos[0].total).toBe(670);
  });

  it("só entra o que é resultado: transferência e aporte ficam de fora", () => {
    const { anos } = montarResultadoPorCategoria([
      l("2026-02-01", 1000, "Saída", "Alimentação", "Supermercado"),
      l("2026-02-02", 50000, "Saída", "Transferência entre contas", null, { contabilizar: false }),
      l("2026-02-03", 30000, "Saída", "Investimentos", "Aporte", { contabilizar: false }),
    ], "Saída");
    expect(anos[0].total).toBe(1000);
    expect(anos[0].categorias).toHaveLength(1);
  });

  it("a entrada é outra tabela, e vê todas as contas", () => {
    const lancamentos = [
      l("2026-05-08", 1350, "Entrada", "Receita Empresa", "Salário", { conta: "Conta Caju · Conta Corrente" }),
      l("2026-05-10", 21223.66, "Entrada", "Receita Empresa", "Salário"),
      l("2026-05-11", 90, "Saída", "Alimentação", "Refeição", { conta: "Bradesco · Cartão de Crédito" }),
    ];
    const entradas = montarResultadoPorCategoria(lancamentos, "Entrada");
    expect(entradas.anos[0].total).toBe(22573.66);
    expect(entradas.contas).toEqual(["Bradesco · Conta Corrente", "Conta Caju · Conta Corrente"]);
    const saidas = montarResultadoPorCategoria(lancamentos, "Saída");
    expect(saidas.anos[0].total).toBe(90);
  });

  it("a categoria pedida vai para o topo, mesmo não sendo a maior", () => {
    const { anos } = montarResultadoPorCategoria([
      l("2026-01-10", 10000, "Saída", "Contas da Casa", "Aluguel"),
      l("2026-01-11", 100, "Saída", "Automóvel", "Pedágio"),
      l("2026-01-12", 500, "Saída", "Alimentação", "Refeição"),
    ], "Saída", "Automóvel");
    expect(anos[0].categorias.map((c) => c.nome)).toEqual([
      "Automóvel", "Contas da Casa", "Alimentação",
    ]);
  });

  it("lançamento sem categoria não some da tabela", () => {
    const { anos } = montarResultadoPorCategoria([
      l("2026-09-04", 948.9, "Saída", null, null),
    ], "Saída");
    expect(anos[0].categorias[0].nome).toBe("Sem categoria");
    expect(anos[0].categorias[0].subcategorias[0].nome).toBe("Sem subcategoria");
    expect(anos[0].total).toBe(948.9);
  });

  it("separa os anos, do mais recente para o mais antigo", () => {
    const { anos } = montarResultadoPorCategoria([
      l("2025-12-31", 10, "Saída", "Alimentação", "Refeição"),
      l("2026-01-01", 20, "Saída", "Alimentação", "Refeição"),
    ], "Saída");
    expect(anos.map((a) => a.ano)).toEqual([2026, 2025]);
    expect(anos[0].total).toBe(20);
    expect(anos[1].total).toBe(10);
  });
});
