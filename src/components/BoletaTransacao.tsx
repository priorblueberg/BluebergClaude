import { useState, useEffect, useMemo, useCallback } from "react";
import { format, parse, isValid } from "date-fns";
import { PlusCircle, AlertTriangle, HelpCircle, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolverTitulo } from "@/lib/resolverTitulo";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { buildNomeAtivo } from "@/lib/nomeAtivo";
import { toast } from "sonner";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { verificarMudancaDoFundo } from "@/lib/verificarMudancaDoFundo";
import { calcularRendaFixaDiario, opcoesPagamentoDoProduto, permiteVendaNoSecundario } from "@/lib/rendaFixaEngine";
import { fatoresIpcaSeNecessario, pisoDoCalendario } from "@/lib/ipcaSeries";
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
import { MOEDAS } from "@/lib/catalogoDeMoedas";
import AcaoSelect from "@/components/AcaoSelect";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { calcularPoupancaDiario, buildPoupancaLotesFromMovs } from "@/lib/poupancaEngine";
import { proximoCodigoCustodia } from "@/lib/codigoCustodia";
import { parseQuantidade } from "@/lib/numeroBR";
import { ehDiaUtil, foraDaJanela, DATA_MINIMA_CARTEIRA, cotacaoMoeda, cotaFundo, saldosNaData, dataCotizacaoFundo, saldoEmQuantidade, fmtData, fundosComPosicao, limitesDaSerieDoFundo } from "@/lib/validacaoBoleta";
import { janelaDoCalendarioDoFundo, mensagemDaDataDoFundo, type LimitesDoFundo } from "@/lib/validacaoDataFundo";
import CampoDataCalendario from "@/components/CampoDataCalendario";
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
  codigo_custodia: string;
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
const CATEGORIAS_IMPLEMENTADAS = ["Renda Fixa", "Fundos de Investimentos", "Moedas", "Renda Variável"];

