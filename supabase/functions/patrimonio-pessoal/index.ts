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

    // So `saldos_mensais`: 160 linhas hoje, e e tudo o que a tabela de patrimonio por conta usa.
    // Transacao e fatura NAO passam por aqui - quando uma tela precisar delas, o recorte entra
    // nesta funcao, explicito, em vez de abrir o banco inteiro para o navegador.
    const { data, error } = await financas
      .from("saldos_mensais")
      .select("ano_mes, instituicao, tipo_conta, saldo_final")
      .order("ano_mes");
    if (error) return json({ ok: false, erro: `leitura de saldos_mensais: ${error.message}` }, 502);

    return json({ ok: true, saldos: data ?? [] });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
