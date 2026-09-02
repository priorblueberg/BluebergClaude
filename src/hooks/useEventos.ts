import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcularRendaFixaDiario, gerarDatasPagamentoJuros } from "@/lib/rendaFixaEngine";
import { fatoresIpcaDoTitulo, carregarSeriesIpca, algumIndexadoAoIpca, type SeriesIpca } from "@/lib/ipcaSeries";

/**
 * Eventos da carteira: o que o dinheiro fez fora da variação de preço.
 *
 * Espelha a tela de Eventos do Gorila, cuja API (`security-events/history`) devolve dois
 * tipos: `CASH_INCOME`, que é cupom, e `CASH_AMORTIZATION`, que é o principal devolvido no
 * vencimento. Medido em 02/09/2026: 93 rendimentos e 7 amortizações.
 *
 * Aqui os tipos são:
 *  - "Pagamento de juros" = `CASH_INCOME` dele: cupom do motor (`pagamentoJuros`) mais o juro
 *    do dia do vencimento
 *  - "Vencimento" = `CASH_AMORTIZATION` dele: o principal corrigido devolvido no vencimento
 *  - "Resgate" e "Come-cotas": das movimentações. O Gorila não tem esses dois - resgate lá é
 *    transação, não evento - e por isso ficam fora dos cartões de total.
 *
 * Conferido contra a API dele na janela de 12 meses até 02/09/2026: 125 rendimentos somando
 * R$ 434.295,37 contra R$ 434.295,44, e 7 amortizações somando R$ 103.193,61 dos dois lados,
 * cada papel batendo no centavo.
 */
export type TipoEvento = "Pagamento de juros" | "Vencimento" | "Resgate" | "Come-cotas";

export interface EventoRow {
  data: string;
  tipo: TipoEvento;
  ativo: string;
  valor: number;
  valorUnitario: number | null;
  quantidade: number | null;
  custodiante: string;
}

export interface VencimentoRow {
  ativo: string;
  vencimento: string;
  valorInvestido: number;
  custodiante: string;
}

const MODALIDADES_COM_CUPOM = ["Prefixado", "Pos Fixado", "Pós Fixado", "Mista"];

