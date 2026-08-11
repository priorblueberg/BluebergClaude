import { useState, useEffect } from "react";
import { format, parse, isValid } from "date-fns";
import { ArrowLeft, PlusCircle, AlertTriangle, HelpCircle, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { calcularRendaFixaDiario } from "@/lib/rendaFixaEngine";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import SearchableSelect from "@/components/SearchableSelect";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Categoria {
  id: string;
  nome: string;
}
interface Produto {
  id: string;
  nome: string;
}
interface Instituicao {
  id: string;
  nome: string;
}
interface Emissor {
  id: string;
  nome: string;
}
interface CustodiaItem {
  id: string;
  nome: string | null;
  codigo_custodia: number;
  data_inicio: string;
  valor_investido: number;
  taxa: number | null;
  indexador: string | null;
  vencimento: string | null;
  modalidade: string | null;
  pagamento: string | null;
  produto_id: string;
  instituicao_id: string | null;
  emissor_id: string | null;
  categoria_id: string;
  preco_unitario: number | null;
  resgate_total: string | null;
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

function numberToCurrency(num: number): string {
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TIPOS_MOVIMENTACAO = [
  "Aplicação",
  "Resgate",
];

const PAGAMENTO_OPTIONS = [
  "Mensal",
  "Bimestral",
  "Trimestral",
  "Quatrimestral",
  "Semestral",
  "No Vencimento",
];

const MODALIDADE_OPTIONS = ["Prefixado", "Pós Fixado"];

const INDEXADOR_OPTIONS = ["CDI", "CDI+"];

// ── Currency formatting helpers ──
function formatCurrency(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  const formatted = (num / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted;
}

function formatValorInicial(value: string): string {
  let cleaned = value.replace(/[^\d,]/g, "");
  const parts = cleaned.split(",");
  
  if (parts.length > 2) {
    cleaned = parts[0] + "," + parts.slice(1).join("");
  }
  
  if (parts.length === 1) {
    const intDigits = parts[0].replace(/^0+(?=\d)/, "") || "";
    if (!intDigits) return "";
    return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  
  let decPart = parts[1].slice(0, 2).padEnd(2, "0");
  const intPart = (parts[0].replace(/^0+(?=\d)/, "") || "0").replace(/\./g, "");
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + decPart;
}

function formatTaxaInput(value: string): string {
  let cleaned = value.replace(/[^\d,]/g, "");
  const parts = cleaned.split(",");

  if (parts.length > 2) {
    cleaned = parts[0] + "," + parts.slice(1).join("");
    return formatTaxaInput(cleaned);
  }

  if (parts.length === 1) {
    // No comma yet – just show integer digits, let user type comma when ready
    const intDigits = parts[0].replace(/^0+(?=\d)/, "") || "";
    return intDigits;
  }

  const intPart = parts[0].replace(/^0+(?=\d)/, "") || "0";
  const decPart = parts[1].slice(0, 2);
  return intPart + "," + decPart;
}

function parseCurrencyToNumber(value: string): number {
  const cleaned = value.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

/** Strip parenthetical suffix: "CDB (Certificado de Depósito Bancário)" → "CDB" */
function sigla(nome: string): string {
  return nome.replace(/\s*\(.*\)$/, "").trim();
}

function buildNomeAtivo(
  produtoNome: string,
  emissorNome: string,
  modalidade: string,
  taxa: string,
  vencimento: string,
  indexador: string
): string {
  const prod = sigla(produtoNome);
  const taxaFormatted = taxa ? `${taxa.replace(".", ",")}%` : "";
  const vencFormatted = vencimento
    ? new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR")
    : "";

  if (modalidade === "Prefixado") {
    return [prod, emissorNome, modalidade, taxaFormatted ? `${taxaFormatted} a.a.` : "", vencFormatted ? `- ${vencFormatted}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  if (indexador === "CDI") {
    return [prod, emissorNome, modalidade, taxaFormatted, "do CDI", vencFormatted ? `- ${vencFormatted}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  return [prod, emissorNome, modalidade, indexador, taxaFormatted, vencFormatted ? `- ${vencFormatted}` : ""]
    .filter(Boolean)
    .join(" ");
}



export default function CadastrarTransacaoPage() {
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([]);
  const [emissores, setEmissores] = useState<Emissor[]>([]);

  // Resgate-specific state
  const [custodiaItems, setCustodiaItems] = useState<CustodiaItem[]>([]);
  const [selectedCustodiaId, setSelectedCustodiaId] = useState("");
  const [saldoDisponivel, setSaldoDisponivel] = useState<number | null>(null);
  const [calculandoSaldo, setCalculandoSaldo] = useState(false);
  const [resgateDateInput, setResgateDateInput] = useState("");
  const [resgateDateError, setResgateDateError] = useState<string | null>(null);
  const [resgateDate, setResgateDate] = useState<Date | undefined>();
  const [fecharPosicao, setFecharPosicao] = useState(false);
  const [resgateCalendarOpen, setResgateCalendarOpen] = useState(false);

  // form state
  const [categoriaId, setCategoriaId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [tipoMovimentacao, setTipoMovimentacao] = useState("");
  const [data, setData] = useState("");
  const [valor, setValor] = useState("");
  const [precoUnitario, setPrecoUnitario] = useState("1.000,00");
  const [instituicaoId, setInstituicaoId] = useState("");
  const [emissorId, setEmissorId] = useState("");
  const [modalidade, setModalidade] = useState("");
  const [indexador, setIndexador] = useState("");
  const [taxa, setTaxa] = useState("");
  const [pagamento, setPagamento] = useState("No Vencimento");
  const [vencimento, setVencimento] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editLoaded, setEditLoaded] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());

  // Derived
  const categoriaSelecionada = categorias.find((c) => c.id === categoriaId);
  const produtoSelecionado = produtos.find((p) => p.id === produtoId);
  const isRendaFixa = categoriaSelecionada?.nome === "Renda Fixa";
  const isPoupanca = produtoSelecionado?.nome === "Poupança";
  const isPosFixado = modalidade === "Pós Fixado";
  const isEditing = !!editId;
  const isResgate = tipoMovimentacao === "Resgate";
  const isAplicacao = tipoMovimentacao === "Aplicação";
  const selectedCustodia = custodiaItems.find((c) => c.id === selectedCustodiaId);

  // Load categorias on mount — only Renda Fixa (Poupança is now a product within RF)
  useEffect(() => {
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("ativa", true)
      .order("nome")
      .then(({ data }) => {
        if (data) {
          const allowed = data.filter((c: Categoria) => c.nome === "Renda Fixa");
          setCategorias(allowed);
          if (allowed.length === 1 && !editId) {
            setCategoriaId(allowed[0].id);
          }
        }
      });
  }, []);

  // Load produtos when categoria changes (for Aplicação flow)
  useEffect(() => {
    if (!categoriaId) {
      setProdutos([]);
      return;
    }
    supabase
      .from("produtos")
      .select("id, nome")
      .eq("categoria_id", categoriaId)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        if (data) {
          setProdutos(data);
          // Auto-select when only one product (e.g. Poupança)
          if (data.length === 1 && !editId) {
            setProdutoId(data[0].id);
          }
        }
      });
  }, [categoriaId]);

  // Load instituicoes and emissores once
  useEffect(() => {
    supabase
      .from("instituicoes")
      .select("id, nome")
      .eq("ativa", true)
      .order("nome")
      .then(({ data }) => {
        if (data) setInstituicoes(data);
      });
    supabase
      .from("emissores")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        if (data) setEmissores(data);
      });
  }, []);

  // Load custodia items when Resgate is selected
  useEffect(() => {
    if (!isResgate || !categoriaId || !user) {
      setCustodiaItems([]);
      return;
    }
    supabase
      .from("custodia")
      .select("id, nome, codigo_custodia, data_inicio, valor_investido, taxa, indexador, vencimento, modalidade, pagamento, produto_id, instituicao_id, emissor_id, categoria_id, preco_unitario, resgate_total")
      .eq("categoria_id", categoriaId)
      .eq("user_id", user.id)
      .order("nome")
      .then(({ data }) => {
        if (data) setCustodiaItems(data as CustodiaItem[]);
      });
  }, [isResgate, categoriaId, user]);

  // Auto-fill fields when custodia item selected
  useEffect(() => {
    if (!selectedCustodia) return;
    setProdutoId(selectedCustodia.produto_id);
    setInstituicaoId(selectedCustodia.instituicao_id || "");
    setEmissorId(selectedCustodia.emissor_id || "");
    setModalidade(selectedCustodia.modalidade || "");
    setIndexador(selectedCustodia.indexador || "");
    setTaxa(selectedCustodia.taxa ? String(selectedCustodia.taxa) : "");
    setPagamento(selectedCustodia.pagamento || "No Vencimento");
    setVencimento(selectedCustodia.vencimento || "");
  }, [selectedCustodia]);

  // Auto-check fecharPosicao when valor matches saldoDisponivel
  useEffect(() => {
    if (!isResgate || saldoDisponivel == null || saldoDisponivel <= 0) return;
    const valorNum = parseCurrencyToNumber(valor);
    if (valorNum > 0 && Math.abs(valorNum - saldoDisponivel) < 0.01) {
      if (!fecharPosicao) setFecharPosicao(true);
    }
  }, [valor, saldoDisponivel, isResgate]);

  const handleFecharPosicaoChange = (checked: boolean) => {
    setFecharPosicao(checked);
    if (checked && saldoDisponivel != null && saldoDisponivel > 0) {
      setValor(numberToCurrency(saldoDisponivel));
    } else if (!checked) {
      setValor("");
    }
  };

  /** Clear resgate calculated fields without touching dateInput */
  const clearResgateCalculated = () => {
    setResgateDate(undefined);
    setSaldoDisponivel(null);
    setFecharPosicao(false);
    setValor("");
    setResgateDateError(null);
  };

  /** Validate and process a complete resgate date */
  const processResgateDate = async (d: Date) => {
    if (!selectedCustodia || !user) return;
    setResgateDate(d);
    setSaldoDisponivel(null);
    setFecharPosicao(false);
    setValor("");
    setResgateDateError(null);

    const dateISO = format(d, "yyyy-MM-dd");
    setData(dateISO);

    // Validate: not before data_inicio
    const inicioDate = new Date(selectedCustodia.data_inicio + "T00:00:00");
    if (d < inicioDate) {
      setResgateDateError("A data selecionada não pode ser anterior à aplicação inicial.");
      return;
    }

    // Validate: not in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d > today) {
      setResgateDateError("A data não pode ser superior à data atual.");
      return;
    }

    // Validate: not after vencimento
    if (selectedCustodia.vencimento) {
      const vencDate = new Date(selectedCustodia.vencimento + "T00:00:00");
      if (d > vencDate) {
        setResgateDateError("A data não pode ser posterior ao vencimento do título.");
        return;
      }
    }

    // Validate: if resgate_total exists, date must be before it
    if (selectedCustodia.resgate_total) {
      const resgateDate = new Date(selectedCustodia.resgate_total + "T00:00:00");
      if (d >= resgateDate) {
        setResgateDateError("A data deve ser anterior à data do resgate total.");
        return;
      }
    }

    // Validate: business day (skip for Poupança)
    const isPoupancaResgate = selectedCustodia.modalidade === "Poupança";
    if (!isPoupancaResgate) {
      const { data: diaUtil } = await supabase
        .from("calendario_dias_uteis")
        .select("dia_util")
        .eq("data", dateISO)
        .maybeSingle();

      if (!diaUtil || !diaUtil.dia_util) {
        setResgateDateError("A data selecionada não é um dia útil.");
        return;
      }
    }

    // Calculate saldo using renda fixa engine
    const isRendaFixaEngine = (selectedCustodia.modalidade === "Prefixado" || selectedCustodia.modalidade === "Pos Fixado" || selectedCustodia.modalidade === "Pós Fixado" || selectedCustodia.modalidade === "Mista") && selectedCustodia.taxa && selectedCustodia.preco_unitario;

    if (isRendaFixaEngine) {
      setCalculandoSaldo(true);
      try {
        const isPosFixadoCDI = ((selectedCustodia.modalidade === "Pos Fixado" || selectedCustodia.modalidade === "Pós Fixado") && selectedCustodia.indexador === "CDI") || (selectedCustodia.modalidade === "Mista" && selectedCustodia.indexador === "CDI");

        const calQuery = supabase
          .from("calendario_dias_uteis")
          .select("data, dia_util")
          .gte("data", selectedCustodia.data_inicio)
          .lte("data", dateISO)
          .order("data");
        const movQuery = supabase
          .from("movimentacoes")
          .select("data, tipo_movimentacao, valor")
          .eq("codigo_custodia", selectedCustodia.codigo_custodia)
          .eq("user_id", user.id)
          .order("data");
        const custQuery = supabase
          .from("custodia")
          .select("resgate_total")
          .eq("codigo_custodia", selectedCustodia.codigo_custodia)
          .eq("user_id", user.id)
          .maybeSingle();
        const cdiQuery = isPosFixadoCDI
          ? supabase
              .from("historico_cdi")
              .select("data, taxa_anual")
              .gte("data", selectedCustodia.data_inicio)
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
          dataInicio: selectedCustodia.data_inicio,
          dataCalculo: dateISO,
          taxa: selectedCustodia.taxa!,
          modalidade: selectedCustodia.modalidade!,
          puInicial: selectedCustodia.preco_unitario!,
          calendario,
          movimentacoes,
          dataResgateTotal: custRes.data?.resgate_total ?? null,
          pagamento: selectedCustodia.pagamento,
          vencimento: selectedCustodia.vencimento,
          indexador: selectedCustodia.indexador,
          cdiRecords,
        });

        const rowDia = rows.find((r) => r.data === dateISO);
        if (rowDia) {
          setSaldoDisponivel(rowDia.liquido);
        }
      } catch {
        setSaldoDisponivel(null);
      } finally {
        setCalculandoSaldo(false);
      }
    } else {
      setSaldoDisponivel(selectedCustodia.valor_investido);
    }
  };

  /** Handle typed resgate date input with mask */
  const handleResgateDateInputChange = (rawValue: string) => {
    const masked = applyDateMask(rawValue);
    setResgateDateInput(masked);
    clearResgateCalculated();
    setData("");

    const parsed = parseDateInput(masked);
    if (parsed) {
      processResgateDate(parsed);
    }
  };

  /** Handle resgate calendar selection */
  const handleResgateCalendarSelect = (d: Date | undefined) => {
    setResgateCalendarOpen(false);
    if (!d) {
      setResgateDateInput("");
      clearResgateCalculated();
      setData("");
      return;
    }
    setResgateDateInput(format(d, "dd/MM/yyyy"));
    processResgateDate(d);
  };

  // Load edit data
  useEffect(() => {
    if (!editId || editLoaded || categorias.length === 0) return;

    (async () => {
      const { data: mov } = await supabase
        .from("movimentacoes")
        .select("*")
        .eq("id", editId)
        .single();

      if (!mov) {
        toast.error("Movimentação não encontrada.");
        navigate("/movimentacoes");
        return;
      }

      setCategoriaId(mov.categoria_id);
      setTipoMovimentacao(mov.tipo_movimentacao);
      setProdutoId(mov.produto_id);
      setData(mov.data);
      setValor(mov.valor ? formatCurrency(Math.round(mov.valor * 100).toString()) : "");
      setPrecoUnitario(mov.preco_unitario ? formatCurrency(Math.round(mov.preco_unitario * 100).toString()) : "1.000,00");
      setInstituicaoId(mov.instituicao_id || "");
      setEmissorId(mov.emissor_id || "");
      setModalidade(mov.modalidade || "");
      setIndexador(mov.indexador || "");
      setTaxa(mov.taxa ? String(mov.taxa) : "");
      setPagamento(mov.pagamento || "No Vencimento");
      setVencimento(mov.vencimento || "");
      setEditLoaded(true);
    })();
  }, [editId, editLoaded, categorias]);

  // Step visibility
  const showTipoMovimentacao = !!categoriaId && isRendaFixa;
  const showAplicacaoFields = showTipoMovimentacao && !!produtoId && (isAplicacao || (isEditing && !!tipoMovimentacao && !isResgate));
  const showResgateFields = showTipoMovimentacao && isResgate && !isEditing;
  const showPoupancaFields = isPoupanca && isAplicacao;

  const resetForm = () => {
    setCategoriaId("");
    setProdutoId("");
    setTipoMovimentacao("");
    setData("");
    setValor("");
    setPrecoUnitario("1.000,00");
    setInstituicaoId("");
    setEmissorId("");
    setModalidade("");
    setIndexador("");
    setTaxa("");
    setPagamento("No Vencimento");
    setVencimento("");
    setSelectedCustodiaId("");
    setSaldoDisponivel(null);
    setResgateDateInput("");
    setResgateDate(undefined);
    setResgateDateError(null);
    setFecharPosicao(false);
    setResgateCalendarOpen(false);
    if (isEditing) {
      navigate("/movimentacoes");
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error("Usuário não autenticado. Faça login novamente.");
      return;
    }

    // ── Resgate submission ──
    if (isResgate && selectedCustodia) {
      const errors = new Set<string>();
      if (!resgateDate || !data) errors.add("data");
      if (!valor || parseCurrencyToNumber(valor) <= 0) errors.add("valor");
      if (errors.size > 0) {
        setValidationErrors(errors);
        toast.error("Preencha todos os campos obrigatórios.");
        return;
      }
      if (resgateDateError) {
        toast.error(resgateDateError);
        return;
      }
      setValidationErrors(new Set());

      const valorNum = parseCurrencyToNumber(valor);
      if (saldoDisponivel !== null && valorNum > saldoDisponivel) {
        toast.error("O valor do resgate excede o saldo disponível.");
        return;
      }

      setSubmitting(true);
      try {
        const tipoMovimentacaoFinal = fecharPosicao ? "Resgate Total" : "Resgate";
        const fmtBR = (v: number) =>
          v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const { error } = await supabase.from("movimentacoes").insert({
          categoria_id: selectedCustodia.categoria_id,
          tipo_movimentacao: tipoMovimentacaoFinal,
          data,
          produto_id: selectedCustodia.produto_id,
          valor: valorNum,
          preco_unitario: null,
          instituicao_id: selectedCustodia.instituicao_id,
          emissor_id: selectedCustodia.emissor_id,
          modalidade: selectedCustodia.modalidade,
          taxa: selectedCustodia.taxa,
          pagamento: selectedCustodia.pagamento,
          vencimento: selectedCustodia.vencimento,
          nome_ativo: selectedCustodia.nome,
          codigo_custodia: selectedCustodia.codigo_custodia,
          indexador: selectedCustodia.indexador,
          quantidade: null,
          valor_extrato: `R$ ${fmtBR(valorNum)}`,
          user_id: user.id,
          origem: "manual",
        });

        if (error) throw error;

        const { data: inserted } = await supabase
          .from("movimentacoes")
          .select("id")
          .eq("codigo_custodia", selectedCustodia.codigo_custodia)
          .eq("user_id", user.id)
          .eq("tipo_movimentacao", tipoMovimentacaoFinal)
          .order("created_at", { ascending: false })
          .limit(1);

        const insertedId = inserted?.[0]?.id || null;
        await fullSyncAfterMovimentacao(insertedId, selectedCustodia.categoria_id, user.id, dataReferenciaISO);
        applyDataReferencia();

        toast.success("Resgate cadastrado com sucesso!");
        resetForm();
      } catch (err: any) {
        toast.error("Erro ao cadastrar resgate.");
        console.error(err);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // (Resgate already handled above)
    // ── Aplicação submission (existing logic) ──
    let requiredFields: Record<string, string>;

    if (isPoupanca) {
      requiredFields = { categoriaId, tipoMovimentacao, produtoId, valor, data, instituicaoId };
    } else {
      requiredFields = {
        categoriaId, tipoMovimentacao, produtoId, valor, data, precoUnitario,
        instituicaoId, emissorId, modalidade, taxa, pagamento, vencimento,
      };
      if (isPosFixado) {
        requiredFields.indexador = indexador;
      }
    }

    const emptyFields = Object.entries(requiredFields).filter(([, v]) => !v).map(([k]) => k);

    if (emptyFields.length > 0) {
      setValidationErrors(new Set(emptyFields));
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    setValidationErrors(new Set());

    // Validate business day AFTER required fields check
    if (!isPoupanca) {
      const { data: diaUtil } = await supabase
        .from("calendario_dias_uteis")
        .select("dia_util")
        .eq("data", data)
        .single();

      if (!diaUtil) {
        toast.error("A data informada não foi encontrada no calendário. Verifique se é um dia útil válido.");
        return;
      }

      if (!diaUtil.dia_util) {
        toast.error("A Data de Transação deve ser um dia útil.");
        return;
      }
    }

    setSubmitting(true);

    try {
      const produtoNome = produtos.find((p) => p.id === produtoId)?.nome || "";
      const emissorNome = emissores.find((e) => e.id === emissorId)?.nome || "";
      const instituicaoNome = instituicoes.find((i) => i.id === instituicaoId)?.nome || "";

      let nomeAtivo: string | null;
      if (isPoupanca) {
        nomeAtivo = `Poupança ${instituicaoNome}`.trim();
      } else if (isRendaFixa) {
        nomeAtivo = buildNomeAtivo(produtoNome, emissorNome, modalidade, taxa, vencimento, indexador);
      } else {
        nomeAtivo = null;
      }

      const valorNum = parseCurrencyToNumber(valor);
      const puNum = isPoupanca ? 0 : parseCurrencyToNumber(precoUnitario);
      const taxaNum = isPoupanca ? 0 : parseFloat(taxa.replace(",", ".") || "0");
      const quantidade = !isPoupanca && puNum > 0 ? valorNum / puNum : null;

      // Mapeamento: "Pós Fixado" + "CDI+" → "Mista" + "CDI"
      let modalidadeToSave = isPoupanca ? "Poupança" : modalidade;
      let indexadorToSave = isPosFixado ? indexador : null;
      if (modalidade === "Pós Fixado" && indexador === "CDI+") {
        modalidadeToSave = "Mista";
        indexadorToSave = "CDI";
      }

      const fmtBR = (v: number) =>
        v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const valorExtrato = quantidade != null
        ? `R$ ${fmtBR(valorNum)} (R$ ${fmtBR(puNum)} x ${fmtBR(quantidade)})`
        : `R$ ${fmtBR(valorNum)}`;

      if (isEditing) {
        const { error } = await supabase.from("movimentacoes").update({
          data,
          valor: valorNum,
          preco_unitario: puNum,
          instituicao_id: instituicaoId,
          emissor_id: emissorId,
          modalidade: modalidadeToSave,
          taxa: taxaNum,
          pagamento,
          vencimento,
          nome_ativo: nomeAtivo,
          indexador: indexadorToSave,
          quantidade,
          valor_extrato: valorExtrato,
        }).eq("id", editId);

        if (error) throw error;

        await fullSyncAfterMovimentacao(editId!, categoriaId, user!.id, dataReferenciaISO);
        applyDataReferencia();

        toast.success("Transação atualizada com sucesso!");
        navigate("/movimentacoes");
      } else {
        let codigoCustodia: number;
        let tipoFinal = tipoMovimentacao;

        if (nomeAtivo) {
          const { data: existing } = await supabase
            .from("movimentacoes")
            .select("codigo_custodia")
            .eq("nome_ativo", nomeAtivo)
            .not("codigo_custodia", "is", null)
            .limit(1);

          if (existing && existing.length > 0) {
            codigoCustodia = existing[0].codigo_custodia!;
          } else {
            const { data: maxRow } = await supabase
              .from("movimentacoes")
              .select("codigo_custodia")
              .not("codigo_custodia", "is", null)
              .order("codigo_custodia", { ascending: false })
              .limit(1);

            const maxCodigo = maxRow && maxRow.length > 0 ? (maxRow[0].codigo_custodia ?? 99) : 99;
            codigoCustodia = maxCodigo + 1;
            tipoFinal = "Aplicação Inicial";
          }
        } else {
          codigoCustodia = 0;
        }

        const { error } = await supabase.from("movimentacoes").insert({
          categoria_id: categoriaId,
          tipo_movimentacao: tipoFinal,
          data,
          produto_id: produtoId,
          valor: valorNum,
          preco_unitario: isPoupanca ? null : puNum,
          instituicao_id: instituicaoId,
          emissor_id: isPoupanca ? (instituicaoId || null) : emissorId || null,
          modalidade: modalidadeToSave,
          taxa: isPoupanca ? null : taxaNum,
          pagamento: isPoupanca ? "Mensal" : pagamento,
          vencimento: isPoupanca ? null : vencimento || null,
          nome_ativo: nomeAtivo,
          codigo_custodia: nomeAtivo ? codigoCustodia : null,
          indexador: isPoupanca ? null : indexadorToSave,
          quantidade,
          valor_extrato: valorExtrato,
          user_id: user?.id,
          origem: "manual",
        });

        if (error) throw error;

        const { data: inserted } = await supabase
          .from("movimentacoes")
          .select("id")
          .eq("codigo_custodia", nomeAtivo ? codigoCustodia : -1)
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const insertedId = inserted?.[0]?.id || null;

        await fullSyncAfterMovimentacao(insertedId, categoriaId, user!.id, dataReferenciaISO);
        applyDataReferencia();

        toast.success("Transação cadastrada com sucesso!");
        resetForm();
      }
    } catch (err: any) {
      toast.error(isEditing ? "Erro ao atualizar transação." : "Erro ao cadastrar transação.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper for displaying names from IDs (for Resgate readonly fields)
  const getInstituicaoNome = (id: string) => instituicoes.find((i) => i.id === id)?.nome || "—";
  const getEmissorNome = (id: string) => emissores.find((e) => e.id === id)?.nome || "—";

  const fmtBrlDisplay = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const valorResgateSuperaSaldo =
    isResgate && saldoDisponivel !== null && parseCurrencyToNumber(valor) > saldoDisponivel && valor !== "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={resetForm}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {isEditing ? "Editar Transação" : "Nova Transação"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isEditing ? "Altere os dados da movimentação" : "Os campos com * são de preenchimento obrigatório"}
          </p>
        </div>
      </div>

      {/* Form card */}
      <div className="rounded-md border border-border bg-card p-6 max-w-2xl space-y-5">
        {/* Step 1 — Categoria + Tipo de Movimentação */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Categoria do Produto" required>
            <NativeSelect
              value={categoriaId}
              onChange={(v) => {
                if (isEditing) return;
                setCategoriaId(v);
                setTipoMovimentacao("");
                setProdutoId("");
                setSelectedCustodiaId("");
              }}
              placeholder="Selecione uma categoria"
              disabled={isEditing}
              options={categorias.map((c) => ({
                value: c.id,
                label: c.nome,
              }))}
            />
          </Field>

          {showTipoMovimentacao && (
            <Field label="Tipo de Movimentação" required>
              <NativeSelect
                value={tipoMovimentacao}
                onChange={(v) => {
                  setTipoMovimentacao(v);
                  // Don't reset produtoId for Poupança (auto-selected, single product)
                  if (!isPoupanca) setProdutoId("");
                  setSelectedCustodiaId("");
                  setValor("");
                  setSaldoDisponivel(null);
                  if (v === "Resgate") setData("");
                }}
                placeholder="Selecione o tipo de movimentação"
                disabled={isEditing}
                options={TIPOS_MOVIMENTACAO.map((t) => ({
                  value: t,
                  label: t,
                  disabled: t !== "Aplicação" && t !== "Resgate",
                }))}
              />
            </Field>
          )}
        </div>

        {/* ── Aplicação Flow ── */}
        {(isAplicacao || (isEditing && !!tipoMovimentacao && !isResgate)) && isRendaFixa && !isPoupanca && (
          <>
            {/* Produto selector */}
            <Field label="Produto" required>
              <NativeSelect
                value={produtoId}
                onChange={setProdutoId}
                placeholder="Selecione"
                disabled={isEditing}
                options={produtos.map((p) => ({
                  value: p.id,
                  label: p.nome,
                }))}
              />
            </Field>

            {showAplicacaoFields && (
              <>
                {/* Row 1: Data, Valor Inicial, Preço de Emissão, Vencimento */}
                <div className="grid grid-cols-4 gap-4">
                  <Field label="Data de Transação" required>
                    <input
                      type="date"
                      value={data}
                      onChange={(e) => { setData(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("data"); return n; }); }}
                      className={`input-field ${validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                  </Field>

                  <Field label="Valor Inicial" required>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        R$
                      </span>
                      <input
                        type="text"
                        value={valor}
                        onChange={(e) => { setValor(formatCurrency(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("valor"); return n; }); }}
                        placeholder="0,00"
                        className={`input-field pl-9 ${validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                    </div>
                  </Field>

                  <Field label="Preço de Emissão" required>
                    <TooltipProvider>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                          R$
                        </span>
                        <input
                          type="text"
                          value={precoUnitario}
                          onChange={(e) => { setPrecoUnitario(formatCurrency(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("precoUnitario"); return n; }); }}
                          placeholder="1.000,00"
                          className={`input-field pl-9 pr-8 ${validationErrors.has("precoUnitario") ? "border-destructive ring-1 ring-destructive" : ""}`}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 cursor-help text-muted-foreground">
                              <HelpCircle className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            Caso não saiba, deixe o valor de R$ 1.000,00 (Padrão)
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </Field>

                  <Field label="Vencimento" required>
                    <input
                      type="date"
                      value={vencimento}
                      min={data || undefined}
                      onChange={(e) => { setVencimento(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("vencimento"); return n; }); }}
                      className={`input-field ${validationErrors.has("vencimento") ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                  </Field>
                </div>

                {/* Row 2: Instituição, Emissor */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Corretora" required>
                    <SearchableSelect
                      value={instituicaoId}
                      onChange={(v) => { setInstituicaoId(v); setValidationErrors((prev) => { const n = new Set(prev); n.delete("instituicaoId"); return n; }); }}
                      placeholder="Pesquisar corretora..."
                      hasError={validationErrors.has("instituicaoId")}
                      options={instituicoes.map((i) => ({
                        value: i.id,
                        label: i.nome,
                      }))}
                    />
                  </Field>

                  <Field label="Emissor" required>
                    <SearchableSelect
                      value={emissorId}
                      onChange={(v) => { setEmissorId(v); setValidationErrors((prev) => { const n = new Set(prev); n.delete("emissorId"); return n; }); }}
                      placeholder="Pesquisar emissor..."
                      hasError={validationErrors.has("emissorId")}
                      options={emissores.map((e) => ({
                        value: e.id,
                        label: e.nome,
                      }))}
                    />
                  </Field>
                </div>

                {/* Row 3: Modalidade, (Indexador if Pós Fixado), Taxa, Pagamento de Juros */}
                <div className={`grid gap-4 ${isPosFixado ? "grid-cols-4" : "grid-cols-3"}`}>
                  <Field label="Modalidade" required>
                    <NativeSelect
                      value={modalidade}
                      onChange={(v) => {
                        setModalidade(v);
                        if (v !== "Pós Fixado") setIndexador("");
                        setValidationErrors((prev) => { const n = new Set(prev); n.delete("modalidade"); return n; });
                      }}
                      placeholder="Selecione"
                      options={MODALIDADE_OPTIONS.map((m) => ({
                        value: m,
                        label: m,
                      }))}
                      hasError={validationErrors.has("modalidade")}
                    />
                  </Field>

                  {isPosFixado && (
                    <Field label="Indexador" required>
                      <NativeSelect
                        value={indexador}
                        onChange={(v) => { setIndexador(v); setValidationErrors((prev) => { const n = new Set(prev); n.delete("indexador"); return n; }); }}
                        placeholder="Selecione"
                        options={INDEXADOR_OPTIONS.map((idx) => ({
                          value: idx,
                          label: idx,
                        }))}
                        hasError={validationErrors.has("indexador")}
                      />
                    </Field>
                  )}

                  <Field label="Taxa" required>
                    <div className="relative">
                      <input
                        type="text"
                        value={taxa}
                        onChange={(e) => { setTaxa(formatTaxaInput(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("taxa"); return n; }); }}
                        placeholder="0,00"
                        className={`input-field pr-7 ${validationErrors.has("taxa") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        %
                      </span>
                    </div>
                  </Field>

                  <Field label="Pagamento de Juros" required>
                    <NativeSelect
                      value={pagamento}
                      onChange={(v) => { setPagamento(v); setValidationErrors((prev) => { const n = new Set(prev); n.delete("pagamento"); return n; }); }}
                      placeholder="Selecione"
                      options={PAGAMENTO_OPTIONS.map((p) => ({
                        value: p,
                        label: p,
                      }))}
                      hasError={validationErrors.has("pagamento")}
                    />
                  </Field>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-md bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(145,63%,32%)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[hsl(145,63%,28%)] transition-colors disabled:opacity-50"
                  >
                    <PlusCircle size={16} />
                    {submitting ? "Enviando..." : isEditing ? "Salvar Alterações" : "Enviar"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Poupança Aplicação Flow (product-based) ── */}
        {isPoupanca && isRendaFixa && (isAplicacao || (isEditing && !!tipoMovimentacao && !isResgate)) && (
          <>
            {/* Produto auto-selected, no selector needed */}

            {showPoupancaFields && (
              <>
                {/* Row 1: Data, Valor */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Data de Transação" required>
                    <input
                      type="date"
                      value={data}
                      onChange={(e) => { setData(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("data"); return n; }); }}
                      className={`input-field ${validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                  </Field>

                  <Field label="Valor da Aplicação" required>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        R$
                      </span>
                      <input
                        type="text"
                        value={valor}
                        onChange={(e) => { setValor(formatCurrency(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("valor"); return n; }); }}
                        placeholder="0,00"
                        className={`input-field pl-9 ${validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                    </div>
                  </Field>
                </div>

                {/* Row 2: Banco */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Banco" required>
                    <SearchableSelect
                      value={instituicaoId}
                      onChange={(v) => { setInstituicaoId(v); setValidationErrors((prev) => { const n = new Set(prev); n.delete("instituicaoId"); return n; }); }}
                      placeholder="Pesquisar banco..."
                      hasError={validationErrors.has("instituicaoId")}
                      options={instituicoes.map((i) => ({
                        value: i.id,
                        label: i.nome,
                      }))}
                    />
                  </Field>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-md bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(145,63%,32%)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[hsl(145,63%,28%)] transition-colors disabled:opacity-50"
                  >
                    <PlusCircle size={16} />
                    {submitting ? "Enviando..." : isEditing ? "Salvar Alterações" : "Enviar"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Resgate Flow ── */}
        {showResgateFields && (
          <>
            <Field label="Nome do Título" required>
              <NativeSelect
                value={selectedCustodiaId}
                onChange={(v) => {
                  setSelectedCustodiaId(v);
                  setValor("");
                  setData("");
                  setSaldoDisponivel(null);
                  setResgateDateInput("");
                  setResgateDate(undefined);
                  setResgateDateError(null);
                  setFecharPosicao(false);
                }}
                placeholder="Selecione o título em custódia"
                options={custodiaItems.map((c) => ({
                  value: c.id,
                  label: c.nome || `Custódia #${c.codigo_custodia}`,
                }))}
              />
            </Field>

            {selectedCustodia && (
              <>
                <Field label="Data de Transação" required>
                  <div className="flex gap-2">
                    <Input
                      placeholder="dd/mm/aaaa"
                      value={resgateDateInput}
                      className={cn("flex-1 max-w-[220px]", resgateDateError || validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : "")}
                      onChange={(e) => { handleResgateDateInputChange(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("data"); return n; }); }}
                    />
                    <Popover open={resgateCalendarOpen} onOpenChange={setResgateCalendarOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="shrink-0">
                          <CalendarIcon className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={resgateDate}
                          onSelect={handleResgateCalendarSelect}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  {resgateDateError && (
                    <p className="text-xs font-medium text-destructive mt-1">{resgateDateError}</p>
                  )}
                </Field>

                {resgateDate && !resgateDateError && (
                  <>
                    {/* Row 1: Valor, Vencimento */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Valor do Resgate (R$)" required>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                            R$
                          </span>
                          <input
                            type="text"
                            value={valor}
                            onChange={(e) => { setValor(formatCurrency(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("valor"); return n; }); }}
                            placeholder="0,00"
                            className={`input-field pl-9 ${validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}`}
                          />
                        </div>
                      </Field>

                      <Field label="Vencimento">
                        <input
                          type="text"
                          value={vencimento ? new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>
                    </div>

                    {/* Saldo disponível info */}
                    <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        Saldo disponível para resgate em{" "}
                        {resgateDateInput}:
                      </p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">
                        {calculandoSaldo
                          ? "Calculando..."
                          : saldoDisponivel !== null
                            ? fmtBrlDisplay(saldoDisponivel)
                            : "—"
                        }
                      </p>
                    </div>

                    {/* Fechar Posição checkbox */}
                    {saldoDisponivel != null && saldoDisponivel > 0 && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="fechar-posicao-cadastrar"
                          checked={fecharPosicao}
                          onCheckedChange={(checked) => handleFecharPosicaoChange(!!checked)}
                        />
                        <label htmlFor="fechar-posicao-cadastrar" className="text-sm font-medium text-foreground cursor-pointer">
                          Fechar Posição
                        </label>
                      </div>
                    )}

                    {/* Alert if valor > saldo */}
                    {valorResgateSuperaSaldo && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          O valor do resgate (R$ {valor}) excede o saldo disponível ({fmtBrlDisplay(saldoDisponivel)}).
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Row 2: Instituição, Emissor (readonly) */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Corretora">
                        <input
                          type="text"
                          value={getInstituicaoNome(instituicaoId)}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>

                      <Field label="Emissor">
                        <input
                          type="text"
                          value={getEmissorNome(emissorId)}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>
                    </div>

                    {/* Row 3: Modalidade, (Indexador), Taxa, Pagamento (readonly) */}
                    <div className={`grid gap-4 ${isPosFixado ? "grid-cols-4" : "grid-cols-3"}`}>
                      <Field label="Modalidade">
                        <input
                          type="text"
                          value={modalidade}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>

                      {isPosFixado && (
                        <Field label="Indexador">
                          <input
                            type="text"
                            value={indexador}
                            disabled
                            className="input-field opacity-60"
                          />
                        </Field>
                      )}

                      <Field label="Taxa">
                        <input
                          type="text"
                          value={taxa ? `${taxa}%` : "—"}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>

                      <Field label="Pagamento">
                        <input
                          type="text"
                          value={pagamento}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-md bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting || valorResgateSuperaSaldo}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(145,63%,32%)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[hsl(145,63%,28%)] transition-colors disabled:opacity-50"
                      >
                        <PlusCircle size={16} />
                        {submitting ? "Enviando..." : "Registrar Resgate"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Shared sub-components ── */

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  hasError,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  hasError?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input-field ${hasError ? "border-destructive ring-1 ring-destructive" : ""}`}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
