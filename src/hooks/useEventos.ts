import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";
import { fatoresIpcaDoTitulo, carregarSeriesIpca, algumIndexadoAoIpca, type SeriesIpca } from "@/lib/ipcaSeries";

/**
 * Eventos da carteira: o que o dinheiro fez fora da variação de preço.
 *
 * Espelha a tela de Eventos do Gorila, cuja API (`security-events/history`) devolve dois
 * tipos: `CASH_INCOME`, que é cupom, e `CASH_AMORTIZATION`, que é o principal devolvido no
 * vencimento. Medido em 02/09/2026: 93 rendimentos e 7 amortizações.
 *
 * Aqui os tipos são os que o nosso motor sabe calcular sem inventar:
 *  - "Pagamento de juros": cupom, do próprio motor (`pagamentoJuros`)
 *  - "Vencimento" / "Resgate": o que voltou, das movimentações
 *  - "Come-cotas": a mordida semestral nos fundos
 *
 * Diferença conhecida em relação ao Gorila: no vencimento ele separa principal (amortização)
 * de juros (rendimento); aqui o vencimento entra como um evento só, pelo valor devolvido.
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

      const lista: EventoRow[] = [];
      for (const m of movs as any[]) {
        if (m.data > dataReferenciaISO) continue;
        const c = porCodigo.get(String(m.codigo_custodia));
        if (!c) continue;
        const t = String(m.tipo_movimentacao);
        let tipo: TipoEvento | null = null;
        if (t === "Come-Cotas") tipo = "Come-cotas";
        else if (t === "Resgate no Vencimento") tipo = "Vencimento";
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

      /**
       * Papel que venceu dentro da janela. Nao da para tirar isso das movimentacoes: so um
       * dos sete vencidos tem "Resgate no Vencimento" cadastrado, o resto vence na curva,
       * sem lancamento. Contando so pela movimentacao, a pagina mostrava R$ 40.577 de
       * vencimento contra R$ 103.193 de amortizacao no Gorila.
       */
      const vencidos = todos.filter(
        (c) =>
          c.vencimento && c.vencimento <= dataReferenciaISO &&
          !movs.some((m: any) => String(m.codigo_custodia) === String(c.codigo_custodia)
            && m.tipo_movimentacao === "Resgate no Vencimento") &&
          !(c.resgate_total && c.resgate_total < c.vencimento),
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
            for (const r of linhas) {
              if ((r.pagamentoJuros ?? 0) <= 0.01) continue;
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
            const devolvido = noVencimento?.liquido ?? 0;
            if (devolvido > 0.01) {
              lista.push({
                data: p.vencimento, tipo: "Vencimento", ativo: nomeDe(p), valor: devolvido,
                valorUnitario: qtd && qtd > 0 ? devolvido / qtd : null,
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
