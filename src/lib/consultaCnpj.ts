/**
 * Razao social a partir do CNPJ, para cadastrar emissor nao-financeiro.
 *
 * Os 1.614 emissores da lista do Banco Central entram com razao social E CNPJ. Quem o usuario
 * cadastrava pela boleta entrava so com o nome digitado - e emissor de debenture, CRI ou CRA e
 * empresa, que nao esta naquela lista. O resultado eram registros sem identificacao: duas
 * grafias da mesma companhia viram dois emissores, e nao ha como saber que sao o mesmo.
 *
 * Fonte: BrasilAPI, publica, sem chave e com CORS liberado (`access-control-allow-origin: *`),
 * entao a consulta sai do proprio navegador.
 */

export interface DadosCnpj {
  cnpj: string;
  /** So os 8 primeiros digitos - e assim que os registros do BCB guardam. */
  raiz: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  uf: string | null;
  situacao: string | null;
  /** false quando a Receita nao mostra a empresa como ATIVA. */
  ativa: boolean;
}

/** Deixa so os digitos. */
export function soDigitos(texto: string): string {
  return (texto ?? "").replace(/\D/g, "");
}

/** 00.000.000/0000-00 */
export function formatarCnpj(valor: string): string {
  const d = soDigitos(valor).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Digito verificador do CNPJ.
 *
 * Vale a checagem local antes de chamar a rede: numero digitado errado vira 404 da API, e "nao
 * encontrado" faz o usuario procurar a empresa em vez de conferir o que ele digitou.
 */
export function cnpjValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // 00000000000000 e afins

  const dv = (base: string, pesoInicial: number): number => {
    let peso = pesoInicial;
    let soma = 0;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return (
    dv(c.slice(0, 12), 5) === Number(c[12]) &&
    dv(c.slice(0, 13), 6) === Number(c[13])
  );
}

/**
 * Consulta a razao social. Devolve `null` quando o CNPJ nao existe na base da Receita;
 * lanca quando a rede falha, para a tela poder separar "nao achei" de "nao consegui olhar".
 */
export async function consultarCnpj(valor: string): Promise<DadosCnpj | null> {
  const c = soDigitos(valor);
  if (!cnpjValido(c)) throw new Error("CNPJ inválido.");

  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Não foi possível consultar o CNPJ (erro ${r.status}).`);

  const j = await r.json();
  const razao: string = (j?.razao_social ?? "").trim();
  if (!razao) return null;

  const situacao: string | null = j?.descricao_situacao_cadastral ?? null;
  return {
    cnpj: c,
    raiz: c.slice(0, 8),
    razaoSocial: razao,
    nomeFantasia: (j?.nome_fantasia ?? "").trim() || null,
    uf: j?.uf ?? null,
    situacao,
    ativa: (situacao ?? "").toUpperCase() === "ATIVA",
  };
}
