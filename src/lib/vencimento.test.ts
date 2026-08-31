import { describe, it, expect } from "vitest";
import { calcularRendaFixaDiario } from "./rendaFixaEngine";

/**
 * O VENCIMENTO rende o proprio dia, como qualquer dia util. Venda antecipada tambem.
 *
 * O que confunde: o Gorila para de publicar preco no vencimento. Pedindo a posicao do CDB
 * IPCA+3,80% venc. 15/06/2026 (10 cotas) com endDate variavel, em 31/08/2026:
 *
 *   12/06  q=10  pu=1080,4422  mv=10.804,42  pnl=804,42
 *   15/06  q= 0  pu=1080,4422  mv=     0,00  pnl=809,15   <- +4,73 = 1 dia util
 *
 * A posicao ja nasce zerada no dia do vencimento e o `currentPrice` fica congelado no do
 * dia anterior. Ler esse preco congelado como "valor resgatado" foi o erro que deixou os
 * oito papeis vencidos da carteira de teste R$ 50,41 curtos, um dia util cada.
 *
 * Os testes abaixo usam prefixado porque ele nao depende de serie de indice: a regra mora
 * no motor, nao no indexador.
 */

function calendario(de: string, ate: string) {
  const out: { data: string; dia_util: boolean }[] = [];
  for (let t = Date.parse(de + "T00:00:00Z"); t <= Date.parse(ate + "T00:00:00Z"); t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const w = new Date(iso + "T00:00:00Z").getUTCDay();
    out.push({ data: iso, dia_util: w !== 0 && w !== 6 });
  }
  return out;
}

