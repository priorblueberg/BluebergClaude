import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Easter & Brazilian holidays ──────────────────────────────────────

function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getBrazilianHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  // Fixed holidays
  const fixed = [
    [1, 1], [4, 21], [5, 1], [9, 7], [10, 12],
    [11, 2], [11, 15], [11, 20], [12, 25],
  ];
  for (const [m, d] of fixed) {
    holidays.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  // Easter-dependent
  const easter = computeEaster(year);
  // Carnival: Mon + Tue before Ash Wednesday (47 and 46 days before Easter)
  holidays.add(toISO(addDays(easter, -48))); // Carnival Monday
  holidays.add(toISO(addDays(easter, -47))); // Carnival Tuesday
  holidays.add(toISO(addDays(easter, -2)));  // Good Friday
  holidays.add(toISO(addDays(easter, 60)));  // Corpus Christi
  return holidays;
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const results: Record<string, string> = {};

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 1. CDI ───────────────────────────────────────────────────────
    try {
      // Get max date in table
      const { data: maxCdi } = await supabase
        .from("historico_cdi")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const startDate = maxCdi
        ? addDays(new Date(maxCdi.data + "T12:00:00"), 1)
        : new Date(2024, 0, 2);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      if (startDate <= yesterday) {
        const fmt = (d: Date) =>
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

        const bcbUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados?formato=json&dataInicial=${fmt(startDate)}&dataFinal=${fmt(yesterday)}`;
        console.log("Fetching CDI from BCB:", bcbUrl);

        const resp = await fetch(bcbUrl);
        if (!resp.ok) throw new Error(`BCB API error ${resp.status}`);

        const cdiData: { data: string; valor: string }[] = await resp.json();

        if (cdiData.length > 0) {
          const rows = cdiData.map((r) => {
            const [dd, mm, yyyy] = r.data.split("/");
            return {
              data: `${yyyy}-${mm}-${dd}`,
              taxa_anual: parseFloat(r.valor),
            };
          });

          const batchSize = 500;
          let inserted = 0;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const { error } = await supabase
              .from("historico_cdi")
              .upsert(batch, { onConflict: "data" });
            if (error) throw new Error(`CDI insert: ${error.message}`);
            inserted += batch.length;
          }
          results.cdi = `Upserted ${inserted} CDI records`;
        } else {
          results.cdi = "No new CDI data";
        }
      } else {
        results.cdi = "CDI already up to date";
      }
    } catch (e) {
      results.cdi = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("CDI error:", e);
    }

    // ── 2. Ibovespa ──────────────────────────────────────────────────
    try {
      const { data: maxIbov } = await supabase
        .from("historico_ibovespa")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const period1 = maxIbov
        ? Math.floor(new Date(maxIbov.data + "T12:00:00").getTime() / 1000)
        : 1704153600; // 02/01/2024

      const now = Math.floor(Date.now() / 1000);

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?period1=${period1}&period2=${now}&interval=1d`;
      console.log("Fetching Ibovespa from Yahoo Finance...");

      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Yahoo Finance error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result) throw new Error("No data from Yahoo Finance");

      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close;

      if (timestamps && closes) {
        const rows: { data: string; pontos: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] == null) continue;
          const date = new Date(timestamps[i] * 1000);
          rows.push({
            data: toISO(date),
            pontos: Math.round(closes[i] * 100) / 100,
          });
        }

        const batchSize = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const { error } = await supabase
            .from("historico_ibovespa")
            .upsert(batch, { onConflict: "data" });
          if (error) throw new Error(`Ibovespa insert: ${error.message}`);
          inserted += batch.length;
        }
        results.ibovespa = `Upserted ${inserted} Ibovespa records`;
      } else {
        results.ibovespa = "No timestamp/close data";
      }
    } catch (e) {
      results.ibovespa = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("Ibovespa error:", e);
    }

    // ── 3. Selic ───────────────────────────────────────────────────────
    try {
      const { data: maxSelic } = await supabase
        .from("historico_selic")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const startSelic = maxSelic
        ? addDays(new Date(maxSelic.data + "T12:00:00"), 1)
        : new Date(2024, 0, 2);

      const yesterdaySelic = new Date();
      yesterdaySelic.setDate(yesterdaySelic.getDate() - 1);

      if (startSelic <= yesterdaySelic) {
        const fmt = (d: Date) =>
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

        const bcbSelicUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?formato=json&dataInicial=${fmt(startSelic)}&dataFinal=${fmt(yesterdaySelic)}`;
        console.log("Fetching Selic from BCB:", bcbSelicUrl);

        const selicResp = await fetch(bcbSelicUrl);
        if (!selicResp.ok) throw new Error(`BCB Selic API error ${selicResp.status}`);

        const selicData: { data: string; valor: string }[] = await selicResp.json();

        if (selicData.length > 0) {
          const selicRows = selicData.map((r) => {
            const [dd, mm, yyyy] = r.data.split("/");
            return {
              data: `${yyyy}-${mm}-${dd}`,
              taxa_anual: parseFloat(r.valor),
            };
          });

          const batchSize = 500;
          let inserted = 0;
          for (let i = 0; i < selicRows.length; i += batchSize) {
            const batch = selicRows.slice(i, i + batchSize);
            const { error } = await supabase
              .from("historico_selic")
              .upsert(batch, { onConflict: "data" });
            if (error) throw new Error(`Selic insert: ${error.message}`);
            inserted += batch.length;
          }
          results.selic = `Upserted ${inserted} Selic records`;
        } else {
          results.selic = "No new Selic data";
        }
      } else {
        results.selic = "Selic already up to date";
      }
    } catch (e) {
      results.selic = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("Selic error:", e);
    }

    // ── 4. TR (Taxa Referencial) ─────────────────────────────────────
    try {
      const { data: maxTr } = await supabase
        .from("historico_tr")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const startTr = maxTr
        ? addDays(new Date(maxTr.data + "T12:00:00"), 1)
        : new Date(2024, 0, 1);

      const yesterdayTr = new Date();
      yesterdayTr.setDate(yesterdayTr.getDate() - 1);

      if (startTr <= yesterdayTr) {
        const fmt = (d: Date) =>
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

        const bcbTrUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.226/dados?formato=json&dataInicial=${fmt(startTr)}&dataFinal=${fmt(yesterdayTr)}`;
        console.log("Fetching TR from BCB:", bcbTrUrl);

        const trResp = await fetch(bcbTrUrl);
        if (!trResp.ok) throw new Error(`BCB TR API error ${trResp.status}`);

        const trData: { data: string; valor: string }[] = await trResp.json();

        if (trData.length > 0) {
          // Deduplicate by date (keep last value)
          const byDate = new Map<string, number>();
          for (const r of trData) {
            const [dd, mm, yyyy] = r.data.split("/");
            byDate.set(`${yyyy}-${mm}-${dd}`, parseFloat(r.valor));
          }

          const trRows = Array.from(byDate.entries()).map(([data, taxa_mensal]) => ({
            data,
            taxa_mensal,
          }));

          const batchSize = 500;
          let inserted = 0;
          for (let i = 0; i < trRows.length; i += batchSize) {
            const batch = trRows.slice(i, i + batchSize);
            const { error } = await supabase
              .from("historico_tr")
              .upsert(batch, { onConflict: "data" });
            if (error) throw new Error(`TR insert: ${error.message}`);
            inserted += batch.length;
          }
          results.tr = `Upserted ${inserted} TR records`;
        } else {
          results.tr = "No new TR data";
        }
      } else {
        results.tr = "TR already up to date";
      }
    } catch (e) {
      results.tr = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("TR error:", e);
    }

    // ── 5. Poupança Rendimento (Série 195) ─────────────────────────
    try {
      const { data: maxPoup } = await supabase
        .from("historico_poupanca_rendimento")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const startPoup = maxPoup
        ? addDays(new Date(maxPoup.data + "T12:00:00"), 1)
        : new Date(2024, 0, 1);

      const yesterdayPoup = new Date();
      yesterdayPoup.setDate(yesterdayPoup.getDate() - 1);

      if (startPoup <= yesterdayPoup) {
        const fmt = (d: Date) =>
          `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

        const bcbPoupUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.195/dados?formato=json&dataInicial=${fmt(startPoup)}&dataFinal=${fmt(yesterdayPoup)}`;
        console.log("Fetching Poupança rendimento from BCB:", bcbPoupUrl);

        const poupResp = await fetch(bcbPoupUrl);
        if (!poupResp.ok) throw new Error(`BCB Poupança API error ${poupResp.status}`);

        const poupData: { data: string; valor: string }[] = await poupResp.json();

        if (poupData.length > 0) {
          const byDate = new Map<string, number>();
          for (const r of poupData) {
            const [dd, mm, yyyy] = r.data.split("/");
            byDate.set(`${yyyy}-${mm}-${dd}`, parseFloat(r.valor));
          }

          const poupRows = Array.from(byDate.entries()).map(([data, rendimento_mensal]) => ({
            data,
            rendimento_mensal,
          }));

          const batchSize = 500;
          let inserted = 0;
          for (let i = 0; i < poupRows.length; i += batchSize) {
            const batch = poupRows.slice(i, i + batchSize);
            const { error } = await supabase
              .from("historico_poupanca_rendimento")
              .upsert(batch, { onConflict: "data" });
            if (error) throw new Error(`Poupança insert: ${error.message}`);
            inserted += batch.length;
          }
          results.poupanca_rendimento = `Upserted ${inserted} Poupança rendimento records`;
        } else {
          results.poupanca_rendimento = "No new Poupança rendimento data";
        }
      } else {
        results.poupanca_rendimento = "Poupança rendimento already up to date";
      }
    } catch (e) {
      results.poupanca_rendimento = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("Poupança rendimento error:", e);
    }

    // ── 6. Calendário Dias Úteis ─────────────────────────────────────
    try {
      // Get max date in calendar
      const { data: maxCal } = await supabase
        .from("calendario_dias_uteis")
        .select("data")
        .order("data", { ascending: false })
        .limit(1)
        .single();

      const today = new Date();
      const endYear = today.getFullYear() + 1;
      const endDate = new Date(endYear, 11, 31);

      const startCal = maxCal
        ? addDays(new Date(maxCal.data + "T12:00:00"), 1)
        : new Date(2024, 0, 1);

      if (startCal <= endDate) {
        // Collect holidays for all relevant years
        const allHolidays = new Set<string>();
        for (let y = startCal.getFullYear(); y <= endYear; y++) {
          getBrazilianHolidays(y).forEach((h) => allHolidays.add(h));
        }

        const rows: { data: string; dia_util: boolean }[] = [];
        const cursor = new Date(startCal);
        while (cursor <= endDate) {
          const iso = toISO(cursor);
          const dow = cursor.getDay(); // 0=Sun, 6=Sat
          const isWeekday = dow >= 1 && dow <= 5;
          const isHoliday = allHolidays.has(iso);
          rows.push({ data: iso, dia_util: isWeekday && !isHoliday });
          cursor.setDate(cursor.getDate() + 1);
        }

        const batchSize = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const { error } = await supabase
            .from("calendario_dias_uteis")
            .upsert(batch, { onConflict: "data" });
          if (error) throw new Error(`Calendar insert: ${error.message}`);
          inserted += batch.length;
        }
        results.calendario = `Upserted ${inserted} calendar records through ${endYear}`;
      } else {
        results.calendario = "Calendar already up to date";
      }
    } catch (e) {
      results.calendario = `Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("Calendar error:", e);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
