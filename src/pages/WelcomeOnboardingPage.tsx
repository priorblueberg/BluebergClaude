import { useState, useEffect } from "react";
import { PlusCircle, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import SearchableSelect from "@/components/SearchableSelect";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Reuse types and helpers from CadastrarTransacaoPage
interface Produto { id: string; nome: string; }
interface Instituicao { id: string; nome: string; }
interface Emissor { id: string; nome: string; }
interface Categoria { id: string; nome: string; }

const PAGAMENTO_OPTIONS = ["Mensal", "Bimestral", "Trimestral", "Quatrimestral", "Semestral", "No Vencimento"];
const MODALIDADE_OPTIONS = ["Prefixado", "Pós Fixado"];
const INDEXADOR_OPTIONS = ["CDI", "CDI+"];

function formatCurrency(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  return (num / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatValorInicial(value: string): string {
  let cleaned = value.replace(/[^\d,]/g, "");
  const parts = cleaned.split(",");
  if (parts.length > 2) cleaned = parts[0] + "," + parts.slice(1).join("");
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
  if (parts.length > 2) cleaned = parts[0] + "," + parts.slice(1).join("");
  if (parts.length === 1) {
    const intDigits = parts[0].replace(/^0+(?=\d)/, "") || "";
    if (!intDigits) return "";
    return intDigits + ",00";
  }
  let decPart = parts[1].slice(0, 2).padEnd(2, "0");
  const intPart = parts[0].replace(/^0+(?=\d)/, "") || "0";
  return intPart + "," + decPart;
}

function parseCurrencyToNumber(value: string): number {
  return parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
}

function buildNomeAtivo(produtoNome: string, emissorNome: string, modalidade: string, taxa: string, vencimento: string, indexador: string): string {
  const taxaFormatted = taxa ? `${taxa.replace(".", ",")}%` : "";
  const vencFormatted = vencimento ? new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "";
  if (modalidade === "Prefixado") return [produtoNome, emissorNome, modalidade, taxaFormatted ? `${taxaFormatted} a.a.` : "", vencFormatted ? `- ${vencFormatted}` : ""].filter(Boolean).join(" ");
  if (indexador === "CDI") return [produtoNome, emissorNome, modalidade, taxaFormatted, "do CDI", vencFormatted ? `- ${vencFormatted}` : ""].filter(Boolean).join(" ");
  return [produtoNome, emissorNome, modalidade, indexador, taxaFormatted, vencFormatted ? `- ${vencFormatted}` : ""].filter(Boolean).join(" ");
}

export default function WelcomeOnboardingPage() {
  const { user, profileName, refreshCustodia } = useAuth();

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([]);
  const [emissores, setEmissores] = useState<Emissor[]>([]);
  const [categoriaId, setCategoriaId] = useState("");
  const [categoriaNome, setCategoriaNome] = useState("");

  // form state
  const [produtoId, setProdutoId] = useState("");
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
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());

  const isPosFixado = modalidade === "Pós Fixado";
  const isPoupanca = categoriaNome === "Poupança";

  useEffect(() => {
    supabase.from("categorias").select("id, nome").eq("ativa", true).order("nome").then(({ data }) => {
      if (data) {
        const filtered = data.filter((c: any) => c.nome === "Renda Fixa" || c.nome === "Poupança");
        setCategorias(filtered);
      }
    });
    supabase.from("instituicoes").select("id, nome").eq("ativa", true).order("nome").then(({ data }) => { if (data) setInstituicoes(data); });
    supabase.from("emissores").select("id, nome").eq("ativo", true).order("nome").then(({ data }) => { if (data) setEmissores(data); });
  }, []);

  useEffect(() => {
    if (!categoriaId) return;
    supabase.from("produtos").select("id, nome").eq("categoria_id", categoriaId).eq("ativo", true).order("nome").then(({ data }) => {
      if (data) {
        setProdutos(data);
        // Auto-select product for Poupança
        if (isPoupanca && data.length > 0) {
          setProdutoId(data[0].id);
        }
      }
    });
  }, [categoriaId, isPoupanca]);

  const handleSubmit = async () => {
    if (!user) { toast.error("Usuário não autenticado."); return; }

    const requiredFields: Record<string, string> = isPoupanca
      ? { produtoId, valor, data, instituicaoId }
      : { produtoId, valor, data, precoUnitario, instituicaoId, emissorId, modalidade, taxa, pagamento, vencimento };
    if (!isPoupanca && isPosFixado) requiredFields.indexador = indexador;

    const emptyFields = Object.entries(requiredFields).filter(([, v]) => !v).map(([k]) => k);
    if (emptyFields.length > 0) {
      setValidationErrors(new Set(emptyFields));
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    setValidationErrors(new Set());

    // Validate business day (skip for Poupança)
    if (!isPoupanca) {
      const { data: diaUtil } = await supabase.from("calendario_dias_uteis").select("dia_util").eq("data", data).single();
      if (!diaUtil) { toast.error("Data não encontrada no calendário."); return; }
      if (!diaUtil.dia_util) { toast.error("A Data de Transação deve ser um dia útil."); return; }
    }

    setSubmitting(true);
    try {
      const produtoNome = produtos.find((p) => p.id === produtoId)?.nome || "";
      const valorNum = parseCurrencyToNumber(valor);
      const fmtBR = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      let nomeAtivo: string;
      let puNum: number;
      let taxaNum: number | null;
      let quantidade: number | null;
      let modalidadeToSave: string | null;
      let indexadorToSave: string | null;
      let valorExtrato: string;

      if (isPoupanca) {
        const instNome = instituicoes.find((i) => i.id === instituicaoId)?.nome || "";
        nomeAtivo = `Poupança ${instNome}`;
        puNum = 1;
        taxaNum = null;
        quantidade = valorNum;
        modalidadeToSave = "Poupança";
        indexadorToSave = null;
        valorExtrato = `R$ ${fmtBR(valorNum)}`;
      } else {
        const emissorNome = emissores.find((e) => e.id === emissorId)?.nome || "";
        nomeAtivo = buildNomeAtivo(produtoNome, emissorNome, modalidade, taxa, vencimento, indexador);
        puNum = parseCurrencyToNumber(precoUnitario);
        taxaNum = parseFloat(taxa.replace(",", "."));
        quantidade = puNum > 0 ? valorNum / puNum : null;
        modalidadeToSave = modalidade;
        indexadorToSave = isPosFixado ? indexador : null;
        if (modalidade === "Pós Fixado" && indexador === "CDI+") { modalidadeToSave = "Mista"; indexadorToSave = "CDI"; }
        valorExtrato = quantidade != null ? `R$ ${fmtBR(valorNum)} (R$ ${fmtBR(puNum)} x ${fmtBR(quantidade)})` : `R$ ${fmtBR(valorNum)}`;
      }

      const { data: maxRow } = await supabase.from("movimentacoes").select("codigo_custodia").not("codigo_custodia", "is", null).order("codigo_custodia", { ascending: false }).limit(1);
      const maxCodigo = maxRow && maxRow.length > 0 ? (maxRow[0].codigo_custodia ?? 99) : 99;
      const codigoCustodia = maxCodigo + 1;

      const { error } = await supabase.from("movimentacoes").insert({
        categoria_id: categoriaId,
        tipo_movimentacao: "Aplicação Inicial",
        data,
        produto_id: produtoId,
        valor: valorNum,
        preco_unitario: puNum,
        instituicao_id: instituicaoId,
        emissor_id: isPoupanca ? null : emissorId,
        modalidade: modalidadeToSave,
        taxa: taxaNum,
        pagamento: isPoupanca ? "Mensal" : pagamento,
        vencimento: isPoupanca ? null : vencimento,
        nome_ativo: nomeAtivo,
        codigo_custodia: codigoCustodia,
        indexador: indexadorToSave,
        quantidade,
        valor_extrato: valorExtrato,
        user_id: user.id,
        origem: "manual",
      });

      if (error) throw error;

      const { data: inserted } = await supabase.from("movimentacoes").select("id").eq("codigo_custodia", codigoCustodia).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
      const insertedId = inserted?.[0]?.id || null;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dataReferenciaISO = yesterday.toISOString().slice(0, 10);

      await fullSyncAfterMovimentacao(insertedId, categoriaId, user.id, dataReferenciaISO);
      await refreshCustodia();
      toast.success("Título cadastrado com sucesso! Bem-vindo à plataforma.");
    } catch (err: any) {
      toast.error("Erro ao cadastrar título.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = (field: string) => setValidationErrors((prev) => { const n = new Set(prev); n.delete(field); return n; });

  const firstName = profileName?.split(" ")[0] || "usuário";

  return (
    <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
      {/* Left panel - welcome text */}
      <div className="hidden lg:block lg:w-[45%]">
        <div className="max-w-xl space-y-6">
          <h2 className="text-3xl font-bold text-foreground leading-tight">
            Olá {profileName || firstName}
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Se você está aqui hoje, é porque de alguma forma acompanha a construção da Blueberg e ter você nesse momento é parte essencial para que tudo isso dê certo.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Então em primeira mão lá vai o <strong className="text-foreground">MVP1 da nossa ferramenta</strong>...<br />
            <strong className="text-foreground">Cálculo de rentabilidade de títulos privados de Renda Fixa, Prefixados e Pós Fixados CDI.</strong>
          </p>

          <div>
            <p className="font-semibold text-foreground mb-1">Operações disponíveis:</p>
            <p className="text-muted-foreground leading-relaxed">
              CDB, LCI, LCA CRI, CRA, LF e Debentures prefixados, que rendem uma porcentagem do CDI ou que pagam o CDI mais uma taxa. Há... Com pagamento de juros no vencimento ou periódico. Essa graninha aí a gente também calcula pra você.
            </p>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-2">O que você pode fazer neste MVP:</p>
            <ul className="space-y-1.5 text-muted-foreground text-sm">
              <li>📊 Acompanhar a rentabilidade da sua carteira de renda fixa com gráficos históricos, comparando seu desempenho com CDI e Ibovespa</li>
              <li>🧩 Visualizar a alocação do portfólio por estratégia, custodiante e emissor em gráficos interativos</li>
              <li>🔍 Analisar cada ativo individualmente</li>
              <li>📑 Consultar movimentações e proventos com filtros e buscas</li>
              <li>⏳ Navegar por diferentes datas de e acompanhar a evolução do seu patrimônio ao longo do tempo</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1">Seu feedback é fundamental</p>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Essa é uma versão inicial — e foi feita para evoluir com você.<br />
              Se algo não fizer sentido, se algo puder melhorar, ou se você simplesmente tiver uma ideia: fala comigo.<br />
              Vale tudo: mensagem, áudio, ligação…<br />
              "Me liga, me manda um telegrama, uma carta de amor…" 😄<br /><br />
              Obrigado por estar junto nessa construção.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 lg:w-[55%] lg:border-l border-border lg:pl-12">
        <div className="w-full max-w-2xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Cadastre seu primeiro título</h1>
            <p className="mt-2 text-muted-foreground">
              É necessário ter ao menos um título cadastrado para ter acesso total a ferramenta
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Os campos com * são de preenchimento obrigatório</p>
          </div>

          <div className="space-y-5">
            {/* Categoria */}
            <Field label="Categoria" required>
              <NativeSelect
                value={categoriaId}
                onChange={(v) => {
                  setCategoriaId(v);
                  const cat = categorias.find((c) => c.id === v);
                  setCategoriaNome(cat?.nome || "");
                  setProdutoId("");
                  clearError("produtoId");
                }}
                placeholder="Selecione"
                options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
              />
            </Field>

            {/* Produto (hidden for Poupança since auto-selected) */}
            {categoriaId && !isPoupanca && (
              <Field label="Produto" required>
                <NativeSelect
                  value={produtoId}
                  onChange={(v) => { setProdutoId(v); clearError("produtoId"); }}
                  placeholder="Selecione"
                  options={produtos.map((p) => ({ value: p.id, label: p.nome }))}
                  hasError={validationErrors.has("produtoId")}
                />
              </Field>
            )}

            {(isPoupanca ? categoriaId : produtoId) && (
              <>
                {/* Poupança: simplified form */}
                {isPoupanca ? (
                  <>
                    <Field label="Data de Transação" required>
                      <input type="date" value={data} onChange={(e) => { setData(e.target.value); clearError("data"); }}
                        className={`input-field ${validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                    </Field>

                    <Field label="Valor Inicial" required>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                        <input type="text" value={valor} onChange={(e) => { setValor(formatValorInicial(e.target.value)); clearError("valor"); }}
                          placeholder="0,00" className={`input-field pl-9 ${validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                      </div>
                    </Field>

                    <Field label="Banco" required>
                      <SearchableSelect value={instituicaoId} onChange={(v) => { setInstituicaoId(v); clearError("instituicaoId"); }}
                        placeholder="Pesquisar banco..." hasError={validationErrors.has("instituicaoId")}
                        options={instituicoes.map((i) => ({ value: i.id, label: i.nome }))} />
                    </Field>
                  </>
                ) : (
                  <>
                    {/* Renda Fixa: full form */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Data de Transação" required>
                        <input type="date" value={data} onChange={(e) => { setData(e.target.value); clearError("data"); }}
                          className={`input-field ${validationErrors.has("data") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                      </Field>
                      <Field label="Vencimento" required>
                        <input type="date" value={vencimento} min={data || undefined} onChange={(e) => { setVencimento(e.target.value); clearError("vencimento"); }}
                          className={`input-field ${validationErrors.has("vencimento") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Valor Inicial" required>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                          <input type="text" value={valor} onChange={(e) => { setValor(formatValorInicial(e.target.value)); clearError("valor"); }}
                            placeholder="0,00" className={`input-field pl-9 ${validationErrors.has("valor") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                        </div>
                      </Field>
                      <Field label="Preço de Emissão" required>
                        <TooltipProvider>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                            <input type="text" value={precoUnitario} onChange={(e) => { setPrecoUnitario(formatCurrency(e.target.value)); clearError("precoUnitario"); }}
                              placeholder="1.000,00" className={`input-field pl-9 pr-8 ${validationErrors.has("precoUnitario") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 cursor-help text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" /></span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[220px] text-xs">Caso não saiba, deixe o valor de R$ 1.000,00 (Padrão)</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Corretora" required>
                        <SearchableSelect value={instituicaoId} onChange={(v) => { setInstituicaoId(v); clearError("instituicaoId"); }}
                          placeholder="Pesquisar corretora..." hasError={validationErrors.has("instituicaoId")}
                          options={instituicoes.map((i) => ({ value: i.id, label: i.nome }))} />
                      </Field>
                      <Field label="Emissor" required>
                        <SearchableSelect value={emissorId} onChange={(v) => { setEmissorId(v); clearError("emissorId"); }}
                          placeholder="Pesquisar emissor..." hasError={validationErrors.has("emissorId")}
                          options={emissores.map((e) => ({ value: e.id, label: e.nome }))} />
                      </Field>
                    </div>

                    <div className={`grid gap-4 ${isPosFixado ? "grid-cols-4" : "grid-cols-3"}`}>
                      <Field label="Modalidade" required>
                        <NativeSelect value={modalidade} onChange={(v) => { setModalidade(v); if (v !== "Pós Fixado") setIndexador(""); clearError("modalidade"); }}
                          placeholder="Selecione" options={MODALIDADE_OPTIONS.map((m) => ({ value: m, label: m }))} hasError={validationErrors.has("modalidade")} />
                      </Field>
                      {isPosFixado && (
                        <Field label="Indexador" required>
                          <NativeSelect value={indexador} onChange={(v) => { setIndexador(v); clearError("indexador"); }}
                            placeholder="Selecione" options={INDEXADOR_OPTIONS.map((idx) => ({ value: idx, label: idx }))} hasError={validationErrors.has("indexador")} />
                        </Field>
                      )}
                      <Field label="Taxa" required>
                        <div className="relative">
                          <input type="text" value={taxa} onChange={(e) => { setTaxa(formatTaxaInput(e.target.value)); clearError("taxa"); }}
                            placeholder="0,00" className={`input-field pr-7 ${validationErrors.has("taxa") ? "border-destructive ring-1 ring-destructive" : ""}`} />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                        </div>
                      </Field>
                      <Field label="Pagamento de Juros" required>
                        <NativeSelect value={pagamento} onChange={(v) => { setPagamento(v); clearError("pagamento"); }}
                          placeholder="Selecione" options={PAGAMENTO_OPTIONS.map((p) => ({ value: p, label: p }))} hasError={validationErrors.has("pagamento")} />
                      </Field>
                    </div>
                  </>
                )}

                {/* Submit */}
                <div className="pt-2">
                  <button type="button" onClick={handleSubmit} disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(145,63%,32%)] px-5 py-3 text-sm font-medium text-white hover:bg-[hsl(145,63%,28%)] transition-colors disabled:opacity-50">
                    <PlusCircle size={16} />
                    {submitting ? "Enviando..." : "Cadastrar Título"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}{required && <span className="text-destructive ml-0.5">*</span>}</label>
      {children}
    </div>
  );
}

function NativeSelect({ value, onChange, placeholder, options, disabled, hasError }: {
  value: string; onChange: (v: string) => void; placeholder: string;
  options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean; hasError?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      className={`input-field ${hasError ? "border-destructive ring-1 ring-destructive" : ""}`}>
      <option value="">{placeholder}</option>
      {options.map((o) => (<option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  );
}
