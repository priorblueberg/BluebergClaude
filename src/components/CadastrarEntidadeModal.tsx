import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export type TipoEntidade = "emissor" | "instituicao";

export interface EntidadeCriada {
  id: string;
  nome: string;
}

interface CadastrarEntidadeModalProps {
  tipo: TipoEntidade;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Termo pesquisado na boleta, usado para pre-preencher o campo. */
  nomeInicial?: string;
  /** Titulo do modal, ex.: "Cadastrar Novo Emissor". */
  titulo: string;
  /** Rotulo do campo, ex.: "Nome do Emissor". */
  labelCampo: string;
  onCriado: (entidade: EntidadeCriada) => void;
}

/**
 * Cadastro do que a lista do Banco Central nao cobre (emissor ou instituicao).
 * Nasce com user_id = dono da sessao e origem 'usuario', entao a RLS de
 * invest.emissores / invest.instituicoes so o entrega pra ele.
 */
export default function CadastrarEntidadeModal({
  tipo,
  open,
  onOpenChange,
  nomeInicial = "",
  titulo,
  labelCampo,
  onCriado,
}: CadastrarEntidadeModalProps) {
  const { user } = useAuth();
  const [nome, setNome] = useState(nomeInicial);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (open) setNome(nomeInicial);
  }, [open, nomeInicial]);

  const handleSalvar = async () => {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      toast.error(`Informe o nome ${tipo === "emissor" ? "do emissor" : "da instituição"}.`);
      return;
    }
    if (!user) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }

    setSalvando(true);
    const { data, error } =
      tipo === "emissor"
        ? await supabase
            .from("emissores")
            .insert({ nome: limpo, user_id: user.id, origem: "usuario", ativo: true })
            .select("id, nome")
            .single()
        : await supabase
            .from("instituicoes")
            .insert({ nome: limpo, user_id: user.id, origem: "usuario", ativa: true })
            .select("id, nome")
            .single();
    setSalvando(false);

    if (error) {
      if (error.code === "23505") {
        toast.error(`Você já cadastrou ${tipo === "emissor" ? "esse emissor" : "essa instituição"}.`);
      } else {
        console.error("Erro ao cadastrar", error);
        toast.error("Não foi possível concluir o cadastro.");
      }
      return;
    }

    toast.success("Cadastro concluído.");
    onCriado({ id: data.id, nome: data.nome });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{titulo}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-foreground">{labelCampo} *</label>
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSalvar();
              }
            }}
            placeholder={labelCampo}
          />
          <p className="text-xs text-muted-foreground">
            Fica disponível só na sua conta, em todas as próximas operações.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
