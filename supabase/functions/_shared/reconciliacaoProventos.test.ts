import { describe, expect, it } from "vitest";
import { mesmoValor, reconciliarProventos } from "./reconciliacaoProventos.ts";

const nossa = (dataEx: string, valor: number, aprovacao: string | null = null, tipo = "JCP") =>
  ({ dataEx, tipo, valor, aprovacao });
const deles = (dataEx: string, valor: number, aprovacao: string | null = null, tipo = "JCP") =>
  ({ dataEx, tipo, valor, aprovacao });

describe("reconciliacao de proventos contra a B3", () => {
  it("nao acha nada quando as duas fontes concordam", () => {
    const r = reconciliarProventos(
      [nossa("2025-06-02", 0.0235295), nossa("2025-09-01", 0.0235295)],
      [deles("2025-06-02", 0.0235295), deles("2025-09-01", 0.0235295)],
    );
    expect(r.faltantes).toEqual([]);
    expect(r.sobrando).toEqual([]);
  });

  it("acha a parcela que a base nao tem", () => {
    const r = reconciliarProventos(
      [nossa("2025-06-02", 0.0235295)],
      [deles("2025-06-02", 0.0235295), deles("2025-08-11", 0.1859)],
    );
    expect(r.faltantes).toHaveLength(1);
    expect(r.faltantes[0].dataEx).toBe("2025-08-11");
  });

  // ── ITSA4, 05/03/2025 ────────────────────────────────────────────────────────────────────
  // Duas parcelas de 0,0235295 na mesma data-ex: a ultima do programa aprovado em 19/02/2024 e
  // a primeira do aprovado em 10/02/2025. A BRAPI trouxe so a primeira.
  describe("duas parcelas legitimamente iguais na mesma data-ex", () => {
    const naB3 = [
      deles("2025-03-05", 0.0235295, "2024-02-19"),
      deles("2025-03-05", 0.0235295, "2025-02-10"),
    ];

    it("acha a que falta", () => {
      const r = reconciliarProventos([nossa("2025-03-05", 0.0235295, "2024-02-19")], naB3);
      expect(r.faltantes).toHaveLength(1);
    });

    it("acha a que falta com a aprovacao CERTA, nao a primeira da lista", () => {
      const r = reconciliarProventos([nossa("2025-03-05", 0.0235295, "2024-02-19")], naB3);
      expect(r.faltantes[0].aprovacao).toBe("2025-02-10");
    });

    // Este caso existe porque o anterior NAO basta: la a aprovacao certa e a segunda da lista,
    // entao casar pela ORDEM da a mesma resposta que casar pela APROVACAO, e o teste passaria
    // com a logica errada. Verificado por mutacao em 09/09/2026. Aqui a ordem da B3 vem
    // invertida, e so quem olha a aprovacao acerta.
    it("acerta mesmo quando a ordem da B3 contraria a aprovacao", () => {
      const invertida = [
        deles("2025-03-05", 0.0235295, "2025-02-10"),
        deles("2025-03-05", 0.0235295, "2024-02-19"),
      ];
      const r = reconciliarProventos([nossa("2025-03-05", 0.0235295, "2024-02-19")], invertida);
      expect(r.faltantes).toHaveLength(1);
      expect(r.faltantes[0].aprovacao).toBe("2025-02-10");
    });

    it("nao insere de novo quando a base ja tem as duas", () => {
      const r = reconciliarProventos(
        [nossa("2025-03-05", 0.0235295, "2024-02-19"), nossa("2025-03-05", 0.0235295, "2025-02-10")],
        naB3,
      );
      expect(r.faltantes).toEqual([]);
    });
  });

  // ── Defeito 1 (09/09/2026): a BRAPI arredonda na sexta casa ──────────────────────────────
  // Comparar valor exato transformava cada arredondamento em "parcela faltando". Foram 26
  // duplicatas so em PETR4, um papel que eu tinha acabado de conferir como completo, 55 de 55.
  describe("valores que diferem so por arredondamento sao a MESMA parcela", () => {
    const casos: [string, number, number][] = [
      ["PETR4 23/04/2026", 0.313115, 0.31311454],
      ["PETR4 26/04/2024", 0.55015785, 0.55015787],
      ["BBDC4 04/08/2026", 0.018975, 0.018974809],
      ["KLBN11 11/08/2025", 0.25094462, 0.25094461555],
    ];

    it.each(casos)("%s nao vira faltante", (_rotulo, nosso, b3) => {
      const r = reconciliarProventos([nossa("2026-04-23", nosso)], [deles("2026-04-23", b3)]);
      expect(r.faltantes).toEqual([]);
      expect(r.sobrando).toEqual([]);
    });

    it("mas valor de verdade diferente CONTINUA sendo achado", () => {
      const r = reconciliarProventos(
        [nossa("2026-04-23", 0.313115)],
        [deles("2026-04-23", 0.313115), deles("2026-04-23", 0.413115)],
      );
      expect(r.faltantes).toHaveLength(1);
      expect(r.faltantes[0].valor).toBe(0.413115);
    });

    it("a tolerancia e absoluta, nao proporcional", () => {
      // O mesmo desvio absoluto vale para valor grande e pequeno.
      expect(mesmoValor(0.018975, 0.018974809)).toBe(true);
      expect(mesmoValor(1.5, 1.5000005)).toBe(true);
      expect(mesmoValor(0.018975, 0.0189)).toBe(false);
    });
  });

  // ── Defeito 2 (09/09/2026): aprovacao nula do lado da BRAPI ──────────────────────────────
  // Exigir aprovacao igual fazia cada parcela sem `approvedOn` virar faltante e entrar como
  // duplicata, DOBRANDO o provento. Aconteceu em ITSA4 de 19/06/2026.
  it("linha nossa com aprovacao NULA casa com a parcela da B3 que tem aprovacao", () => {
    const r = reconciliarProventos(
      [nossa("2026-06-19", 0.138, null)],
      [deles("2026-06-19", 0.138, "2026-06-15")],
    );
    expect(r.faltantes).toEqual([]);
    expect(r.sobrando).toEqual([]);
  });

  // ── Defeito 3 (09/09/2026): parcelas anteriores ao inicio da serie ───────────────────────
  // Sem o piso, 206 parcelas de ITSA4 entre 1996 e 2022 entraram todas com data-ex 02/01/2023,
  // e o papel saltou de 37 para 442 proventos.
  describe("piso da serie", () => {
    it("descarta parcela anterior ao piso", () => {
      const r = reconciliarProventos([], [deles("1998-10-02", 0.023625)], "2023-01-02");
      expect(r.faltantes).toEqual([]);
    });

    it("mantem parcela a partir do piso", () => {
      const r = reconciliarProventos([], [deles("2023-01-02", 0.141)], "2023-01-02");
      expect(r.faltantes).toHaveLength(1);
    });

    it("sem piso, nao descarta nada", () => {
      const r = reconciliarProventos([], [deles("1998-10-02", 0.023625)]);
      expect(r.faltantes).toHaveLength(1);
    });
  });

  describe("quando a base tem MAIS do que a B3 declara", () => {
    it("reporta e nao apaga", () => {
      const r = reconciliarProventos(
        [nossa("2025-06-02", 0.0235295), nossa("2025-06-02", 0.0235295)],
        [deles("2025-06-02", 0.0235295)],
      );
      expect(r.faltantes).toEqual([]);
      expect(r.sobrando).toHaveLength(1);
      expect(r.sobrando[0].nossas).toHaveLength(1);
    });
  });

  it("nao mistura tipos diferentes na mesma data-ex", () => {
    const r = reconciliarProventos(
      [nossa("2024-12-26", 0.65356508, null, "DIVIDENDO")],
      [
        deles("2024-12-26", 0.65356508, null, "DIVIDENDO"),
        deles("2024-12-26", 0.66410331, null, "JCP"),
      ],
    );
    expect(r.faltantes).toHaveLength(1);
    expect(r.faltantes[0].tipo).toBe("JCP");
  });

  it("e idempotente: rodar sobre a base ja completada nao acha nada", () => {
    const naB3 = [
      deles("2025-03-05", 0.0235295, "2024-02-19"),
      deles("2025-03-05", 0.0235295, "2025-02-10"),
      deles("2025-06-02", 0.0235295, "2025-02-10"),
    ];
    const primeira = reconciliarProventos([nossa("2025-03-05", 0.0235295, "2024-02-19")], naB3);
    const base = [
      nossa("2025-03-05", 0.0235295, "2024-02-19"),
      ...primeira.faltantes.map((f) => nossa(f.dataEx, f.valor, f.aprovacao, f.tipo)),
    ];
    const segunda = reconciliarProventos(base, naB3);
    expect(segunda.faltantes).toEqual([]);
  });
});
