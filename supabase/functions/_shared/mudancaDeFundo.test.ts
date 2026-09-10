import { describe, expect, it } from "vitest";
import {
  dataDeReferencia, detectarMudanca, DIAS_UTEIS_SEM_COTA, posicaoNaData, TIPO_MUDANCA_DE_FUNDO,
} from "./mudancaDeFundo.ts";

/** Dias uteis de seg a sex entre duas datas, sem feriado - basta para as contas daqui. */
function diasUteis(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("data de referencia", () => {
  it("e o penultimo dia util antes de hoje", () => {
    // Quinta 10/09/2026: a cota de quarta pode nao ter saido; a de terca ja deveria.
    expect(dataDeReferencia(diasUteis("2026-09-01", "2026-09-10"), "2026-09-10")).toBe("2026-09-08");
  });
});

describe("detector de mudanca na serie do fundo", () => {
  const uteis = diasUteis("2025-03-01", "2025-07-31");

  it("Kinea Advisory: cota zero repetida depois do cancelamento", () => {
    const m = detectarMudanca({
      ultimaCotaEm: "2025-04-10",
      referencia: "2025-04-15",
      diasUteis: uteis,
      datasComCotaZero: ["2025-04-11", "2025-04-14"],
    });
    expect(m?.sinal).toBe("cota_zero");
    expect(m?.ultimaCotaEm).toBe("2025-04-10");
  });

  it("uma cota zero isolada nao e mudanca (erro de publicacao da CVM)", () => {
    expect(detectarMudanca({
      ultimaCotaEm: "2025-04-10", referencia: "2025-04-11", diasUteis: uteis, datasComCotaZero: ["2025-04-11"],
    })).toBeNull();
  });

  it("cota zero anterior a ultima cota valida nao conta", () => {
    expect(detectarMudanca({
      ultimaCotaEm: "2025-04-10", referencia: "2025-04-10", diasUteis: uteis,
      datasComCotaZero: ["2025-04-01", "2025-04-02"],
    })).toBeNull();
  });

  it("fundo em dia (ALOCC depois da troca de rotulo FI -> CLASSES) nao dispara", () => {
    expect(detectarMudanca({ ultimaCotaEm: "2025-07-02", referencia: "2025-07-02", diasUteis: uteis })).toBeNull();
  });

  it("atraso de poucos dias uteis nao dispara", () => {
    expect(detectarMudanca({ ultimaCotaEm: "2025-07-01", referencia: "2025-07-07", diasUteis: uteis })).toBeNull();
  });

  it(`serie parada por ${DIAS_UTEIS_SEM_COTA} dias uteis dispara (Trend DI parou em 20/03/2024)`, () => {
    const m = detectarMudanca({
      ultimaCotaEm: "2024-03-20",
      referencia: "2024-04-30",
      diasUteis: diasUteis("2024-03-01", "2024-04-30"),
    });
    expect(m?.sinal).toBe("serie_parou");
    expect(Number(m?.evidencias.dias_uteis_sem_cota)).toBeGreaterThanOrEqual(DIAS_UTEIS_SEM_COTA);
  });

  it("fundo sem subclasse cujo CNPJ passou a publicar por subclasse", () => {
    const m = detectarMudanca({
      ultimaCotaEm: "2025-05-14", referencia: "2025-05-16", diasUteis: uteis,
      subclassesNovas: ["MZMRC1747322915", "RBMFN1747320951", "MZMRC1747322915"],
    });
    expect(m?.sinal).toBe("virou_subclasses");
    expect(m?.evidencias.subclasses).toEqual(["MZMRC1747322915", "RBMFN1747320951"]);
  });

  it("sem ultima cota ou sem referencia nao ha o que dizer", () => {
    expect(detectarMudanca({ ultimaCotaEm: null, referencia: "2025-05-16", diasUteis: uteis })).toBeNull();
    expect(detectarMudanca({ ultimaCotaEm: "2025-05-14", referencia: null, diasUteis: uteis })).toBeNull();
  });
});

describe("posicao do cliente com mudanca de fundo (copia do servidor)", () => {
  const movs = [
    { fundo_id: "advisory", data: "2023-12-29", tipo_movimentacao: "Aplicação Inicial", quantidade: 110439.98299791 },
    { fundo_id: "advisory", data: "2024-12-11", tipo_movimentacao: "Resgate", quantidade: 39849.20529394 },
    { fundo_id: "subclasse-ii", data: "2025-04-11", tipo_movimentacao: TIPO_MUDANCA_DE_FUNDO, quantidade: 70000 },
    { fundo_id: "subclasse-ii", data: "2025-04-23", tipo_movimentacao: "Resgate", quantidade: 48605.24652808 },
  ];

  it("antes da mudanca a posicao e do fundo antigo", () => {
    const p = posicaoNaData(movs, "2025-04-10");
    expect(p.fundoId).toBe("advisory");
    expect(p.saldo).toBeCloseTo(70590.77770397, 8);
  });

  it("a mudanca troca o fundo e SUBSTITUI o saldo", () => {
    const p = posicaoNaData(movs, "2025-04-11");
    expect(p.fundoId).toBe("subclasse-ii");
    expect(p.saldo).toBe(70000);
    expect(posicaoNaData(movs, "2025-04-23").saldo).toBeCloseTo(21394.75347192, 8);
  });
});
