// Auditoria de EVENTOS DE QUANTIDADE: desdobramento, grupamento e bonificacao.
//
//   POST { }                  todos os papeis sincronizados
//   POST { ticker: "GGBR4" }  so um
//
// NAO GRAVA NADA. So relata - a irma `auditoria-proventos` segue a mesma regra, e pelo mesmo
// motivo: quem completa a base e o `sync-acoes`, e uma auditoria que corrige perde a capacidade
// de dizer se a correcao funcionou.
//
// ── Por que ela existe ──────────────────────────────────────────────────────────────────────
//
// Ate 09/09/2026 a base tinha auditoria para o dinheiro e NENHUMA para a quantidade. O custo
// esta medido: dos oito eventos com data-ex dentro da janela de calculo, dois so entraram
// depois de alguem comparar a quantidade com a do GorilaVIEW na mao (ITSA4 11/11/2022 e
// KLBN11 07/05/2024) e um terceiro, a bonificacao de 5% do GGBR4 em 22/03/2023, nao existe em
// fonte nenhuma. Um erro de quantidade nao aparece como erro: aparece como uma posicao
// plausivel e errada, que e o pior jeito de um defeito se apresentar.
//
// ── Tres perguntas, porque um evento falha de tres jeitos ───────────────────────────────────
//
//   1. QUANTIDADE   a B3 declara evento que a nossa base nao tem?
//                   Fonte: `GetListedSupplementCompany`, o ultimo evento de cada rotulo por
//                   ISIN. Pega o evento NOVO que a BRAPI perdeu, que e o caso que se repete.
//
//   2. PRECO        a nossa serie ja vem ajustada por um evento sem estar marcada como tal?
//                   Fonte: o `closingPricePriorExDate` que a B3 publica em cada parcela de
//                   provento - um preco NOMINAL, nunca ajustado. A razao entre ele e a nossa
//                   serie vale o fator antes da data-ex e 1 depois, entao todo degrau nela e um
//                   evento que a fonte embutiu no preco.
//
//   3. COBERTURA    o que NAO foi possivel olhar.
//                   Sem isto, o papel que a B3 nao respondeu sairia no meio dos aprovados.
//
// ── O que ela NAO pega, dito em voz alta ────────────────────────────────────────────────────
//
// Evento que nenhuma fonte declara E que a fonte tambem nao embutiu no preco. E exatamente o
// GGBR4 de 22/03/2023: a B3 nao o publica (o suplemento so guarda o ultimo de cada rotulo, e o
// dele e o de 2024), a BRAPI nao o publica, e as duas series de preco sao nominais - a razao
// fica lisa em 1,2000 atravessando a data-ex. A queda de -4,37% do dia tambem nao serve de
// sinal: sete pregoes antes, em 15/03, o papel caiu -5,36% sem evento nenhum, e um detector de
// queda pegaria 15/03 antes de 22/03.
//
// Duas outras portas foram medidas e fechadas em 09/09/2026, para nao serem tentadas de novo:
//
//   - `GetListedStockDividends`, o analogo de historico do endpoint de proventos, responde 404.
//   - O `adjustedClose` da BRAPI ajusta SO por dividendo. Medido em GGBR4 desde 2022: 19
//     degraus na razao adjustedClose/close, todos em data-ex de provento, NENHUM em 22/03/2023
//     nem em 17/04/2024 (a bonificacao de 20%). O motor de ajuste dela nao conhece o evento.
//
// O caso do evento que ninguem publica continua sendo achado do jeito que foi achado: comparando
// a quantidade com a de um terceiro. O que esta funcao faz e tirar do "achado por acaso" todos
// os outros casos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { eventosDaB3 } from "../_shared/eventosDaB3.ts";
import { ancorasDePrecoDaB3 } from "../_shared/proventosDaB3.ts";
import {
  degrausDeAjuste,
  duplicados,
  reconciliarEventos,
} from "../_shared/reconciliacaoEventos.ts";

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

      const [{ data: nossosEventos }, { data: cotacoes }] = await Promise.all([
        db.from("eventos_de_ativos")
          .select("tipo, data_ex, fator, ja_refletido_no_preco, fonte")
          .eq("ticker", ticker).eq("classe", "QUANTIDADE").order("data_ex"),
        db.from("cotacoes_acoes").select("data, fechamento").eq("ticker", ticker).order("data"),
      ]);

      const serie = new Map<string, number>();
      for (const c of (cotacoes ?? []) as Record<string, unknown>[]) {
        serie.set(String(c.data), Number(c.fechamento));
      }
      const pregoes = [...serie.keys()];

      // A base tem duplicata historica: o mesmo evento gravado duas vezes com marcas opostas
      // (PETR4 25/04/2008 e KLBN11 25/03/2014, das cargas antigas). Deduplicar aqui esconderia
      // o problema; entao eles entram inteiros e a contagem denuncia.
      const nossos = ((nossosEventos ?? []) as Record<string, unknown>[]).map((e) => ({
        tipo: String(e.tipo),
        fator: Number(e.fator),
        dataEx: String(e.data_ex),
        jaRefletidoNoPreco: Boolean(e.ja_refletido_no_preco),
        fonte: String(e.fonte),
      }));

      const leitura = await eventosDaB3(ticker, isin);
      const linha: Record<string, unknown> = {
        ticker,
        isin,
        na_nossa_base: nossos.length,
        na_janela_de_calculo: nossos.filter((e) => e.dataEx >= PISO_SERIE).length,
        // Defeito nosso, independente do que a B3 diz. Fica no topo porque um duplicado dentro
        // da janela de calculo dobra a quantidade, e isso vale mais que qualquer divergencia
        // de fonte.
        duplicados_na_base: duplicados(nossos),
      };

      // ── 1. Quantidade ────────────────────────────────────────────────────────────────────
      if (!leitura.eventos) {
        // Nao foi possivel olhar. Nao entra em aprovado nem em reprovado - contar ausencia de
        // informacao como aprovacao e a falha silenciosa que esta auditoria existe para evitar.
        linha.declaracao = { coberto: false, motivo: leitura.motivo };
        // Mesmo sem cobertura, o ISIN que a B3 conhece e informacao util: e o que resolve o
        // caso do BDR, que nao tem ISIN em fonte nenhuma que consultamos ate hoje.
        if (leitura.isinsDoEmissor.length) {
          linha.isin_na_b3 = leitura.isinsDoEmissor;
          linha.trading_name = leitura.tradingName;
        }
      } else {
        const r = reconciliarEventos(nossos, leitura.eventos, pregoes, PISO_SERIE);
        linha.declaracao = {
          coberto: true,
          trading_name: leitura.tradingName,
          isin_na_b3: leitura.isinsDoEmissor,
          // A B3 devolve o ULTIMO de cada rotulo, nao o historico. Dizer o numero evita que
          // alguem leia "3 declarados contra 20 nossos" como base inflada.
          declarados_na_b3: leitura.eventos.length,
          faltando: r.faltantes.map((f) => ({
            tipo: f.declarado.tipo,
            fator: f.declarado.fator,
            factor_cru_da_b3: (f.declarado as { factorCru?: number }).factorCru ?? null,
            data_declarada: f.declarado.dataDeclarada,
            datas_ex_possiveis: f.datas_ex_possiveis,
            abaixo_do_piso: f.abaixo_do_piso ?? false,
          })),
          // Esperado, e nao defeito: a B3 so repete o mais recente de cada rotulo. So vira
          // pergunta quando o nosso e MAIS NOVO que o declarado, e a lista deixa isso visivel.
          sem_par_na_b3: r.sobrando.map((e) => ({
            tipo: e.tipo, fator: e.fator, data_ex: e.dataEx, fonte: e.fonte,
          })),
          // A B3 tambem publica ato societario que o nosso modelo nao representa. Nao e ruido:
          // e ela avisando que houve algo ali.
          rotulos_nao_modelados: leitura.naoModelados,
        };
      }

      // ── 2. Preco ─────────────────────────────────────────────────────────────────────────
      const { ancoras, motivo: motivoAncora } = await ancorasDePrecoDaB3(ticker, isin)
        .catch((e) => ({ ancoras: [], motivo: String(e) }));
      if (ancoras.length < 2) {
        linha.ajuste_de_preco = {
          coberto: false,
          // O motivo vem da leitura, nao de um palpite daqui. Um "sem ISIN, ou sem provento"
          // manda quem le adivinhar qual dos dois - e adivinhar e o que esta auditoria combate.
          motivo: ancoras.length
            ? "so uma ancora de preco nominal caiu dentro da nossa serie; com uma so nao ha "
              + "degrau para medir"
            : motivoAncora ?? "a B3 nao publica preco nominal para este papel",
        };
      } else {
        const d = degrausDeAjuste(ancoras, serie, nossos);
        linha.ajuste_de_preco = {
          coberto: true,
          ancoras_usadas: d.ancoras_usadas,
          // O periodo medido, nao o que a B3 publica: ancora anterior ao inicio da nossa serie
          // nao tem pregao do lado para comparar, e anunciar o intervalo dela mentiria sobre o
          // alcance da auditoria.
          periodo: d.periodo,
          ancoras_publicadas_pela_b3: ancoras.length,
          // Razao diferente de 1 no comeco da janela sem degrau depois significa ajuste por
          // evento ANTERIOR a primeira ancora - fora do alcance da medicao, e nao ausencia dele.
          razao_inicial: d.razao_inicial === null ? null : +d.razao_inicial.toFixed(6),
          razao_final: d.razao_final === null ? null : +d.razao_final.toFixed(6),
          divergencias: d.divergencias,
        };
      }

      const semCobertura = !(linha.declaracao as { coberto: boolean }).coberto
        || !(linha.ajuste_de_preco as { coberto: boolean }).coberto;
      const achados = ((linha.declaracao as { faltando?: unknown[] }).faltando?.length ?? 0)
        + ((linha.ajuste_de_preco as { divergencias?: unknown[] }).divergencias?.length ?? 0)
        + (linha.duplicados_na_base as unknown[]).length;
      linha.ok = achados === 0;
      linha.cobertura_parcial = semCobertura;
      relatorio.push(linha);
    }

    return responder({
      ok: true,
      resumo: {
        papeis: relatorio.length,
        sem_achado: relatorio.filter((x) => x.ok && !x.cobertura_parcial).length,
        com_achado: relatorio.filter((x) => !x.ok).length,
        cobertura_parcial: relatorio.filter((x) => x.cobertura_parcial).length,
      },
      relatorio,
    });
  } catch (e) {
    return responder({ ok: false, erro: String(e) }, 500);
  }
});
