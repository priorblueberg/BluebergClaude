import { useState, useEffect, useMemo } from "react";
import { format, parse, isValid } from "date-fns";
import { PlusCircle, AlertTriangle, HelpCircle, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { buildNomeAtivo } from "@/lib/nomeAtivo";
import { toast } from "sonner";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { calcularRendaFixaDiario, opcoesPagamentoDoProduto } from "@/lib/rendaFixaEngine";
import { fatoresIpcaSeNecessario } from "@/lib/ipcaSeries";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import EntidadeSelect from "@/components/EntidadeSelect";
import FundoSelect from "@/components/FundoSelect";
import TituloSelect from "@/components/TituloSelect";
import { MOEDAS } from "@/lib/cambioEngine";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { proximoCodigoCustodia } from "@/lib/codigoCustodia";
import { parseQuantidade } from "@/lib/numeroBR";
import { ehDiaUtil, foraDaJanela, DATA_MINIMA_CARTEIRA, cotacaoMoeda, cotaFundo, saldosNaData, dataCotizacaoFundo, saldoEmQuantidade, fmtData } from "@/lib/validacaoBoleta";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Categoria {
  id: string;
  nome: string;
}
interface Produto {
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

const MODALIDADE_OPTIONS = ["Prefixado", "Pós Fixado"];

const INDEXADOR_OPTIONS = ["CDI", "CDI+", "IPCA+"];

// Categorias com fluxo de cadastro já implementado na boleta. As demais ficam
// visíveis no dropdown mas caem num placeholder até ganharem seu próprio fluxo.
// (Poupança é um produto dentro de Renda Fixa, não uma categoria à parte.)
const CATEGORIAS_IMPLEMENTADAS = ["Renda Fixa", "Fundos de Investimentos", "Moedas"];

// Moeda: compra e venda de saldo em moeda estrangeira, sem juros.
const TIPOS_MOVIMENTACAO_MOEDA = ["Compra", "Venda"];

// Fundo nao tem "Resgate Total" na boleta: quem encerra a posicao e o resgate
// que zera as cotas, como no mercado. Come-cotas e saida lancada pelo cotista.
const TIPOS_MOVIMENTACAO_FUNDO = ["Aplicação", "Resgate", "Come-Cotas"];

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


/**
 * A boleta. Era a pagina /cadastrar-transacao; virou conteudo de modal em 05/09/2026, aberta
 * pelo `BoletaProvider`. Por isso ela nao navega mais: quem fecha e quem abriu, via `onFechar`.
 */
export default function BoletaTransacao({
  editId = null,
  onFechar,
}: {
  /** Id da movimentacao em edicao; nulo cadastra uma nova. */
  editId?: string | null;
  onFechar?: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const { dataReferenciaISO, applyDataReferencia, maxDate } = useDataReferencia();
  /**
   * Janela em que uma operacao pode ser lancada: do inicio das carteiras ate a ultima data de
   * calculo. Os campos de data ficam limitados a ela, e a validacao repete o limite porque o
   * usuario pode digitar em vez de usar o seletor.
   */
  const maxDataISO = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, "0")}-${String(maxDate.getDate()).padStart(2, "0")}`;
  const limitesData = { min: DATA_MINIMA_CARTEIRA, max: maxDataISO };

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  // Resgate-specific state
  const [custodiaItems, setCustodiaItems] = useState<CustodiaItem[]>([]);
  const [selectedCustodiaId, setSelectedCustodiaId] = useState("");
  const [saldoDisponivel, setSaldoDisponivel] = useState<number | null>(null);
  const [calculandoSaldo, setCalculandoSaldo] = useState(false);
  const [resgateDateInput, setResgateDateInput] = useState("");
  const [resgateDateError, setResgateDateError] = useState<string | null>(null);
  const [resgateDate, setResgateDate] = useState<Date | undefined>();
  /** Se a data do resgate e dia util. Filtra a lista: fora de dia util so a Poupanca rende. */
  const [dataEhDiaUtil, setDataEhDiaUtil] = useState<boolean | null>(null);
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
  const [instituicaoNome, setInstituicaoNome] = useState("");
  const [emissorId, setEmissorId] = useState("");
  const [emissorNome, setEmissorNome] = useState("");
  const [modalidade, setModalidade] = useState("");
  const [indexador, setIndexador] = useState("");
  const [taxa, setTaxa] = useState("");
  const [pagamento, setPagamento] = useState("No Vencimento");
  const [vencimento, setVencimento] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editLoaded, setEditLoaded] = useState(false);
  /** Nome do titulo da movimentacao em edicao, so para exibicao. */
  const [nomeAtivoEmEdicao, setNomeAtivoEmEdicao] = useState("");
  /** Codigo de custodia da movimentacao em edicao, para propagar o nome ao papel inteiro. */
  const [codigoCustodiaEmEdicao, setCodigoCustodiaEmEdicao] = useState<string | null>(null);
  /** Titulo escolhido no cadastro compartilhado. Vazio + `cadastrandoNovoTitulo` = papel novo. */
  const [tituloId, setTituloId] = useState("");
  const [cadastrandoNovoTitulo, setCadastrandoNovoTitulo] = useState(false);
  // Fundos
  const [fundos, setFundos] = useState<{ id: string; nome: string; cnpj: string }[]>([]);
  const [fundoId, setFundoId] = useState("");
  const [qtdCotas, setQtdCotas] = useState("");
  /** Cota que a operacao vai usar, ja na data de cotizacao. Alimenta o campo somente-leitura. */
  const [cotaOp, setCotaOp] = useState<{
    dataCotizacao: string;
    cota: number | null;
    ultima: { data: string; valor: number } | null;
  } | null>(null);
  // Moedas
  const [moedaSel, setMoedaSel] = useState("");
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());

  // Derived
  const categoriaSelecionada = categorias.find((c) => c.id === categoriaId);
  const produtoSelecionado = produtos.find((p) => p.id === produtoId);
  const isRendaFixa = categoriaSelecionada?.nome === "Renda Fixa";
  const isFundo = categoriaSelecionada?.nome === "Fundos de Investimentos";
  const isMoeda = categoriaSelecionada?.nome === "Moedas";
  const isPoupanca = produtoSelecionado?.nome === "Poupança";
  // TEMPORARIO: usuario comum so cadastra titulo com juros no vencimento.
  // Alem disso, LC, RDB, RDC e DPGE nao pagam cupom nem para admin: a boleta do Gorila nem
  // oferece periodicidade neles (ver PRODUTOS_SEM_CUPOM no motor).
  const pagamentoOptions = useMemo(
    () => (isAdmin ? opcoesPagamentoDoProduto(produtoSelecionado?.nome) : ["No Vencimento"]),
    [isAdmin, produtoSelecionado?.nome],
  );
  const isPosFixado = modalidade === "Pós Fixado";
  const isEditing = !!editId;
  const isResgate = tipoMovimentacao === "Resgate";
  const isResgateTotal = tipoMovimentacao === "Resgate Total";
  const isAplicacao = tipoMovimentacao === "Aplicação";
  /** Saidas de renda fixa. Na edicao elas tem formulario proprio, nao o de aplicacao. */
  const ehSaidaRF = isResgate || isResgateTotal;
  /**
   * Edicao de resgate e de resgate total.
   *
   * Antes o Resgate nao caia em formulario nenhum (o de aplicacao o excluia, o de resgate
   * excluia edicao) e o modal abria vazio, sem campos e sem salvar. E o Resgate Total caia no
   * formulario de APLICACAO, com o valor resgatado rotulado "Valor Inicial".
   *
   * Aqui so aparece o que e da operacao - data e valor. O titulo e imutavel, como o ativo na
   * edicao do Gorila: as caracteristicas do papel pertencem a custodia, nao a movimentacao.
   */
  const showEdicaoSaidaRF = isEditing && isRendaFixa && ehSaidaRF;
  const selectedCustodia = custodiaItems.find((c) => c.id === selectedCustodiaId);

  /**
   * Titulos que o cliente tinha em custodia NA DATA da operacao - os unicos que podem ser
   * resgatados. Nao se resgata o que nao se tem: papel aplicado depois daquela data, ja
   * vencido ou ja encerrado por resgate total nao entra, e fora de dia util sobra so a
   * Poupanca, a unica que rende em dia nao util.
   */
  const custodiasNaData = useMemo(() => {
    if (!data || resgateDateError) return [];
    return custodiaItems.filter((c) => {
      if (c.data_inicio > data) return false;
      if (c.vencimento && c.vencimento < data) return false;
      if (c.resgate_total && c.resgate_total <= data) return false;
      if (dataEhDiaUtil === false && c.modalidade !== "Poupança") return false;
      return true;
    });
  }, [custodiaItems, data, dataEhDiaUtil, resgateDateError]);
  // Etapa 1 do destravamento: a categoria escolhida já tem fluxo próprio na boleta?
  const categoriaImplementada = !categoriaSelecionada || CATEGORIAS_IMPLEMENTADAS.includes(categoriaSelecionada.nome);

  // Trocar para um produto sem cupom (LC, RDB, RDC, DPGE) tem que limpar a periodicidade que
  // ja estivesse escolhida - senao o titulo entra com cupom que o Gorila nao paga, e o select
  // fica mostrando uma opcao que nem consta mais da lista.
  useEffect(() => {
    if (!pagamentoOptions.includes(pagamento)) setPagamento(pagamentoOptions[0]);
  }, [pagamentoOptions, pagamento]);

  // Load categorias on mount — todas as categorias ativas. O fluxo de cada uma é
  // despachado abaixo; categorias sem fluxo próprio caem num placeholder (etapa 1
  // do destravamento multi-categoria). Só auto-seleciona se houver uma única.
  useEffect(() => {
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("ativa", true)
      .order("nome")
      .then(({ data }) => {
        if (data) {
          // TEMPORARIO: usuario comum opera Renda Fixa e Fundos; as demais
          // categorias seguem fechadas ate ganharem motor. Admin ve tudo.
          const LIBERADAS = ["Renda Fixa", "Fundos de Investimentos", "Moedas"];
          const visiveis = isAdmin ? data : data.filter((c) => LIBERADAS.includes(c.nome));
          setCategorias(visiveis);
          if (visiveis.length === 1 && !editId) {
            setCategoriaId(visiveis[0].id);
          }
        }
      });
  }, [isAdmin, editId]);

  // Fundos disponiveis (base publica da CVM, compartilhada por todos).
  useEffect(() => {
    if (!isFundo) return;
    supabase
      .from("cadastro_de_fundos")
      .select("id, nome_curto, cnpj_classe")
      .eq("ativo", true)
      .order("nome_curto")
      .then(({ data }) => {
        if (data) setFundos(data.map((f: any) => ({ id: f.id, nome: f.nome_curto, cnpj: f.cnpj_classe })));
      });
  }, [isFundo]);

  // A cota mostrada e a MESMA que a gravacao vai usar: data de cotizacao pelo cadastro do
  // fundo, cota da serie da CVM naquela data. Sem isso a tela mostraria a cota do dia da
  // operacao e o registro sairia com outra.
  useEffect(() => {
    if (!isFundo || !fundoId || !data || !tipoMovimentacao) {
      setCotaOp(null);
      return;
    }
    let vivo = true;
    (async () => {
      const dataCotizacao = await dataCotizacaoFundo(fundoId, data, tipoMovimentacao);
      const { naData, ultima } = await cotaFundo(fundoId, dataCotizacao);
      if (vivo) setCotaOp({ dataCotizacao, cota: naData, ultima });
    })();
    return () => {
      vivo = false;
    };
  }, [isFundo, fundoId, data, tipoMovimentacao]);

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

  // Emissores e instituicoes nao sao carregados aqui: as duas tabelas tem ~1,6 mil
  // nomes (lista do Banco Central) e quem busca e o EntidadeSelect, server-side.

  // Load custodia items when Resgate is selected
  useEffect(() => {
    if (!(isResgate || ehSaidaRF) || !categoriaId || !user) {
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
  }, [isResgate, ehSaidaRF, categoriaId, user]);

  // Auto-fill fields when custodia item selected
  useEffect(() => {
    if (!selectedCustodia) return;
    setProdutoId(selectedCustodia.produto_id);
    setInstituicaoId(selectedCustodia.instituicao_id || "");
    setInstituicaoNome("");
    if (selectedCustodia.instituicao_id) {
      supabase
        .from("instituicoes")
        .select("nome")
        .eq("id", selectedCustodia.instituicao_id)
        .maybeSingle()
        .then(({ data }) => setInstituicaoNome(data?.nome ?? ""));
    }
    setEmissorId(selectedCustodia.emissor_id || "");
    setEmissorNome("");
    if (selectedCustodia.emissor_id) {
      supabase
        .from("emissores")
        .select("nome")
        .eq("id", selectedCustodia.emissor_id)
        .maybeSingle()
        .then(({ data }) => setEmissorNome(data?.nome ?? ""));
    }
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

  /**
   * Data do resgate: aqui ficam so as checagens que NAO dependem do titulo.
   *
   * As que dependiam (anterior a aplicacao, posterior ao vencimento, depois do resgate total,
   * dia util) eram feitas depois de escolher o titulo, uma a uma, e o usuario so descobria o
   * problema no fim. Agora a data vem antes e elas viraram filtro da lista: o titulo invalido
   * naquela data simplesmente nao aparece.
   */
  const definirDataResgate = async (d: Date) => {
    setResgateDate(d);
    setSelectedCustodiaId("");
    setSaldoDisponivel(null);
    setFecharPosicao(false);
    setValor("");
    setResgateDateError(null);
    setDataEhDiaUtil(null);

    const dateISO = format(d, "yyyy-MM-dd");
    setData(dateISO);

    const foraJanela = foraDaJanela(dateISO, maxDataISO);
    if (foraJanela) {
      setResgateDateError(foraJanela);
      return;
    }

    const { data: cal } = await supabase
      .from("calendario_dias_uteis")
      .select("dia_util")
      .eq("data", dateISO)
      .maybeSingle();
    if (!cal) {
      setResgateDateError("Data não encontrada no calendário.");
      return;
    }
    setDataEhDiaUtil(!!(cal as any).dia_util);
  };

  /** Saldo do titulo na data, pelo motor. Roda quando o titulo e escolhido. */
  /**
   * Saldo do titulo na data. `ignorarId` tira a propria movimentacao da conta - na EDICAO o
   * numero util e "quanto havia disponivel antes deste resgate", nao o saldo ja liquido dele.
   */
  const calcularSaldoResgate = async (selectedCustodia: CustodiaItem, dateISO: string, ignorarId?: string | null) => {
    if (!user) return;
    setSaldoDisponivel(null);
    const isRendaFixaEngine = (selectedCustodia.modalidade === "Prefixado" || selectedCustodia.modalidade === "Pos Fixado" || selectedCustodia.modalidade === "Pós Fixado" || selectedCustodia.modalidade === "Mista") && selectedCustodia.taxa && selectedCustodia.preco_unitario;

    if (isRendaFixaEngine) {
      setCalculandoSaldo(true);
      try {
        const isPosFixadoCDI = ((selectedCustodia.modalidade === "Pos Fixado" || selectedCustodia.modalidade === "Pós Fixado") && selectedCustodia.indexador === "CDI") || (selectedCustodia.modalidade === "Mista" && selectedCustodia.indexador === "CDI");

        // O calendario tem que ir ate o VENCIMENTO, nao ate a data do resgate: o
        // motor usa esse calendario para montar as datas de pagamento de cupom,
        // que sao contadas a partir do vencimento. Com o calendario curto, as
        // datas saiam erradas e o titulo aparecia com o saldo travado no valor
        // aplicado - um CDB de 112% do CDI mostrava R$ 140.000,00 em vez dos
        // R$ 149,4 mil que tinha rendido.
        const fimSerie = [dateISO, selectedCustodia.vencimento ?? "", selectedCustodia.resgate_total ?? ""]
          .reduce((maior, d) => (d > maior ? d : maior), dateISO);

        // Paginado: acima de 1000 dias corridos a serie vinha cortada e o motor
        // devolvia saldo errado, que vira o teto da validacao do valor resgatado.
        const calQuery = fetchAllRows((de, ate) => supabase
          .from("calendario_dias_uteis")
          .select("data, dia_util")
          .gte("data", selectedCustodia.data_inicio)
          .lte("data", fimSerie)
          .order("data")
          .range(de, ate)).then((data) => ({ data }));
        const movQuery = (ignorarId
          ? supabase.from("movimentacoes").select("data, tipo_movimentacao, valor")
              .eq("codigo_custodia", selectedCustodia.codigo_custodia).eq("user_id", user.id)
              .neq("id", ignorarId).order("data")
          : supabase.from("movimentacoes").select("data, tipo_movimentacao, valor")
              .eq("codigo_custodia", selectedCustodia.codigo_custodia).eq("user_id", user.id)
              .order("data"));
        const custQuery = supabase
          .from("custodia")
          .select("resgate_total")
          .eq("codigo_custodia", selectedCustodia.codigo_custodia)
          .eq("user_id", user.id)
          .maybeSingle();
        const cdiQuery = isPosFixadoCDI
          ? fetchAllRows((de, ate) => supabase
              .from("historico_cdi")
              .select("data, taxa_anual")
              .gte("data", selectedCustodia.data_inicio)
              .lte("data", dateISO)
              .order("data")
              .range(de, ate)).then((data) => ({ data }))
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
          // Ao ignorar a propria movimentacao, tem que ignorar tambem o encerramento que ELA
          // provoca: `custodia.resgate_total` guarda a data dela, e com ele a posicao ja chega
          // zerada ao dia - a caixa mostrava "R$ 0,00 sem contar esta movimentacao".
          dataResgateTotal: (ignorarId && isResgateTotal) ? null : (custRes.data?.resgate_total ?? null),
          pagamento: selectedCustodia.pagamento,
          vencimento: selectedCustodia.vencimento,
          indexador: selectedCustodia.indexador,
          cdiRecords,
          ipcaFatores: await fatoresIpcaSeNecessario(
            selectedCustodia.indexador, selectedCustodia.vencimento, calendario, selectedCustodia.data_inicio),
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

  // Saldo so pode ser calculado com titulo E data. Antes o calculo estava dentro do handler
  // da data, que exigia o titulo ja escolhido - com a ordem invertida, virou efeito.
  useEffect(() => {
    if (!(isResgate || showEdicaoSaidaRF) || !selectedCustodia || !data || resgateDateError) return;
    calcularSaldoResgate(selectedCustodia, data, showEdicaoSaidaRF ? editId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustodiaId, data, showEdicaoSaidaRF]);

  /** Handle typed resgate date input with mask */
  const handleResgateDateInputChange = (rawValue: string) => {
    const masked = applyDateMask(rawValue);
    setResgateDateInput(masked);
    clearResgateCalculated();
    setData("");

    const parsed = parseDateInput(masked);
    if (parsed) {
      definirDataResgate(parsed);
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
    definirDataResgate(d);
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
        onFechar?.();
        return;
      }

      setCategoriaId(mov.categoria_id);
      setTipoMovimentacao(mov.tipo_movimentacao);
      setProdutoId(mov.produto_id);
      setData(mov.data);
      setValor(mov.valor ? formatCurrency(Math.round(mov.valor * 100).toString()) : "");
      setPrecoUnitario(mov.preco_unitario ? formatCurrency(Math.round(mov.preco_unitario * 100).toString()) : "1.000,00");
      setInstituicaoId(mov.instituicao_id || "");
      setInstituicaoNome("");
      if (mov.instituicao_id) {
        const { data: instituicao } = await supabase
          .from("instituicoes")
          .select("nome")
          .eq("id", mov.instituicao_id)
          .maybeSingle();
        setInstituicaoNome(instituicao?.nome ?? "");
      }
      setEmissorId(mov.emissor_id || "");
      setEmissorNome("");
      if (mov.emissor_id) {
        const { data: emissor } = await supabase
          .from("emissores")
          .select("nome")
          .eq("id", mov.emissor_id)
          .maybeSingle();
        setEmissorNome(emissor?.nome ?? "");
      }
      // Os termos vem do cadastro. As colunas duplicadas na movimentacao nao existem mais.
      const tit = (mov as any).titulo_id
        ? (await supabase
            .from("cadastro_de_titulos")
            .select("modalidade, indexador, taxa, vencimento, pagamento, preco_emissao")
            .eq("id", (mov as any).titulo_id)
            .maybeSingle()).data as any
        : null;
      setModalidade(tit?.modalidade ?? "");
      setIndexador(tit?.indexador ?? "");
      setTaxa(tit?.taxa != null ? String(tit.taxa) : "");
      setPagamento(tit?.pagamento ?? "No Vencimento");
      setVencimento(tit?.vencimento ?? "");
      setTituloId((mov as any).titulo_id ?? "");
      // Fundo e moeda tambem sao editaveis: sem isto a tela de edicao abria vazia.
      setFundoId((mov as any).fundo_id || "");
      setMoedaSel((mov as any).moeda || "");
      setQtdCotas(mov.quantidade != null ? String(mov.quantidade).replace(".", ",") : "");
      setNomeAtivoEmEdicao(mov.nome_ativo || "");
      setCodigoCustodiaEmEdicao((mov as any).codigo_custodia ?? null);
      setEditLoaded(true);
    })();
  }, [editId, editLoaded, categorias]);

  // Step visibility
  const showTipoMovimentacao = !!categoriaId && (isRendaFixa || isFundo || isMoeda);
  const showAplicacaoFields = showTipoMovimentacao && isRendaFixa && !!produtoId && (isAplicacao || (isEditing && !!tipoMovimentacao && !ehSaidaRF));

  // Na edicao de uma saida, casa a custodia pelo codigo da movimentacao. E o que destrava o
  // calculo do saldo, que e escrito para o fluxo de criacao (onde o usuario escolhe o titulo).
  useEffect(() => {
    if (!showEdicaoSaidaRF || !codigoCustodiaEmEdicao || custodiaItems.length === 0) return;
    const achada = custodiaItems.find((c) => String(c.codigo_custodia) === String(codigoCustodiaEmEdicao));
    if (achada && achada.id !== selectedCustodiaId) setSelectedCustodiaId(achada.id);
  }, [showEdicaoSaidaRF, codigoCustodiaEmEdicao, custodiaItems, selectedCustodiaId]);

  /**
   * Num aporte adicional, os termos do papel sao somente leitura.
   *
   * Vencimento, emissor, modalidade, indexador, taxa e periodicidade descrevem o TITULO, e o
   * titulo e definido pela aplicacao inicial - `syncCustodia` le os termos de la. Editando-os
   * numa Aplicacao secundaria, a movimentacao passava a divergir da custodia e ainda renomeava
   * o ativo, deixando a mesma custodia com movimentacoes de nomes diferentes na lista.
   *
   * E o mesmo principio da edicao do Gorila, medido em 06/09/2026: la o ativo e travado e so
   * se edita o que e da operacao. A diferenca e que na Aplicacao Inicial nos mantemos os
   * termos editaveis, porque e ali que eles nascem - o Gorila edita isso no cadastro do ativo,
   * que nos nao temos separado.
   */
  /**
   * Termos do papel somente leitura.
   *
   * Dois casos: aporte adicional em edicao (os termos vem da aplicacao inicial) e titulo
   * escolhido do cadastro (os termos sao do emissor, nao de quem compra). Num CDB emitido a
   * 102% do CDI com vencimento em 31/12/2029, quem define isso foi o banco - o cliente so
   * decide quando e quanto aplicar.
   */
  const travarTermosDoPapel = (isEditing && isRendaFixa && isAplicacao) || (!!tituloId && !cadastrandoNovoTitulo);
  const showResgateFields = showTipoMovimentacao && isRendaFixa && isResgate && !isEditing;
  const showFundoFields = isFundo && !!tipoMovimentacao;

  /** Come-cotas e a unica movimentacao de fundo com quantidade digitada (vem do extrato). */
  const ehComeCotas = tipoMovimentacao === "Come-Cotas";

  /** Saida (resgate, come-cotas, venda) so pode incidir sobre o que existia na data. */
  const ehSaida = !!tipoMovimentacao && !["Aplicação", "Compra"].includes(tipoMovimentacao);

  // Saldo por ativo na data. Enquanto for null a lista fica travada, porque oferecer tudo
  // enquanto carrega deixaria escolher um ativo que nao existia naquele dia.
  const [comSaldo, setComSaldo] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!user || !ehSaida || !data || !(isFundo || isMoeda)) {
      setComSaldo(null);
      return;
    }
    let vivo = true;
    saldosNaData(user.id, data, isFundo ? "fundo_id" : "moeda").then((s) => {
      if (vivo) setComSaldo(s);
    });
    return () => { vivo = false; };
  }, [user, ehSaida, data, isFundo, isMoeda]);

  /** Cotacao da moeda na data, so para mostrar o saldo tambem em reais. */
  const [cotacaoOp, setCotacaoOp] = useState<number | null>(null);
  useEffect(() => {
    if (!isMoeda || !moedaSel || !data) {
      setCotacaoOp(null);
      return;
    }
    let vivo = true;
    cotacaoMoeda(moedaSel, data).then(({ naData, ultima }) => {
      if (vivo) setCotacaoOp(naData ?? ultima?.valor ?? null);
    });
    return () => { vivo = false; };
  }, [isMoeda, moedaSel, data]);

  /** Saldo do ativo escolhido na data: em cotas no fundo, na moeda estrangeira no cambio. */
  const saldoDaSaida = useMemo(() => {
    if (!ehSaida || !comSaldo) return null;
    const chave = isFundo ? fundoId : moedaSel;
    return chave ? comSaldo.get(chave) ?? null : null;
  }, [ehSaida, comSaldo, isFundo, fundoId, moedaSel]);

  // Mudou a data numa saida: o ativo escolhido pode nao existir na nova data, entao sai.
  useEffect(() => {
    if (!ehSaida) return;
    if (fundoId && comSaldo && !comSaldo.has(fundoId)) setFundoId("");
    if (moedaSel && comSaldo && !comSaldo.has(moedaSel)) setMoedaSel("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comSaldo, ehSaida]);

  /** Fundos oferecidos: todos na aplicacao, so os que tinham cotas na data nas saidas. */
  const fundosDisponiveis = useMemo(
    () => (ehSaida ? fundos.filter((f) => comSaldo?.has(f.id)) : fundos),
    [fundos, ehSaida, comSaldo],
  );

  const moedasDisponiveis = useMemo(
    () => (ehSaida ? MOEDAS.filter((m) => comSaldo?.has(m.codigo)) : MOEDAS),
    [ehSaida, comSaldo],
  );

  /** Quantidade de cotas da operacao: valor / cota. Exibida, nunca digitada. */
  const qtdCotasDerivada = useMemo(() => {
    const v = parseCurrencyToNumber(valor);
    const c = cotaOp?.cota;
    if (!c || !v) return null;
    return v / c;
  }, [valor, cotaOp]);
  const showMoedaFields = isMoeda && !!tipoMovimentacao;
  const showPoupancaFields = isPoupanca && isAplicacao;

  const resetForm = () => {
    setCategoriaId("");
    setProdutoId("");
    setTipoMovimentacao("");
    setData("");
    setValor("");
    setPrecoUnitario("1.000,00");
    setInstituicaoId("");
    setInstituicaoNome("");
    setEmissorId("");
    setEmissorNome("");
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
      onFechar?.();
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error("Usuário não autenticado. Faça login novamente.");
      return;
    }

    // ── Edicao de saida de renda fixa (Resgate e Resgate Total) ──
    // So data e valor mudam. O titulo, o emissor e os termos do papel nao pertencem a esta
    // movimentacao, entao nao sao tocados aqui.
    if (showEdicaoSaidaRF) {
      const faltando = new Set<string>();
      if (!data) faltando.add("data");
      if (!valor || parseCurrencyToNumber(valor) <= 0) faltando.add("valor");
      if (faltando.size > 0) {
        setValidationErrors(faltando);
        toast.error("Preencha a data e o valor.");
        return;
      }
      setValidationErrors(new Set());

      const foraJanela = foraDaJanela(data, maxDataISO);
      if (foraJanela) {
        toast.error(foraJanela);
        return;
      }
      if (modalidade !== "Poupança" && !(await ehDiaUtil(data))) {
        toast.error("A data da operação deve ser um dia útil.");
        return;
      }

      setSubmitting(true);
      try {
        const valorNum = parseCurrencyToNumber(valor);
        const { error } = await supabase
          .from("movimentacoes")
          .update({ data, valor: valorNum })
          .eq("id", editId);
        if (error) throw error;

        await fullSyncAfterMovimentacao(editId!, categoriaId, user.id, dataReferenciaISO);
        applyDataReferencia();
        toast.success(`${tipoMovimentacao} atualizado com sucesso!`);
        onFechar?.();
      } catch (err) {
        console.error(err);
        toast.error("Erro ao atualizar a movimentação.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── Moedas ──
    if (isMoeda) {
      const faltando = new Set<string>();
      if (!moedaSel) faltando.add("moedaSel");
      if (!data) faltando.add("data");
      if (!valor || parseCurrencyToNumber(valor) <= 0) faltando.add("valor");
      if (!instituicaoId) faltando.add("instituicaoId");
      if (faltando.size > 0) {
        setValidationErrors(faltando);
        toast.error("Preencha todos os campos obrigatórios.");
        return;
      }
      setValidationErrors(new Set());

      const foraJanela = foraDaJanela(data, maxDataISO);
      if (foraJanela) {
        toast.error(foraJanela);
        return;
      }
      if (!(await ehDiaUtil(data))) {
        toast.error("A data da operação deve ser um dia útil.");
        return;
      }

      const valorNum = parseCurrencyToNumber(valor);
      const qtdInformada = parseQuantidade(qtdCotas);

      // Sem quantidade informada, ela sai da cotacao do dia: se o BCB ainda nao
      // publicou, gravar agora produziria quantidade errada em silencio.
      const { naData: cotacaoDoDia, ultima: ultimaCotacao } = await cotacaoMoeda(moedaSel, data);
      if (qtdInformada == null && cotacaoDoDia == null) {
        toast.error(
          ultimaCotacao
            ? `Não há cotação publicada para ${fmtData(data)}. A última é de ${fmtData(ultimaCotacao.data)} - informe a quantidade na moeda para gravar.`
            : "Não há cotação disponível para essa moeda nessa data. Informe a quantidade na moeda.",
        );
        return;
      }

      const qtdOperacao = qtdInformada ?? (cotacaoDoDia ? valorNum / cotacaoDoDia : null);

      setSubmitting(true);

      try {
        const moeda = MOEDAS.find((m) => m.codigo === moedaSel)!;
        const qtd = qtdOperacao;
        const nomeAtivo = moeda.nome;

        // Mesma moeda na mesma instituição é a mesma posição.
        const { data: existentes } = await supabase
          .from("movimentacoes")
          .select("codigo_custodia")
          .eq("user_id", user.id)
          .eq("moeda", moedaSel)
          .eq("instituicao_id", instituicaoId)
          .not("codigo_custodia", "is", null)
          .limit(1);

        let codigoCustodia: string;
        if (existentes && existentes.length > 0) {
          codigoCustodia = String(existentes[0].codigo_custodia);
        } else {
          codigoCustodia = await proximoCodigoCustodia(user.id);
        }

        // Venda nao pode passar do saldo: o motor aceita posicao negativa e ela
        // segue rendendo, entao o erro so apareceria semanas depois na carteira.
        if (tipoMovimentacao === "Venda" && qtd != null) {
          const saldo = await saldoEmQuantidade(codigoCustodia, user.id, data, editId);
          if (qtd > saldo + 1e-8) {
            setSubmitting(false);
            toast.error(
              `Venda de ${qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${moedaSel} maior que o saldo de ${saldo.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${moedaSel} em ${fmtData(data)}.`,
            );
            return;
          }
        }

        if (isEditing) {
          const { error: errUp } = await supabase.from("movimentacoes").update({
            instituicao_id: instituicaoId,
            data,
            valor: valorNum,
            quantidade: qtd,
            preco_unitario: cotacaoDoDia,
          }).eq("id", editId);
          if (errUp) throw errUp;
          await fullSyncAfterMovimentacao(editId!, categoriaId, user.id, dataReferenciaISO);
          applyDataReferencia();
          toast.success("Operação de câmbio atualizada com sucesso!");
          onFechar?.();
          return;
        }

        const { data: inserida, error } = await supabase.from("movimentacoes").insert({
          categoria_id: categoriaId,
          produto_id: produtos[0]?.id ?? null,
          instituicao_id: instituicaoId,
          moeda: moedaSel,
          codigo_custodia: codigoCustodia,
          nome_ativo: nomeAtivo,
          data,
          tipo_movimentacao: tipoMovimentacao,
          valor: valorNum,
          quantidade: qtd,
          preco_unitario: cotacaoDoDia,
          user_id: user.id,
          origem: "manual",
        }).select("id").single();

        if (error) throw error;

        await fullSyncAfterMovimentacao(inserida.id, categoriaId, user.id, dataReferenciaISO);
        applyDataReferencia();
        toast.success("Operação de câmbio cadastrada com sucesso!");
        resetForm();
        setMoedaSel("");
        setQtdCotas("");
      } catch (err: any) {
        toast.error("Erro ao cadastrar operação de câmbio.");
        console.error(err);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── Fundos de Investimentos ──
    if (isFundo) {
      const faltando = new Set<string>();
      if (!fundoId) faltando.add("fundoId");
      if (!data) faltando.add("data");
      if (!valor || parseCurrencyToNumber(valor) <= 0) faltando.add("valor");
      if (!instituicaoId) faltando.add("instituicaoId");
      // So o come-cotas tem quantidade digitada; nos outros ela e derivada da cota.
      if (ehComeCotas && parseQuantidade(qtdCotas) == null) faltando.add("qtdCotas");
      if (faltando.size > 0) {
        setValidationErrors(faltando);
        toast.error("Preencha todos os campos obrigatórios.");
        return;
      }
      setValidationErrors(new Set());

      const foraJanela = foraDaJanela(data, maxDataISO);
      if (foraJanela) {
        toast.error(foraJanela);
        return;
      }
      if (!(await ehDiaUtil(data))) {
        toast.error("A data da operação deve ser um dia útil.");
        return;
      }

      setSubmitting(true);

      try {
        const fundo = fundos.find((f) => f.id === fundoId)!;
        const valorNum = parseCurrencyToNumber(valor);

        const dataCotizacao = await dataCotizacaoFundo(fundoId, data, tipoMovimentacao);
        const { naData: cotaDoDia, ultima: ultimaCota } = await cotaFundo(fundoId, dataCotizacao);

        // Em aplicacao e resgate a quantidade e exatamente valor / cota, sem spread nem taxa
        // que justifiquem outro numero (ao contrario do cambio) - por isso ela nao e digitada,
        // e sem a cota divulgada a operacao nao pode ser lancada.
        //
        // Come-cotas e o oposto: quem calcula quantas cotas cancelar e o administrador, a
        // partir do ganho de cada cotista. Nos nao temos como derivar isso, entao a quantidade
        // vem do extrato, digitada.
        let qtd: number;
        if (ehComeCotas) {
          qtd = parseQuantidade(qtdCotas)!;
        } else {
          if (cotaDoDia == null) {
            setSubmitting(false);
            toast.error(
              ultimaCota
                ? `O fundo ainda não divulgou a cota de ${fmtData(dataCotizacao)}. A última é de ${fmtData(ultimaCota.data)}: lance a operação quando a cota sair.`
                : "Não há cota disponível para esse fundo nessa data.",
            );
            return;
          }
          qtd = valorNum / cotaDoDia;
        }

        // Fundo que ja esta na carteira reaproveita o codigo de custodia.
        const { data: existentes } = await supabase
          .from("movimentacoes")
          .select("codigo_custodia")
          .eq("user_id", user.id)
          .eq("fundo_id", fundoId)
          .not("codigo_custodia", "is", null)
          .limit(1);

        let codigoCustodia: string;
        let tipoFinal = tipoMovimentacao;
        if (existentes && existentes.length > 0) {
          codigoCustodia = String(existentes[0].codigo_custodia);
        } else {
          codigoCustodia = await proximoCodigoCustodia(user.id);
          if (tipoMovimentacao === "Aplicação") tipoFinal = "Aplicação Inicial";
        }

        // Resgate e come-cotas nao podem passar do saldo de cotas: posicao
        // negativa segue rendendo e o erro so aparece semanas depois.
        if (tipoMovimentacao !== "Aplicação") {
          const saldo = await saldoEmQuantidade(codigoCustodia, user.id, dataCotizacao, editId);
          if (qtd > saldo + 1e-8) {
            setSubmitting(false);
            const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
            toast.error(
              `${tipoMovimentacao} de ${fmtQtd(qtd)} cotas maior que o saldo de ${fmtQtd(saldo)} cotas em ${fmtData(dataCotizacao)}.`,
            );
            return;
          }
        }

        if (isEditing) {
          const { error: errUp } = await supabase.from("movimentacoes").update({
            instituicao_id: instituicaoId,
            data,
            data_cotizacao: dataCotizacao,
            valor: valorNum,
            quantidade: qtd,
            preco_unitario: cotaDoDia,
          }).eq("id", editId);
          if (errUp) throw errUp;
          await fullSyncAfterMovimentacao(editId!, categoriaId, user.id, dataReferenciaISO);
          applyDataReferencia();
          toast.success("Movimentação de fundo atualizada com sucesso!");
          onFechar?.();
          return;
        }

        const { data: inserida, error } = await supabase.from("movimentacoes").insert({
          categoria_id: categoriaId,
          produto_id: produtos[0]?.id ?? null,
          fundo_id: fundoId,
          instituicao_id: instituicaoId,
          codigo_custodia: codigoCustodia,
          nome_ativo: fundo.nome,
          data,
          data_cotizacao: dataCotizacao,
          tipo_movimentacao: tipoFinal,
          valor: valorNum,
          quantidade: qtd,
          preco_unitario: cotaDoDia,
          user_id: user.id,
          origem: "manual",
        }).select("id").single();

        if (error) throw error;

        await fullSyncAfterMovimentacao(inserida.id, categoriaId, user.id, dataReferenciaISO);
        applyDataReferencia();
        toast.success("Movimentação de fundo cadastrada com sucesso!");
        resetForm();
        setFundoId("");
        setQtdCotas("");
      } catch (err: any) {
        toast.error("Erro ao cadastrar movimentação do fundo.");
        console.error(err);
      } finally {
        setSubmitting(false);
      }
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
      // Ou escolheu um titulo do cadastro, ou declarou que esta cadastrando um novo.
      if (!isEditing && !tituloId && !cadastrandoNovoTitulo) requiredFields.tituloId = "";
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

    // Aplicacao com data futura deixa a custodia depois da data de referencia e
    // a carteira aparece como "Nao Iniciada"; o resgate ja barrava isso.
    const foraJanela = foraDaJanela(data, maxDataISO);
    if (foraJanela) {
      toast.error(foraJanela);
      return;
    }

    if (!isPoupanca && vencimento && vencimento <= data) {
      toast.error("O vencimento deve ser posterior à Data de Transação.");
      return;
    }

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
      // TEMPORARIO: trava a periodicidade do usuario comum tambem na gravacao,
      // nao so na lista do campo.
      const pagamentoToSave = isAdmin ? pagamento : "No Vencimento";

      // Mapeamento: "Pós Fixado" + "CDI+" → "Mista" + "CDI"; o mesmo vale para
      // "IPCA+" → "Mista" + "IPCA". A modalidade "Mista" é a de índice mais spread,
      // e o indexador diz qual índice.
      let modalidadeToSave = isPoupanca ? "Poupança" : modalidade;
      let indexadorToSave = isPosFixado ? indexador : null;
      if (modalidade === "Pós Fixado" && indexador === "CDI+") {
        modalidadeToSave = "Mista";
        indexadorToSave = "CDI";
      } else if (modalidade === "Pós Fixado" && indexador === "IPCA+") {
        modalidadeToSave = "Mista";
        indexadorToSave = "IPCA";
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
          nome_ativo: nomeAtivo,
          quantidade,
          valor_extrato: valorExtrato,
        }).eq("id", editId);

        if (error) throw error;

        // O nome do ativo e derivado dos termos do papel, entao vale para a custodia inteira.
        // Antes so a linha editada e a custodia eram renomeadas, e a lista passava a mostrar o
        // MESMO papel com dois nomes - o que torna impossivel distinguir as linhas na hora de
        // editar ou excluir, que foi como eu apaguei a transacao errada no Gorila em 06/09/2026.
        if (codigoCustodiaEmEdicao) {
          const { error: errNome } = await supabase
            .from("movimentacoes")
            .update({ nome_ativo: nomeAtivo })
            .eq("codigo_custodia", codigoCustodiaEmEdicao)
            .eq("user_id", user!.id);
          if (errNome) console.error("nao foi possivel propagar o nome do ativo", errNome);
        }

        await fullSyncAfterMovimentacao(editId!, categoriaId, user!.id, dataReferenciaISO);
        applyDataReferencia();

        toast.success("Transação atualizada com sucesso!");
        onFechar?.();
      } else {
        // Texto, como a coluna: o codigo pode ser legado nao numerico.
        let codigoCustodia: string;
        let tipoFinal = tipoMovimentacao;

        if (nomeAtivo) {
          // O nome do ativo NAO carrega o custodiante, entao o mesmo titulo
          // comprado em duas corretoras caia na mesma posicao. A instituicao
          // entra na busca para as duas ficarem separadas.
          const { data: existing } = await supabase
            .from("movimentacoes")
            .select("codigo_custodia")
            .eq("user_id", user.id)
            .eq("nome_ativo", nomeAtivo)
            .eq("instituicao_id", instituicaoId)
            .not("codigo_custodia", "is", null)
            .limit(1);

          if (existing && existing.length > 0) {
            codigoCustodia = String(existing[0].codigo_custodia);
          } else {
            codigoCustodia = await proximoCodigoCustodia(user.id);
            tipoFinal = "Aplicação Inicial";
          }
        } else {
          codigoCustodia = "";
        }

        // Resolve o titulo no cadastro compartilhado. Papel novo entra aqui, e a partir dai
        // fica disponivel para qualquer cliente - a chave unica garante que dois clientes que
        // comprem o MESMO papel caiam no mesmo registro, em vez de duplica-lo.
        let tituloResolvido: string | null = tituloId || null;
        if (!isPoupanca && !tituloResolvido && vencimento && modalidadeToSave && taxaNum != null) {
          const identidade = {
            produto_id: produtoId,
            emissor_id: emissorId || null,
            modalidade: modalidadeToSave,
            indexador: indexadorToSave,
            taxa: taxaNum,
            vencimento,
            pagamento: pagamentoToSave,
          };
          const { data: jaExiste } = await supabase
            .from("cadastro_de_titulos")
            .select("id")
            .match(identidade as any)
            .maybeSingle();
          if (jaExiste) {
            tituloResolvido = (jaExiste as any).id;
          } else {
            const { data: criado, error: errTitulo } = await supabase
              .from("cadastro_de_titulos")
              .insert({ ...identidade, preco_emissao: puNum, nome: nomeAtivo, criado_por: user.id } as any)
              .select("id")
              .maybeSingle();
            // Bloqueante: com os termos vivendo no cadastro, uma operacao sem titulo ficaria
            // sem onde guarda-los. Melhor recusar do que gravar pela metade.
            if (errTitulo || !criado) {
              console.error("nao foi possivel cadastrar o titulo", errTitulo);
              setSubmitting(false);
              toast.error("Não foi possível cadastrar o título. A operação não foi gravada.");
              return;
            }
            tituloResolvido = (criado as any).id;
          }
        }

        const { error } = await supabase.from("movimentacoes").insert({
          categoria_id: categoriaId,
          tipo_movimentacao: tipoFinal,
          data,
          produto_id: produtoId,
          titulo_id: tituloResolvido,
          valor: valorNum,
          preco_unitario: isPoupanca ? null : puNum,
          instituicao_id: instituicaoId,
          // Poupanca nao tem emissor: o vinculo e com a instituicao onde a conta
          // existe (instituicao_id acima + nome_ativo). Gravar o id de
          // instituicoes aqui estourava a FK emissor_id -> emissores.
          emissor_id: isPoupanca ? null : emissorId || null,
          nome_ativo: nomeAtivo,
          codigo_custodia: nomeAtivo ? codigoCustodia : null,
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

        // DEPOIS do sync: e ele que cria a custodia. Antes, o update nao encontrava linha
        // nenhuma e o vinculo se perdia calado - o titulo ficava cadastrado e a custodia orfa.
        if (tituloResolvido && codigoCustodia) {
          await supabase.from("custodia").update({ titulo_id: tituloResolvido })
            .eq("codigo_custodia", codigoCustodia).eq("user_id", user.id);
        }

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

  const fmtBrlDisplay = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const valorResgateSuperaSaldo =
    isResgate && saldoDisponivel !== null && parseCurrencyToNumber(valor) > saldoDisponivel && valor !== "";

  return (
    <div className="space-y-6">

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
                options={(isMoeda ? TIPOS_MOVIMENTACAO_MOEDA : isFundo ? TIPOS_MOVIMENTACAO_FUNDO : TIPOS_MOVIMENTACAO).map((t) => ({
                  value: t,
                  label: t,
                  disabled: !isFundo && !isMoeda && t !== "Aplicação" && t !== "Resgate",
                }))}
              />
            </Field>
          )}
        </div>

        {/* Categoria selecionada cujo fluxo ainda não foi implementado (etapa 1 do destravamento) */}
        {!!categoriaId && !categoriaImplementada && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              O fluxo de cadastro para <strong>{categoriaSelecionada?.nome}</strong> ainda não está
              disponível. Por enquanto a boleta cadastra <strong>Renda Fixa</strong>,{" "}
              <strong>Fundos de Investimentos</strong> e <strong>Moedas</strong>.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Moedas ── */}
        {showMoedaFields && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data da Transação" required>
                <Input type="date" value={data} min={limitesData.min} max={limitesData.max} onChange={(e) => setData(e.target.value)} />
              </Field>
              {/* Na venda so aparece moeda com saldo na data, por isso ela vem depois. */}
              <Field label="Moeda" required>
                <NativeSelect
                  value={moedaSel}
                  onChange={setMoedaSel}
                  placeholder={
                    ehSaida && !data
                      ? "Informe a data da operação"
                      : ehSaida && moedasDisponiveis.length === 0
                        ? "Nenhuma moeda em custódia nessa data"
                        : "Selecione a moeda"
                  }
                  disabled={isEditing || (ehSaida && !data)}
                  options={moedasDisponiveis.map((m) => ({ value: m.codigo, label: `${m.nome} (${m.codigo})` }))}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label={tipoMovimentacao === "Compra" ? "Valor Pago (R$)" : "Valor Recebido (R$)"} required>
                <Input
                  value={valor}
                  onChange={(e) => setValor(formatCurrency(e.target.value))}
                  placeholder="0,00"
                  inputMode="numeric"
                />
              </Field>
              <Field label="Quantidade na Moeda">
                <Input
                  value={qtdCotas}
                  onChange={(e) => setQtdCotas(e.target.value.replace(/[^\d,.]/g, ""))}
                  placeholder="Em branco, usa a cotação do dia"
                />
              </Field>
            </div>

            <Field label="Instituição (custodiante)" required>
              <EntidadeSelect
                tipo="instituicao"
                value={instituicaoId}
                onChange={(id, nome) => { setInstituicaoId(id); setInstituicaoNome(nome); }}
                tituloCadastro="Cadastrar Nova Instituição"
                labelCadastro="Nome da Instituição"
                placeholder="Busque a corretora ou banco"
              />
            </Field>

            {ehSaida && data && (
              <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Saldo disponível para venda em {fmtData(data)}:
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {!moedaSel
                    ? "Selecione a moeda"
                    : comSaldo == null
                      ? "Calculando..."
                      : saldoDaSaida == null
                        ? "—"
                        : `${MOEDAS.find((m) => m.codigo === moedaSel)?.simbolo ?? moedaSel} ` +
                          saldoDaSaida.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
                          (cotacaoOp != null ? ` (${fmtBrlDisplay(saldoDaSaida * cotacaoOp)})` : "")}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              A quantidade em branco é derivada pela cotação de venda do Banco Central na data.
              Informe a quantidade quando quiser registrar o câmbio efetivo da operação, com spread e IOF.
            </p>

            <div className="flex gap-3">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Salvando..." : isEditing ? "Salvar alterações" : "Cadastrar"}
              </Button>
              <Button variant="outline" onClick={() => onFechar?.()} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </>
        )}

        {/* ── Fundos de Investimentos ── */}
        {showFundoFields && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data da Transação" required>
                <Input type="date" value={data} min={limitesData.min} max={limitesData.max} onChange={(e) => setData(e.target.value)} />
              </Field>
              <Field label="Valor" required>
                <Input
                  value={valor}
                  onChange={(e) => setValor(formatCurrency(e.target.value))}
                  placeholder="0,00"
                  inputMode="numeric"
                />
              </Field>
            </div>

            {/* Numa saida so aparecem os fundos com cotas na data, por isso o campo vem
                depois dela e fica travado enquanto a data nao for informada. */}
            <Field label="Fundo" required>
              {ehSaida && !data ? (
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Informe a data da operação
                </p>
              ) : ehSaida && comSaldo && fundosDisponiveis.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Nenhum fundo em custódia nessa data
                </p>
              ) : (
                <FundoSelect
                  fundos={fundosDisponiveis}
                  value={fundoId}
                  onChange={setFundoId}
                  disabled={isEditing}
                  hasError={validationErrors.has("fundoId")}
                />
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Valor da Cota">
                <Input
                  readOnly
                  className="bg-muted/50"
                  value={
                    cotaOp?.cota != null
                      ? cotaOp.cota.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 })
                      : ""
                  }
                  placeholder={fundoId && data ? "Cota não divulgada" : "Selecione o fundo e a data"}
                />
              </Field>
              <Field label="Quantidade de Cotas" required={ehComeCotas}>
                {ehComeCotas ? (
                  <Input
                    value={qtdCotas}
                    onChange={(e) => setQtdCotas(e.target.value.replace(/[^\d,.]/g, ""))}
                    placeholder="Cotas canceladas, do extrato"
                    className={validationErrors.has("qtdCotas") ? "border-destructive ring-1 ring-destructive" : ""}
                  />
                ) : (
                  <Input
                    readOnly
                    className="bg-muted/50"
                    value={
                      qtdCotasDerivada != null
                        ? qtdCotasDerivada.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 })
                        : ""
                    }
                    placeholder="Valor ÷ cota"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Instituição (custodiante)" required>
                <EntidadeSelect
                  tipo="instituicao"
                  value={instituicaoId}
                  onChange={(id, nome) => { setInstituicaoId(id); setInstituicaoNome(nome); }}
                  tituloCadastro="Cadastrar Nova Instituição"
                  labelCadastro="Nome da Instituição"
                  placeholder="Busque a corretora ou banco"
                />
              </Field>
            </div>

            {/* Numa saida o usuario precisa ver o que tem antes de digitar quanto tira. */}
            {ehSaida && data && (
              <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {ehComeCotas ? "Cotas em custódia em " : "Saldo disponível para resgate em "}
                  {fmtData(data)}:
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {!fundoId
                    ? "Selecione o fundo"
                    : comSaldo == null
                      ? "Calculando..."
                      : saldoDaSaida == null
                        ? "—"
                        : `${saldoDaSaida.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 })} cotas` +
                          (cotaOp?.cota != null ? ` (${fmtBrlDisplay(saldoDaSaida * cotaOp.cota)})` : "")}
                </p>
              </div>
            )}

            {cotaOp && cotaOp.cota == null && !ehComeCotas && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {cotaOp.ultima
                    ? `O fundo ainda não divulgou a cota de ${fmtData(cotaOp.dataCotizacao)}. A última é de ${fmtData(cotaOp.ultima.data)}. Como a quantidade de cotas vem de valor ÷ cota, a operação só pode ser lançada quando a cota sair.`
                    : "Não há cota disponível para esse fundo nessa data."}
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              {cotaOp?.cota != null && cotaOp.dataCotizacao !== data
                ? `Cota de ${fmtData(cotaOp.dataCotizacao)}, data em que a operação cotiza. `
                : ""}
              {ehComeCotas
                ? "No come-cotas quem calcula as cotas canceladas é o administrador, a partir do ganho de cada cotista, então a quantidade vem do extrato. Entra como saída de cotas: reduz a posição sem dinheiro saindo da carteira."
                : "A cota vem da série da CVM e a quantidade é valor ÷ cota, por isso os dois campos são somente leitura."}
            </p>

            <div className="flex gap-3">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Salvando..." : isEditing ? "Salvar alterações" : "Cadastrar"}
              </Button>
              <Button variant="outline" onClick={() => onFechar?.()} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </>
        )}

        {/* ── Aplicação Flow ── */}
        {(isAplicacao || (isEditing && !!tipoMovimentacao && !ehSaidaRF)) && isRendaFixa && !isPoupanca && (
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

            {/* O papel em si, do cadastro compartilhado. Novo titulo entra por aqui tambem. */}
            {!!produtoId && !isEditing && (
              <Field label="Título" required>
                <TituloSelect
                  produtoId={produtoId}
                  produtoNome={produtos.find((p) => p.id === produtoId)?.nome ?? "título"}
                  value={tituloId}
                  cadastrandoNovo={cadastrandoNovoTitulo}
                  hasError={validationErrors.has("tituloId")}
                  onCadastrarNovo={() => {
                    setTituloId("");
                    setCadastrandoNovoTitulo(true);
                    setEmissorId(""); setEmissorNome("");
                    setModalidade(""); setIndexador(""); setTaxa("");
                    setVencimento(""); setPagamento("No Vencimento");
                  }}
                  onSelecionar={(t) => {
                    setTituloId(t.id);
                    setCadastrandoNovoTitulo(false);
                    setEmissorId(t.emissor_id ?? "");
                    setEmissorNome(t.emissor_nome ?? "");
                    setModalidade(t.modalidade);
                    setIndexador(t.indexador ?? "");
                    setTaxa(String(t.taxa).replace(".", ","));
                    setVencimento(t.vencimento);
                    setPagamento(t.pagamento);
                    setPrecoUnitario(formatCurrency(Math.round(t.preco_emissao * 100).toString()));
                    setValidationErrors((prev) => { const n = new Set(prev); n.delete("tituloId"); return n; });
                  }}
                />
              </Field>
            )}

            {showAplicacaoFields && (
              <>
                {/* Row 1: Data, Valor Inicial, Preço de Emissão, Vencimento */}
                <div className="grid grid-cols-4 gap-4">
                  <Field label="Data de Transação" required>
                    <input
                      type="date"
                      value={data}
                      min={limitesData.min}
                      max={limitesData.max}
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
                      disabled={travarTermosDoPapel}
                      onChange={(e) => { setVencimento(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("vencimento"); return n; }); }}
                      className={`input-field ${travarTermosDoPapel ? "opacity-60" : ""} ${validationErrors.has("vencimento") ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                  </Field>
                </div>

                {/* Row 2: Instituição, Emissor */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Corretora" required>
                    <EntidadeSelect
                      tipo="instituicao"
                      value={instituicaoId}
                      onChange={(id, nome) => { setInstituicaoId(id); setInstituicaoNome(nome); setValidationErrors((prev) => { const n = new Set(prev); n.delete("instituicaoId"); return n; }); }}
                      tituloCadastro="Cadastrar Nova Corretora"
                      labelCadastro="Nome da Corretora"
                      placeholder="Pesquisar corretora..."
                      hasError={validationErrors.has("instituicaoId")}
                    />
                  </Field>

                  <Field label="Emissor" required>
                    <EntidadeSelect
                      tipo="emissor"
                      value={emissorId}
                      onChange={(id, nome) => { setEmissorId(id); setEmissorNome(nome); setValidationErrors((prev) => { const n = new Set(prev); n.delete("emissorId"); return n; }); }}
                      tituloCadastro="Cadastrar Novo Emissor"
                      labelCadastro="Nome do Emissor"
                      placeholder="Pesquisar emissor..."
                      hasError={validationErrors.has("emissorId")}
                      disabled={travarTermosDoPapel}
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
                      disabled={travarTermosDoPapel}
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
                        disabled={travarTermosDoPapel}
                      />
                    </Field>
                  )}

                  <Field label="Taxa" required>
                    <div className="relative">
                      <input
                        type="text"
                        value={taxa}
                        disabled={travarTermosDoPapel}
                        onChange={(e) => { setTaxa(formatTaxaInput(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("taxa"); return n; }); }}
                        placeholder="0,00"
                        className={`input-field pr-7 ${travarTermosDoPapel ? "opacity-60" : ""} ${validationErrors.has("taxa") ? "border-destructive ring-1 ring-destructive" : ""}`}
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
                      options={pagamentoOptions.map((p) => ({
                        value: p,
                        label: p,
                      }))}
                      hasError={validationErrors.has("pagamento")}
                      disabled={travarTermosDoPapel}
                    />
                  </Field>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onFechar?.()}
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
        {isPoupanca && isRendaFixa && (isAplicacao || (isEditing && !!tipoMovimentacao && !ehSaidaRF)) && (
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
                      min={limitesData.min}
                      max={limitesData.max}
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
                    <EntidadeSelect
                      tipo="instituicao"
                      value={instituicaoId}
                      onChange={(id, nome) => { setInstituicaoId(id); setInstituicaoNome(nome); setValidationErrors((prev) => { const n = new Set(prev); n.delete("instituicaoId"); return n; }); }}
                      tituloCadastro="Cadastrar Novo Banco"
                      labelCadastro="Nome do Banco"
                      placeholder="Pesquisar banco..."
                      hasError={validationErrors.has("instituicaoId")}
                    />
                  </Field>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onFechar?.()}
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

        {/* ── Edicao de saida de renda fixa (Resgate / Resgate Total) ── */}
        {showEdicaoSaidaRF && (
          <>
            <Field label="Título">
              <Input readOnly className="bg-muted/50" value={nomeAtivoEmEdicao || "—"} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Data de Transação" required>
                <Input
                  type="date"
                  value={data}
                  min={limitesData.min}
                  max={limitesData.max}
                  onChange={(e) => { setData(e.target.value); setValidationErrors((prev) => { const n = new Set(prev); n.delete("data"); return n; }); }}
                  className={`input-field ${validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : ""}`}
                />
              </Field>
              <Field label={isResgateTotal ? "Valor do Resgate Total (R$)" : "Valor do Resgate (R$)"} required>
                <Input
                  value={valor}
                  onChange={(e) => { setValor(formatCurrency(e.target.value)); setValidationErrors((prev) => { const n = new Set(prev); n.delete("valor"); return n; }); }}
                  placeholder="0,00"
                  inputMode="numeric"
                  className={validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}
                />
              </Field>
            </div>

            {/* O saldo mostrado DESCONSIDERA esta movimentacao: e o que havia antes dela. */}
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Saldo disponível em {data ? fmtData(data) : "—"}, sem contar esta movimentação:
              </p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {calculandoSaldo
                  ? "Calculando..."
                  : saldoDisponivel !== null
                    ? fmtBrlDisplay(saldoDisponivel)
                    : "—"}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Só a data e o valor da operação mudam aqui. O título e os termos dele (emissor, taxa,
              indexador, vencimento) pertencem à custódia, não a esta movimentação.
            </p>

            <div className="flex gap-3">
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Salvando..." : "Salvar alterações"}
              </Button>
              <Button variant="outline" onClick={() => onFechar?.()} disabled={submitting}>
                Cancelar
              </Button>
            </div>
          </>
        )}

        {/* ── Resgate Flow ── */}
        {showResgateFields && (
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
                      // Fora da janela nem aparece clicavel: o resgate seria recusado depois.
                      disabled={{
                        before: new Date(limitesData.min + "T00:00:00"),
                        after: new Date(limitesData.max + "T00:00:00"),
                      }}
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

            <Field label="Nome do Título" required>
              <NativeSelect
                value={selectedCustodiaId}
                onChange={(v) => {
                  setSelectedCustodiaId(v);
                  setValor("");
                  setSaldoDisponivel(null);
                  setFecharPosicao(false);
                }}
                disabled={!resgateDate || !!resgateDateError}
                placeholder={
                  !resgateDate || resgateDateError
                    ? "Informe a data da operação"
                    : custodiasNaData.length > 0
                      ? "Selecione o título em custódia"
                      // Lista vazia tem duas causas diferentes, e dizer "nenhum título em
                      // custódia" num sábado manda o usuário procurar o problema no lugar errado.
                      : dataEhDiaUtil === false
                        ? "Fora de dia útil, só a Poupança pode ser movimentada"
                        : "Nenhum título em custódia nessa data"
                }
                options={custodiasNaData.map((c) => ({
                  value: c.id,
                  label: c.nome || `Custódia #${c.codigo_custodia}`,
                }))}
              />
            </Field>

            {selectedCustodia && (
              <>
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
                          value={instituicaoNome || "—"}
                          disabled
                          className="input-field opacity-60"
                        />
                      </Field>

                      <Field label="Emissor">
                        <input
                          type="text"
                          value={emissorNome || "—"}
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
                        onClick={() => onFechar?.()}
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
