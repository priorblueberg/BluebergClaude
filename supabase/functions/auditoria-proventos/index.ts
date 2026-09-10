// Auditoria de proventos: compara a nossa base com o CALENDARIO DECLARADO da B3.
//
//   POST { }                  todos os papeis sincronizados
//   POST { ticker: "ITSA4" }  so um
//
// NAO GRAVA NADA. So relata. Quem completa a base e o `sync-acoes`, na mesma passada em que
// atualiza o papel. Esta funcao serve para olhar o conjunto sem disparar carga, e para responder
// "a base esta completa?" sem depender de ter rodado o sync agora.
//
// ── Por que esta funcao mudou de fonte em 09/09/2026 ────────────────────────────────────────
//
// Ate esta data ela cruzava BRAPI, Yahoo e B3, e o Yahoo era o detector: uma linha por data-ex
// com o TOTAL, entao a soma das nossas parcelas contra o total dele denunciava parcela faltando.
// Isso existia porque acreditavamos que a B3 so publicava ~9 meses de historico.
//
// Nao era verdade, era o endpoint errado. `GetListedSupplementCompany` devolve uma janela curta;
// `GetListedCashDividends` devolve desde 1996 - e o parametro dele e `tradingName`, nao
// `issuingCompany`. Com o parametro errado ele responde 200 com ZERO registros e sem erro
// nenhum, e foi exatamente isso que despistou.
//
// Com o historico completo da fonte PRIMARIA disponivel, o Yahoo perdeu a funcao. Ele tinha dois
// problemas que agora nao precisamos mais carregar:
//
//   1. Entrega o provento AJUSTADO por eventos posteriores, e desfazer esse ajuste com os NOSSOS
//      fatores gerava divergencia sistematica em toda data anterior a um desdobramento. A
//      correcao exigia agrupar razoes e separar fator de buraco - varias telas de codigo para
//      compensar a fonte, nao para auditar a base.
//   2. Ele registra o valor PAGO, com correcao pela Selic; a B3 registra o DECLARADO. Isso
//      produzia "divergencias" de 1 a 2% que nao eram erro nosso, e que o GorilaVIEW tambem
//      ignora - conferido na tela dele em 09/09/2026, em PETR4 de 23/12/2025.
//
// ── Uma copia so da regra ───────────────────────────────────────────────────────────────────
//
// A comparacao e a MESMA funcao que o sync usa, importada de `_shared`. Duas copias divergindo
// ja aconteceu neste projeto, e aqui seria pior que o normal: a auditoria diria que esta tudo
// bem com uma regra enquanto o sync grava com outra.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reconciliarProventos } from "../_shared/reconciliacaoProventos.ts";
import { nomeDePregao, proventosDaB3 } from "../_shared/proventosDaB3.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PISO_SERIE = "2023-01-02";

function clienteInvest() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "invest" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = clienteInvest();
  const responder = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo, null, 2), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const pedido = String(body?.ticker ?? "").toUpperCase().trim();

    const { data: papeis, error: eCadastro } = await db.from("cadastro_de_acoes")
      .select("ticker, isin")
      .eq("sincronizar_cotacoes", true);
    if (eCadastro) return responder({ ok: false, erro: eCadastro.message }, 500);

    const alvos = (papeis ?? []).filter((p) => !pedido || p.ticker === pedido);
    if (!alvos.length) {
      return responder({
        ok: false,
        erro: `nenhum papel sincronizado${pedido ? ` com ticker ${pedido}` : ""}`,
      }, 404);
    }

    const relatorio: Record<string, unknown>[] = [];

    for (const papel of alvos) {
      const ticker = String(papel.ticker);
      const isin = papel.isin ? String(papel.isin) : null;

      // Sem ISIN nao ha como chegar na B3. O caso conhecido e BDR, que ela nao publica neste
      // endpoint em periodo nenhum - dizer isso e mais util do que devolver zero e calar.
      if (!isin) {
        relatorio.push({
          ticker,
          coberto: false,
          motivo: "sem ISIN na base; se for BDR, a B3 nao publica proventos neste endpoint",
        });
        continue;
      }

      // Distinguir "a empresa nao distribuiu" de "o nome nao resolveu" e o ponto desta secao: o
      // segundo caso e um furo silencioso, em que a auditoria diria "tudo certo" sem ter olhado
      // nada. Medido em 09/09/2026 sobre 77 emissores, 10 nao resolveram.
      const nome = await nomeDePregao(isin).catch(() => null);
      if (!nome) {
        relatorio.push({
          ticker,
          isin,
          coberto: false,
          motivo: "nome de pregao nao resolveu a partir do ISIN; a B3 nao foi consultada",
        });
        continue;
      }

      const [{ data: nossosProventos }, { data: cotacoes }] = await Promise.all([
        db.from("eventos_de_ativos")
          .select("data_ex, tipo, valor, data_aprovacao, fonte")
          .eq("ticker", ticker).eq("classe", "CAIXA"),
        db.from("cotacoes_acoes").select("data").eq("ticker", ticker).order("data"),
      ]);

      const pregoes = ((cotacoes ?? []) as Record<string, unknown>[]).map((c) => String(c.data));
      const declaradas = await proventosDaB3(ticker, isin, pregoes);

      const nossas = ((nossosProventos ?? []) as Record<string, unknown>[]).map((l) => ({
        dataEx: String(l.data_ex),
        tipo: String(l.tipo),
        valor: Number(l.valor),
        aprovacao: l.data_aprovacao === null ? null : String(l.data_aprovacao),
      }));

      const r = reconciliarProventos(
        nossas,
        declaradas.map((p) => ({
          dataEx: p.data_ex, tipo: p.tipo, valor: p.valor, aprovacao: p.data_aprovacao,
        })),
        PISO_SERIE,
      );

      relatorio.push({
        ticker,
        isin,
        coberto: true,
        nome_de_pregao: nome,
        declaradas_na_b3: declaradas.filter((p) => p.data_ex >= PISO_SERIE).length,
        na_nossa_base: nossas.filter((n) => n.dataEx >= PISO_SERIE).length,
        // Dinheiro faltando. Lista, e nao contagem: quem le precisa poder conferir na fonte
        // antes de mandar o sync gravar.
        faltando: r.faltantes.map((f) => ({
          data_ex: f.dataEx, tipo: f.tipo, valor: f.valor, aprovacao: f.aprovacao,
        })),
        // Temos mais do que a B3 declara. Em geral e data-ex futura que a BRAPI antecipa e a B3
        // ainda nao publicou. Nao se apaga nada por isso, so se mostra.
        a_mais_que_a_b3: r.sobrando,
        ok: r.faltantes.length === 0,
      });
    }

    return responder({
      ok: true,
      resumo: {
        papeis: relatorio.length,
        completos: relatorio.filter((x) => x.coberto && x.ok).length,
        com_parcela_faltando: relatorio.filter((x) => x.coberto && !x.ok).length,
        // Nao entra em "completos" nem em "com falta": nao foi possivel olhar. Contar como
        // completo seria transformar ausencia de informacao em aprovacao.
        sem_cobertura_da_b3: relatorio.filter((x) => !x.coberto).length,
      },
      relatorio,
    });
  } catch (e) {
    return responder({ ok: false, erro: String(e) }, 500);
  }
});
