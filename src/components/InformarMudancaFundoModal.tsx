import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBoleta } from "@/contexts/BoletaContext";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { fmtData, saldoEmQuantidade } from "@/lib/validacaoBoleta";
import { TIPO_MUDANCA_DE_FUNDO } from "@/lib/posicaoDeFundo";
import FundoSelect, { formatarCnpj } from "@/components/FundoSelect";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Alerta } from "@/hooks/useAlertas";

const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 });
const fmtCota = fmtQtd;
/** "70.590,77770397" -> 70590.77770397 */
const lerQtd = (t: string): number | null => {
  const n = Number(t.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Faixa em que a cota nova e "a mesma" da antiga. Dentro dela a sugestao e manter a quantidade
 * (o caso do Kinea, que virou subclasse de outro fundo com a mesma cota); fora dela, houve fator
 * de conversao e a sugestao e a quantidade que preserva o valor. Nos dois casos quem confirma e o
 * extrato do cliente.
 */
const MESMA_COTA = 0.02;

/** Uma posicao do fundo antigo: desde 12/09/2026 o mesmo fundo em duas instituicoes sao duas. */
interface Posicao { codigo: string; instituicao: string; saldo: number; qtd: string }

/**
 * Resposta do cliente a "Possível alteração na composição do fundo".
 *
 * A ferramenta detectou que a serie do fundo mudou (cota zerada, serie parada, virou subclasses),
 * mas nao sabe o que aconteceu - so o cliente sabe. Tres saidas:
 *
 * - "O fundo mudou": o cliente escolhe o fundo novo e informa a quantidade de cotas. Isso vira
 *   uma "Mudança de Fundo" dentro da MESMA posicao, e a carteira segue sem quebra.
 * - "Resgatei ou o fundo foi liquidado": abre a boleta para o resgate total.
 * - "Não houve mudança": descarta o alerta.
 */
export default function InformarMudancaFundoModal({
  alerta,
  onFechar,
  onMarcar,
  onConcluido,
}: {
  alerta: Alerta;
  onFechar: () => void;
  onMarcar: (status: "resolvido" | "descartado") => Promise<void>;
  onConcluido: () => Promise<void> | void;
}) {
  const d = alerta.detalhe;
  const { user } = useAuth();
  const { abrirBoleta } = useBoleta();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();

  const [etapa, setEtapa] = useState<"pergunta" | "mudou">("pergunta");
  const [novoFundoId, setNovoFundoId] = useState("");
  const [novo, setNovo] = useState<{ nome: string; cnpj: string; data: string; cota: number } | null>(null);
  const [semCotaDepois, setSemCotaDepois] = useState(false);
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [salvando, setSalvando] = useState(false);

  // Saldo de cada posicao no dia da ultima cota: e dele que sai a sugestao de quantidade.
  useEffect(() => {
    if (!user) return;
    let vivo = true;
    Promise.all((d.codigos_custodia ?? []).map(async (codigo) => {
      // A instituicao da posicao (a da primeira movimentacao) identifica cada uma na tela.
      const { data: base } = await supabase.from("movimentacoes")
        .select("instituicao_id")
        .eq("user_id", user.id).eq("codigo_custodia", String(codigo))
        .order("data").limit(1).maybeSingle();
      let instituicao = "";
      if (base?.instituicao_id) {
        const { data: inst } = await supabase.from("instituicoes").select("nome").eq("id", base.instituicao_id).maybeSingle();
        instituicao = inst?.nome ?? "";
      }
      return {
        codigo: String(codigo),
        instituicao,
        saldo: await saldoEmQuantidade(String(codigo), user.id, d.ultima_cota_em),
      };
    })).then((ps) => { if (vivo) setPosicoes(ps.map((p) => ({ ...p, qtd: "" }))); });
    return () => { vivo = false; };
  }, [user, alerta.id, d.codigos_custodia, d.ultima_cota_em]);

  // Fundo novo escolhido: primeira cota dele DEPOIS da ultima do antigo. E nessa data que a
  // posicao passa a ser do fundo novo.
  useEffect(() => {
    if (!novoFundoId) { setNovo(null); setSemCotaDepois(false); return; }
    let vivo = true;
    (async () => {
      const [{ data: cadastro }, { data: cota }] = await Promise.all([
        supabase.from("cadastro_de_fundos").select("nome_curto, cnpj_classe").eq("id", novoFundoId).maybeSingle(),
        supabase.from("cotas_fundos").select("data, valor_cota").eq("fundo_id", novoFundoId)
          .gt("data", d.ultima_cota_em).order("data").limit(1).maybeSingle(),
      ]);
      if (!vivo) return;
      if (!cota) { setNovo(null); setSemCotaDepois(true); return; }
      const cotaNova = Number(cota.valor_cota);
      const cotaAntiga = Number(d.ultima_cota ?? 0);
      const mesmaCota = !(cotaAntiga > 0) || Math.abs(cotaNova / cotaAntiga - 1) <= MESMA_COTA;
      setSemCotaDepois(false);
      setNovo({ nome: cadastro?.nome_curto ?? "", cnpj: cadastro?.cnpj_classe ?? "", data: cota.data, cota: cotaNova });
      setPosicoes((ps) => ps.map((p) => ({
        ...p,
        qtd: fmtQtd(mesmaCota ? p.saldo : (p.saldo * cotaAntiga) / cotaNova),
      })));
    })();
    return () => { vivo = false; };
  }, [novoFundoId, d.ultima_cota_em, d.ultima_cota]);

  const motivo = d.sinal === "cota_zero"
    ? "a CVM passou a publicar a cota deste fundo zerada"
    : d.sinal === "virou_subclasses"
      ? "a CVM passou a publicar este fundo dividido em subclasses"
      : `a CVM não publica a cota deste fundo há ${String(d.evidencias?.dias_uteis_sem_cota ?? "vários")} dias úteis`;

  const descartar = async () => {
    try {
      await onMarcar("descartado");
      toast.success("Alerta descartado.");
      await onConcluido();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível descartar o alerta.");
    }
  };

  const resgatar = () => {
    onFechar();
    abrirBoleta();
    toast.info(`Lance o resgate total de ${d.fundo_nome} com data até ${fmtData(d.ultima_cota_em)}.`);
  };

  const confirmar = async () => {
    if (!user || !novo) return;
    if (novoFundoId === d.fundo_id) {
      toast.error("Escolha um fundo diferente do atual.");
      return;
    }
    const itens = posicoes.map((p) => ({ ...p, n: lerQtd(p.qtd) }));
    if (!itens.length || itens.some((i) => i.n == null)) {
      toast.error("Informe a quantidade de cotas no fundo novo.");
      return;
    }
    setSalvando(true);
    try {
      for (const i of itens) {
        const { data: base, error: eBase } = await supabase.from("movimentacoes")
          .select("categoria_id, produto_id, instituicao_id")
          .eq("user_id", user.id).eq("codigo_custodia", i.codigo)
          .order("data").limit(1).maybeSingle();
        if (eBase) throw eBase;
        if (!base) continue;
        const { data: inserida, error } = await supabase.from("movimentacoes").insert({
          user_id: user.id,
          categoria_id: base.categoria_id,
          produto_id: base.produto_id,
          instituicao_id: base.instituicao_id,
          codigo_custodia: i.codigo,
          fundo_id: novoFundoId,
          nome_ativo: novo.nome,
          data: novo.data,
          data_cotizacao: novo.data,
          tipo_movimentacao: TIPO_MUDANCA_DE_FUNDO,
          valor: Math.round(i.n! * novo.cota * 100) / 100,
          quantidade: i.n,
          // Guardado para a quantidade acompanhar o historico anterior: saldo x fator (Daniel, 12/09/2026).
          fator_conversao: i.saldo > 1e-8 ? i.n! / i.saldo : null,
          preco_unitario: novo.cota,
          origem: "mudanca_de_fundo",
          observacao: `Mudança de fundo informada pelo cliente: ${d.fundo_nome} (CNPJ ${formatarCnpj(d.cnpj)}) `
            + `-> ${novo.nome} (CNPJ ${formatarCnpj(novo.cnpj)}). Última cota do fundo antigo em ${fmtData(d.ultima_cota_em)}.`,
        }).select("id").single();
        if (error) throw error;
        await fullSyncAfterMovimentacao(inserida.id, String(base.categoria_id), user.id, dataReferenciaISO);
      }
      await onMarcar("resolvido");
      applyDataReferencia();
      toast.success("Mudança registrada. A posição segue pelo fundo novo.");
      await onConcluido();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a mudança.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Possível alteração na composição do fundo</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              <p className="break-words text-foreground">{d.fundo_nome}</p>
              <p className="text-xs">CNPJ {formatarCnpj(d.cnpj)}{d.subclasse ? " · Subclasse" : ""}</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        {etapa === "pergunta" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Desde {fmtData(d.ultima_cota_em)}, {motivo}. Isso costuma acontecer quando o fundo muda de
              CNPJ, vira subclasse de outro fundo, é incorporado ou encerrado. Enquanto você não informar
              o que aconteceu, a posição fica parada na última cota publicada.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => setEtapa("mudou")}>O fundo mudou: informar o fundo novo</Button>
              <Button variant="outline" onClick={resgatar}>Resgatei ou o fundo foi liquidado</Button>
              <Button variant="ghost" onClick={descartar}>Não houve mudança</Button>
            </div>
          </div>
        )}

        {etapa === "mudou" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Fundo novo</p>
              <FundoSelect
                fundos={[]}
                value={novoFundoId}
                onChange={setNovoFundoId}
                abrirAoMontar
                onFecharBoleta={onFechar}
              />
              <p className="text-xs text-muted-foreground">
                Procure pelo nome ou CNPJ que aparece no seu extrato. Se o fundo virou subclasse de outro,
                escolha a subclasse.
              </p>
            </div>

            {semCotaDepois && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Este fundo não tem cota publicada depois de {fmtData(d.ultima_cota_em)}. Confira se é o fundo certo.
              </p>
            )}

            {novo && (
              <div className="space-y-3 rounded-md border border-border bg-muted/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  A posição passa a ser do fundo novo em <span className="font-medium text-foreground">{fmtData(novo.data)}</span>,
                  primeira cota dele depois da última do fundo antigo.
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Cota antiga ({fmtData(d.ultima_cota_em)})</p>
                    <p className="font-medium text-foreground">{d.ultima_cota != null ? fmtCota(Number(d.ultima_cota)) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cota nova ({fmtData(novo.data)})</p>
                    <p className="font-medium text-foreground">{fmtCota(novo.cota)}</p>
                  </div>
                </div>
                {posicoes.map((p, i) => (
                  <div key={p.codigo} className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Cotas no fundo novo{posicoes.length > 1 ? ` (${p.instituicao || `posição ${p.codigo}`})` : ""} · antes: {fmtQtd(p.saldo)}
                    </p>
                    <Input
                      value={p.qtd}
                      inputMode="decimal"
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.,]/g, "");
                        setPosicoes((ps) => ps.map((x, k) => (k === i ? { ...x, qtd: v } : x)));
                      }}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  A quantidade sugerida mantém a posição quando a cota continua a mesma e preserva o valor quando
                  houve conversão. Confira no extrato da corretora.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={confirmar} disabled={!novo || salvando}>
                {salvando ? "Registrando..." : "Registrar mudança"}
              </Button>
              <Button variant="outline" onClick={() => setEtapa("pergunta")} disabled={salvando}>Voltar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
