import { describe, expect, it } from "vitest";
import {
  MSG_ANTES_DO_CALCULO, MSG_ANTES_DO_FUNDO, MSG_COTA_NAO_DIVULGADA, MSG_DATA_INVALIDA, MSG_SEM_CUSTODIA,
  ehFimDeSemana, janelaDoCalendarioDoFundo, mensagemDaDataDoFundo, type LimitesDoFundo,
} from "./validacaoDataFundo";

const PISO = "2023-01-02";
const antigo: LimitesDoFundo = { primeiraCota: "2022-11-01", ultimaCota: "2026-09-09", inicioDoFundo: "2020-01-02" };
const novo: LimitesDoFundo = { primeiraCota: "2025-04-11", ultimaCota: "2026-09-09", inicioDoFundo: "2025-04-11" };

const base = { piso: PISO, limites: antigo, diaUtil: true, cotaNaData: 14.86, ehSaida: false, saldoNaData: undefined };

describe("janela do calendário do fundo", () => {
  it("fundo antigo começa em 02/01/2023 e termina na última cota", () => {
    expect(janelaDoCalendarioDoFundo(antigo, PISO)).toEqual({ min: PISO, max: "2026-09-09" });
  });
  it("fundo que nasceu depois começa na primeira cota", () => {
    expect(janelaDoCalendarioDoFundo(novo, PISO).min).toBe("2025-04-11");
  });
  it("sem série lida, só o piso", () => {
    expect(janelaDoCalendarioDoFundo(null, PISO)).toEqual({ min: PISO, max: null });
  });
});

describe("mensagem embaixo da data", () => {
  it("fim de semana é data inválida", () => {
    expect(ehFimDeSemana("2026-07-05")).toBe(true);
    expect(mensagemDaDataDoFundo({ ...base, data: "2026-07-05" })).toBe(MSG_DATA_INVALIDA);
  });
  it("feriado (dia útil falso no calendário) também é data inválida", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2025-11-20", diaUtil: false })).toBe(MSG_DATA_INVALIDA);
  });
  it("antes da primeira cota de um fundo que nasceu depois de 2023", () => {
    expect(mensagemDaDataDoFundo({ ...base, limites: novo, data: "2024-03-01" })).toBe(MSG_ANTES_DO_FUNDO);
    expect(mensagemDaDataDoFundo({ ...base, limites: novo, data: "2022-12-01" })).toBe(MSG_ANTES_DO_FUNDO);
  });
  it("antes de 02/01/2023 num fundo que já existia", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2022-12-01" })).toBe(MSG_ANTES_DO_CALCULO);
  });
  it("depois da última cota divulgada", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2026-09-10" })).toBe(MSG_COTA_NAO_DIVULGADA);
  });
  it("dia útil dentro da série sem cota publicada", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2026-07-10", cotaNaData: null })).toBe(MSG_COTA_NAO_DIVULGADA);
  });
  it("saída sem custódia na data", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2024-01-10", ehSaida: true, saldoNaData: null })).toBe(MSG_SEM_CUSTODIA);
  });
  it("carregando não gera mensagem", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2024-01-10", ehSaida: true, saldoNaData: undefined, cotaNaData: undefined, diaUtil: undefined })).toBeNull();
  });
  it("aplicação não olha custódia", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2024-01-10", saldoNaData: null })).toBeNull();
  });
  it("data válida com saldo", () => {
    expect(mensagemDaDataDoFundo({ ...base, data: "2026-05-29", ehSaida: true, saldoNaData: 26492.48 })).toBeNull();
  });
});
