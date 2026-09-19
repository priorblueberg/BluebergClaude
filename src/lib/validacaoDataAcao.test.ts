import { describe, expect, it } from "vitest";
import {
  MSG_ANTES_DO_CALCULO, MSG_DATA_INVALIDA, MSG_SEM_CUSTODIA, MSG_SEM_FECHAMENTO,
  janelaDoCalendarioDaAcao, mensagemDaDataDaAcao, msgAposDeslistagem,
} from "./validacaoDataAcao";

const PISO = "2023-01-02";
const TETO = "2026-09-17";

const base = {
  piso: PISO,
  teto: TETO,
  ultimoPregaoDoPapel: null,
  diaUtil: true,
  ehVenda: false,
  saldoNaData: undefined,
};

describe("janela do calendário da ação", () => {
  it("do piso da ferramenta até o teto de cálculo", () => {
    expect(janelaDoCalendarioDaAcao(PISO, TETO)).toEqual({ min: PISO, max: TETO });
  });
  it("sem teto lido, só o piso", () => {
    expect(janelaDoCalendarioDaAcao(PISO, undefined)).toEqual({ min: PISO, max: null });
  });
});

describe("mensagem embaixo da data", () => {
  it("sem data, sem mensagem", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "" })).toBeNull();
  });
  it("dia útil dentro da janela passa", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16" })).toBeNull();
  });
  it("fim de semana é data inválida", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-07-05" })).toBe(MSG_DATA_INVALIDA);
  });
  it("feriado (dia útil falso no calendário) também é data inválida", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2025-11-20", diaUtil: false })).toBe(MSG_DATA_INVALIDA);
  });
  it("dia útil ainda carregando não inventa mensagem", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", diaUtil: undefined })).toBeNull();
  });
  it("antes de 02/01/2023", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2022-12-01" })).toBe(MSG_ANTES_DO_CALCULO);
  });
  it("depois do teto de cálculo", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-18" })).toBe(MSG_SEM_FECHAMENTO);
  });
  it("papel deslistado explica a deslistagem, não a falta de fechamento", () => {
    const m = mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ultimoPregaoDoPapel: "2026-05-08" });
    expect(m).toBe(msgAposDeslistagem("2026-05-08"));
    expect(m).toContain("08/05/2026");
  });
  it("no último pregão do papel deslistado ainda dá para lançar", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-05-08", ultimoPregaoDoPapel: "2026-05-08" })).toBeNull();
  });
});

describe("venda sem posição na data", () => {
  it("saldo ainda carregando não gera mensagem", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ehVenda: true, saldoNaData: undefined })).toBeNull();
  });
  it("sem posição nenhuma", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ehVenda: true, saldoNaData: null })).toBe(MSG_SEM_CUSTODIA);
  });
  it("posição zerada na data", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ehVenda: true, saldoNaData: 0 })).toBe(MSG_SEM_CUSTODIA);
  });
  it("com saldo, passa", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ehVenda: true, saldoNaData: 100 })).toBeNull();
  });
  it("na compra o saldo não importa", () => {
    expect(mensagemDaDataDaAcao({ ...base, data: "2026-09-16", ehVenda: false, saldoNaData: null })).toBeNull();
  });
});
