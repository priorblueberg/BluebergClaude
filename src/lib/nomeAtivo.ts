/**
 * Nome do ativo de Renda Fixa, no padrão do Daniel (2026-08-17):
 *
 *   Prefixado   [Produto] [Emissor] [Taxa] a.a. - [Vencimento]
 *   Pós CDI     [Produto] [Emissor] [Taxa] do CDI - [Vencimento]
 *   Mista       [Produto] [Emissor] CDI+ [Taxa] - [Vencimento]
 *
 * A palavra da modalidade não entra no nome: o formato já a denuncia.
 *
 * Estava duplicado em CadastrarTransacaoPage e WelcomeOnboardingPage, com
 * pequenas diferenças entre as cópias. Fonte única agora.
 */

/** Tira o sufixo entre parênteses: "CDB (Certificado de Depósito Bancário)" → "CDB" */
export function sigla(nome: string): string {
  return nome.replace(/\s*\(.*\)$/, "").trim();
}

export function buildNomeAtivo(
  produtoNome: string,
  emissorNome: string,
  modalidade: string,
  taxa: string,
  vencimento: string,
  indexador: string
): string {
  const prod = sigla(produtoNome);
  const taxaFormatted = taxa ? `${taxa.replace(".", ",")}%` : "";
  const vencFormatted = vencimento
    ? new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR")
    : "";
  const venc = vencFormatted ? `- ${vencFormatted}` : "";

  // Mista com IPCA: na boleta é "Pós Fixado" + indexador "IPCA+"; gravada vira
  // "Mista" + "IPCA". Precisa vir antes do teste de Mista, senão cai no rótulo CDI+.
  const ehIpca = indexador === "IPCA+" || indexador === "IPCA";

  const partes =
    modalidade === "Prefixado"
      ? [prod, emissorNome, taxaFormatted ? `${taxaFormatted} a.a.` : "", venc]
      : ehIpca
        ? [prod, emissorNome, "IPCA+", taxaFormatted, venc]
        : // Mista: na boleta é "Pós Fixado" + indexador "CDI+"; gravada vira "Mista".
          indexador === "CDI+" || modalidade === "Mista"
          ? [prod, emissorNome, "CDI+", taxaFormatted, venc]
          : // Pós fixado indexado ao CDI
            [prod, emissorNome, taxaFormatted, "do CDI", venc];

  return partes.filter(Boolean).join(" ");
}
