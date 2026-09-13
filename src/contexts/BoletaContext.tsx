import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import BoletaTransacao from "@/components/BoletaTransacao";
import BoletaMigracaoFundo from "@/components/BoletaMigracaoFundo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AlertaSemCota } from "@/lib/alertaDeFundo";

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
 * modal em cada tela que o abre. A boleta de migracao de fundo (aberta pelo "!" do fundo sem cota)
 * mora aqui pelo mesmo motivo.
 */

/** Boleta aberta ja preenchida por outra tela. */
export type PreenchimentoDaBoleta = {
  /** "!" do fundo sem cota: resgate com "Fechar Posição" na data da ultima cota. */
  tipo: "encerrar_fundo";
  fundoId: string;
  codigoCustodia: string;
  data: string;
};

interface BoletaContextType {
  /** Abre a boleta. Com `editId`, em modo de edicao daquela movimentacao; com `preenchimento`, ja preenchida. */
  abrirBoleta: (editId?: string | null, preenchimento?: PreenchimentoDaBoleta | null) => void;
  /** Abre a boleta de migracao da posicao de fundo que parou de receber cota. */
  abrirMigracao: (origem: AlertaSemCota) => void;
}

const BoletaContext = createContext<BoletaContextType | null>(null);

export function BoletaProvider({ children }: { children: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [preenchimento, setPreenchimento] = useState<PreenchimentoDaBoleta | null>(null);
  const [migracao, setMigracao] = useState<AlertaSemCota | null>(null);

  const abrirBoleta = useCallback((id?: string | null, pre?: PreenchimentoDaBoleta | null) => {
    setEditId(id ?? null);
    setPreenchimento(pre ?? null);
    setAberta(true);
  }, []);

  const abrirMigracao = useCallback((origem: AlertaSemCota) => setMigracao(origem), []);

  const fechar = useCallback(() => setAberta(false), []);

  return (
    <BoletaContext.Provider value={{ abrirBoleta, abrirMigracao }}>
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
            <BoletaTransacao
              key={editId ?? (preenchimento ? `encerrar-${preenchimento.codigoCustodia}` : "nova")}
              editId={editId}
              preenchimento={preenchimento}
              onFechar={fechar}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!migracao} onOpenChange={(o) => !o && setMigracao(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Migrar posição</DialogTitle>
            <DialogDescription>Migração da posição para o fundo novo</DialogDescription>
          </DialogHeader>
          {migracao && (
            <BoletaMigracaoFundo key={migracao.codigoCustodia} origem={migracao} onFechar={() => setMigracao(null)} />
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
