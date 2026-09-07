import { describe, it, expect } from "vitest";
import { calcularRendaFixaDiario, permiteVendaNoSecundario } from "./rendaFixaEngine";
import { construirFatoresIpcaDiarios } from "./ipcaEngine";
import { pisoDoCalendario, FOLGA_CICLO_IPCA_DIAS } from "./ipcaSeries";

/**
 * Debenture calculada NA CURVA.
 *
 * Decisao do Daniel em 06/09/2026: debentures, CRI e CRA nao serao marcados a mercado. Sao
 * calculados na curva, partindo do principio de que no dia do vencimento o valor bate com o
 * que o emissor paga. A contrapartida e a boleta: no fechamento de posicao o valor tem que ser
 * digitavel, porque uma venda no secundario sai pelo preco de mercado, nao pela curva.
 *
 * Caso de teste: COMGAS, vencimento DEZ 2023.
 *   aplicacao   14/06/2023
 *   taxa        IPCA + 7,80%
 *   vencimento  15/12/2023
 *   valor       R$ 150.976,22
 *
 * O papel comeca e termina em 2023, antes do inicio da carteira (29/12/2023) - por isso o
 * `calendario_dias_uteis` do banco foi estendido para tras ate 01/01/2022.
 *
 * Premissa assumida por falta de dado: pagamento NO VENCIMENTO (bullet). Debentures IPCA+
 * costumam pagar cupom semestral, e com cupom o valor no vencimento NAO e o principal
 * corrigido acumulado - parte ja teria sido paga antes. Se a COMGAS DEZ 2023 pagava cupom,
 * este numero muda.
 */

// ── calendario 2023 ──────────────────────────────────────────────────
// Mesma convencao da daily-market-sync: nacionais fixos + Carnaval, Sexta-Feira Santa e
// Corpus Christi. Pascoa de 2023 em 09/04.
const FERIADOS_2023 = new Set([
  "2023-01-01", "2023-02-20", "2023-02-21", "2023-04-07", "2023-04-21",
  "2023-05-01", "2023-06-08", "2023-09-07", "2023-10-12", "2023-11-02",
  "2023-11-15", "2023-11-20", "2023-12-25",
]);

