import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { consultarCnpj, formatarCnpj, soDigitos, cnpjValido } from "@/lib/consultaCnpj";
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
 *
 * O CNPJ existe aqui porque emissor de debenture, CRI ou CRA e EMPRESA, e empresa nao esta na
 * lista do Banco Central - que so tem instituicao financeira. Os 1.614 registros vindos do BCB
 * entram com razao social e CNPJ; sem este campo, o que o usuario cadastrava entrava so com o
 * nome digitado, e duas grafias da mesma companhia viravam dois emissores sem como saber que
 * sao o mesmo. A razao social vem da Receita, entao a grafia nao depende de quem digitou.
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
  const [cnpj, setCnpj] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNome(nomeInicial);
      setCnpj("");
      setAviso(null);
    }
  }, [open, nomeInicial]);

  const cnpjCompleto = soDigitos(cnpj).length === 14;

  const handleBuscarCnpj = async () => {
    if (!cnpjValido(cnpj)) {
      toast.error("CNPJ inválido. Confira os números digitados.");
      return;
    }
    setBuscando(true);
    setAviso(null);
    try {
      const dados = await consultarCnpj(cnpj);
      if (!dados) {
        toast.error("CNPJ não encontrado na base da Receita.");
        return;
      }
      setNome(dados.razaoSocial);
      // Empresa baixada ou suspensa nao impede o cadastro - o papel pode ser antigo -, mas o
      // usuario precisa saber que nao esta olhando uma companhia ativa.
      setAviso(
        dados.ativa
          ? null
          : `Situação na Receita: ${dados.situacao ?? "não informada"}. Confira se é a empresa certa.`,
      );
      toast.success("Razão social preenchida.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível consultar o CNPJ.");
    } finally {
      setBuscando(false);
    }
  };

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
    const digitos = soDigitos(cnpj);
    if (digitos.length > 0 && !cnpjValido(digitos)) {
      toast.error("CNPJ inválido. Corrija ou deixe o campo em branco.");
      return;
    }

    setSalvando(true);
    // Os registros do BCB guardam a RAIZ do CNPJ, os oito primeiros digitos; seguimos igual
    // para os dois convivirem na mesma coluna.
    const raiz = digitos ? digitos.slice(0, 8) : null;
    const { data, error } =
      tipo === "emissor"
        ? await supabase
            .from("emissores")
            .insert({ nome: limpo, cnpj: raiz, user_id: user.id, origem: "usuario", ativo: true })
            .select("id, nome")
            .single()
        : await supabase
            .from("instituicoes")
            .insert({ nome: limpo, cnpj: raiz, user_id: user.id, origem: "usuario", ativa: true })
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

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-foreground">CNPJ</label>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={cnpj}
                onChange={(e) => setCnpj(formatarCnpj(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cnpjCompleto) {
                    e.preventDefault();
                    handleBuscarCnpj();
                  }
                }}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleBuscarCnpj}
                disabled={buscando || !cnpjCompleto}
                title="Buscar a razão social na Receita"
              >
                <Search size={16} className="mr-1" />
                {buscando ? "Buscando..." : "Buscar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Traz a razão social oficial. Opcional, mas evita a mesma empresa entrar com
              grafias diferentes.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-foreground">{labelCampo} *</label>
            <Input
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

          {aviso && (
            <p className="text-xs text-destructive">{aviso}</p>
          )}
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
