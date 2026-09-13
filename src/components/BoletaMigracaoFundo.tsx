/**
 * Boleta de migracao de posicao de fundo (decisao do Daniel, 12/09/2026).
 *
 * Aberta pelo "!" do fundo que parou de receber cota. Ja vem com a posicao de origem (fundo, instituicao,
 * ultima cota, quantidade e valor); o cliente escolhe o fundo novo e confere a quantidade sugerida.
 *
 * Grava duas movimentacoes ligadas por `transferencia_id`, na data da primeira cota do fundo novo depois da
 * ultima do antigo:
 * - "Migração (saída)": fecha a posicao antiga com o saldo exato, pelo valor da ultima cota;
 * - "Migração (entrada)": abre (ou soma na) posicao do fundo novo, na mesma instituicao, com a quantidade
 *   informada e o MESMO valor da saida. O rendimento do intervalo aparece como ganho do fundo novo, e nao
 *   como aporte.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import FundoSelect, { formatarCnpj } from "@/components/FundoSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fullSyncAfterMovimentacao } from "@/lib/syncEngine";
import { proximoCodigoCustodia } from "@/lib/codigoCustodia";
import { fmtData, saldoEmQuantidade } from "@/lib/validacaoBoleta";
import { quantidadeSugeridaNaMigracao, type AlertaSemCota } from "@/lib/alertaDeFundo";
import { TIPO_MIGRACAO_ENTRADA, TIPO_MIGRACAO_SAIDA } from "@/lib/posicaoDeFundo";

const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 });
const fmtBrl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "70.590,77770397" -> 70590.77770397 */
const lerQtd = (t: string): number | null => {
  const n = Number(t.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface Destino { nome: string; cnpj: string; data: string; cota: number }

export default function BoletaMigracaoFundo({ origem, onFechar }: { origem: AlertaSemCota; onFechar: () => void }) {
  const { user } = useAuth();
  const { dataReferenciaISO, applyDataReferencia } = useDataReferencia();
  const [saldo, setSaldo] = useState<number | null>(null);
  const [novoFundoId, setNovoFundoId] = useState("");
  const [destino, setDestino] = useState<Destino | null>(null);
  const [semCotaDepois, setSemCotaDepois] = useState(false);
  const [qtd, setQtd] = useState("");
  const [criterio, setCriterio] = useState<"mesma" | "valor" | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Saldo da posicao na ultima cota: e ele que sai, e dele vem a quantidade sugerida.
  useEffect(() => {
    if (!user) return;
    let vivo = true;
    saldoEmQuantidade(origem.codigoCustodia, user.id, origem.ultimaCota).then((s) => { if (vivo) setSaldo(s); });
    return () => { vivo = false; };
  }, [user, origem.codigoCustodia, origem.ultimaCota]);

  const valorTransferido = saldo != null && origem.valorCota != null
    ? Math.round(saldo * origem.valorCota * 100) / 100
    : null;
  const mesmoFundo = !!novoFundoId && novoFundoId === origem.fundoId;

  // Fundo novo escolhido: a migracao acontece na primeira cota dele depois da ultima do antigo.
  useEffect(() => {
    setDestino(null);
    setSemCotaDepois(false);
    setQtd("");
    setCriterio(null);
    if (!novoFundoId || saldo == null || novoFundoId === origem.fundoId) return;
    let vivo = true;
    (async () => {
      const [{ data: cadastro }, { data: cota }] = await Promise.all([
        supabase.from("cadastro_de_fundos").select("nome_curto, cnpj_classe").eq("id", novoFundoId).maybeSingle(),
        supabase.from("cotas_fundos").select("data, valor_cota").eq("fundo_id", novoFundoId)
          .gt("data", origem.ultimaCota).order("data").limit(1).maybeSingle(),
      ]);
      if (!vivo) return;
      if (!cota) { setSemCotaDepois(true); return; }
      const cotaNova = Number(cota.valor_cota);
      const sugestao = quantidadeSugeridaNaMigracao(saldo, origem.valorCota, cotaNova);
      setDestino({ nome: cadastro?.nome_curto ?? "", cnpj: cadastro?.cnpj_classe ?? "", data: cota.data, cota: cotaNova });
      setQtd(fmtQtd(sugestao.quantidade));
      setCriterio(sugestao.criterio);
    })();
    return () => { vivo = false; };
  }, [novoFundoId, saldo, origem.fundoId, origem.ultimaCota, origem.valorCota]);

  const qtdNum = lerQtd(qtd);

  const migrar = async () => {
    if (!user || !destino || saldo == null || valorTransferido == null || !qtdNum || mesmoFundo) return;
    if (!(saldo > 1e-8)) {
      toast.error("A posição não tem saldo para migrar.");
      return;
    }
    setSalvando(true);
    try {
      const { data: base, error: eBase } = await supabase.from("movimentacoes")
        .select("categoria_id, produto_id, instituicao_id, nome_ativo")
        .eq("user_id", user.id).eq("codigo_custodia", origem.codigoCustodia)
        .order("data").limit(1).maybeSingle();
      if (eBase) throw eBase;
      if (!base) throw new Error("Posição de origem não encontrada.");

      // Mesmo fundo novo na mesma instituicao e a mesma posicao: a entrada soma nela.
      const { data: existente } = await supabase.from("movimentacoes")
        .select("codigo_custodia")
        .eq("user_id", user.id).eq("fundo_id", novoFundoId).eq("instituicao_id", base.instituicao_id)
        .not("codigo_custodia", "is", null).limit(1);
      const codigoDestino = existente && existente.length > 0
        ? String(existente[0].codigo_custodia)
        : await proximoCodigoCustodia();

      const transferenciaId = crypto.randomUUID();
      const comum = {
        user_id: user.id,
        categoria_id: base.categoria_id,
        produto_id: base.produto_id,
        instituicao_id: base.instituicao_id,
        data: destino.data,
        data_cotizacao: destino.data,
        valor: valorTransferido,
        origem: "migracao",
        transferencia_id: transferenciaId,
      };

      const { data: saida, error: eSaida } = await supabase.from("movimentacoes").insert({
        ...comum,
        fundo_id: origem.fundoId,
        codigo_custodia: origem.codigoCustodia,
        nome_ativo: base.nome_ativo,
        tipo_movimentacao: TIPO_MIGRACAO_SAIDA,
        quantidade: saldo,
        preco_unitario: origem.valorCota,
        observacao: `Migração para ${destino.nome} (CNPJ ${formatarCnpj(destino.cnpj)}) em ${fmtData(destino.data)}.`,
      }).select("id").single();
      if (eSaida) throw eSaida;

      const { data: entrada, error: eEntrada } = await supabase.from("movimentacoes").insert({
        ...comum,
        fundo_id: novoFundoId,
        codigo_custodia: codigoDestino,
        nome_ativo: destino.nome,
        tipo_movimentacao: TIPO_MIGRACAO_ENTRADA,
        quantidade: qtdNum,
        preco_unitario: destino.cota,
        fator_conversao: qtdNum / saldo,
        observacao: `Migração de ${origem.fundoNome} em ${fmtData(destino.data)}.`,
      }).select("id").single();
      if (eEntrada) {
        await supabase.from("movimentacoes").delete().eq("id", saida.id);
        throw eEntrada;
      }

      await fullSyncAfterMovimentacao(saida.id, String(base.categoria_id), user.id, dataReferenciaISO);
      await fullSyncAfterMovimentacao(entrada.id, String(base.categoria_id), user.id, dataReferenciaISO);
      applyDataReferencia();
      toast.success(`Posição migrada para ${destino.nome}.`);
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível migrar a posição.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Migrar posição</h2>
        <p className="text-sm text-muted-foreground">
          A posição atual é encerrada e as cotas passam para o fundo novo, sem resgate nem aplicação.
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-border bg-muted/30 px-4 py-3">
        <p className="break-words text-sm font-semibold text-foreground">{origem.fundoNome}</p>
        <p className="text-xs text-muted-foreground">{origem.instituicaoNome}</p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Info rotulo={`Última cota (${fmtData(origem.ultimaCota)})`} valor={origem.valorCota != null ? fmtQtd(origem.valorCota) : "—"} />
          <Info rotulo="Quantidade de cotas" valor={saldo != null ? fmtQtd(saldo) : "Calculando..."} />
          <Info rotulo="Valor da posição" valor={valorTransferido != null ? fmtBrl(valorTransferido) : "—"} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Fundo novo<span className="ml-0.5 text-destructive">*</span>
        </label>
        <FundoSelect fundos={[]} value={novoFundoId} onChange={setNovoFundoId} abrirAoMontar onFecharBoleta={onFechar} />
        <p className="h-4 text-xs font-medium leading-4 text-destructive">
          {mesmoFundo
            ? "Escolha um fundo diferente do atual."
            : semCotaDepois
              ? `Este fundo não tem cota publicada depois de ${fmtData(origem.ultimaCota)}.`
              : ""}
        </p>
      </div>

      {destino && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">Data da migração</p>
              <p className="h-9 py-2 text-sm leading-5 text-foreground">{fmtData(destino.data)}</p>
              <p className="text-xs text-muted-foreground">Primeira cota do fundo novo: {fmtQtd(destino.cota)}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Quantidade de cotas no fundo novo<span className="ml-0.5 text-destructive">*</span>
              </label>
              <Input
                value={qtd}
                inputMode="decimal"
                onChange={(e) => setQtd(e.target.value.replace(/[^\d.,]/g, ""))}
                className={qtdNum ? "" : "border-destructive"}
              />
              <p className="text-xs text-muted-foreground">
                {criterio === "valor"
                  ? "Sugerida pelo valor: a cota nova é diferente da antiga."
                  : "Sugerida: a mesma quantidade (cota nova até 2% da antiga)."}{" "}
                Confira no extrato.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Valor transferido: {valorTransferido != null ? fmtBrl(valorTransferido) : "—"} · Valor no fundo novo em{" "}
            {fmtData(destino.data)}: {qtdNum ? fmtBrl(qtdNum * destino.cota) : "—"}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={migrar} disabled={salvando || !destino || !qtdNum || mesmoFundo || valorTransferido == null}>
          {salvando ? "Migrando..." : "Migrar"}
        </Button>
        <Button variant="outline" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{rotulo}</p>
      <p className="font-semibold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}