function calendario(de: string, ate: string) {
  const dias: { data: string; dia_util: boolean }[] = [];
  const d = new Date(de + "T12:00:00");
  const fim = new Date(ate + "T12:00:00");
  while (d <= fim) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    dias.push({ data: iso, dia_util: dow >= 1 && dow <= 5 && !FERIADOS_2023.has(iso) });
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

/** Numeros de indice do IBGE, como estao em invest.historico_ipca. */
const IPCA = [
  { competencia: "2022-12", numero_indice: 6474.09, data_publicacao: "2023-01-10" },
  { competencia: "2023-01", numero_indice: 6508.40, data_publicacao: "2023-02-09" },
  { competencia: "2023-02", numero_indice: 6563.07, data_publicacao: "2023-03-10" },
  { competencia: "2023-03", numero_indice: 6609.67, data_publicacao: "2023-04-11" },
  { competencia: "2023-04", numero_indice: 6649.99, data_publicacao: "2023-05-12" },
  { competencia: "2023-05", numero_indice: 6665.28, data_publicacao: "2023-06-07" },
  { competencia: "2023-06", numero_indice: 6659.95, data_publicacao: "2023-07-11" },
  { competencia: "2023-07", numero_indice: 6667.94, data_publicacao: "2023-08-11" },
  { competencia: "2023-08", numero_indice: 6683.28, data_publicacao: "2023-09-12" },
  { competencia: "2023-09", numero_indice: 6700.66, data_publicacao: "2023-10-11" },
  { competencia: "2023-10", numero_indice: 6716.74, data_publicacao: "2023-11-10" },
  { competencia: "2023-11", numero_indice: 6735.55, data_publicacao: "2023-12-12" },
  { competencia: "2023-12", numero_indice: 6773.27, data_publicacao: "2024-01-11" },
];

const APLICACAO = "2023-06-14";
const VENCIMENTO = "2023-12-15";
const VALOR = 150976.22;
const TAXA = 7.8;

function rodar(dataCalculo: string, opcoes: { pagamento?: string } = {}) {
  // O calendario tem que abrir ANTES do ciclo de IPCA que contem a compra.
  //
  // O ciclo de 14/06/2023 abre em 15/05 (aniversario = dia do vencimento). Truncar o
  // calendario depois disso faz o motor contar menos dias uteis no primeiro ciclo e
  // distorce o pro-rata. Medido variando so o inicio do calendario, com todo o resto
  // igual:
  //
  //   desde 09/06/2023 -> P&L R$ 7.568,35
  //   desde 01/06/2023 -> P&L R$ 7.517,79
  //   desde 15/05/2023 -> P&L R$ 7.493,89   <- abertura do ciclo
  //   desde 01/05/2023 -> P&L R$ 7.493,89
  //   desde 02/01/2023 -> P&L R$ 7.493,89   (estavel daqui para tras)
  //
  // O valor estabiliza EXATAMENTE quando o calendario alcanca 15/05. Por isso o teste
  // abre em janeiro: qualquer data anterior a 15/05 daria o mesmo numero.
  const cal = calendario("2023-01-02", "2023-12-31");
  const ipcaFatores = construirFatoresIpcaDiarios({
    diaAniversario: 15, // dia do vencimento
    calendario: cal,
    competencias: IPCA,
    dataInicio: APLICACAO,
  });

  return calcularRendaFixaDiario({
    dataInicio: APLICACAO,
    dataCalculo,
    taxa: TAXA,
    modalidade: "Mista",
    indexador: "IPCA",
    puInicial: 1000,
    calendario: cal,
    movimentacoes: [
      { data: APLICACAO, tipo_movimentacao: "Aplicação Inicial", valor: VALOR },
    ],
    vencimento: VENCIMENTO,
    pagamento: opcoes.pagamento ?? "No Vencimento",
    ipcaFatores,
    // Debenture: rende no proprio dia da compra (128 dias uteis, nao 127).
    rendeNoDiaDaCompra: true,
  });
}

describe("COMGAS DEZ 2023 na curva", () => {
  /**
   * No vencimento o papel e liquidado: `liquido` vai a zero e a posicao some da carteira.
   * O valor que o emissor paga esta em `liquido2`, o saldo ANTES da baixa - a mesma
   * convencao ja validada contra o Gorila em [[vencimento-preco-congelado-gorila]].
   * Comparar `liquido` de papel vencido so mostra zero dos dois lados.
   */
  it("chega ao vencimento com um valor coerente", () => {
    const rows = rodar(VENCIMENTO);
    const fim = rows[rows.length - 1];
    expect(fim.data).toBe(VENCIMENTO);

    const valorNoVencimento = fim.liquido2;
    const du = rows.filter((r) => r.diaUtil && r.data > APLICACAO).length;
    const fatorJuros = Math.pow(1 + TAXA / 100, du / 252);
    const fatorTotal = valorNoVencimento / VALOR;
    const fatorIpca = fatorTotal / fatorJuros;

    console.log("\n  COMGAS DEZ 2023 - IPCA + 7,80%, bullet");
    console.log("  aplicacao    " + APLICACAO + "   R$ " + VALOR.toFixed(2));
    console.log("  vencimento   " + VENCIMENTO);
    console.log("  dias uteis   " + du);
    console.log("  fator juros  " + fatorJuros.toFixed(8) + "   (1,078 ^ " + du + "/252)");
    console.log("  fator IPCA   " + fatorIpca.toFixed(8) + "   (implicito)");
    console.log("  ------------------------------------------");
    console.log("  VALOR NO VENCIMENTO   R$ " + valorNoVencimento.toFixed(2));
    console.log("  principal corrigido   R$ " + fim.principalCorrigido.toFixed(2));
    console.log("  rendimento            R$ " + fim.ganhoAcumulado.toFixed(2) +
                "   (" + ((fatorTotal - 1) * 100).toFixed(2) + "%)");
    console.log("  posicao apos a baixa  R$ " + fim.liquido.toFixed(2));

    // Meio ano a IPCA+7,80%: o valor sobe, e nao explode.
    expect(valorNoVencimento).toBeGreaterThan(VALOR);
    expect(fatorTotal).toBeGreaterThan(1.02);
    expect(fatorTotal).toBeLessThan(1.09);

    // O IPCA do periodo foi baixo (junho negativo). O fator implicito reflete isso.
    expect(fatorIpca).toBeGreaterThan(1.0);
    expect(fatorIpca).toBeLessThan(1.02);

    // A posicao e zerada no vencimento, e o P&L e preservado.
    expect(fim.liquido).toBeCloseTo(0, 2);
    expect(fim.ganhoAcumulado).toBeCloseTo(valorNoVencimento - VALOR, 2);
  });

  it("a curva sobe sem solavanco ate a vespera", () => {
    // Ate 14/12: o dia 15 e o encerramento e teria o degrau da baixa.
    const rows = rodar("2023-12-14").filter((r) => r.data > APLICACAO);
    let piorQueda = 0;
    for (let i = 1; i < rows.length; i++) {
      const anterior = rows[i - 1].liquido;
      if (anterior > 0) {
        piorQueda = Math.min(piorQueda, (rows[i].liquido - anterior) / anterior);
      }
    }

    console.log("  vespera (14/12): R$ " + rows[rows.length - 1].liquido.toFixed(2) +
                "   pior variacao diaria: " + (piorQueda * 100).toFixed(4) + "%");

    // Junho de 2023 teve IPCA negativo (-0,08%), entao a curva PODE recuar.
    // O que nao pode e recuar muito: isso denunciaria erro de fator.
    expect(piorQueda).toBeGreaterThan(-0.001);
  });

  it("nao rende depois do vencimento", () => {
    const noVenc = rodar(VENCIMENTO);
    const depois = rodar("2023-12-28");

    const a = noVenc[noVenc.length - 1];
    const b = depois[depois.length - 1];

    console.log("  serie para em " + b.data + " mesmo pedindo 28/12" +
                "   |   P&L: R$ " + b.ganhoAcumulado.toFixed(2));

    // O motor nao passa do vencimento: o papel foi liquidado.
    expect(b.data).toBe(VENCIMENTO);
    expect(b.ganhoAcumulado).toBeCloseTo(a.ganhoAcumulado, 2);
  });
});

/**
 * Guarda do recorte por produto.
 *
 * O motor so aplica a regra dos 128 dias uteis quando o chamador liga `rendeNoDiaDaCompra`,
 * e quem decide isso e `permiteVendaNoSecundario(nome do produto)`. Se um nome do banco
 * deixar de casar com a lista - acento perdido, plural mudado - o flag chega falso e o papel
 * volta silenciosamente para 127 dias, sem erro de tipo e sem teste vermelho em nenhum outro
 * lugar. Por isso os nomes abaixo sao os EXATOS de invest.produtos.
 */
describe("quais produtos rendem no dia da compra", () => {
  it("os tres negociaveis, com o nome exato do banco", () => {
    for (const nome of ["Debêntures", "CRI", "CRA"]) {
      expect(permiteVendaNoSecundario(nome)).toBe(true);
    }
  });

  it("os contratados com o emissor ficam de fora", () => {
    for (const nome of [
      "CDB", "LCI", "LCA", "LCD", "LC", "LF", "LFS", "LFSN",
      "LIG", "RDB", "RDC", "DPGE", "Poupança",
    ]) {
      expect(permiteVendaNoSecundario(nome)).toBe(false);
    }
  });

  it("CDCA ainda nao entrou: o Daniel citou so debenture, CRI e CRA", () => {
    expect(permiteVendaNoSecundario("CDCA")).toBe(false);
  });

  it("nao quebra com nulo, vazio ou espacos", () => {
    expect(permiteVendaNoSecundario(null)).toBe(false);
    expect(permiteVendaNoSecundario(undefined)).toBe(false);
    expect(permiteVendaNoSecundario("")).toBe(false);
    expect(permiteVendaNoSecundario("  Debêntures  ")).toBe(true);
  });
});

/**
 * Piso do calendario.
 *
 * A COMGAS mostrou que 5 dias de folga nao cobrem o ciclo de IPCA que contem a compra, e o
 * efeito e silencioso: o motor conta menos dias uteis no primeiro ciclo, o pro-rata infla e
 * ninguem reclama. Este teste trava a folga contra o pior caso real - a compra no dia
 * seguinte a um aniversario, com o ciclo anterior aberto 31 dias antes.
 */
describe("piso do calendario", () => {
  it("recua o suficiente para cobrir qualquer ciclo de IPCA", () => {
    // Pior caso: aniversario dia 1o, compra dia 2 -> o ciclo abriu 32 dias antes.
    expect(FOLGA_CICLO_IPCA_DIAS).toBeGreaterThanOrEqual(32);
  });

  it("cobre a abertura do ciclo da COMGAS", () => {
    // Compra 14/06/2023, vencimento dia 15 -> ciclo aberto em 15/05/2023.
    expect(pisoDoCalendario("2023-06-14") <= "2023-05-15").toBe(true);
  });

  it("os 5 dias antigos NAO cobriam - e por isso a tela errava", () => {
    const cincoDias = "2023-06-09";
    expect(cincoDias > "2023-05-15").toBe(true);
  });

  it("atravessa a virada do ano sem quebrar", () => {
    expect(pisoDoCalendario("2024-01-15")).toBe("2023-12-01");
    expect(pisoDoCalendario("2024-03-01")).toBe("2024-01-16"); // ano bissexto
  });
});
