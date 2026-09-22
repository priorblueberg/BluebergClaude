/**
 * Emissores que NAO sao instituicao financeira: quem emite debenture, CRI e CRA.
 *
 * A lista do Banco Central (`invest.sincronizar_bases_do_bcb`) cobre banco, corretora, cooperativa
 * e instituicao de pagamento. Securitizadora e companhia aberta nao estao la - em 22/09/2026 o
 * cadastro do CRA do Atacadao (VERT) e do CRA da Minerva (Riza/Virgo) teve que ser feito a mao,
 * e o Daniel cortou: "Nao podemos ter emissores que nao estao na fonte".
 *
 * A fonte destes e a CVM: o cadastro de companhias abertas, que traz CNPJ, razao social, setor e
 * situacao do registro. Vem em CSV puro, separado por ponto e virgula e **em latin-1** - por isso
 * a carga mora aqui e nao no SQL: o `http` do Postgres decodifica como UTF-8 e devolve
 * um nome com acento cheio de caractere invalido no lugar da letra certa.
 *
 * Como a rotina do BCB, esta NAO apaga nem renomeia ninguem: so insere quem falta, comparando pela
 * raiz do CNPJ. Renome (Riza -> Virgo, CCB -> Bank of China) continua sendo decisao humana, porque
 * a CVM mantem o nome do registro, nao o nome de hoje.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CADASTRO = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  try {
    const resposta = await fetch(CADASTRO);
    if (!resposta.ok) return json({ ok: false, erro: `CVM devolveu ${resposta.status}` }, 502);

    // O arquivo e latin-1. Decodificar como UTF-8 estraga todo nome com acento.
    const texto = new TextDecoder("windows-1252").decode(await resposta.arrayBuffer());
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (linhas.length < 2) return json({ ok: false, erro: "cadastro da CVM veio vazio" }, 502);

    const cabecalho = linhas[0].split(";").map((c) => c.trim());
    const col = (nome: string) => cabecalho.indexOf(nome);
    const iCnpj = col("CNPJ_CIA"), iNome = col("DENOM_SOCIAL"), iSit = col("SIT"), iSetor = col("SETOR_ATIV");
    if (iCnpj < 0 || iNome < 0) return json({ ok: false, erro: "cadastro da CVM mudou de colunas" }, 502);

    // Uma linha por raiz de CNPJ: a mesma companhia aparece repetida (endereco, responsavel).
    // Fica a mais recente por situacao ATIVO, senao a primeira.
    const porRaiz = new Map<string, { nome: string; situacao: string; setor: string }>();
    for (const linha of linhas.slice(1)) {
      const c = linha.split(";");
      const raiz = (c[iCnpj] ?? "").replace(/\D/g, "").slice(0, 8);
      const nome = (c[iNome] ?? "").trim().toUpperCase();
      if (raiz.length !== 8 || !nome) continue;
      const situacao = (c[iSit] ?? "").trim();
      const setor = (iSetor >= 0 ? c[iSetor] ?? "" : "").trim();
      const atual = porRaiz.get(raiz);
      if (!atual || (situacao === "ATIVO" && atual.situacao !== "ATIVO")) {
        porRaiz.set(raiz, { nome, situacao, setor });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } },
    );

    // Paginado: o PostgREST corta em 1000 linhas sem avisar, e a tabela tem mais que isso.
    const jaTem = new Set<string>();
    const nomesUsados = new Set<string>();
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabase
        .from("emissores").select("cnpj, nome_busca").is("user_id", null).range(de, de + 999);
      if (error) return json({ ok: false, erro: `leitura dos emissores: ${error.message}` }, 502);
      for (const e of (data ?? []) as { cnpj: string | null; nome_busca: string | null }[]) {
        if (e.cnpj) jaTem.add(e.cnpj);
        if (e.nome_busca) nomesUsados.add(e.nome_busca);
      }
      if (!data || data.length < 1000) break;
    }

    // `nome_busca` e unico entre os emissores globais: candidato com nome ja usado (a mesma
    // companhia vinda do BCB, ou duas raizes com a mesma razao social) fica de fora, senao o lote
    // inteiro morre no indice unico.
    const normalizar = (t: string) =>
      t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

    const novos = [...porRaiz.entries()]
      .filter(([raiz, c]) => {
        if (jaTem.has(raiz)) return false;
        const chave = normalizar(c.nome);
        if (nomesUsados.has(chave)) return false;
        nomesUsados.add(chave);
        return true;
      })
      .map(([raiz, c]) => ({
        nome: c.nome,
        cnpj: raiz,
        // A situacao do registro entra no segmento: registro cancelado na CVM nao quer dizer
        // empresa extinta, e o papel dela pode estar na carteira.
        segmento: [c.setor || "Companhia aberta", c.situacao === "ATIVO" ? null : `registro ${c.situacao.toLowerCase()}`]
          .filter(Boolean).join(" - "),
        origem: "cvm",
        ativo: true,
        user_id: null,
      }));

    let inseridos = 0;
    for (let de = 0; de < novos.length; de += 500) {
      const lote = novos.slice(de, de + 500);
      const { error } = await supabase.from("emissores").insert(lote);
      if (!error) { inseridos += lote.length; continue; }
      // Um choque de chave nao pode derrubar o lote inteiro: refaz linha a linha e segue.
      for (const linha of lote) {
        const { error: erroLinha } = await supabase.from("emissores").insert(linha);
        if (!erroLinha) inseridos++;
        else if (!erroLinha.message.includes("duplicate key")) {
          return json({ ok: false, erro: `insercao: ${erroLinha.message}`, inseridos }, 502);
        }
      }
    }

    return json({ ok: true, lidos: porRaiz.size, candidatos: novos.length, inseridos });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
