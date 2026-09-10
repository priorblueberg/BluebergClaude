import { useEffect, useState } from "react";
import { toast } from "sonner";
import { carregarFundo, PrecisaSubclasse } from "@/lib/carregarFundo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

export interface FundoCriado {
  id: string;
  nome: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCriado: (fundo: FundoCriado) => void;
}

const mascaraCnpj = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

/**
 * Cadastro de fundo novo pelo CNPJ.
 *
 * A edge function `cadastrar-fundo` busca o registro na CVM e traz a serie de
 * cotas do informe diario. O backfill vem paginado (12 meses por chamada), entao
 * o modal chama em sequencia ate a CVM nao ter mais mes pendente.
 */
export default function CadastrarFundoModal({ open, onOpenChange, onCriado }: Props) {
  const [cnpj, setCnpj] = useState("");
  const [desde, setDesde] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [subclasses, setSubclasses] = useState<string[] | null>(null);
  const [subclasse, setSubclasse] = useState("");

  useEffect(() => {
    if (open) {
      setCnpj(""); setDesde(""); setProgresso(null); setSubclasses(null); setSubclasse("");
    }
  }, [open]);

  const handleSalvar = async () => {
    const digitos = cnpj.replace(/\D/g, "");
    if (digitos.length !== 14) {
      toast.error("Informe um CNPJ com 14 dígitos.");
      return;
    }
    setSalvando(true);
    setProgresso("Buscando o fundo no cadastro da CVM...");

    try {
      const r = await carregarFundo(digitos, {
        desde: desde || null,
        subclasse: subclasse || null,
        aoProgredir: (cotas, mes) => setProgresso(`Carregando cotas... ${cotas} até agora (${mes}).`),
      });
      toast.success(`Fundo cadastrado com ${r.cotas} cotas carregadas.`);
      onCriado({ id: r.fundoId, nome: r.nomeCurto || "Fundo" });
      onOpenChange(false);
    } catch (e: any) {
      // Mesmo CNPJ publicando mais de uma subclasse: sem escolher, gravaria cota errada em
      // silencio. O usuario decide qual e a dele.
      if (e instanceof PrecisaSubclasse) {
        setSubclasses(e.opcoes);
        setProgresso(null);
        setSalvando(false);
        toast.warning(e.message);
        return;
      }
      toast.error(e?.message || "Não foi possível cadastrar o fundo.");
    } finally {
      setSalvando(false);
      setProgresso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar novo fundo</DialogTitle>
          <DialogDescription>
            Informe o CNPJ da classe. O cadastro e a série de cotas vêm da CVM.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">CNPJ do fundo</label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(mascaraCnpj(e.target.value))}
              placeholder="00.000.000/0001-00"
              disabled={salvando}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Cotas a partir de (opcional)</label>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              disabled={salvando}
            />
            <p className="text-xs text-muted-foreground">
              Em branco, carrega desde o início do fundo. Informe a data da sua primeira
              aplicação para a carga ser mais rápida.
            </p>
          </div>

          {subclasses && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Subclasse</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subclasse}
                onChange={(e) => setSubclasse(e.target.value)}
              >
                <option value="">Selecione</option>
                {subclasses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Este CNPJ publica mais de uma subclasse na CVM, cada uma com sua cota.
                A do seu extrato é a que vale.
              </p>
            </div>
          )}

          {progresso && <p className="text-xs text-muted-foreground">{progresso}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? "Cadastrando..." : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
