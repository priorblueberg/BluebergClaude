import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import BoletaTransacao from "@/components/BoletaTransacao";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A boleta em modal.
 *
 * Era a pagina `/cadastrar-transacao`, e cinco lugares diferentes navegavam ate ela: o botao
 * do cabecalho, o vazio da Carteira, o onboarding (duas vezes), o detalhe da posicao e a
 * edicao em Movimentacoes. Sair da tela para lancar uma operacao e voltar depois custava o
 * contexto de onde a pessoa estava - por isso virou modal, aberto de qualquer lugar por
 * `abrirBoleta()`.
 *
 * O estado vive aqui, num provider unico dentro do AppLayout, para nao existir uma copia do
 * modal em cada tela que o abre.
 */
interface BoletaContextType {
  /** Abre a boleta. Com `editId`, em modo de edicao daquela movimentacao. */
  abrirBoleta: (editId?: string | null) => void;
}

const BoletaContext = createContext<BoletaContextType | null>(null);

export function BoletaProvider({ children }: { children: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const abrirBoleta = useCallback((id?: string | null) => {
    setEditId(id ?? null);
    setAberta(true);
  }, []);

  const fechar = useCallback(() => setAberta(false), []);

  return (
    <BoletaContext.Provider value={{ abrirBoleta }}>
      {children}
      <Dialog open={aberta} onOpenChange={(o) => !o && fechar()}>
        {/*
          A boleta e alta (renda fixa tem onze campos) e o modal nao pode empurrar o rodape
          para fora da tela: o corpo rola por dentro.
        */}
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Transação" : "Nova Transação"}</DialogTitle>
            <DialogDescription>
              {editId
                ? "Altere os dados da movimentação"
                : "Os campos com * são de preenchimento obrigatório"}
            </DialogDescription>
          </DialogHeader>
          {/*
            `key` remonta a boleta a cada abertura. Sem isso o formulario voltaria com o que
            ficou da vez anterior, e uma edicao seguida de um cadastro novo herdaria os campos
            da movimentacao editada.
          */}
          {aberta && (
            <BoletaTransacao key={editId ?? "nova"} editId={editId} onFechar={fechar} />
          )}
        </DialogContent>
      </Dialog>
    </BoletaContext.Provider>
  );
}

export function useBoleta() {
  const ctx = useContext(BoletaContext);
  if (!ctx) throw new Error("useBoleta precisa estar dentro de BoletaProvider");
  return ctx;
}