function serie(vencimento: string, dataCalculo: string) {
  const rows = calcularRendaFixaDiario({
    dataInicio: "2025-01-02",
    dataCalculo,
    taxa: 12,
    modalidade: "Prefixado",
    puInicial: 1000,
    calendario: calendario("2024-12-20", "2025-04-30"),
    movimentacoes: [{ data: "2025-01-02", tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
    pagamento: "No Vencimento",
    vencimento,
  });
  return new Map(rows.map((r) => [r.data, r]));
}

describe("convencao do vencimento", () => {
  it("no vencimento o papel rende o proprio dia", () => {
    const m = serie("2025-03-14", "2025-03-14");
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const noVencimento = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(noVencimento / anterior).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });

  it("vencimento na segunda: rende so a segunda, o fim de semana nao conta", () => {
    const m = serie("2025-03-17", "2025-03-17");
    const sexta = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(m.get("2025-03-17")!.puJurosPeriodicos / sexta).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });

  it("dia util comum continua rendendo: a regra e so do vencimento", () => {
    const m = serie("2025-04-30", "2025-03-14");
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const hoje = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(hoje).toBeGreaterThan(anterior);
    expect(hoje / anterior).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });

  it("venda antecipada INCLUI o dia: quem resgata no dia X rende o dia X", () => {
    const rows = calcularRendaFixaDiario({
      dataInicio: "2025-01-02",
      dataCalculo: "2025-03-14",
      taxa: 12,
      modalidade: "Prefixado",
      puInicial: 1000,
      calendario: calendario("2024-12-20", "2025-04-30"),
      movimentacoes: [
        { data: "2025-01-02", tipo_movimentacao: "Aplicação Inicial", valor: 10000 },
        { data: "2025-03-14", tipo_movimentacao: "Resgate Total", valor: 10500 },
      ],
      pagamento: "No Vencimento",
      vencimento: "2025-04-30",
      dataResgateTotal: "2025-03-14",
    });
    const m = new Map(rows.map((r) => [r.data, r]));
    const anterior = m.get("2025-03-13")!.puJurosPeriodicos;
    const noResgate = m.get("2025-03-14")!.puJurosPeriodicos;
    expect(noResgate / anterior).toBeCloseTo(Math.pow(1.12, 1 / 252), 10);
  });
});

/**
 * O cupom paga o JURO e devolve o preco unitario ao PRINCIPAL. Em prefixado e em CDI o
 * principal e o par; no IPCA ele vem corrigido, e a correcao monetaria fica no papel.
 *
 * Medido no Gorila em 31/08/2026 em tres CDBs de IPCA com cupom. Nos seis pagamentos o PU
 * logo apos o cupom e, no centavo, o VNA daquele dia. O teste abaixo usa um IPCA sintetico
 * de 1% ao mes para nao depender da serie real: o que importa e que o piso do cupom ande
 * junto com o indice, e nao fique preso em 1.000.
 */
describe("cupom em papel indexado ao IPCA", () => {
  const INI = "2025-01-02", VENC = "2025-04-15";
  const cal = calendario("2024-12-20", "2025-05-30");

  /** 0,05% por dia util, aplicado todo dia util depois da emissao */
  const fatores = new Map<string, number>();
  for (const c of cal) if (c.dia_util && c.data > INI) fatores.set(c.data, 1.0005);

  const rows: any[] = calcularRendaFixaDiario({
    dataInicio: INI, dataCalculo: VENC, taxa: 6, modalidade: "Mista", puInicial: 1000,
    calendario: cal, movimentacoes: [{ data: INI, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
    pagamento: "Mensal", vencimento: VENC, indexador: "IPCA", ipcaFatores: fatores,
  });
  const m = new Map(rows.map((r) => [r.data, r]));
  const uteis = cal.filter((c) => c.dia_util).map((c) => c.data);
  const vna = (ate: string) => 1000 * Math.pow(1.0005, uteis.filter((d) => d > INI && d <= ate).length);

  it("no cupom o PU volta ao VNA corrigido, nao ao par", () => {
    for (const cupom of ["2025-02-14", "2025-03-14"]) {
      const pu = m.get(cupom)!.puJurosPeriodicos;
      expect(pu).toBeCloseTo(vna(cupom), 6);
      expect(pu).toBeGreaterThan(1000);
    }
  });

  it("entre cupons o PU acumula indice e juro sobre o VNA do ultimo cupom", () => {
    const base = m.get("2025-02-14")!.puJurosPeriodicos;
    const depois = m.get("2025-02-21")!.puJurosPeriodicos;
    const du = uteis.filter((d) => d > "2025-02-14" && d <= "2025-02-21").length;
    expect(depois).toBeCloseTo(base * Math.pow(1.0005, du) * Math.pow(1.06, du / 252), 6);
  });

  it("sem indexador de correcao o cupom continua devolvendo ao par", () => {
    const semIpca: any[] = calcularRendaFixaDiario({
      dataInicio: INI, dataCalculo: VENC, taxa: 12, modalidade: "Prefixado", puInicial: 1000,
      calendario: cal, movimentacoes: [{ data: INI, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
      pagamento: "Mensal", vencimento: VENC,
    });
    const mm = new Map(semIpca.map((r) => [r.data, r]));
    expect(mm.get("2025-02-14")!.puJurosPeriodicos).toBeCloseTo(1000, 8);
  });
});

/**
 * O cupom nao pode baixar COTAS. O Gorila mantem a quantidade fixa e deixa so o preco
 * unitario cair no pagamento, entao o valor da posicao e sempre quantidade x PU.
 *
 * A causa do bug era a base economica: ela guardava o principal AO PAR (cotas x 1.000).
 * Como o cupom e "valor acumulado menos principal", num papel de IPCA ele pagava tambem a
 * correcao monetaria acumulada e derrubava a posicao. Medido no Gorila em 31/08/2026 nos
 * tres CDBs de IPCA com cupom: IPCA+5,00% semestral valia 21.851,65 la e 20.167,78 aqui,
 * com o PU identico ao centavo nos dois lados.
 */
describe("cupom nao consome cotas", () => {
  const INI = "2025-01-02", VENC = "2025-04-15";
  const cal = calendario("2024-12-20", "2025-05-30");
  const fatores = new Map<string, number>();
  for (const c of cal) if (c.dia_util && c.data > INI) fatores.set(c.data, 1.0005);

  const rows: any[] = calcularRendaFixaDiario({
    dataInicio: INI, dataCalculo: "2025-04-14", taxa: 6, modalidade: "Mista", puInicial: 1000,
    calendario: cal, movimentacoes: [{ data: INI, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
    pagamento: "Mensal", vencimento: VENC, indexador: "IPCA", ipcaFatores: fatores,
  });
  const m = new Map(rows.map((r) => [r.data, r]));

  it("depois de tres cupons a posicao ainda vale 10 cotas vezes o PU", () => {
    const r = m.get("2025-04-14")!;
    expect(r.liquido).toBeCloseTo(10 * r.puJurosPeriodicos, 4);
  });

  it("o cupom paga so o juro: o principal corrigido fica no papel", () => {
    const cupom = m.get("2025-02-14")!;
    const vespera = m.get("2025-02-13")!;
    // o que saiu e a queda do PU vezes as cotas, nada alem disso
    expect(cupom.jurosPago).toBeCloseTo(10 * (vespera.puJurosPeriodicos * 1.0005 * Math.pow(1.06, 1 / 252) - cupom.puJurosPeriodicos), 4);
    expect(cupom.jurosPago).toBeGreaterThan(0);
  });

  it("sem indexador de correcao o comportamento nao muda", () => {
    const pre: any[] = calcularRendaFixaDiario({
      dataInicio: INI, dataCalculo: "2025-04-14", taxa: 12, modalidade: "Prefixado", puInicial: 1000,
      calendario: cal, movimentacoes: [{ data: INI, tipo_movimentacao: "Aplicação Inicial", valor: 10000 }],
      pagamento: "Mensal", vencimento: VENC,
    });
    const mm = new Map(pre.map((r) => [r.data, r]));
    const r = mm.get("2025-04-14")!;
    expect(r.liquido).toBeCloseTo(10 * r.puJurosPeriodicos, 4);
    expect(mm.get("2025-02-14")!.puJurosPeriodicos).toBeCloseTo(1000, 8);
  });
});
