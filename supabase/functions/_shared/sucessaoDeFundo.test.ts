import { describe, expect, it } from "vitest";
import {
  chaveDaSerie, type LinhaDoInforme, type PontaDeSerie, pontasDaJanela, sucessoesInequivocas,
} from "./sucessaoDeFundo.ts";

const ponta = (cnpj: string, subclasse: string, data: string, cota: number, pl: number, cotistas: number): PontaDeSerie =>
  ({ chave: chaveDaSerie(cnpj, subclasse), cnpj, subclasse, data, cota, pl, cotistas });

const uteis = ["2025-04-09", "2025-04-10", "2025-04-11", "2025-04-14", "2025-04-15", "2025-04-16", "2025-04-17"];

// Numeros reais do informe diario da CVM na passagem do Kinea (10 -> 11/04/2025).
const advisory = ponta("39586835000100", "", "2025-04-10", 1.5267928, 411276783.28, 12189);
const ficKinea = ponta("38145457000167", "", "2025-04-10", 1.559066, 112542365, 10123);
const ficUmCotista = ponta("49412163000170", "", "2025-04-10", 1.2463, 19400000, 1);
const masterSemSubclasse = ponta("39586858000115", "", "2025-04-10", 1.6237324, 3137146402.57, 3);
const subclasseII = ponta("39586858000115", "M0UTC1743800258", "2025-04-11", 1.5302534, 410880605.73, 12155);
const subclasseI = ponta("39586858000115", "KB0OK1743799805", "2025-04-11", 1.5626225, 112781824.12, 10112);
const subclasseIII = ponta("39586858000115", "YPI761743800738", "2025-04-11", 1.2463748, 19344907.99, 1);
const subclasseIV = ponta("39586858000115", "7EV3M1743800974", "2025-04-11", 1.5626431, 2587530360.68, 1);

describe("sucessao inequivoca", () => {
  it("Kinea: cada FIC cancelado acha a propria subclasse", () => {
    const r = sucessoesInequivocas(
      [advisory, ficKinea, ficUmCotista, masterSemSubclasse],
      [subclasseII, subclasseI, subclasseIII, subclasseIV],
      uteis,
    );
    const pares = r.map((s) => `${s.antecessor.cnpj} -> ${s.sucessor.subclasse}`).sort();
    expect(pares).toEqual([
      "38145457000167 -> KB0OK1743799805",
      "39586835000100 -> M0UTC1743800258",
    ]);
  });

  it("fundo de poucos cotistas nao vale como impressao digital", () => {
    expect(sucessoesInequivocas([ficUmCotista], [subclasseIII], uteis)).toEqual([]);
  });

  it("divisao em subclasses nao e sucessao: nenhuma parte fica com o patrimonio inteiro", () => {
    const antes = ponta("00888897000131", "", "2025-04-14", 61.495388, 1063067117, 14810);
    const parteA = ponta("00888897000131", "MZMRC1747322915", "2025-04-15", 61.465207, 1025651357, 14783);
    const parteI = ponta("00888897000131", "RBMFN1747320951", "2025-04-15", 61.465207, 36677378, 1);
    expect(sucessoesInequivocas([antes], [parteA, parteI], uteis)).toEqual([]);
  });

  it("fator de conversao nao e sucessao de nivel 1: a cota salta", () => {
    const novo = { ...subclasseII, cota: subclasseII.cota * 100 };
    expect(sucessoesInequivocas([advisory], [novo], uteis)).toEqual([]);
  });

  it("dois candidatos iguais: ambiguo, nada e costurado", () => {
    const gemea = { ...subclasseII, chave: chaveDaSerie("11111111000111", "X"), cnpj: "11111111000111", subclasse: "X" };
    expect(sucessoesInequivocas([advisory], [subclasseII, gemea], uteis)).toEqual([]);
  });

  it("dois antecessores para o mesmo sucessor: ambiguo", () => {
    const gemeo = { ...advisory, chave: chaveDaSerie("22222222000122", ""), cnpj: "22222222000122" };
    expect(sucessoesInequivocas([advisory, gemeo], [subclasseII], uteis)).toEqual([]);
  });

  it("sucessor que nasce longe demais nao conta", () => {
    const tarde = { ...subclasseII, data: "2025-04-17" };
    expect(sucessoesInequivocas([advisory], [tarde], uteis)).toEqual([]);
  });

  it("guarda as evidencias", () => {
    const [s] = sucessoesInequivocas([advisory], [subclasseII], uteis);
    expect(s.diasUteis).toBe(1);
    expect(s.evidencias.variacao_cota).toBeCloseTo(0.0022666, 6);
    expect(s.evidencias.diferenca_cotistas).toBeCloseTo(-34 / 12189, 8);
  });
});

describe("pontas da janela e o cenario B3 (Santa Fe Aquarius)", () => {
  // A classe publica sem subclasse ate 07/04/2025; em 08/04 nasce a Subclasse A com os mesmos
  // numeros, e a Subclasse B nasce vazia de cotistas. Um fundo qualquer publica a janela inteira.
  const janela = ["2025-04-02", "2025-04-03", "2025-04-04", "2025-04-07", "2025-04-08", "2025-04-09", "2025-04-10"];
  const linhas: LinhaDoInforme[] = [
    ...janela.slice(0, 4).map((data, i) => ({ cnpj: "04621018000161", subclasse: "", data, cota: 10.40 + i * 0.012, pl: 50.0e6, cotistas: 731 })),
    ...janela.slice(4).map((data, i) => ({ cnpj: "04621018000161", subclasse: "GPZ7A1744144200", data, cota: 10.3802837 + i * 0.01, pl: 49.8e6, cotistas: 731 })),
    ...janela.slice(4).map((data) => ({ cnpj: "04621018000161", subclasse: "ZVYZM1744144397", data, cota: 10.3802837, pl: 1000, cotistas: 1 })),
    ...janela.map((data) => ({ cnpj: "99999999000199", subclasse: "", data, cota: 2, pl: 1e8, cotistas: 5000 })),
  ];

  it("so para quem parou e so nasce quem comecou depois do primeiro dia", () => {
    const { paradas, nascidas } = pontasDaJanela(linhas, janela);
    expect(paradas.map((p) => p.chave)).toEqual(["04621018000161|"]);
    expect(paradas[0].data).toBe("2025-04-07");
    expect(nascidas.map((p) => p.chave).sort()).toEqual(["04621018000161|GPZ7A1744144200", "04621018000161|ZVYZM1744144397"]);
  });

  it("a classe sem subclasse e sucedida pela subclasse que ficou com todos os cotistas", () => {
    const { paradas, nascidas } = pontasDaJanela(linhas, janela);
    const [s] = sucessoesInequivocas(paradas, nascidas, janela);
    expect(s.antecessor.chave).toBe("04621018000161|");
    expect(s.sucessor.chave).toBe("04621018000161|GPZ7A1744144200");
  });

  it("cota zero nao e ponta de serie", () => {
    const comZero = [...linhas, { cnpj: "04621018000161", subclasse: "", data: "2025-04-08", cota: 0, pl: 0, cotistas: 0 }];
    expect(pontasDaJanela(comZero, janela).paradas[0].data).toBe("2025-04-07");
  });
});
