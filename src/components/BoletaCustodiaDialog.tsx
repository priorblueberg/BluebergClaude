import { useState, useEffect } from "react";
import { format, parse, isValid } from "date-fns";
import { AlertTriangle, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface CustodiaRowForBoleta {
  id: string;
  codigo_custodia: number;
  data_inicio: string;
  nome: string | null;
  categoria: string;
  categoria_id: string;
  produto: string;
  produto_id: string;
  instituicao: string | null;
  instituicao_id: string | null;
  emissor: string | null;
  emissor_id: string | null;
  modalidade: string | null;
  indexador: string | null;
  taxa: number | null;
  pagamento: string | null;
  vencimento: string | null;
  preco_unitario: number | null;
  valor_investido: number;
  resgate_total?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: "Aplicação" | "Resgate";
  row: CustodiaRowForBoleta;
  userId: string;
  dataReferenciaISO: string;
  onSuccess: () => void;
}

function formatCurrency(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCurrencyToNumber(value: string): number {
  const cleaned = value.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function numberToCurrency(num: number): string {
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Apply dd/mm/aaaa mask to raw input */
function applyDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
}

/** Parse dd/mm/yyyy to Date or null */
function parseDateInput(masked: string): Date | null {
  if (masked.length !== 10) return null;
  const d = parse(masked, "dd/MM/yyyy", new Date());
  if (!isValid(d)) return null;
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return d;
}

export default function BoletaCustodiaDialog({
  open,
  onClose,
  tipo,
  row,
  userId,
  dataReferenciaISO,
  onSuccess,
}: Props) {
  const [dateInput, setDateInput] = useState("");
  const [date, setDate] = useState<Date | undefined>();
  const [valor, setValor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saldoDisponivel, setSaldoDisponivel] = useState<number | null>(null);
  const [loadingSaldo, setLoadingSaldo] = useState(false);
  const [valorCotaDia, setValorCotaDia] = useState<number | null>(null);
  const [loadingCota, setLoadingCota] = useState(false);
  const [fecharPosicao, setFecharPosicao] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const fmtReadonly = (v: string | null | undefined) => v ?? "—";
  const fmtTaxa = (v: number | null) =>
    v != null ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : "—";
  const fmtDate = (d: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

  // Auto-check fecharPosicao when valor matches saldoDisponivel
  useEffect(() => {
    if (tipo !== "Resgate" || saldoDisponivel == null || saldoDisponivel <= 0) return;
    const valorNum = parseCurrencyToNumber(valor);
    if (valorNum > 0 && Math.abs(valorNum - saldoDisponivel) < 0.01) {
      if (!fecharPosicao) setFecharPosicao(true);
    }
  }, [valor, saldoDisponivel, tipo]);

  const handleFecharPosicaoChange = (checked: boolean) => {
    setFecharPosicao(checked);
    if (checked && saldoDisponivel != null && saldoDisponivel > 0) {
      setValor(numberToCurrency(saldoDisponivel));
    } else if (!checked) {
      setValor("");
    }
  };

  /** Clear calculated fields without touching dateInput */
  const clearCalculated = () => {
    setDate(undefined);
    setValorCotaDia(null);
    setSaldoDisponivel(null);
    setFecharPosicao(false);
    setValor("");
    setDateError(null);
  };

  /** Validate and process a complete date */
  const processDate = async (d: Date) => {
    setDate(d);
    setValorCotaDia(null);
    setSaldoDisponivel(null);
    setFecharPosicao(false);
    setValor("");
    setDateError(null);

    const dateISO = format(d, "yyyy-MM-dd");

    // Validate: not before data_inicio
    const inicioDate = new Date(row.data_inicio + "T00:00:00");
    if (d < inicioDate) {
      setDateError("A data selecionada não pode ser anterior à aplicação inicial.");
      return;
    }

    // Validate: not in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d > today) {
      setDateError("A data não pode ser superior à data atual.");
      return;
    }

    // Validate: not after vencimento
    if (row.vencimento) {
      const vencDate = new Date(row.vencimento + "T00:00:00");
      if (d > vencDate) {
        setDateError("A data não pode ser posterior ao vencimento do título.");
        return;
      }
    }

    // Validate: if resgate_total exists, date must be before it
    if (tipo === "Resgate" && row.resgate_total) {
      const resgateDate = new Date(row.resgate_total + "T00:00:00");
      if (d >= resgateDate) {
        setDateError("A data deve ser anterior à data do resgate total.");
        return;
      }
    }

    // Validate: business day (skip for Poupança)
    const isPoupancaProduct = row.modalidade === "Poupança";
    if (!isPoupancaProduct) {
      const { data: diaUtil } = await supabase
        .from("calendario_dias_uteis")
        .select("dia_util")
        .eq("data", dateISO)
        .maybeSingle();

      if (!diaUtil || !diaUtil.dia_util) {
        setDateError("A data selecionada não é um dia útil.");
        return;
      }
    }

    const isRendaFixaEngine = (row.modalidade === "Prefixado" || row.modalidade === "Pos Fixado" || row.modalidade === "Pós Fixado" || row.modalidade === "Mista") && row.taxa && row.preco_unitario;

    if (isRendaFixaEngine) {
      setLoadingCota(true);
      if (tipo === "Resgate") setLoadingSaldo(true);
      try {
        const isPosFixadoCDI = ((row.modalidade === "Pos Fixado" || row.modalidade === "Pós Fixado") && row.indexador === "CDI") || (row.modalidade === "Mista" && row.indexador === "CDI");

        const calQuery = supabase
            .from("calendario_dias_uteis")
            .select("data, dia_util")
            .gte("data", row.data_inicio)
            .lte("data", dateISO)
            .order("data");
        const movQuery = supabase
            .from("movimentacoes")
            .select("data, tipo_movimentacao, valor")
            .eq("codigo_custodia", row.codigo_custodia)
            .eq("user_id", userId)
            .order("data");
        const custQuery = supabase
            .from("custodia")
            .select("resgate_total")
            .eq("codigo_custodia", row.codigo_custodia)
            .eq("user_id", userId)
            .maybeSingle();
        const cdiQuery = isPosFixadoCDI
          ? supabase
              .from("historico_cdi")
              .select("data, taxa_anual")
              .gte("data", row.data_inicio)
              .lte("data", dateISO)
              .order("data")
          : null;

        const [calRes, movRes, custRes, cdiRes] = await Promise.all([
          calQuery, movQuery, custQuery, ...(cdiQuery ? [cdiQuery] : []),
        ]);

        const calendario = calRes.data || [];
        const movimentacoes = (movRes.data || []).map((m: any) => ({
          data: m.data,
          tipo_movimentacao: m.tipo_movimentacao,
          valor: Number(m.valor),
        }));

        const cdiRecords = isPosFixadoCDI && cdiRes
          ? ((cdiRes as any).data || []).map((r: any) => ({ data: r.data, taxa_anual: Number(r.taxa_anual) }))
          : undefined;

        const rows = calcularRendaFixaDiario({
          dataInicio: row.data_inicio,
          dataCalculo: dateISO,
          taxa: row.taxa!,
          modalidade: row.modalidade!,
          puInicial: row.preco_unitario!,
          calendario,
          movimentacoes,
          dataResgateTotal: custRes.data?.resgate_total ?? null,
          pagamento: row.pagamento,
          vencimento: row.vencimento,
          indexador: row.indexador,
          cdiRecords,
        });

        const rowDia = rows.find((r) => r.data === dateISO);
        if (rowDia) {
          setValorCotaDia(tipo === "Aplicação" ? rowDia.valorCota : rowDia.valorCota2);
          if (tipo === "Resgate") {
            setSaldoDisponivel(rowDia.liquido);
          }
        }
      } catch {
        setValorCotaDia(null);
        setSaldoDisponivel(null);
      } finally {
        setLoadingCota(false);
        setLoadingSaldo(false);
      }
    } else {
      // Non-engine products (e.g. Poupança): use valor_investido as saldo
      if (tipo === "Resgate") {
        setSaldoDisponivel(row.valor_investido);
      }
    }
  };

  /** Handle typed date input with mask */
  const handleDateInputChange = (rawValue: string) => {
    const masked = applyDateMask(rawValue);
    setDateInput(masked);

    // Clear calculated data whenever input changes
    clearCalculated();

    // Only process when we have a complete date
    const parsed = parseDateInput(masked);
    if (parsed) {
      processDate(parsed);
    }
  };

  /** Handle calendar selection */
  const handleCalendarSelect = (d: Date | undefined) => {
    setCalendarOpen(false);
    if (!d) {
      setDateInput("");
      clearCalculated();
      return;
    }
    setDateInput(format(d, "dd/MM/yyyy"));
    processDate(d);
  };

  const handleSubmit = async () => {
    if (!date) {
      toast.error("Selecione a data da operação.");
      return;
    }
    if (dateError) {
      toast.error(dateError);
      return;
    }
    const valorNum = parseCurrencyToNumber(valor);
    if (valorNum <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }

    const dateISO = format(date, "yyyy-MM-dd");

    if (tipo === "Resgate" && saldoDisponivel != null && valorNum > saldoDisponivel) {
      toast.error("Valor excede o saldo disponível para resgate.");
      return;
    }

    setSubmitting(true);
    try {
      const tipoMovimentacao = fecharPosicao ? "Resgate Total" : tipo;
      const isPoupancaProduct = row.modalidade === "Poupança";
      const pu = isPoupancaProduct ? null : (valorCotaDia ?? row.preco_unitario);
      const quantidade = isPoupancaProduct ? null : (pu && pu > 0 ? valorNum / pu : null);

      let valorExtrato: string;
      if (!isPoupancaProduct && pu && quantidade) {
        const fmtVal = valorNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtPU = pu.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtQtd = quantidade.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
        valorExtrato = `R$ ${fmtVal} (${fmtPU} x ${fmtQtd})`;
      } else {
        valorExtrato = `R$ ${valorNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      const { data: inserted, error } = await supabase
        .from("movimentacoes")
        .insert({
          user_id: userId,
          data: dateISO,
          tipo_movimentacao: tipoMovimentacao,
          codigo_custodia: row.codigo_custodia,
          categoria_id: row.categoria_id,
          produto_id: row.produto_id,
          instituicao_id: row.instituicao_id,
          emissor_id: row.emissor_id,
          modalidade: row.modalidade,
          indexador: row.indexador,
          taxa: row.taxa,
          pagamento: row.pagamento,
          vencimento: row.vencimento,
          preco_unitario: pu,
          quantidade,
          valor: valorNum,
          valor_extrato: valorExtrato,
          nome_ativo: row.nome,
          origem: "manual",
        })
        .select("id")
        .single();

      if (error) throw error;

      await fullSyncAfterMovimentacao(inserted.id, row.categoria_id, userId, dataReferenciaISO);
      toast.success(`${tipoMovimentacao} registrado com sucesso!`);
      handleClose();
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Erro ao registrar movimentação.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setDateInput("");
    setDate(undefined);
    setValor("");
    setSaldoDisponivel(null);
    setValorCotaDia(null);
    setFecharPosicao(false);
    setDateError(null);
    setCalendarOpen(false);
    onClose();
  };

  const readonlyFields = [
    { label: "Nome", value: fmtReadonly(row.nome) },
    { label: "Categoria", value: row.categoria },
    { label: "Produto", value: row.produto },
    { label: "Instituição", value: fmtReadonly(row.instituicao) },
    { label: "Emissor", value: fmtReadonly(row.emissor) },
    { label: "Modalidade", value: fmtReadonly(row.modalidade) },
    { label: "Indexador", value: fmtReadonly(row.indexador) },
    { label: "Taxa", value: fmtTaxa(row.taxa) },
    { label: "Pagamento", value: fmtReadonly(row.pagamento) },
    { label: "Vencimento", value: fmtDate(row.vencimento) },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {tipo === "Aplicação" ? "Aplicação Adicional" : "Resgate"} — {row.nome ?? `Cód. ${row.codigo_custodia}`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {readonlyFields.map((f) => (
            <div key={f.label}>
              <span className="text-muted-foreground text-xs">{f.label}</span>
              <p className="font-medium text-foreground truncate">{f.value}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-border my-2" />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-foreground">Data da Transação *</label>
          <div className="flex gap-2">
            <Input
              placeholder="dd/mm/aaaa"
              value={dateInput}
              className={cn("flex-1", dateError ? "border-destructive ring-1 ring-destructive" : "")}
              onChange={(e) => handleDateInputChange(e.target.value)}
            />
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
                  <CalendarIcon className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={handleCalendarSelect}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
          {dateError && (
            <p className="text-xs font-medium text-destructive">{dateError}</p>
          )}
        </div>

        {tipo === "Aplicação" && date && !dateError && loadingCota && (
          <p className="text-sm text-muted-foreground">Calculando...</p>
        )}

        {/* Saldo disponível para resgate */}
        {tipo === "Resgate" && date && !dateError && (
          <div className="text-sm">
            {loadingSaldo ? (
              <p className="text-muted-foreground">Calculando saldo...</p>
            ) : saldoDisponivel != null ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Saldo disponível para resgate:{" "}
                  <strong>
                    R${" "}
                    {saldoDisponivel.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        {/* Fechar Posição checkbox */}
        {tipo === "Resgate" && date && !dateError && saldoDisponivel != null && saldoDisponivel > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="fechar-posicao"
              checked={fecharPosicao}
              onCheckedChange={(checked) => handleFecharPosicaoChange(!!checked)}
            />
            <label htmlFor="fechar-posicao" className="text-sm font-medium text-foreground cursor-pointer">
              Fechar Posição
            </label>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Valor (R$) *</label>
          <Input
            placeholder="0,00"
            value={valor}
            disabled={fecharPosicao}
            onChange={(e) => setValor(formatCurrency(e.target.value))}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Registrando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