function menos(dataISO: string, dias: number): string {
  const d = new Date(dataISO + "T00:00:00");
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function mais12Meses(dataISO: string): string {
  const d = new Date(dataISO + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function useEventos() {
  const { user } = useAuth();
  const { appliedVersion, dataReferenciaISO } = useDataReferencia();
  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [vencimentos, setVencimentos] = useState<VencimentoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);

      const { data: custodias } = await supabase
        .from("custodia")
        .select("codigo_custodia, nome, data_inicio, data_calculo, taxa, modalidade, indexador, preco_unitario, quantidade, resgate_total, pagamento, vencimento, valor_investido, fundo_id, instituicoes(nome), categorias(nome)")
        .eq("user_id", user.id);

      const todos = (custodias || []) as any[];
      if (todos.length === 0) {
        setEventos([]); setVencimentos([]); setLoading(false); return;
      }

      const nomeDe = (c: any) => c.nome || "—";
      const custodianteDe = (c: any) => c.instituicoes?.nome || "—";

      // --- vencimentos nos proximos 12 meses (o que ainda esta vivo) ---
      const limite = mais12Meses(dataReferenciaISO);
      setVencimentos(
        todos
          .filter((c) => c.vencimento && c.vencimento > dataReferenciaISO && c.vencimento <= limite)
          .filter((c) => !(c.resgate_total && c.resgate_total <= dataReferenciaISO && c.resgate_total !== c.vencimento))
          .map((c) => ({
            ativo: nomeDe(c), vencimento: c.vencimento,
            valorInvestido: Number(c.valor_investido) || 0,
            custodiante: custodianteDe(c),
          }))
          .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
      );

      // --- movimentacoes: come-cotas, resgates e vencimentos ---
      const codigos = todos.map((c) => c.codigo_custodia);
      const movs = await fetchAllRows((de, ate) =>
        supabase.from("movimentacoes")
          .select("codigo_custodia, data, tipo_movimentacao, valor, quantidade")
          .eq("user_id", user.id).in("codigo_custodia", codigos).order("data").range(de, ate),
      );

      const porCodigo = new Map<string, any>();
      for (const c of todos) porCodigo.set(String(c.codigo_custodia), c);

      /**
       * Papel que venceu dentro da janela. Todos passam pelo motor, inclusive os que tem
       * "Resgate no Vencimento" cadastrado: o valor lancado na movimentacao e inconsistente
       * entre papeis (o CDB Inter traz principal + juro, R$ 40.577,14; o CDB Santander traz
       * so o principal, R$ 100.000,00) e o Gorila sempre separa os dois - no Inter ele mostra
       * R$ 40.000 de amortizacao e R$ 577,14 de rendimento. Tirando do motor, o cupom final
       * saia duas vezes.
       *
       * Tambem nao da para tirar isso so das movimentacoes: dos sete vencidos na janela, so um
       * tem lancamento; o resto vence na curva.
       */
      const vencidos = todos.filter(
        (c) =>
          c.vencimento && c.vencimento <= dataReferenciaISO &&
          !(c.resgate_total && c.resgate_total < c.vencimento),
      );
      const noMotorPorVencimento = new Set(vencidos.map((c) => String(c.codigo_custodia)));

      const lista: EventoRow[] = [];
      for (const m of movs as any[]) {
        if (m.data > dataReferenciaISO) continue;
        const c = porCodigo.get(String(m.codigo_custodia));
        if (!c) continue;
        const t = String(m.tipo_movimentacao);
        let tipo: TipoEvento | null = null;
        if (t === "Come-Cotas") tipo = "Come-cotas";
        else if (t === "Resgate no Vencimento") {
          if (noMotorPorVencimento.has(String(m.codigo_custodia))) continue;
          tipo = "Vencimento";
        }
        else if (t === "Resgate" || t === "Resgate Total") tipo = "Resgate";
        if (!tipo) continue;
        const qtd = m.quantidade != null ? Number(m.quantidade) : null;
        const valor = Number(m.valor) || 0;
        lista.push({
          data: m.data, tipo, ativo: nomeDe(c), valor,
          valorUnitario: qtd && qtd > 0 ? valor / qtd : null,
          quantidade: qtd, custodiante: custodianteDe(c),
        });
      }

      // --- o que precisa do motor: cupons e o valor devolvido no vencimento ---
      const comCupom = todos.filter(
        (c) => c.pagamento && c.pagamento !== "No Vencimento" && MODALIDADES_COM_CUPOM.includes(c.modalidade),
      );

      const precisamDoMotor = Array.from(new Set([...comCupom, ...vencidos]));

      if (precisamDoMotor.length > 0) {
        const minData = precisamDoMotor.reduce((m, p) => (p.data_inicio < m ? p.data_inicio : m), precisamDoMotor[0].data_inicio);
        // O calendario precisa alcancar o VENCIMENTO: e de la que o motor conta as datas de
        // cupom para tras. Truncar no dia de calculo dispara um cupom fantasma no ultimo dia.
        const maxData = precisamDoMotor.reduce(
          (m, p) => { const fim = p.vencimento || p.data_calculo || dataReferenciaISO; return fim > m ? fim : m; },
          dataReferenciaISO,
        );
        const precisaCdi = precisamDoMotor.some((p) => (p.indexador || "").includes("CDI"));

        const [cal, cdi] = await Promise.all([
          fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
            .gte("data", menos(minData, 5)).lte("data", maxData).order("data").range(de, ate)),
          precisaCdi
            ? fetchAllRows((de, ate) => supabase.from("historico_cdi").select("data, taxa_anual")
                .gte("data", menos(minData, 5)).lte("data", maxData).order("data").range(de, ate))
            : Promise.resolve([] as any[]),
        ]);
        const calendario = (cal as any[]).map((d) => ({ data: d.data, dia_util: d.dia_util }));
        const cdiRecords = (cdi as any[]).map((c) => ({ data: c.data, taxa_anual: Number(c.taxa_anual) }));

        const movPorCodigo = new Map<string, any[]>();
        for (const m of movs as any[]) {
          const k = String(m.codigo_custodia);
          if (!movPorCodigo.has(k)) movPorCodigo.set(k, []);
          movPorCodigo.get(k)!.push({ data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor) });
        }

        const seriesIpca: SeriesIpca | null = algumIndexadoAoIpca(precisamDoMotor) ? await carregarSeriesIpca() : null;

        for (const p of precisamDoMotor) {
          const fim = p.resgate_total || p.vencimento || dataReferenciaISO;
          const linhas = calcularRendaFixaDiario({
            dataInicio: p.data_inicio,
            dataCalculo: fim > dataReferenciaISO ? dataReferenciaISO : fim,
            taxa: p.taxa || 0,
            modalidade: p.modalidade || "",
            puInicial: p.preco_unitario || 1000,
            calendario,
            movimentacoes: movPorCodigo.get(String(p.codigo_custodia)) || [],
            dataResgateTotal: p.resgate_total,
            pagamento: p.pagamento,
            vencimento: p.vencimento,
            indexador: p.indexador,
            cdiRecords,
            ipcaFatores: fatoresIpcaDoTitulo(seriesIpca, p.indexador, p.vencimento, calendario, p.data_inicio),
            calendarioSorted: true,
          }) as any[];

          const qtd = Number(p.quantidade) || null;

          if (comCupom.includes(p)) {
            // No dia em que a posicao e encerrada, o motor lanca `pagamentoJuros` para fechar a
            // conta, seja ou nao data de cupom. Num RESGATE antecipado esse dinheiro ja saiu
            // inteiro pela movimentacao: o CDB Bradesco CDI+1,5% resgatado em 09/03/2026 tem
            // "Resgate Total" de R$ 113.131,56 e a pagina ainda somava R$ 3.131,56 de cupom no
            // mesmo dia. O Gorila nao lanca CASH_INCOME num resgate antecipado.
            //
            // O corte tem que ser pela AGENDA, nao pela data do resgate: o CDB Santander 12,5%
            // foi resgatado em 27/03/2026, que por acaso era dia de cupom, e o Gorila lanca os
            // R$ 6.016,45 normalmente. Cortando pela data do resgate, marco caia para
            // R$ 29.557,15 contra R$ 36.217,52 dele.
            const encerradoPorResgate = p.resgate_total && (!p.vencimento || p.resgate_total < p.vencimento)
              ? p.resgate_total : null;
            const agenda = encerradoPorResgate && p.vencimento
              ? gerarDatasPagamentoJuros(p.data_inicio, p.vencimento, p.pagamento, calendario, encerradoPorResgate)
              : null;
            for (const r of linhas) {
              if ((r.pagamentoJuros ?? 0) <= 0.01) continue;
              if (encerradoPorResgate && r.data === encerradoPorResgate && !agenda?.has(r.data)) continue;
              lista.push({
                data: r.data, tipo: "Pagamento de juros", ativo: nomeDe(p),
                valor: r.pagamentoJuros,
                valorUnitario: qtd && qtd > 0 ? r.pagamentoJuros / qtd : null,
                quantidade: qtd, custodiante: custodianteDe(p),
              });
            }
          }

          if (vencidos.includes(p)) {
            const noVencimento = linhas.find((r) => r.data === p.vencimento) ?? linhas[linhas.length - 1];
            // `resgates` (K), nao `liquido` (E): no dia do encerramento o motor JA baixou a
            // posicao, entao `liquido` e zero por construcao e a pagina nao mostrava evento
            // nenhum. O capital devolvido esta em `resgates`.
            const devolvido = noVencimento?.resgates ?? 0;
            // O Gorila quebra o vencimento em dois lancamentos: "Amortizacoes", que e o
            // principal corrigido, e "Rendimentos", que e o juro. No CDB IPCA+5,6% de
            // 10/08/2026 sao R$ 10.559,66 e R$ 744,28. Num papel "No Vencimento" o motor nao
            // separa - devolve tudo em `resgates` - entao a separacao sai aqui, com o
            // principal corrigido que o motor passou a expor.
            const bruto = Math.min(noVencimento?.principalCorrigido ?? 0, devolvido);
            // Resto de centavos entre a base economica e o liquido nao e rendimento: no CDB
            // Inter, que ja tem o juro pago como cupom, sobravam R$ 0,07. Abaixo de um real
            // o resto fica no principal em vez de virar um evento de troco.
            const juroFinal = devolvido - bruto > 1 ? devolvido - bruto : 0;
            const principal = devolvido - juroFinal;
            if (principal > 0.01) {
              lista.push({
                data: p.vencimento, tipo: "Vencimento", ativo: nomeDe(p), valor: principal,
                valorUnitario: qtd && qtd > 0 ? principal / qtd : null,
                quantidade: qtd, custodiante: custodianteDe(p),
              });
            }
            if (juroFinal > 0.01) {
              lista.push({
                data: p.vencimento, tipo: "Pagamento de juros", ativo: nomeDe(p), valor: juroFinal,
                valorUnitario: qtd && qtd > 0 ? juroFinal / qtd : null,
                quantidade: qtd, custodiante: custodianteDe(p),
              });
            }
          }
        }
      }

      lista.sort((a, b) => (a.data === b.data ? a.ativo.localeCompare(b.ativo) : b.data.localeCompare(a.data)));
      setEventos(lista);
      setLoading(false);
    })();
  }, [user, appliedVersion, dataReferenciaISO]);

  return { eventos, vencimentos, loading };
}
