import { describe, expect, it } from "vitest";
import { casarPorEliminacao } from "./renomeacaoDeTicker.ts";

describe("casamento por eliminacao no /quote", () => {
  it("nao inventa renomeacao quando tudo respondeu", () => {
    const r = casarPorEliminacao(["PETR4", "VALE3"], ["PETR4", "VALE3"]);
    expect(r.dePara.size).toBe(0);
    expect(r.renomeados).toEqual([]);
    expect(r.ambiguo).toBeNull();
    expect(r.semResposta).toEqual([]);
  });

  // O caso real: pedimos ELET3 e a BRAPI respondeu AXIA3.
  it("casa o unico ausente com o unico intruso", () => {
    const r = casarPorEliminacao(["PETR4", "ELET3"], ["PETR4", "AXIA3"]);
    expect(r.dePara.get("AXIA3")).toBe("ELET3");
    expect(r.renomeados).toEqual([{ nosso: "ELET3", na_fonte: "AXIA3" }]);
    expect(r.semResposta).toEqual([]);
  });

  // Duas renomeacoes no mesmo lote: nao ha como dizer se AXIA3 responde ELET3 ou NTCO3.
  // Gravar qualquer uma das duas poe o preco de um papel na serie do outro, e ninguem procura
  // por uma cotacao que esta no lugar errado.
  it("nao escolhe nada quando ha dois de cada lado", () => {
    const r = casarPorEliminacao(["ELET3", "NTCO3"], ["AXIA3", "NATU3"]);
    expect(r.dePara.size).toBe(0);
    expect(r.renomeados).toEqual([]);
    expect(r.ambiguo).toEqual({
      pedidos_sem_resposta: ["ELET3", "NTCO3"],
      devolvidos_sem_pedido: ["AXIA3", "NATU3"],
    });
    // Enquanto a atribuicao nao se resolve, os dois continuam contando como ausentes.
    expect(r.semResposta).toEqual(["ELET3", "NTCO3"]);
  });

  // MRFG3 e BRFS3 apontam para o MESMO codigo novo depois da fusao. Um pedido sem resposta e
  // um intruso? Nao: dois pedidos sumiram e so um codigo apareceu.
  it("nao casa quando duas empresas viraram o mesmo codigo", () => {
    const r = casarPorEliminacao(["MRFG3", "BRFS3", "PETR4"], ["MBRF3", "PETR4"]);
    expect(r.dePara.size).toBe(0);
    expect(r.ambiguo?.pedidos_sem_resposta).toEqual(["MRFG3", "BRFS3"]);
    expect(r.ambiguo?.devolvidos_sem_pedido).toEqual(["MBRF3"]);
  });

  // Papel que a fonte deixou de devolver sem trocar de codigo continua sendo ausencia, e nao
  // renomeacao. Confundir os dois esconderia uma serie que congelou.
  it("ausencia sem intruso e ausencia, nao renomeacao", () => {
    const r = casarPorEliminacao(["PETR4", "CPLE6"], ["PETR4"]);
    expect(r.dePara.size).toBe(0);
    expect(r.ambiguo).toBeNull();
    expect(r.semResposta).toEqual(["CPLE6"]);
  });

  it("ignora codigo vazio na resposta", () => {
    const r = casarPorEliminacao(["PETR4", "ELET3"], ["PETR4", "", "AXIA3"]);
    expect(r.dePara.get("AXIA3")).toBe("ELET3");
  });

  // A fonte pode devolver o mesmo codigo duas vezes no lote (MRFG3 e BRFS3 -> MBRF3). O
  // conjunto colapsa, e o que importa e nao contar o intruso duas vezes.
  it("nao conta o mesmo intruso duas vezes", () => {
    const r = casarPorEliminacao(["ELET3", "PETR4"], ["AXIA3", "AXIA3", "PETR4"]);
    expect(r.dePara.get("AXIA3")).toBe("ELET3");
    expect(r.renomeados).toHaveLength(1);
  });
});