// Moeda: compra e venda de saldo em moeda estrangeira, sem juros.
const TIPOS_MOVIMENTACAO_MOEDA = ["Compra", "Venda"];
const TIPOS_MOVIMENTACAO_ACAO = ["Compra", "Venda"];

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
  const { dataReferenciaISO, applyDataReferencia, maxDate, maxDataOficial } = useDataReferencia();
  const isoDe = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
    /** Primeiro dia da serie do fundo. `null` = nao ha serie carregada. */
    primeira: string | null;
    /** Data de inicio do fundo na CVM, para saber se a serie esta curta ou o fundo e novo. */
    inicioDoFundo: string | null;
  } | null>(null);
  // Moedas
  const [moedaSel, setMoedaSel] = useState("");
  // Acoes
  const [acaoId, setAcaoId] = useState("");
  const [acaoTicker, setAcaoTicker] = useState("");
  const [acaoNome, setAcaoNome] = useState("");
  /** Preenchido só quando o papel escolhido saiu da bolsa. Ver `tetoDoPapel`. */
  const [acaoDeslistadoEm, setAcaoDeslistadoEm] = useState<string | null>(null);
  const [custosOp, setCustosOp] = useState("");
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());

  // Derived
  const categoriaSelecionada = categorias.find((c) => c.id === categoriaId);
  const produtoSelecionado = produtos.find((p) => p.id === produtoId);
  const isRendaFixa = categoriaSelecionada?.nome === "Renda Fixa";
  const isFundo = categoriaSelecionada?.nome === "Fundos de Investimentos";
  const isMoeda = categoriaSelecionada?.nome === "Moedas";
  const isAcao = categoriaSelecionada?.nome === "Renda Variável";
  const isPoupanca = produtoSelecionado?.nome === "Poupança";

  /**
   * Janela em que uma operacao pode ser lancada. O piso e o inicio da ferramenta; o TETO
   * depende do produto, e e ai que mora a regra.
   *
   * Consulta de rentabilidade vai ate D0 com dado provisorio. CADASTRO, nao: gravar uma
   * operacao contra um dado que ainda vai mudar deixa a operacao errada para sempre, enquanto
   * a consulta se corrige sozinha. Entao o teto do cadastro e `maxDataOficial`, o ultimo dia
   * em que todas as fontes ja fecharam.
   *
   * ACAO E EXCECAO, e vai ate D0 (decisao do Daniel em 08/09/2026): o preco da compra ou venda
   * e DIGITADO pelo cliente, nao sai da nossa serie. Ali o provisorio afeta so a marcacao a
   * mercado da posicao, nunca o lancamento - diferente de fundo, onde a quantidade de cotas
   * SAI da cota do dia, e de renda fixa, cujo PU sai da curva.
   *
   * Os campos de data ficam limitados a essa janela, e a validacao repete o limite porque o
   * usuario pode digitar em vez de usar o seletor.
   */
  /**
   * TETO EXTRA para papel deslistado.
   *
   * Papel que saiu da bolsa continua na busca de proposito: o cliente que o teve em 2023
   * precisa poder cadastrar a posicao retroativa hoje. O que nao pode e lancar operacao DEPOIS
   * de o papel ter deixado de ser negociado - achar o papel e poder operar nele sao coisas
   * diferentes.
   *
   * O teto usado e a ULTIMA COTACAO conhecida, e nao a data em que a deslistagem foi detectada:
   * a deteccao acontece na recarga semanal do catalogo e pode estar ate seis dias adiantada,
   * enquanto a ultima cotacao e o dia exato em que o papel foi negociado pela ultima vez.
   */
  const [tetoDoPapel, setTetoDoPapel] = useState<string | null>(null);

  // A condicao e `deslistado_em`, e nao `ativo`. Desde 10/09/2026 nao ha rotina que mexa nessas
  // duas colunas: entrada de papel, saida e troca de ticker sao acerto manual no banco. Quem
  // marca a data e quem sabe que o papel saiu da bolsa.
  useEffect(() => {
    if (!acaoDeslistadoEm || !acaoTicker) { setTetoDoPapel(null); return; }
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("cotacoes_acoes")
        .select("data")
        .eq("ticker", acaoTicker)
        // `provisorio = false` nao e detalhe: e o que faz o teto significar "ultimo pregao que
        // existiu" em vez de "ultima linha que a fonte cuspiu".
        //
        // A tabela tem dois produtores de linha provisoria. A rodada horaria grava a barra de
        // hoje para todo papel sincronizado, e a marca de deslistagem NAO desliga a
        // sincronizacao de proposito. E a barra herdada: quando a fonte repete a linha inteira
        // do dia anterior, ela e marcada como provisoria mas gravada assim mesmo.
        //
        // O segundo caso e o que anula a trava sozinho. Papel que parou de negociar e cuja
        // fonte continua ecoando o ultimo fechamento acumula datas depois do ultimo pregao
        // real, e sem este filtro o teto anda junto com elas, em silencio. A limpeza de
        // fantasmas do fechamento desfaria isso, mas ela nao roda quando o historico deixa de
        // devolver o ticker - que e justamente o papel deslistado.
        .eq("provisorio", false)
        .order("data", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      // Sem serie carregada nao ha ultima cotacao; ai a data de deteccao e o melhor que existe.
      setTetoDoPapel((data?.data as string | undefined) ?? acaoDeslistadoEm);
    })();
    return () => { vivo = false; };
  }, [acaoDeslistadoEm, acaoTicker]);

  const maxDataGeral = isoDe(isAcao ? maxDate : maxDataOficial);
  const maxDataISO = tetoDoPapel && tetoDoPapel < maxDataGeral ? tetoDoPapel : maxDataGeral;
  const limitesData = { min: DATA_MINIMA_CARTEIRA, max: maxDataISO };
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
          const LIBERADAS = ["Renda Fixa", "Fundos de Investimentos", "Moedas", "Renda Variável"];
          const visiveis = isAdmin ? data : data.filter((c) => LIBERADAS.includes(c.nome));
          setCategorias(visiveis);
          if (visiveis.length === 1 && !editId) {
            setCategoriaId(visiveis[0].id);
          }
        }
      });
  }, [isAdmin, editId]);

  // Os fundos JA CARREGADOS, que sao poucos e tem serie de cotas.
  //
  // O filtro por `sincronizar_cotas` nao e detalhe: desde 10/09/2026 esta tabela guarda tambem o
  // CATALOGO da CVM, com 8.571 classes. Sem ele a boleta baixaria o catalogo inteiro toda vez
  // que abrisse, e o `FundoSelect` filtraria 8.571 linhas em memoria a cada tecla. Quem varre o
  // catalogo e a busca do proprio seletor, no servidor e sob demanda.
  const carregarFundos = useCallback(async () => {
    const { data } = await supabase
      .from("cadastro_de_fundos")
      .select("id, nome_curto, cnpj_classe")
      .eq("ativo", true)
      .eq("sincronizar_cotas", true)
      .order("nome_curto");
    setFundos((data ?? []).map((f: { id: string; nome_curto: string; cnpj_classe: string }) =>
      ({ id: f.id, nome: f.nome_curto, cnpj: f.cnpj_classe })));
  }, []);

  useEffect(() => {
    if (!isFundo) return;
    void carregarFundos();
  }, [isFundo, carregarFundos]);

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
      const c = await cotaFundo(fundoId, dataCotizacao);
      if (vivo) {
        setCotaOp({ dataCotizacao, cota: c.naData, ultima: c.ultima,
                    primeira: c.primeira, inicioDoFundo: c.inicioDoFundo });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [isFundo, fundoId, data, tipoMovimentacao]);

  // Janela do calendario do fundo: primeira e ultima cota, lidas assim que o fundo e escolhido.
  // `undefined` enquanto carrega; a mensagem embaixo da data espera.
  const [limitesFundo, setLimitesFundo] = useState<LimitesDoFundo | null | undefined>(undefined);
  useEffect(() => {
    if (!isFundo || !fundoId) {
      setLimitesFundo(undefined);
      return;
    }
    let vivo = true;
    setLimitesFundo(undefined);
    limitesDaSerieDoFundo(fundoId).then((l) => { if (vivo) setLimitesFundo(l); });
    return () => { vivo = false; };
  }, [isFundo, fundoId]);

  // Feriado so o calendario do banco sabe; fim de semana a validacao ja pega sem ir ao banco.
  const [diaUtilFundo, setDiaUtilFundo] = useState<{ data: string; util: boolean } | null>(null);
  useEffect(() => {
    if (!isFundo || !data) {
      setDiaUtilFundo(null);
      return;
    }
    let vivo = true;
    ehDiaUtil(data).then((util) => { if (vivo) setDiaUtilFundo({ data, util }); });
    return () => { vivo = false; };
  }, [isFundo, data]);

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
      .select("id, nome, codigo_custodia, data_inicio, valor_investido, taxa, indexador, vencimento, modalidade, pagamento, produto_id, instituicao_id, emissor_id, categoria_id, preco_unitario, resgate_total, titulo_id")
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
          .gte("data", pisoDoCalendario(selectedCustodia.data_inicio))
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
          // Debenture, CRI e CRA rendem no proprio dia da compra.
          rendeNoDiaDaCompra: permiteVendaNoSecundario(
            produtos.find((p) => p.id === selectedCustodia.produto_id)?.nome,
          ),
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
    } else if (selectedCustodia.modalidade === "Poupança") {
      // A poupanca tem motor proprio: sem ele a caixa mostrava o valor APLICADO como saldo
      // disponivel. Medido em 06/09/2026: R$ 10.000,00 numa posicao que ja valia R$ 10.258,60
      // com quatro aniversarios pagos - o cliente nao conseguiria resgatar o que era dele.
      setCalculandoSaldo(true);
      try {
        const [calRes, movRes, rendRes] = await Promise.all([
          fetchAllRows((de, ate) => supabase.from("calendario_dias_uteis").select("data, dia_util")
            .gte("data", pisoDoCalendario(selectedCustodia.data_inicio)).lte("data", dateISO).order("data").range(de, ate)),
          (ignorarId
            ? supabase.from("movimentacoes").select("data, tipo_movimentacao, valor")
                .eq("codigo_custodia", selectedCustodia.codigo_custodia).eq("user_id", user.id)
                .neq("id", ignorarId).order("data")
            : supabase.from("movimentacoes").select("data, tipo_movimentacao, valor")
                .eq("codigo_custodia", selectedCustodia.codigo_custodia).eq("user_id", user.id)
                .order("data")),
          fetchAllRows((de, ate) => supabase.from("historico_poupanca_rendimento")
            .select("data, rendimento_mensal")
            .gte("data", selectedCustodia.data_inicio).lte("data", dateISO).order("data").range(de, ate)),
        ]);

        const movs = ((movRes as any).data || []).map((m: any) => ({
          data: m.data, tipo_movimentacao: m.tipo_movimentacao, valor: Number(m.valor),
        }));
        const rows = calcularPoupancaDiario({
          dataInicio: selectedCustodia.data_inicio,
          dataCalculo: dateISO,
          calendario: (calRes || []) as any,
          movimentacoes: movs,
          lotes: buildPoupancaLotesFromMovs(movs),
          selicRecords: [],
          poupancaRendimentoRecords: ((rendRes || []) as any[]).map((r: any) => ({
            data: r.data, rendimento_mensal: Number(r.rendimento_mensal),
          })),
        });
        const rowDia = rows.find((r) => r.data === dateISO) ?? rows[rows.length - 1];
        setSaldoDisponivel(rowDia ? rowDia.liquido : selectedCustodia.valor_investido);
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
  const showTipoMovimentacao = !!categoriaId && (isRendaFixa || isFundo || isMoeda || isAcao);
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

  /**
   * Come-cotas: saida de cotas sem dinheiro saindo da carteira. Desde 11/09/2026 (pedido do Daniel) o
   * cliente digita so o valor do extrato e a quantidade e valor / cota do dia, como nos outros tipos.
   * No extrato da XP os dois batem: R$ 657,03 / 11,52691600 = 56,99963459 cotas.
   */
  const ehComeCotas = tipoMovimentacao === "Come-Cotas";

  /** Saida (resgate, come-cotas, venda) so pode incidir sobre o que existia na data. */
  // "Aplicação Inicial" e ENTRADA: e o tipo gravado da primeira aplicacao e so aparece na edicao.
  const ehSaida = !!tipoMovimentacao && !["Aplicação", "Aplicação Inicial", "Compra"].includes(tipoMovimentacao);

  // Saldo por ativo na data. Enquanto for null a lista fica travada, porque oferecer tudo
  // enquanto carrega deixaria escolher um ativo que nao existia naquele dia.
  const [comSaldo, setComSaldo] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!user || !ehSaida || !data || !(isFundo || isMoeda)) {
      setComSaldo(null);
      return;
    }
    let vivo = true;
    saldosNaData(user.id, data, isFundo ? "fundo_id" : "moeda", editId ?? undefined).then((s) => {
      if (vivo) setComSaldo(s);
    });
    return () => { vivo = false; };
  }, [user, ehSaida, data, isFundo, isMoeda, editId]);

  // Fundos com posicao no portfolio: a lista do resgate. O fundo vem ANTES da data, entao a lista
  // nao depende do saldo num dia; o saldo na data aparece abaixo do valor, em reais.
  const [fundosComPosicaoIds, setFundosComPosicaoIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!user || !isFundo || !ehSaida) {
      setFundosComPosicaoIds(null);
      return;
    }
    let vivo = true;
    fundosComPosicao(user.id).then((s) => { if (vivo) setFundosComPosicaoIds(s); });
    return () => { vivo = false; };
  }, [user, isFundo, ehSaida]);

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

  /**
   * Validacao da data de fundo, embaixo do campo (pedido do Daniel, 11/09/2026): data invalida, antes
   * da constituicao do fundo, cota ainda nao divulgada e, na saida, sem custodia na data. Substituiu o
   * alerta vermelho e os avisos que so apareciam ao cadastrar.
   */
  const janelaFundo = janelaDoCalendarioDoFundo(limitesFundo ?? null, DATA_MINIMA_CARTEIRA);
  const mensagemDataFundo = !isFundo ? null : mensagemDaDataDoFundo({
    data,
    piso: DATA_MINIMA_CARTEIRA,
    limites: limitesFundo,
    diaUtil: diaUtilFundo && diaUtilFundo.data === data ? diaUtilFundo.util : undefined,
    cotaNaData: cotaOp && cotaOp.dataCotizacao === data ? cotaOp.cota : undefined,
    ehSaida,
    saldoNaData: !ehSaida || comSaldo == null ? undefined : saldoDaSaida,
  });

  // Mudou a data numa venda de moeda: a moeda escolhida pode nao existir na nova data, entao sai.
  // O fundo fica: ele vem antes da data, e a falta de saldo aparece abaixo do valor.
  useEffect(() => {
    if (!ehSaida) return;
    if (moedaSel && comSaldo && !comSaldo.has(moedaSel)) setMoedaSel("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comSaldo, ehSaida]);

  /** Fundos oferecidos: todos na aplicacao, so os com posicao no portfolio nas saidas. */
  const fundosDisponiveis = useMemo(
    () => (ehSaida ? fundos.filter((f) => fundosComPosicaoIds?.has(f.id)) : fundos),
    [fundos, ehSaida, fundosComPosicaoIds],
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
  // Como em moedas: os campos so fazem sentido depois de saber se e compra ou venda - o
  // rotulo do valor e a checagem de saldo dependem disso.
  const showAcaoFields = isAcao && !!tipoMovimentacao;
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

    // ── Ações ──
    if (isAcao) {
      const faltando = new Set<string>();
      if (!acaoId) faltando.add("acaoId");
      if (!data) faltando.add("data");
      if (!valor || parseCurrencyToNumber(valor) <= 0) faltando.add("valor");
      // A quantidade virou OBRIGATORIA quando o campo de valor passou a ser o PRECO UNITARIO:
      // nao ha como derivar quantidade de preco, e a combinacao quantidade x preco e a mesma
      // que o GorilaVIEW e a nota de corretagem usam.
      if (parseQuantidade(qtdCotas) == null) faltando.add("qtdCotas");
      if (!instituicaoId) faltando.add("instituicaoId");
      if (faltando.size > 0) {
        setValidationErrors(faltando);
        toast.error("Preencha todos os campos obrigatórios.");
        return;
      }
      setValidationErrors(new Set());

      const foraJanela = foraDaJanela(data, maxDataISO);
      if (foraJanela) { toast.error(foraJanela); return; }
      if (!(await ehDiaUtil(data))) {
        toast.error("A data da operação deve ser um dia útil.");
        return;
      }

      // O campo de valor é o PREÇO UNITÁRIO, e o total sai dele.
      //
      // Até 09/09/2026 era o contrário: o campo pedia o total da operação e a quantidade era
      // opcional. Isso trocou o significado do que o cliente digita e gravou três operações cem
      // vezes menores em silêncio - "22,00" num lote de 100 ações virou 0,22 por ação. A ordem
      // certa é a da nota de corretagem, que é também a do GorilaVIEW: quantidade e preço, com
      // o total calculado.
      const precoEfetivo = parseCurrencyToNumber(valor);
      const custosNum = custosOp ? parseCurrencyToNumber(custosOp) : 0;
      const qtdOperacao = parseQuantidade(qtdCotas)!;
      const valorNum = precoEfetivo * qtdOperacao;

      // Trava contra erro de casa decimal. Não barra: AVISA e pede confirmação. Preço de
      // execução legitimamente foge do fechamento - o pregão tem máxima e mínima, e em
      // 02/01/2023 o GGBR4 foi comprado 19% acima do fechamento - mas um preço cem vezes fora
      // é digitação, não execução. As três operações de 09/09/2026 estavam a -99% e passaram
      // sem uma palavra.
      const { data: precoRow } = await supabase
        .from("cotacoes_acoes")
        .select("fechamento")
        .eq("ticker", acaoTicker)
        .eq("data", data)
        .maybeSingle();
      const precoDoDia = precoRow ? Number((precoRow as any).fechamento) : null;

      if (precoDoDia && precoDoDia > 0) {
        const desvio = Math.abs(precoEfetivo / precoDoDia - 1);
        if (desvio > 0.5) {
          const emReais = (n: number) =>
            n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
          const ok = window.confirm(
            `O preço informado (${emReais(precoEfetivo)}) está ${(desvio * 100).toFixed(0)}% fora `
            + `do fechamento de ${acaoTicker} em ${fmtData(data)}, que foi ${emReais(precoDoDia)}.`
            + `

Confirma que o preço está certo?`,
          );
          if (!ok) return;
        }
      }

      setSubmitting(true);
      try {
        // Mesmo papel na mesma instituição é a mesma posição.
        const { data: existentes } = await supabase
          .from("movimentacoes")
          .select("codigo_custodia")
          .eq("user_id", user.id)
          .eq("acao_id", acaoId)
          .eq("instituicao_id", instituicaoId)
          .not("codigo_custodia", "is", null)
          .limit(1);

        const codigoCustodia = existentes && existentes.length > 0
          ? String(existentes[0].codigo_custodia)
          : await proximoCodigoCustodia();

        // Venda não pode passar do saldo: o motor aceita posição negativa e ela seguiria
        // "rendendo", então o erro só apareceria semanas depois na carteira.
        if (tipoMovimentacao === "Venda" && qtdOperacao != null) {
          const saldo = await saldoEmQuantidade(codigoCustodia, user.id, data, editId);
          if (qtdOperacao > saldo + 1e-8) {
            setSubmitting(false);
            toast.error(
              `Venda de ${qtdOperacao.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ações maior que o saldo de ${saldo.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} em ${fmtData(data)}.`,
            );
            return;
          }
        }

        if (isEditing) {
          const { error: errUp } = await supabase.from("movimentacoes").update({
            instituicao_id: instituicaoId,
            data,
            valor: valorNum,
            quantidade: qtdOperacao,
            preco_unitario: precoEfetivo,
          }).eq("id", editId);
          if (errUp) throw errUp;
          await fullSyncAfterMovimentacao(editId!, categoriaId, user.id, dataReferenciaISO);
          applyDataReferencia();
          toast.success("Operação atualizada com sucesso!");
          onFechar?.();
          return;
        }

        const { data: inserida, error } = await supabase.from("movimentacoes").insert({
          categoria_id: categoriaId,
          produto_id: produtoId || produtos[0]?.id || null,
          instituicao_id: instituicaoId,
          acao_id: acaoId,
          codigo_custodia: codigoCustodia,
          nome_ativo: acaoTicker,
          data,
          tipo_movimentacao: tipoMovimentacao,
          valor: valorNum,
          quantidade: qtdOperacao,
          preco_unitario: precoEfetivo,
          custos_operacao: custosNum || null,
          user_id: user.id,
          origem: "manual",
        }).select("id").single();

        if (error) throw error;

        await fullSyncAfterMovimentacao(inserida.id, categoriaId, user.id, dataReferenciaISO);
        applyDataReferencia();
        toast.success("Operação cadastrada com sucesso!");
        resetForm();
        setAcaoId(""); setAcaoTicker(""); setAcaoNome("");
        setQtdCotas(""); setCustosOp("");
      } catch (err: any) {
        toast.error("Erro ao cadastrar operação de ações.");
        console.error(err);
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
      // O preco e o cambio EFETIVO da operacao, nao a PTAX: quando o cliente informa a
      // quantidade justamente para registrar spread e IOF, gravar a PTAX faria o extrato
      // contar outra historia (R$ 5,94 numa compra fechada a R$ 6,67). Com a quantidade
      // derivada os dois coincidem, entao a divisao vale para os dois casos.
      const precoEfetivo = qtdOperacao ? valorNum / qtdOperacao : cotacaoDoDia;

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
          codigoCustodia = await proximoCodigoCustodia();
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
            preco_unitario: precoEfetivo,
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
          preco_unitario: precoEfetivo,
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
      if (faltando.size > 0) {
        setValidationErrors(faltando);
        toast.error("Preencha todos os campos obrigatórios.");
        return;
      }
      setValidationErrors(new Set());

      // A data errada ja se explica embaixo do campo. Aqui so impede a gravacao, sem aviso vermelho.
      if (mensagemDataFundo) {
        setValidationErrors(new Set(["data"]));
        return;
      }
      if (!(await ehDiaUtil(data))) {
        setDiaUtilFundo({ data, util: false });
        setValidationErrors(new Set(["data"]));
        return;
      }

      setSubmitting(true);

      try {
        const fundo = fundos.find((f) => f.id === fundoId)!;
        const valorNum = parseCurrencyToNumber(valor);

        const dataCotizacao = await dataCotizacaoFundo(fundoId, data, tipoMovimentacao);
        const { naData: cotaDoDia, ultima: ultimaCota, primeira: primeiraCota,
                inicioDoFundo: inicioFundo } = await cotaFundo(fundoId, dataCotizacao);

        // A quantidade e exatamente valor / cota, sem spread nem taxa que justifiquem outro numero
        // (ao contrario do cambio) - por isso ela nao e digitada, e sem a cota divulgada a operacao
        // nao pode ser lancada. Vale tambem para o come-cotas: o administrador cancela as cotas pela
        // cota do dia, e o valor do extrato dividido por ela devolve a quantidade do extrato.
        if (cotaDoDia == null) {
          setSubmitting(false);
          toast.error(
            ultimaCota
              ? `O fundo ainda não divulgou a cota de ${fmtData(dataCotizacao)}. A última é de ${fmtData(ultimaCota.data)}: lance a operação quando a cota sair.`
              : primeiraCota
                ? (inicioFundo && primeiraCota <= inicioFundo
                    ? `Este fundo começou em ${fmtData(inicioFundo)}, depois de ${fmtData(dataCotizacao)}. Não há cota nessa data porque o fundo ainda não existia.`
                    : `A série deste fundo na ferramenta começa em ${fmtData(primeiraCota)}, depois de ${fmtData(dataCotizacao)}.`)
                : "A série de cotas deste fundo ainda não foi carregada.",
          );
          return;
        }
        const qtd = valorNum / cotaDoDia;

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
          codigoCustodia = await proximoCodigoCustodia();
          if (tipoMovimentacao === "Aplicação") tipoFinal = "Aplicação Inicial";
        }

        // Resgate e come-cotas nao podem passar do saldo de cotas: posicao
        // negativa segue rendendo e o erro so aparece semanas depois.
        if (ehSaida) {
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
          verificarMudancaDoFundo(fundoId);
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
        verificarMudancaDoFundo(fundoId);
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
      // Em centavos, pelo mesmo motivo de `valorResgateSuperaSaldo`: o valor do "Fechar
      // Posicao" vem arredondado e pode ficar milesimos acima do saldo cru.
      // Debentures, CRI e CRA passam por cima do teto: vendidos no secundario, o preco pode
      // estar acima da curva.
      if (
        !vendaNoSecundario && saldoDisponivel !== null &&
        Math.round(valorNum * 100) > Math.round(saldoDisponivel * 100)
      ) {
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
          titulo_id: (selectedCustodia as any).titulo_id ?? null,
          nome_ativo: selectedCustodia.nome,
          codigo_custodia: selectedCustodia.codigo_custodia,
          quantidade: null,
          valor_extrato: `R$ ${fmtBR(valorNum)}`,
          // Venda no secundario por preco diferente da curva: o valor e um fato, e o
          // recalculo nao pode sobrescreve-lo. Igual a curva, o fechamento segue dinamico.
          valor_fixado: tipoMovimentacaoFinal === "Resgate Total" && ehVendaComPrecoProprio,
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
            codigoCustodia = await proximoCodigoCustodia();
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
          tituloResolvido = await resolverTitulo(
            {
              produto_id: produtoId,
              emissor_id: emissorId || null,
              modalidade: modalidadeToSave,
              indexador: indexadorToSave,
              taxa: taxaNum,
              vencimento,
              pagamento: pagamentoToSave,
            },
            { preco_emissao: puNum, nome: nomeAtivo, criado_por: user.id }
          );
          // Bloqueante: com os termos vivendo no cadastro, uma operacao sem titulo ficaria
          // sem onde guarda-los. Melhor recusar do que gravar pela metade.
          if (!tituloResolvido) {
            setSubmitting(false);
            toast.error("Não foi possível cadastrar o título. A operação não foi gravada.");
            return;
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
          .eq("codigo_custodia", nomeAtivo ? codigoCustodia : "-1")
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

  // Comparacao em CENTAVOS. O "Fechar Posicao" preenche o saldo arredondado a 2 casas, e
  // quando o arredondamento sobe o valor fica alguns milesimos ACIMA do saldo cru - bastava
  // isso para o botao travar e a posicao ficar impossivel de fechar pela tela. Medido em
  // 06/09/2026 numa poupanca: saldo R$ 12.005,68664670, campo R$ 12.005,69, bloqueio por
  // R$ 0,0033. Em centavos os dois viram 1200569 e a comparacao passa a dizer o que quer
  // dizer: barrar quem pede mais do que tem, nao quem pede exatamente tudo.
  //
  // Debentures, CRI e CRA sao a excecao: eles se vendem no mercado secundario, e o preco de
  // venda pode estar ACIMA da curva. Ali o teto nao e erro de digitacao, e o proprio dado.
  const vendaNoSecundario = permiteVendaNoSecundario(
    produtos.find((p) => p.id === produtoId)?.nome,
  );

  const valorResgateSuperaSaldo =
    isResgate && !vendaNoSecundario && saldoDisponivel !== null && valor !== "" &&
    Math.round(parseCurrencyToNumber(valor) * 100) > Math.round(saldoDisponivel * 100);

  /**
   * Fechamento por valor diferente da curva, isto e, uma venda a preco de mercado.
   * O valor precisa ser preservado do recalculo (`valor_fixado`), e a tela precisa dizer
   * isso, para nao parecer que o numero foi aceito por engano.
   */
  const diferencaParaCurva =
    vendaNoSecundario && fecharPosicao && saldoDisponivel !== null && valor !== ""
      ? parseCurrencyToNumber(valor) - saldoDisponivel
      : 0;
  const ehVendaComPrecoProprio = Math.abs(diferencaParaCurva) >= 0.01;

  /*
   * O campo do fundo muda de lugar conforme a movimentacao.
   *
   * Numa APLICACAO ele vem primeiro e sozinho: o resto da boleta so aparece depois que o fundo
   * passou pela verificacao de cotas. Escolher um fundo sem serie fecha a boleta ("Adicionar")
   * ou limpa o campo ("Cancelar"), e o que o usuario tivesse digitado antes seria perdido.
   *
   * Numa SAIDA tambem (decisao do Daniel, 10/09/2026): logo depois do tipo, com os fundos que tem
   * posicao no portfolio. O saldo na data aparece abaixo do campo de valor, em reais.
   */
  const campoFundo = (
    <Field label="Fundo" required>
      {ehSaida && fundosComPosicaoIds && fundosDisponiveis.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Nenhum fundo em custódia neste portfólio
        </p>
      ) : (
        <FundoSelect
          fundos={fundosDisponiveis}
          value={fundoId}
          onChange={setFundoId}
          disabled={isEditing}
          hasError={validationErrors.has("fundoId")}
          permitirCatalogo={!ehSaida}
          onFecharBoleta={() => onFechar?.()}
          // No come-cotas a lista de fundos da custodia so aparece depois do clique no campo.
          abrirAoMontar={!isEditing && !ehComeCotas}
        />
      )}
    </Field>
  );

  return (
    <div className="space-y-6">

      {/* Form card */}
      <div className="w-full max-w-2xl min-w-0 rounded-md border border-border bg-card p-6 space-y-5">
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
                options={(isAcao ? TIPOS_MOVIMENTACAO_ACAO : isMoeda ? TIPOS_MOVIMENTACAO_MOEDA : isFundo ? TIPOS_MOVIMENTACAO_FUNDO : TIPOS_MOVIMENTACAO).map((t) => ({
                  value: t,
                  label: t,
                  disabled: !isFundo && !isMoeda && !isAcao && t !== "Aplicação" && t !== "Resgate",
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
              <strong>Fundos de Investimentos</strong>, <strong>Moedas</strong> e{" "}
              <strong>Renda Variável</strong>.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Ações ── */}
        {showAcaoFields && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data da Transação" required>
                <Input type="date" value={data} min={limitesData.min} max={limitesData.max} onChange={(e) => setData(e.target.value)} />
              </Field>
              <Field label="Ação" required>
                <AcaoSelect
                  value={acaoId}
                  disabled={isEditing}
                  onChange={(id, ticker, nome, deslistadoEm) => {
                    setAcaoId(id); setAcaoTicker(ticker); setAcaoNome(nome);
                    setAcaoDeslistadoEm(deslistadoEm ?? null);
                  }}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço por Ação (R$)" required>
                <Input
                  value={valor}
                  onChange={(e) => setValor(formatCurrency(e.target.value))}
                  placeholder="0,00"
                  inputMode="numeric"
                />
              </Field>
              <Field label="Quantidade de Ações" required>
                <Input
                  value={qtdCotas}
                  onChange={(e) => setQtdCotas(e.target.value.replace(/[^\d,.]/g, ""))}
                  placeholder="Ex.: 100"
                />
              </Field>
            </div>

            {/* Total calculado, como na boleta do GorilaVIEW. Mostrar o produto na tela e o
                que torna visivel um erro de casa decimal ANTES de gravar. */}
            {valor && parseQuantidade(qtdCotas) != null && (
              <p className="text-sm text-muted-foreground">
                Total da operação:{" "}
                <strong className="text-foreground">
                  {(parseCurrencyToNumber(valor) * (parseQuantidade(qtdCotas) ?? 0))
                    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </strong>
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Custos da Operação (R$)">
                <Input
                  value={custosOp}
                  onChange={(e) => setCustosOp(formatCurrency(e.target.value))}
                  placeholder="Corretagem e emolumentos"
                  inputMode="numeric"
                />
              </Field>
              <Field label="Instituição (custodiante)" required>
                <EntidadeSelect
                  tipo="instituicao"
                  value={instituicaoId}
                  onChange={(id, nome) => { setInstituicaoId(id); setInstituicaoNome(nome); }}
                  tituloCadastro="Cadastrar Nova Instituição"
                  labelCadastro="Nome da Instituição"
                  placeholder="Busque a corretora"
                />
              </Field>
            </div>

            <p className="text-xs text-muted-foreground">
              A quantidade em branco é derivada pelo fechamento do dia. Informe a quantidade
              quando quiser registrar o preço em que executou de fato. Dividendos e JCP entram
              sozinhos, pela data-ex - não precisam ser lançados.
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
        {showFundoFields && campoFundo}
        {showFundoFields && !fundoId && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onFechar?.()}>
              Cancelar
            </Button>
          </div>
        )}
        {showFundoFields && !!fundoId && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data de Cotização" required>
                {/* Calendario de 02/01/2023 (ou da primeira cota) ate a ultima cota, sem fim de semana. */}
                <CampoDataCalendario
                  value={data}
                  onChange={setData}
                  min={janelaFundo.min}
                  max={janelaFundo.max}
                  mensagem={mensagemDataFundo}
                />
              </Field>
              <Field label="Valor" required>
                <Input
                  value={valor}
                  onChange={(e) => setValor(formatCurrency(e.target.value))}
                  placeholder="0,00"
                  inputMode="numeric"
                />
                {/* Num resgate, o saldo na data compoe o campo: so o valor em reais. No come-cotas o
                    valor vem do extrato e o saldo nao ajuda em nada. */}
                {ehSaida && !ehComeCotas && data && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {comSaldo == null
                      ? "Calculando o saldo..."
                      : saldoDaSaida != null && cotaOp?.cota != null
                        ? `Saldo disponível em ${fmtData(data)}: ${fmtBrlDisplay(saldoDaSaida * cotaOp.cota)}`
                        : ""}
                  </p>
                )}
              </Field>
            </div>

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
              <Field label="Quantidade de Cotas">
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

                    {/* Venda no secundário: o valor sugerido é a curva, mas quem manda é o preço */}
                    {vendaNoSecundario && fecharPosicao && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {ehVendaComPrecoProprio ? (
                            <>
                              Venda no mercado secundário: o valor informado fica{" "}
                              <strong>
                                {diferencaParaCurva > 0 ? "acima" : "abaixo"} da curva em{" "}
                                {fmtBrlDisplay(Math.abs(diferencaParaCurva))}
                              </strong>
                              . Ele será preservado e não recalculado.
                            </>
                          ) : (
                            <>
                              O valor sugerido é o da curva. Se vendeu no mercado secundário por
                              outro preço, digite o valor efetivamente recebido - ele pode ser
                              maior ou menor que o saldo.
                            </>
                          )}
                        </AlertDescription>
                      </Alert>
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
    // `min-w-0`: item de grid nasce com `min-width: auto` e cresce para caber o conteudo em vez
    // de encolher. Sem isto, um nome de fundo comprido alarga a coluna e o modal inteiro ganha
    // barra de rolagem horizontal.
    <div className="min-w-0 space-y-1.5">
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
