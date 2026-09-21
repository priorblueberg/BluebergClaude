import { describe, expect, it } from "vitest";
import { provisoriosFantasmas } from "./limpezaDeProvisorios.ts";

const oficial = (data: string) => ({ data, provisorio: false });
const provisoria = (data: string) => ({ data, provisorio: true });

describe("limpeza de provisorios no fechamento", () => {
  // O caso real de 10/09/2026 as 19:15: a fonte trouxe ate 08/09 consolidado e a barra ao vivo
  // de 10/09, sem 09/09. A provisoria de 09/09 era pregao de verdade.
  it("nao apaga o dia que a fonte ainda nao consolidou, mesmo com a barra de hoje depois", () => {
    const historico = [oficial("2026-09-04"), oficial("2026-09-08"), provisoria("2026-09-10")];
    const r = provisoriosFantasmas(["2026-09-09", "2026-09-10"], historico);
    expect(r.apagar).toEqual([]);
    expect(r.mantidos).toEqual(["2026-09-09"]);
  });

  // Feriado so da B3: a rodada horaria gravou, e a fonte ja tem pregao oficial depois dele.
  it("apaga o dia sem pregao quando ha barra oficial posterior", () => {
    const historico = [oficial("2026-12-23"), oficial("2026-12-28"), provisoria("2026-12-29")];
    const r = provisoriosFantasmas(["2026-12-24"], historico);
    expect(r.apagar).toEqual(["2026-12-24"]);
    expect(r.mantidos).toEqual([]);
  });

  // Barra herdada e copia da anterior, nao pregao: nao conta como cobertura.
  it("barra herdada nao conta como cobertura", () => {
    const historico = [oficial("2026-09-08"), provisoria("2026-09-10"), provisoria("2026-09-11")];
    const r = provisoriosFantasmas(["2026-09-09"], historico);
    expect(r.apagar).toEqual([]);
  });

  it("provisorio confirmado pelo historico nao e fantasma nem mantido", () => {
    const r = provisoriosFantasmas(["2026-09-10"], [oficial("2026-09-08"), provisoria("2026-09-10")]);
    expect(r).toEqual({ apagar: [], mantidos: [] });
  });

  it("historico sem barra oficial nao apaga nada", () => {
    const r = provisoriosFantasmas(["2026-09-09"], [provisoria("2026-09-10")]);
    expect(r).toEqual({ apagar: [], mantidos: ["2026-09-09"] });
  });
});
