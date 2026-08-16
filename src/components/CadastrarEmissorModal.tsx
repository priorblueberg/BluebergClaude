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

export interface EmissorCriado {
  id: string;
  nome: string;
}

interface CadastrarEmissorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Termo pesquisado na boleta, usado para pre-preencher o campo. */
  nomeInicial?: string;
  onCriado: (emissor: EmissorCriado) => void;
}

/**
 * Cadastro de emissor que a lista do Banco Central nao cobre.
 * O emissor nasce com user_id = dono da sessao (origem 'usuario'), entao a RLS
 * de invest.emissores so o entrega pra ele - nunca pros outros usuarios.
 */
export default function CadastrarEmissorModal({
  open,
  onOpenChange,
  nomeInicial = "",
  onCriado,
}: CadastrarEmissorModalProps) {
  const { user } = useAuth();
  const [nome, setNome] = useState(nomeInicial);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (open) setNome(nomeInicial);
  }, [open, nomeInicial]);

  const handleSalvar = async () => {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      toast.error("Informe o nome do emissor.");
      return;
    }
    if (!user) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }

    setSalvando(true);
    const { data, error } = await supabase
      .from("emissores")
      .insert({ nome: limpo, user_id: user.id, origem: "usuario", ativo: true })
      .select("id, nome")
      .single();
    setSalvando(false);

    if (error) {
      if (error.code === "23505") {
        toast.error("Você já cadastrou esse emissor.");
      } else {
        console.error("Erro ao cadastrar emissor", error);
        toast.error("Não foi possível cadastrar o emissor.");
      }
      return;
    }

    toast.success("Emissor cadastrado.");
    onCriado({ id: data.id, nome: data.nome });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Cadastrar Novo Emissor</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-foreground">Nome do Emissor *</label>
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
            placeholder="Nome do emissor"
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
