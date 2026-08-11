import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import welcomeHeaderImg from "@/assets/welcome-investments-header.jpg";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function OnboardingRendaFixaModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header image */}
        <div className="w-full">
          <img
            src={welcomeHeaderImg}
            alt="Equipe trabalhando com investimentos"
            className="w-full h-48 object-cover rounded-t-lg"
            width={1280}
            height={512}
          />
        </div>

        <div className="px-6 pb-6 pt-2">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Seja muito bem-vindo!
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed mt-4">
            <p>
              Se você está aqui hoje, é porque de alguma forma está acompanhando a construção da Blueberg
              — e ter você nesse momento é parte essencial para que tudo isso dê certo.
            </p>

            <p>
              Estou liberando para você, em primeira mão, o <strong className="text-foreground">MVP1</strong> da nossa ferramenta.
            </p>

            <p>
              Nesta primeira versão, o foco é o cálculo de rentabilidade de títulos privados de renda fixa,
              tanto prefixados quanto indexados ao CDI — e acredite. Totalmente em linha com as regras de
              valorização de títulos da ANBIMA e CETIP.
            </p>

            <p className="font-medium text-foreground">O que você pode fazer neste MVP:</p>

            <ul className="space-y-2 ml-1">
              <li>
                📊 <strong>Acompanhar a rentabilidade</strong> da sua carteira de renda fixa com gráficos
                históricos, comparando seu desempenho com CDI e Ibovespa
              </li>
              <li>
                🧩 <strong>Visualizar a alocação</strong> do portfólio por estratégia, custodiante e emissor
                em gráficos interativos
              </li>
              <li>
                🔍 <strong>Analisar cada ativo individualmente</strong> — clique em qualquer produto na
                Posição Consolidada para abrir o dashboard detalhado
              </li>
              <li>
                📑 <strong>Consultar movimentações</strong> e proventos com filtros e buscas
              </li>
              <li>
                ⏳ <strong>Navegar por diferentes datas de referência</strong> e acompanhar a evolução do
                seu patrimônio ao longo do tempo.
              </li>
            </ul>

            <p>
              Se seu título paga juros periódicos, não se preocupe. Calculamos certinho para você.
            </p>

            <p>
              👉{" "}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate("/cadastrar-transacao");
                }}
                className="text-primary font-semibold underline underline-offset-2 hover:text-primary/80 cursor-pointer bg-transparent border-none p-0"
              >
                Clique aqui
              </button>{" "}
              para cadastrar o seu primeiro título e veja a mágica acontecer.
            </p>

            <p className="font-medium text-foreground mt-2">Seu feedback é fundamental</p>

            <p>
              Essa é uma versão inicial — e foi feita para evoluir com você.
            </p>

            <p>
              Se algo não fizer sentido, se algo puder melhorar, ou se você simplesmente tiver uma ideia:
              <br />
              <strong className="text-foreground">fala comigo.</strong>
            </p>

            <p>
              Vale tudo: mensagem, áudio, ligação…
            </p>

            <p className="italic">
              "Me liga, me manda um telegrama, uma carta de amor…" 😄
            </p>

            <p className="font-medium text-foreground">Obrigado por estar junto nessa construção.</p>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={() => {
              onOpenChange(false);
              navigate("/cadastrar-transacao");
            }}>
              Cadastrar meu primeiro título
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
