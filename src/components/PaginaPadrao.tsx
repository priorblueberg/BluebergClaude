import { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Pecas de layout das paginas de listagem.
 *
 * Posicao Consolidada, Movimentacoes e Eventos estavam cada uma no seu modelo: titulo em
 * `text-2xl font-bold` contra `text-lg font-semibold`; subtitulo em `text-xs`, em `text-sm`
 * ou inexistente; moldura de tabela `rounded-lg border` contra `rounded-md border-border`,
 * uma delas sem `overflow-x-auto` apesar de ter oito colunas; e a data de referencia ora no
 * subtitulo, ora numa linha solta ao lado do filtro, ora em lugar nenhum.
 *
 * O padrao adotado nao e novo: e o que Configuracoes, Controle de Carteiras e Analise
 * Individual ja usavam. Estas tres e que destoavam.
 */

export function PaginaCabecalho({
  titulo,
  subtitulo,
  acao,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  /** Conteudo alinhado a direita, na mesma linha do titulo. */
  acao?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}

/** Linha de filtros. O ultimo filho com `ml-auto` encosta na direita (usar para contagem). */
export function BarraDeFiltros({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

/** Contagem de itens da listagem, no canto direito da barra de filtros. */
export function Contagem({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-xs text-muted-foreground">{children}</span>;
}

/** Moldura da tabela. `overflow-x-auto` aqui e o que impede a pagina de rolar na horizontal. */
export function TabelaCartao({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card overflow-x-auto">{children}</div>;
}

/** Linha unica de "carregando" ou "nada encontrado", no lugar do conteudo da tabela. */
export function LinhaMensagem({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}
