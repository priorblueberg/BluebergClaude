import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { usePortfolios, type Portfolio } from "@/hooks/usePortfolios";
import {
  LIMITE_DE_PORTFOLIOS, TAMANHO_MAXIMO_DO_NOME, normalizarNomeDePortfolio, validarNomeDePortfolio,
} from "@/lib/portfolios";
import { LinhaMensagem, PaginaCabecalho, TabelaCartao } from "@/components/PaginaPadrao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtData = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const contar = (n: number, um: string, varios: string) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

type Edicao = { modo: "criar" } | { modo: "renomear"; portfolio: Portfolio };

/**
 * Cadastro dos portfólios da conta: criar, renomear, excluir e escolher o portfólio em uso.
 *
 * Cada portfólio é isolado: movimentações, custódia, carteiras e alertas são dele. As demais telas
 * mostram só o portfólio em uso, que também aparece (e troca) no cabeçalho.
 */
export default function PortfoliosPage() {
  const { portfolios, carregando, criar, renomear, excluir, ativar } = usePortfolios();

  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [nome, setNome] = useState("");
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [aExcluir, setAExcluir] = useState<Portfolio | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);

  const [abrindo, setAbrindo] = useState<string | null>(null);

  const noLimite = portfolios.length >= LIMITE_DE_PORTFOLIOS;
  const unico = portfolios.length <= 1;

  const abrirCriacao = () => {
    setEdicao({ modo: "criar" });
    setNome("");
    setErroNome(null);
  };

  const abrirRenomear = (p: Portfolio) => {
    setEdicao({ modo: "renomear", portfolio: p });
    setNome(p.nome);
    setErroNome(null);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edicao) return;
    const idEmEdicao = edicao.modo === "renomear" ? edicao.portfolio.id : undefined;
    const erro = validarNomeDePortfolio(nome, portfolios, idEmEdicao);
    if (erro) {
      setErroNome(erro);
      return;
    }
    setSalvando(true);
    try {
      if (edicao.modo === "criar") {
        await criar(nome);
        toast.success(`Portfólio "${normalizarNomeDePortfolio(nome)}" criado. Clique em Abrir para cadastrar operações nele.`);
      } else {
        await renomear(edicao.portfolio.id, nome);
        toast.success("Portfólio renomeado.");
      }
      setEdicao(null);
    } catch (err) {
      setErroNome(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const abrir = async (p: Portfolio) => {
    setAbrindo(p.id);
    try {
      await ativar(p.id, "/carteira");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível abrir o portfólio.");
      setAbrindo(null);
    }
  };

  const pedirExclusao = (p: Portfolio) => {
    setAExcluir(p);
    setConfirmacao("");
  };

  // Portfólio com operações só sai digitando o nome: a exclusão apaga tudo e não tem volta.
  const exigeDigitarNome = (aExcluir?.movimentacoes ?? 0) > 0;
  const podeExcluir = !!aExcluir && (
    !exigeDigitarNome
    || normalizarNomeDePortfolio(confirmacao).toLowerCase() === normalizarNomeDePortfolio(aExcluir.nome).toLowerCase()
  );

  const confirmarExclusao = async () => {
    if (!aExcluir || !podeExcluir) return;
    setExcluindo(true);
    try {
      await excluir(aExcluir.id);
      toast.success(`Portfólio "${aExcluir.nome}" excluído.`);
      setAExcluir(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível excluir o portfólio.");
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaginaCabecalho
        titulo="Portfólios"
        subtitulo={`Cada portfólio tem as próprias movimentações, custódia e rentabilidade. ${portfolios.length} de ${LIMITE_DE_PORTFOLIOS} portfólios.`}
        acao={
          <Button
            size="sm"
            onClick={abrirCriacao}
            disabled={carregando || noLimite}
            title={noLimite ? `Limite de ${LIMITE_DE_PORTFOLIOS} portfólios por conta.` : undefined}
          >
            <Plus size={14} strokeWidth={1.5} />
            Novo portfólio
          </Button>
        }
      />

      <TabelaCartao>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right">Posições</TableHead>
              <TableHead className="text-right">Movimentações</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando ? (
              <LinhaMensagem colSpan={5}>Carregando...</LinhaMensagem>
            ) : portfolios.length === 0 ? (
              <LinhaMensagem colSpan={5}>Nenhum portfólio.</LinhaMensagem>
            ) : (
              portfolios.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <span className="break-words">{p.nome}</span>
                      {p.ativo && <Badge variant="secondary" className="text-[10px] font-normal">Em uso</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtInt(p.posicoes)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtInt(p.movimentacoes)}</TableCell>
                  <TableCell className="text-sm">{fmtData(p.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!p.ativo && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => abrir(p)} disabled={abrindo !== null}>
                          {abrindo === p.id ? "Abrindo..." : "Abrir"}
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => abrirRenomear(p)}
                        title="Renomear"
                        aria-label={`Renomear ${p.nome}`}
                      >
                        <Pencil size={14} strokeWidth={1.5} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => pedirExclusao(p)}
                        disabled={unico}
                        title={unico ? "A conta precisa ter pelo menos um portfólio." : "Excluir"}
                        aria-label={`Excluir ${p.nome}`}
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TabelaCartao>

      <Dialog open={!!edicao} onOpenChange={(aberto) => { if (!aberto && !salvando) setEdicao(null); }}>
        <DialogContent className="max-w-sm">
          <form onSubmit={salvar} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{edicao?.modo === "renomear" ? "Renomear portfólio" : "Novo portfólio"}</DialogTitle>
              <DialogDescription>
                {edicao?.modo === "renomear"
                  ? "Só o nome muda. As operações do portfólio continuam as mesmas."
                  : "O portfólio nasce vazio. Abra-o para cadastrar as operações."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="nome-portfolio">Nome</Label>
              <Input
                id="nome-portfolio"
                autoFocus
                value={nome}
                maxLength={TAMANHO_MAXIMO_DO_NOME}
                placeholder="Ex.: Pessoal XP"
                onChange={(e) => { setNome(e.target.value); setErroNome(null); }}
              />
              {erroNome && <p className="text-xs text-destructive">{erroNome}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEdicao(null)} disabled={salvando}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!aExcluir} onOpenChange={(aberto) => { if (!aberto && !excluindo) setAExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o portfólio "{aExcluir?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {aExcluir && aExcluir.movimentacoes > 0
                    ? `Isso apaga definitivamente ${contar(aExcluir.movimentacoes, "movimentação", "movimentações")} e ${contar(aExcluir.posicoes, "posição", "posições")}. Não dá para desfazer.`
                    : "O portfólio está vazio."}
                </p>
                {aExcluir?.ativo && <p>Ele é o portfólio em uso. A ferramenta passa a usar o portfólio mais antigo.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {exigeDigitarNome && (
            <div className="space-y-1.5">
              <Label htmlFor="confirmar-exclusao">Digite o nome do portfólio para confirmar</Label>
              <Input id="confirmar-exclusao" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={!podeExcluir || excluindo}>
              {excluindo ? "Excluindo..." : "Excluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
