import * as XLSX from "xlsx";
import { DailyRow } from "@/lib/rendaFixaEngine";
import { CarteiraRFRow } from "@/lib/carteiraRendaFixaEngine";

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function exportIndividualToExcel(rows: DailyRow[], nomeAtivo: string) {
  const data = rows.map((r) => ({
    Data: formatDate(r.data),
    "Dia Útil": r.diaUtil ? "Sim" : "Não",
    "Valor Cota (1)": r.valorCota,
    "Saldo Cotas (1)": r.saldoCotas,
    "Líquido (1)": r.liquido,
    "Valor Cota (2)": r.valorCota2,
    "Saldo Cotas (2)": r.saldoCotas2,
    "Líquido (2)": r.liquido2,
    Aplicações: r.aplicacoes,
    "QTD Cotas (Compra)": r.qtdCotasCompra,
    Resgate: r.resgates,
    "QTD Cotas (Resgate)": r.qtdCotasResgate,
    "Rent. Diária (R$)": r.ganhoDiario,
    "Rent. Diária (%)": r.rentDiariaPct * 100,
    "R$ Rent. Acumulada": r.ganhoAcumulado,
    "Rent. Acum (2)": r.rentAcumulada2 * 100,
    "% Rent. Acumulada": r.rentabilidadeAcumuladaPct * 100,
    Multiplicador: r.multiplicador,
    "Apoio Cupom": r.apoioCupom,
    "Cupom Acumulado": r.cupomAcumulado,
    "Juros Pago": r.jurosPago,
    "Valor Investido": r.valorInvestido,
    "Resgate Limpo": r.resgateLimpo,
    "Preço Unitário": r.precoUnitario,
    "QTD Aplicação": r.qtdAplicacaoPU,
    "QTD Resgate": r.qtdResgatePU,
    "Base Econômica": r.baseEconomica,
    "Aplicação Ex Cupom": r.aplicacaoExCupom,
    "Resgate Ex Cupom": r.resgateExCupom,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Calculadora");
  XLSX.writeFile(wb, `Calculadora_${nomeAtivo.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`);
}

export function exportCarteiraToExcel(rows: CarteiraRFRow[]) {
  const data = rows.map((r) => ({
    Data: formatDate(r.data),
    "Dia Útil": r.diaUtil ? "Sim" : "Não",
    "Líquido (1)": r.liquido,
    "Líquido (2)": r.liquido2,
    "Rent. Diária (R$)": r.rentDiariaRS,
    "Rent. Diária (%)": r.rentDiariaPct * 100,
    "R$ Rent. Acumulada": r.rentAcumuladaRS,
    "% Rent. Acumulada": r.rentAcumuladaPct * 100,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Carteira RF");
  XLSX.writeFile(wb, "Calculadora_Carteira_RF.xlsx");
}
