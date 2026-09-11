import { describe, expect, it } from "vitest";
import {
  dataGlobalEfetiva, fimDaCarteira, fimDoProduto, linguetaDoFim, ultimaBarraReal, ultimaDataAte,
} from "./periodo";

/** Calendário corrido com fim de semana fora dos dias úteis. */
function calendario(de: string, ate: string) {
  const dias = [];
  for (let d = new Date(de + "T00:00:00Z"); d.toISOString().slice(0, 10) <= ate; d.setUTCDate(d.getUTCDate() + 1)) {
    const semana = d.getUTCDay();
    dias.push({ data: d.toISOString().slice(0, 10), dia_util: semana !== 0 && semana !== 6 });
  }
  return dias;
}

describe("período do produto", () => {
  it("fundo: da aplicação à última cota divulgada, mesmo com a data global depois", () => {
    const cotas = [{ data: "2026-09-08" }, { data: "2026-09-09" }];
    const ultima = ultimaDataAte(cotas, "2026-09-11");
    expect(fimDoProduto({ dataGlobal: "2026-09-11", ultimoDado: ultima })).toBe("2026-09-09");
  });

  it("a data global é teto: em 05/07/2026 nenhuma cota posterior entra", () => {
    const cotas = [{ data: "2026-07-03" }, { data: "2026-09-09" }];
    const global = dataGlobalEfetiva(calendario("2026-06-29", "2026-07-05"), "2026-07-05");
    expect(fimDoProduto({ dataGlobal: global, ultimoDado: ultimaDataAte(cotas, global) })).toBe("2026-07-03");
  });

  it("data global num domingo cai no último dia útil, sem provisório no fim de semana", () => {
    expect(dataGlobalEfetiva(calendario("2026-06-29", "2026-07-05"), "2026-07-05")).toBe("2026-07-03");
    expect(dataGlobalEfetiva(calendario("2026-09-07", "2026-09-11"), "2026-09-11")).toBe("2026-09-11");
  });

  it("renda fixa vai até a data global", () => {
    expect(fimDoProduto({ dataGlobal: "2026-09-11" })).toBe("2026-09-11");
  });

  it("encerramento antes da data global encerra o período", () => {
    expect(fimDoProduto({ dataGlobal: "2026-09-11", encerramento: "2026-08-18" })).toBe("2026-08-18");
    expect(fimDoProduto({ dataGlobal: "2026-09-11", ultimoDado: "2026-09-09", encerramento: "2029-07-29" })).toBe("2026-09-09");
  });

  it("série sem nenhum ponto até a data global não tem período", () => {
    expect(fimDoProduto({ dataGlobal: "2023-01-10", ultimoDado: null })).toBeNull();
  });

  it("moeda: a PTAX repetida pelo carry-forward não conta", () => {
    const ptax = [
      { data: "2026-09-10", provisorio: false },
      { data: "2026-09-11", provisorio: true },
    ];
    expect(ultimaDataAte(ptax, "2026-09-11", (p) => !p.provisorio)).toBe("2026-09-10");
  });
});

describe("ação: a barra que vale", () => {
  const fechada = { data: "2026-09-09", abertura: 35, maxima: 35.5, minima: 34.8, fechamento: 35.2, volume: 30_000_000, provisorio: false };

  it("a barra do pregão em andamento vale", () => {
    const intradiaria = { data: "2026-09-10", abertura: 35.2, maxima: 35.6, minima: 35.1, fechamento: 35.4, volume: 12_000_000, provisorio: true };
    expect(ultimaBarraReal([fechada, intradiaria], "2026-09-10")).toBe("2026-09-10");
  });

  it("a cópia do dia anterior não vale", () => {
    const copia = { ...fechada, data: "2026-09-10", provisorio: true };
    expect(ultimaBarraReal([fechada, copia], "2026-09-10")).toBe("2026-09-09");
  });

  it("barra oficial igual à anterior continua valendo (só a provisória é suspeita)", () => {
    const igual = { ...fechada, data: "2026-09-10", provisorio: false };
    expect(ultimaBarraReal([fechada, igual], "2026-09-10")).toBe("2026-09-10");
  });
});

describe("período da carteira", () => {
  it("o exemplo do Daniel: vai do menor início ao maior fim", () => {
    const fundo1 = fimDoProduto({ dataGlobal: "2026-09-11", ultimoDado: "2026-09-09" });
    const fundo2 = fimDoProduto({ dataGlobal: "2026-09-11", ultimoDado: "2026-09-08" });
    expect(fimDaCarteira([
      { fim: fundo1, comPosicao: true },
      { fim: fundo2, comPosicao: true },
    ])).toBe("2026-09-09");
  });

  it("buraco da fonte no passado: o fundo sem a cota do dia para antes, a carteira não", () => {
    // BTG Pactual Hedge sem a cota de 10/07/2026 na CVM.
    const btg = fimDoProduto({ dataGlobal: "2026-07-10", ultimoDado: ultimaDataAte([{ data: "2026-07-09" }], "2026-07-10") });
    const outro = fimDoProduto({ dataGlobal: "2026-07-10", ultimoDado: "2026-07-10" });
    expect(btg).toBe("2026-07-09");
    expect(fimDaCarteira([{ fim: btg, comPosicao: true }, { fim: outro, comPosicao: true }])).toBe("2026-07-10");
  });

  it("produto encerrado não estica a carteira", () => {
    expect(fimDaCarteira([
      { fim: "2026-09-11", comPosicao: false },
      { fim: "2026-09-09", comPosicao: true },
    ])).toBe("2026-09-09");
  });

  it("carteira toda encerrada termina no último encerramento", () => {
    expect(fimDaCarteira([
      { fim: "2025-06-23", comPosicao: false },
      { fim: "2024-03-20", comPosicao: false },
    ])).toBe("2025-06-23");
  });

  it("sem período nenhum", () => {
    expect(fimDaCarteira([{ fim: null, comPosicao: false }])).toBeNull();
  });
});

describe("lingueta", () => {
  it("aparece quando o fim é anterior à data global", () => {
    expect(linguetaDoFim("2026-09-08", "2026-09-11")).toBe("2026-09-08");
    expect(linguetaDoFim("2026-09-11", "2026-09-11")).toBeNull();
  });

  it("produto encerrado não leva lingueta", () => {
    expect(linguetaDoFim("2026-08-18", "2026-09-11", false)).toBeNull();
  });
});
