import { describe, it, expect } from "vitest";
import {
  limiteISO, periodoDoPreset, janelaDaLamina, aplicarJanela, deBR, fmtBR,
} from "./periodo";

/** 01/09/2026, uma terça. D-1 = 31/08/2026, uma segunda. */
const HOJE = new Date(2026, 8, 1, 12, 0, 0);

describe("teto D-1", () => {
  it("o limite e sempre o dia anterior", () => {
    expect(limiteISO(HOJE)).toBe("2026-08-31");
  });

  it("nenhum atalho passa do limite", () => {
    for (const p of ["30d", "12m", "mesAtual", "anoAtual", "mesAnterior", "anoAnterior", "inicio"] as const) {
      expect(periodoDoPreset(p, HOJE).fim <= "2026-08-31").toBe(true);
    }
  });
});

describe("atalhos, na convencao do Gorila", () => {
  it("30 dias conta 30 dias corridos para tras", () => {
    // Medido no Gorila em 01/09/2026: "30 dias" = 02/08/2026 - 01/09/2026. Ele termina em
    // D0 e nos em D-1, entao a janela inteira anda um dia.
    expect(periodoDoPreset("30d", HOJE)).toMatchObject({ inicio: "2026-08-01", fim: "2026-08-31" });
  });

  it("12 meses volta um ano", () => {
    expect(periodoDoPreset("12m", HOJE)).toMatchObject({ inicio: "2025-08-31", fim: "2026-08-31" });
  });

  it("mes atual no dia 1o sai vazio: nenhum dia fechado ainda no mes", () => {
    const p = periodoDoPreset("mesAtual", HOJE);
    expect(p).toMatchObject({ inicio: "2026-09-01", fim: "2026-08-31" });
    expect(janelaDaLamina(p, "2024-01-03")).toBeNull();
  });

  it("mes atual no meio do mes vai do dia 1 ate D-1", () => {
    expect(periodoDoPreset("mesAtual", new Date(2026, 8, 15, 12))).toMatchObject({ inicio: "2026-09-01", fim: "2026-09-14" });
  });

  it("ano atual comeca em 1o de janeiro", () => {
    expect(periodoDoPreset("anoAtual", HOJE)).toMatchObject({ inicio: "2026-01-01", fim: "2026-08-31" });
  });

  it("mes anterior e o mes fechado inteiro", () => {
    // Medido no Gorila em 01/09/2026: 01/08/2026 - 31/08/2026.
    expect(periodoDoPreset("mesAnterior", HOJE)).toMatchObject({ inicio: "2026-08-01", fim: "2026-08-31" });
  });

  it("ano anterior e o ano fechado inteiro", () => {
    expect(periodoDoPreset("anoAnterior", HOJE)).toMatchObject({ inicio: "2025-01-01", fim: "2025-12-31" });
  });

  it("desde o inicio deixa a ponta inicial em aberto", () => {
    expect(periodoDoPreset("inicio", HOJE)).toMatchObject({ inicio: null, fim: "2026-08-31" });
  });
});

describe("janela da lamina", () => {
  const fim = "2026-08-31";

  it("desde o inicio usa o comeco da propria carteira", () => {
    const p = { inicio: null, fim, preset: "inicio" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2024-01-03", fim });
  });

  it("janela anterior a carteira e recortada no comeco dela, como no Gorila", () => {
    const p = { inicio: "2020-01-01", fim, preset: "custom" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2024-01-03", fim });
  });

  it("janela posterior ao comeco da carteira e respeitada", () => {
    const p = { inicio: "2026-01-01", fim, preset: "anoAtual" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toEqual({ inicio: "2026-01-01", fim });
  });

  it("janela inteiramente antes da carteira nao existe", () => {
    const p = { inicio: "2020-01-01", fim: "2021-12-31", preset: "custom" as const };
    expect(janelaDaLamina(p, "2024-01-03")).toBeNull();
  });
});

describe("aplicarJanela", () => {
  it("troca as duas pontas da carteira pela janela", () => {
    const cart = { data_inicio: "2024-01-03", data_calculo: "2026-08-27", nome: "Renda Fixa" };
    const p = { inicio: "2026-01-01", fim: "2026-08-31", preset: "anoAtual" as const };
    expect(aplicarJanela(cart, p)).toEqual({ ...cart, data_inicio: "2026-01-01", data_calculo: "2026-08-31" });
  });

  it("o fim NAO e recortado pelo fim da carteira: carteira encerrada continua no historico", () => {
    // Patrimonio zera, mas o ganho e a rentabilidade do periodo em que ela viveu ficam.
    const cart = { data_inicio: "2024-01-03", data_calculo: "2025-06-30" };
    const p = { inicio: null, fim: "2026-08-31", preset: "inicio" as const };
    expect(aplicarJanela(cart, p)).toEqual({ data_inicio: "2024-01-03", data_calculo: "2026-08-31" });
  });

  it("carteira nao iniciada passa direto", () => {
    const cart = { data_inicio: null, data_calculo: null };
    const p = { inicio: null, fim: "2026-08-31", preset: "inicio" as const };
    expect(aplicarJanela(cart, p)).toEqual(cart);
  });
});

describe("datas em dd/mm/aaaa", () => {
  it("ida e volta", () => {
    expect(deBR("31/08/2026")).toBe("2026-08-31");
    expect(fmtBR("2026-08-31")).toBe("31/08/2026");
  });

  it("recusa data que nao existe", () => {
    expect(deBR("31/02/2026")).toBeNull();
    expect(deBR("1/8/2026")).toBeNull();
    expect(deBR("abacaxi")).toBeNull();
  });
});
