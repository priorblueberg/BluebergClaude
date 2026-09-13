/**
 * "!" ao lado do nome do fundo que parou de receber cota da CVM (decisao do Daniel, 12/09/2026).
 *
 * Ao passar o mouse, o texto e as duas saidas: encerrar a posicao (boleta de resgate com "Fechar Posição"
 * na data da ultima cota) ou migra-la para o fundo novo. Fica dentro de linhas clicaveis (a linha abre a
 * gaveta), entao nenhum clique aqui sobe para ela - nem os do cartao, que o React propaga pelo portal.
 */
import { useBoleta } from "@/contexts/BoletaContext";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TEXTO_FUNDO_SEM_COTA, type AlertaSemCota } from "@/lib/alertaDeFundo";

const fmtData = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR");

export default function AlertaFundoSemCota({ alerta }: { alerta: AlertaSemCota }) {
  const { abrirBoleta, abrirMigracao } = useBoleta();
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <HoverCard openDelay={100} closeDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={parar}
          aria-label={`Sem cota da CVM desde ${fmtData(alerta.ultimaCota)}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold leading-none text-white"
        >
          !
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 space-y-3" onClick={parar} onPointerDown={parar}>
        <p className="text-sm font-semibold text-foreground">Sem cota da CVM desde {fmtData(alerta.ultimaCota)}</p>
        <p className="text-xs text-muted-foreground">{TEXTO_FUNDO_SEM_COTA}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => abrirBoleta(null, {
              tipo: "encerrar_fundo",
              fundoId: alerta.fundoId,
              codigoCustodia: alerta.codigoCustodia,
              data: alerta.ultimaCota,
            })}
          >
            Encerrar Posição
          </Button>
          <Button size="sm" onClick={() => abrirMigracao(alerta)}>
            Migrar posição
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
