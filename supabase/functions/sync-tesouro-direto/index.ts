// Precos e taxas do Tesouro Direto, do Tesouro Transparente para `precos_tesouro_direto`.
//
//   POST { }                       diario: traz do ultimo dia gravado em diante
//   POST { desde: "2022-12-30" }   backfill: varre ate essa data e para
//   POST { ate: "2023-12-31" }     recorta o topo, para fatiar uma carga grande
//
// ── A fonte, e por que nao a BRAPI ───────────────────────────────────────────────────────────
//
// O Tesouro Nacional publica o historico COMPLETO num unico CSV, desde 31/12/2004. E a fonte
// primaria: quem calcula o preco e quem o divulga. A BRAPI tem `/api/v2/treasury/list`, e a
// decisao anterior a aceitava aqui por nao existir acesso melhor - existe. Vale a mesma regra
// que ja governa CDI (BCB) e cotas de fundo (CVM): vai-se em quem publica.
//
// ── O truque que torna isto barato ───────────────────────────────────────────────────────────
//
// O arquivo tem 14,5 MB e vem ordenado do MAIS RECENTE para o mais antigo. Como so interessa de
// 30/12/2022 em diante, da para ler em streaming e PARAR assim que a data cair abaixo do piso -
// os 18 anos anteriores nunca sao baixados. Sem isso seria preciso puxar o arquivo inteiro para
// aproveitar os ultimos 15%.
//
// O `fetch` e abortado de proposito quando o piso e alcancado. Sem o abort, o Deno continuaria
// escoando o corpo da resposta em segundo plano - e a economia existiria so no papel.
//
// ── O formato, e as duas armadilhas dele ─────────────────────────────────────────────────────
//
//   Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;...
//   Tesouro Selic;01/03/2029;04/09/2026;0,03;0,04;19810,47;19795,28;19795,28
//
//   1. Datas em dd/MM/yyyy e numeros com VIRGULA decimal - o padrao brasileiro. `parseFloat`
//      cru le "19810,47" como 19810 e perde os centavos em silencio.
//   2. Ha duas datas por linha, e elas se confundem: `Data Vencimento` e do titulo, `Data Base`
//      e do preco. O piso do backfill se aplica a SEGUNDA. Filtrar pela errada traria um punhado
//      de titulos longos e nada mais.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const URL_TD = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3"
             + "/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";

/** "01/03/2029" -> "2029-03-01". Devolve null no que nao for data, inclusive no cabecalho. */
const dataBR = (s: string): string | null => {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** "19810,47" -> 19810.47. O separador decimal do arquivo e virgula. */
const num = (s: string): number | null => {
  const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const ate = typeof body?.ate === "string" ? body.ate.slice(0, 10) : null;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "invest" } },
    );

    // Sem `desde`, o piso e o ultimo dia ja gravado: a rotina diaria so le o topo do arquivo.
    let desde = typeof body?.desde === "string" ? body.desde.slice(0, 10) : null;
    if (!desde) {
      const { data } = await db.from("precos_tesouro_direto")
        .select("data").order("data", { ascending: false }).limit(1).maybeSingle();
      desde = data?.data ?? "2022-12-30";
    }

    const controle = new AbortController();
    const r = await fetch(URL_TD, { signal: controle.signal });
    if (!r.ok) throw new Error(`Tesouro Transparente HTTP ${r.status}`);

    type Linha = {
      tipo_titulo: string; vencimento: string; data: string;
      taxa_compra: number | null; taxa_venda: number | null;
      pu_compra: number | null; pu_venda: number | null; pu_base: number | null;
    };
    const lote: Linha[] = [];
    let lidas = 0, gravadas = 0, maisAntigaVista = "9999-12-31", maisRecente = "0000-01-01";

    const gravar = async () => {
      if (!lote.length) return;
      const { error } = await db.from("precos_tesouro_direto")
        .upsert(lote.splice(0), { onConflict: "tipo_titulo,vencimento,data", ignoreDuplicates: false });
      if (error) throw new Error(`upsert: ${error.message}`);
    };

    const leitor = r.body!.pipeThrough(new TextDecoderStream("iso-8859-1")).getReader();
    let resto = "", parou = false;

    linhas: while (!parou) {
      const { value, done } = await leitor.read();
      if (done) break;
      const partes = (resto + value).split("\n");
      resto = partes.pop() ?? "";

      for (const bruta of partes) {
        const c = bruta.replace(/\r$/, "").split(";");
        if (c.length < 8) continue;
        const venc = dataBR(c[1]), dataBase = dataBR(c[2]);
        if (!venc || !dataBase) continue; // cabecalho e lixo caem aqui
        lidas++;

        // O arquivo desce no tempo: chegou abaixo do piso, o resto nao interessa.
        if (dataBase < desde!) { parou = true; break linhas; }
        if (ate && dataBase > ate) continue;

        if (dataBase < maisAntigaVista) maisAntigaVista = dataBase;
        if (dataBase > maisRecente) maisRecente = dataBase;

        lote.push({
          tipo_titulo: c[0].trim(),
          vencimento: venc,
          data: dataBase,
          taxa_compra: num(c[3]), taxa_venda: num(c[4]),
          pu_compra: num(c[5]), pu_venda: num(c[6]), pu_base: num(c[7]),
        });
        if (lote.length >= 1000) { gravadas += lote.length; await gravar(); }
      }
    }

    gravadas += lote.length;
    await gravar();
    // Sem isto o Deno seguiria drenando os 14,5 MB em segundo plano, e a leitura parcial nao
    // teria economizado nada.
    controle.abort();

    const { count } = await db.from("precos_tesouro_direto")
      .select("*", { count: "exact", head: true });

    return json({
      ok: true,
      piso: desde, teto: ate,
      linhas_lidas: lidas,
      gravadas,
      janela_gravada: gravadas ? { de: maisAntigaVista, ate: maisRecente } : null,
      total_na_base: count,
    });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
