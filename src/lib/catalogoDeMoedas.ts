/**
 * Catalogo de moedas negociaveis.
 *
 * Existem tres catalogos no sistema, e este e o unico que NAO fica em banco:
 *   - fundos    -> `invest.cadastro_de_fundos`, alimentado pela CVM
 *   - titulos   -> `invest.cadastro_de_titulos`, criado pelo primeiro cliente que cadastra
 *   - moedas    -> esta lista
 *
 * A diferenca nao e descuido. Um titulo novo o cliente inventa a qualquer momento, e nada
 * alem do cadastro precisa mudar - por isso ali a tabela paga. Uma moeda nova exige serie de
 * cotacao propria: tabela `historico_<moeda>`, codigo da serie no BCB e uma linha nas rotinas
 * `daily-market-sync` e `market-carry-forward`. O campo `tabela` abaixo e a prova disso. Um
 * cadastro em banco daria aparencia de configuracao a algo que continua sendo mudanca de
 * codigo, e essa aparencia e pior do que a lista honesta.
 *
 * Se um dia forem dez moedas, o desenho passa a ser o do cadastro de fundos, com a serie de
 * cotacao como atributo do registro.
 *
 * Fica separado do `cambioEngine` porque isto e CATALOGO, nao calculo.
 */
export const MOEDAS = [
  { codigo: "USD", nome: "Dólar americano", simbolo: "US$", tabela: "historico_dolar" },
  { codigo: "EUR", nome: "Euro", simbolo: "€", tabela: "historico_euro" },
] as const;

export type CodigoMoeda = (typeof MOEDAS)[number]["codigo"];

export const moedaPorCodigo = (codigo: string | null | undefined) =>
  MOEDAS.find((m) => m.codigo === codigo) ?? null;
