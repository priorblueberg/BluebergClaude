import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const STORAGE_KEY = "blueberg_welcome_dismissed";

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, "true");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="w-full rounded-t-lg bg-gradient-to-r from-[hsl(213,60%,20%)] to-[hsl(210,100%,45%)] flex items-center justify-center py-6 -mx-6 -mt-6 px-6">
            <span className="text-2xl font-bold text-white tracking-tight">Blueberg</span>
          </div>
          <DialogTitle className="text-lg font-semibold mt-4">Aos amigos da Blueberg</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Sejam muito bem-vindos! É uma enorme alegria ter vocês aqui. 
            Esta ferramenta está sendo construída com muito cuidado e a opinião de cada um de vocês será 
            fundamental para que ela evolua e se torne cada vez melhor.
          </p>

          <p className="font-medium text-foreground">O que você pode fazer neste MVP:</p>

          <ul className="list-disc list-inside space-y-1.5 ml-1">
            <li>
              <strong>Cadastrar transações</strong> de Renda Fixa (aplicações, resgates, juros) através do botão "Cadastrar Transação" no cabeçalho.
            </li>
            <li>
              <strong>Acompanhar a rentabilidade</strong> da sua carteira de Renda Fixa com gráficos históricos comparando seu desempenho com CDI e Ibovespa.
            </li>
            <li>
              <strong>Visualizar a alocação</strong> do portfólio por estratégia, custodiante e emissor em gráficos interativos.
            </li>
            <li>
              <strong>Analisar cada ativo individualmente</strong> — clique em qualquer produto na Posição Consolidada para abrir o dashboard detalhado com gráficos e tabelas.
            </li>
            <li>
              <strong>Consultar movimentações</strong> e proventos recebidos com filtros e buscas.
            </li>
            <li>
              <strong>Navegar por diferentes datas de referência</strong> usando o seletor no cabeçalho para ver a evolução do seu patrimônio ao longo do tempo.
            </li>
          </ul>

          <p className="font-medium text-foreground mt-2">Primeiros passos:</p>

          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>Clique em <strong>"Cadastrar Transação"</strong> para adicionar sua primeira operação.</li>
            <li>Após cadastrar, acesse <strong>"Carteira de Investimentos"</strong> no menu lateral para ver sua carteira de Renda Fixa.</li>
            <li>Explore os gráficos e clique nos ativos para análises detalhadas.</li>
          </ol>

          <p>
            Conto com o feedback de vocês! Qualquer dúvida, sugestão ou problema encontrado, 
            não hesitem em me procurar. Juntos, vamos construir algo incrível. 🚀
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-3 mt-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(v === true)}
            />
            Não exibir novamente
          </label>
          <Button onClick={handleClose} className="ml-auto">
            Começar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
