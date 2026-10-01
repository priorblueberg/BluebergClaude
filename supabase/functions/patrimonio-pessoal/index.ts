// Ponte para o banco de FINANCAS PESSOAIS, que e um projeto Supabase separado.
//
// ── Por que existe uma funcao no meio ────────────────────────────────────────────────────────
//
// O caminho obvio seria o navegador falar direto com o segundo projeto, como o dashboard local
// faz. Nao da, e a razao nao e de estilo:
//
// 1. A chave anonima vai no bundle, que e servido a qualquer um. Quem protege e a RLS - e a RLS
//    do projeto de financas hoje e `anon SELECT using (true)` em `saldos_mensais`,
//    `transacoes_financeiras` e `pagamento_faturas`. Isso era seguro enquanto o unico leitor era
//    um arquivo `file://` na maquina do Daniel; publicado em www.blueberg.com.br, significaria
//    extrato e saldo pessoal abertos para qualquer visitante.
// 2. Sessao nao atravessa projeto. O JWT emitido no login do Blueberg nao vale no projeto de
//    financas, entao nem apertando a RLS de la o navegador conseguiria se identificar.
//
// Aqui a chave do segundo projeto fica em `FINANCAS_KEY`, um secret da funcao, e NUNCA chega ao
// navegador. Quem chega identificado e o usuario do Blueberg, e a funcao so responde a admin.
//
// Quando a RLS do projeto de financas for apertada (tirar o `anon using (true)`), basta trocar o
// secret pela service role: nada mais neste arquivo muda.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * As contas que a pagina individual do Caixa pode pedir, e como cada uma se le no banco de
 * financas. LISTA FECHADA de proposito: o navegador manda so a chave, e a funcao decide o filtro.
 * Aceitar filtro livre do navegador seria abrir a tabela inteira a quem montasse o pedido.
 *
 * A Conta Luciana engoliu a Conta Samambaia e a Conta Osvaldo Cruz em 29/09/2026 (Daniel: "essas
 * duas foram com a Luciana tambem"). Os tres assuntos - os dois imoveis e os reembolsos - viraram
 * uma conta so, com lancamento espelho proprio, no modelo da Conta Mauricio. A subcategoria na
 * conta de origem (`Apto Samambaia`, `Apto Osvaldo Cruz`, `Reembolsos`) diz de onde vem cada linha.
 *
 * A Conta Mauricio terminou a travessia em 24/09/2026: todo lancamento dela tem ESPELHO proprio
 * (`instituicao = 'Conta Maurício'`), e nenhum usa mais a categoria antiga. O `ou` fica como rede:
 * se algo for recadastrado do jeito velho, aparece na conta em vez de sumir.
 *
 * `recebivel` marca a conta que nao e dinheiro em caixa e sim divida de alguem com o Daniel. Nela
 * o `contabilizar` nao serve para dividir a ponte, porque emprestimo nunca e receita nem despesa
 * do Daniel: cairia tudo em transferencia entre contas e a tabela nao mostraria movimento nenhum
 * (Daniel, 24/09/2026: "como mudamos o conceito, deve estar dividido entre entradas e saidas").
 * Ali quem divide e o TIPO do lancamento, e so a categoria `Transferência entre contas` fica na
 * terceira linha.
 */
const CONTAS: Record<string, {
  instituicao?: string; tipo_conta?: string; categoria?: string; ou?: string; recebivel?: true;
}> = {
  cc: { instituicao: "Bradesco", tipo_conta: "Conta Corrente" },
  cc_xp: { instituicao: "XP Investimentos", tipo_conta: "Conta Corrente" },
  caju: { instituicao: "Conta Caju", tipo_conta: "Conta Corrente" },
  adriana: { instituicao: "Conta Adriana", tipo_conta: "Conta Corrente", recebivel: true },
  mauricio: { ou: "instituicao.eq.Conta Maurício,categoria.eq.Conta Maurício", recebivel: true },
  luciana: { instituicao: "Conta Luciana", tipo_conta: "Conta Corrente", recebivel: true },
  cartao_bradesco: { instituicao: "Bradesco", tipo_conta: "Cartão de Crédito" },
  cartao_xp: { instituicao: "XP Investimentos", tipo_conta: "Cartão de Crédito" },
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── 1. Quem esta chamando ──
    //
    // A checagem roda com o JWT de quem chamou, contra o banco do Blueberg, e usa a mesma
    // `invest.is_admin()` do resto do sistema. Repetir a regra aqui (comparar e-mail, por
    // exemplo) criaria uma segunda definicao de admin que sairia do lugar com o tempo.
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ ok: false, erro: "sem credencial" }, 401);

    const comoUsuario = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } }, db: { schema: "invest" } },
    );
    const { data: ehAdmin, error: eAdmin } = await comoUsuario.rpc("is_admin");
    if (eAdmin) return json({ ok: false, erro: `checagem de admin: ${eAdmin.message}` }, 500);
    if (!ehAdmin) return json({ ok: false, erro: "apenas administradores" }, 403);

    // ── 2. O segundo banco ──
    const url = Deno.env.get("FINANCAS_URL");
    const chave = Deno.env.get("FINANCAS_KEY");
    if (!url || !chave) {
      return json({
        ok: false,
        erro: "FINANCAS_URL ou FINANCAS_KEY nao configurados nos secrets da funcao",
      }, 500);
    }

    const financas = createClient(url, chave, { auth: { persistSession: false } });

    const pedido = await req.json().catch(() => ({}));
    const incluir: string[] = Array.isArray(pedido?.incluir) ? pedido.incluir : [];

    // `saldos_mensais`: 160 linhas hoje, e e tudo o que a tabela de patrimonio por conta usa.
    const { data, error } = await financas
      .from("saldos_mensais")
      .select("ano_mes, instituicao, tipo_conta, saldo_final")
      .order("ano_mes");
    if (error) return json({ ok: false, erro: `leitura de saldos_mensais: ${error.message}` }, 502);

    const resposta: Record<string, unknown> = { ok: true, saldos: data ?? [] };

    // O movimento do mes, para o dash Caixa (21/09/2026). Sai AGREGADO daqui - receita e despesa
    // por mes, e despesa por mes e categoria -, e nao linha a linha: a tela nao precisa do
    // extrato, e cada lancamento a menos que atravessa para o navegador e dado pessoal a menos
    // exposto. Quando uma tela precisar do extrato, entra como outro recorte, explicito.
    //
    // A regra de receita e despesa e a marca `contabilizar = true`, em QUALQUER conta. E para isso
    // que ela existe: compra no cartao conta (na data da compra), pagamento da fatura nao conta
    // (e `contabilizar = false`), transferencia entre contas e aporte nao contam. O dashboard
    // local so olhava a conta corrente, e com isso deixava o cartao inteiro de fora.
    if (incluir.includes("movimento")) {
      const linhas: {
        data: string; valor: number | string; tipo: string; categoria: string | null;
        subcategoria: string | null; instituicao: string; tipo_conta: string;
      }[] = [];
      const PAGINA = 1000;
      for (let de = 0; ; de += PAGINA) {
        const { data: lote, error: e } = await financas
          .from("transacoes_financeiras")
          .select("data, valor, tipo, categoria, subcategoria, instituicao, tipo_conta")
          .eq("contabilizar", true)
          .order("data")
          .range(de, de + PAGINA - 1);
        if (e) return json({ ok: false, erro: `leitura de transacoes_financeiras: ${e.message}` }, 502);
        linhas.push(...(lote ?? []));
        if (!lote || lote.length < PAGINA) break;
      }

      const porMes: Record<string, { receitas: number; despesas: number; lancamentos: number }> = {};
      // Ate quando cada conta tem lancamento. Sem isto, mes com cartao ainda nao importado parece
      // mes de pouca despesa - em 21/09/2026 o cartao parava em 27/04 e a conta corrente em 17/09.
      const ultimaData: Record<string, string> = {};
      const despesaPorCategoria: Record<string, Record<string, number>> = {};
      for (const l of linhas) {
        // Dinheiro do Mauricio guardado com o Daniel: nao e movimento do Daniel. Mesma regra do
        // dashboard local.
        if (l.subcategoria === "Custódia") continue;
        const conta = `${l.instituicao} · ${l.tipo_conta}`;
        if (!ultimaData[conta] || l.data > ultimaData[conta]) ultimaData[conta] = l.data;
        const mes = String(l.data).slice(0, 7);
        const v = Number(l.valor);
        if (!Number.isFinite(v)) continue;
        const m = porMes[mes] ??= { receitas: 0, despesas: 0, lancamentos: 0 };
        m.lancamentos++;
        if (l.tipo === "Entrada") {
          m.receitas += v;
        } else {
          m.despesas += v;
          const cat = l.categoria ?? "Sem categoria";
          (despesaPorCategoria[mes] ??= {})[cat] = (despesaPorCategoria[mes][cat] ?? 0) + v;
        }
      }
      const r2 = (x: number) => Math.round(x * 100) / 100;
      resposta.movimento = Object.entries(porMes).sort().map(([mes, m]) => ({
        mes, receitas: r2(m.receitas), despesas: r2(m.despesas), lancamentos: m.lancamentos,
      }));
      resposta.despesaPorCategoria = Object.entries(despesaPorCategoria).sort().flatMap(([mes, cats]) =>
        Object.entries(cats).map(([categoria, valor]) => ({ mes, categoria, valor: r2(valor) })));
      resposta.atualizacao = Object.entries(ultimaData)
        .map(([conta, ate]) => ({ conta, ate }))
        .sort((a, b) => b.ate.localeCompare(a.ate));
    }

    // O extrato de TODAS as contas, para o dash consolidado (Daniel, 23/09/2026). Mesmas colunas
    // do extrato de uma conta, mais a conta de cada linha - que sai do proprio lancamento
    // (instituicao + tipo de conta), e nao da lista fechada: aqui nao ha filtro vindo do
    // navegador, entao nao ha o que restringir.
    if (incluir.includes("extrato")) {
      const linhas: {
        data: string; descricao: string; valor: number | string; tipo: string;
        categoria: string | null; subcategoria: string | null; contabilizar: boolean;
        instituicao: string | null; tipo_conta: string | null;
      }[] = [];
      const PAGINA = 1000;
      for (let de = 0; ; de += PAGINA) {
        const { data: lote, error: e } = await financas
          .from("transacoes_financeiras")
          .select("data, descricao, valor, tipo, categoria, subcategoria, contabilizar, instituicao, tipo_conta")
          // O pingue-pongue da conta corrente do Bradesco nao muda saldo e a reconciliacao ja o
          // ignora (instrucoes-projeto, 9.1).
          .not("descricao", "ilike", "%Apl.invest Fac%")
          .not("descricao", "ilike", "%Resgate Inv Fac%")
          .order("data")
          .range(de, de + PAGINA - 1);
        if (e) return json({ ok: false, erro: `leitura do extrato geral: ${e.message}` }, 502);
        linhas.push(...(lote ?? []));
        if (!lote || lote.length < PAGINA) break;
      }

      const r2 = (x: number) => Math.round(x * 100) / 100;
      resposta.extrato = linhas
        .map((l) => ({
          data: l.data,
          descricao: l.descricao,
          conta: [l.instituicao, l.tipo_conta].filter(Boolean).join(" · "),
          valor: r2(Number(l.valor)),
          tipo: l.tipo,
          categoria: l.categoria,
          subcategoria: l.subcategoria,
          contabilizar: l.contabilizar,
        }))
        .reverse();
    }

    // A pagina de UMA conta: o movimento dela por mes, e o extrato de um ano.
    //
    // Aqui o extrato atravessa para o navegador, linha a linha - e so aqui, e so de uma conta por
    // pedido. Vao todos os anos: a pagina filtra e pagina (Daniel, 21/09/2026). Sai tudo o que foi lancado na conta, receita ou transferencia, porque
    // e o que move o saldo dela. A unica excecao e o pingue-pongue `Apl.invest Fac` /
    // `Resgate Inv Fac` da conta corrente Bradesco, que nao muda o saldo e que a reconciliacao ja
    // ignora (instrucoes-projeto, 9.1).
    if (incluir.includes("conta")) {
      const filtro = CONTAS[String(pedido?.conta ?? "")];
      if (!filtro) return json({ ok: false, erro: "conta desconhecida" }, 400);

      const linhas: {
        data: string; descricao: string; valor: number | string; tipo: string;
        categoria: string | null; subcategoria: string | null; contabilizar: boolean;
      }[] = [];
      const PAGINA = 1000;
      for (let de = 0; ; de += PAGINA) {
        let q = financas
          .from("transacoes_financeiras")
          .select("data, descricao, valor, tipo, categoria, subcategoria, contabilizar")
          .not("descricao", "ilike", "%Apl.invest Fac%")
          .not("descricao", "ilike", "%Resgate Inv Fac%");
        if (filtro.instituicao) q = q.eq("instituicao", filtro.instituicao);
        if (filtro.tipo_conta) q = q.eq("tipo_conta", filtro.tipo_conta);
        if (filtro.categoria) q = q.eq("categoria", filtro.categoria);
        if (filtro.ou) q = q.or(filtro.ou);
        const { data: lote, error: e } = await q.order("data").range(de, de + PAGINA - 1);
        if (e) return json({ ok: false, erro: `leitura do extrato: ${e.message}` }, 502);
        linhas.push(...(lote ?? []));
        if (!lote || lote.length < PAGINA) break;
      }

      // Cada mes em duas partes, para a ponte de saldo da pagina (Daniel, 21/09/2026): o que e
      // receita ou despesa (`contabilizar = true`) e o que e transferencia entre contas - o
      // resto: pagamento de fatura, aplicacao e resgate, promissoria, dinheiro que vai e volta.
      //
      // Na conta de recebivel (`recebivel`) a regra e outra, desde 24/09/2026: a ponte e da
      // DIVIDA, nao do caixa. O que o Daniel paga por alguem aumenta a divida (entrada) e o que
      // volta diminui (saida), e nada disso e receita ou despesa dele. So a categoria
      // `Transferência entre contas` continua na linha de transferencia.
      type Mes = {
        entradas: number; saidas: number; lancamentos: number;
        receitas: number; despesas: number; transfEntradas: number; transfSaidas: number;
      };
      const porMes: Record<string, Mes> = {};
      for (const l of linhas) {
        const mes = String(l.data).slice(0, 7);
        const v = Number(l.valor);
        if (!Number.isFinite(v)) continue;
        const m = porMes[mes] ??= {
          entradas: 0, saidas: 0, lancamentos: 0, receitas: 0, despesas: 0, transfEntradas: 0, transfSaidas: 0,
        };
        m.lancamentos++;
        const entra = l.tipo === "Entrada";
        if (entra) m.entradas += v; else m.saidas += v;
        const transferencia = l.categoria === "Transferência entre contas";
        if (filtro.recebivel ? !transferencia : l.contabilizar) {
          if (entra) m.receitas += v; else m.despesas += v;
        } else if (entra) m.transfEntradas += v; else m.transfSaidas += v;
      }
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const anos = [...new Set(linhas.map((l) => Number(String(l.data).slice(0, 4))))].sort((a, b) => b - a);

      resposta.conta = {
        movimento: Object.entries(porMes).sort().map(([mes, m]) => ({
          mes, entradas: r2(m.entradas), saidas: r2(m.saidas), lancamentos: m.lancamentos,
          receitas: r2(m.receitas), despesas: r2(m.despesas),
          transferencias: r2(m.transfEntradas - m.transfSaidas),
        })),
        anos,
        extrato: linhas
          .map((l) => ({
            data: l.data, descricao: l.descricao, valor: r2(Number(l.valor)), tipo: l.tipo,
            categoria: l.categoria, subcategoria: l.subcategoria, contabilizar: l.contabilizar,
          }))
          .reverse(),
      };
    }

    return json(resposta);
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
