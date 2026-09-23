/**
 * Para que lado anda o cupom que cai em dia não útil.
 *
 * Medido em 22/09/2026 contra o que a XP pagou no CRA da Minerva (CETIP CRA024002S2, Virgo,
 * 11,8085% a.a. pela CVM, semestral, vencimento 15/03/2029). Os créditos estão no extrato da conta
 * investimento do Daniel:
 *
 *   17/03/2025  R$ 2.822,95      15/03/2025 caiu num sábado
 *   15/09/2025  R$ 2.869,76
 *   16/03/2026  R$ 2.846,35      15/03/2026 caiu num domingo
 *   15/09/2026  R$ 2.869,76
 *
 * Em CRA, CRI e debênture o cupom anda para a FRENTE. Nos demais produtos continua andando para
 * trás, que foi como o motor fechou com o Gorila num CDB com cupom.
 */
import { gerarDatasPagamentoJuros, ajusteDeCupomDoProduto, calcularRendaFixaDiario } from "./rendaFixaEngine";

const FERIADOS = new Set([
  "2024-05-01", "2024-05-30", "2024-11-15", "2024-11-20", "2024-12-25", "2025-01-01", "2025-03-03",
  "2025-03-04", "2025-04-18", "2025-04-21", "2025-05-01", "2025-06-19", "2025-11-20", "2025-12-25",
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04",
  "2026-09-07",
]);

function calendario(de: string, ate: string) {
  const linhas: { data: string; dia_util: boolean }[] = [];
  const d = new Date(de + "T00:00:00Z");
  const fim = new Date(ate + "T00:00:00Z");
  while (d <= fim) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    linhas.push({ data: iso, dia_util: dow >= 1 && dow <= 5 && !FERIADOS.has(iso) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return linhas;
}

const CAL = calendario("2024-05-01", "2026-09-22");

describe("ajuste do cupom em dia não útil", () => {
  it("CRA, CRI e debênture andam para a frente; o resto, para trás", () => {
    for (const p of ["CRA", "CRI", "Debêntures", "DEBENTURES"]) {
      expect(ajusteDeCupomDoProduto(p)).toBe("seguinte");
    }
    for (const p of ["CDB", "LCI", "LCA", "LCD", "LF", null, undefined]) {
      expect(ajusteDeCupomDoProduto(p)).toBe("anterior");
    }
  });

  it("o CRA da Minerva paga nos dias em que a XP pagou", () => {
    const datas = gerarDatasPagamentoJuros(
      "2024-05-24", "2029-03-15", "Semestral", CAL, "2026-09-22", "seguinte");
    expect([...datas].sort()).toEqual(["2024-09-16", "2025-03-17", "2025-09-15", "2026-03-16", "2026-09-15"]);
  });

  it("com a regra antiga o mesmo papel pagaria antes, na sexta", () => {
    const datas = gerarDatasPagamentoJuros(
      "2024-05-24", "2029-03-15", "Semestral", CAL, "2026-09-22", "anterior");
    expect([...datas].sort()).toEqual(["2024-09-13", "2025-03-14", "2025-09-15", "2026-03-13", "2026-09-15"]);
  });

  it("os cupons do CRA batem com o que a XP pagou, por certificado", () => {
    const rows = calcularRendaFixaDiario({
      dataInicio: "2024-05-24",
      dataCalculo: "2026-09-22",
      taxa: 11.8085,
      modalidade: "Prefixado",
      puInicial: 1000,
      produtoNome: "CRA",
      calendario: CAL,
      // 50 certificados de PU 1.000, para comparar com o cupom por certificado da XP. Na carteira
      // do Daniel a quantidade é 49,90771, porque ele comprou com deságio e a ferramenta ainda não
      // separa o PU de emissão do PU pago - por isso os cupons dele saem 0,18% menores.
      movimentacoes: [{ data: "2024-05-24", tipo_movimentacao: "Aplicação Inicial", valor: 50000 }],
      pagamento: "Semestral",
      vencimento: "2029-03-15",
      indexador: null,
    });

    const cupom = (data: string) => {
      const linha = rows.find((r) => r.data === data);
      return linha ? Math.round(linha.pagamentoJuros * 100) / 100 : null;
    };

    // Um centavo de tolerancia: o arredondamento do agente fiduciario nao e o nosso.
    expect(cupom("2025-03-17")).toBeCloseTo(2822.95, 1);
    expect(cupom("2025-09-15")).toBeCloseTo(2869.76, 1);
    expect(cupom("2026-03-16")).toBeCloseTo(2846.35, 1);
    expect(cupom("2026-09-15")).toBeCloseTo(2869.76, 1);
  });
});
