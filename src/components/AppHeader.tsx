import { useState } from "react";
import { format } from "date-fns";
import { Bell, ChevronDown, RefreshCw, Plus } from "lucide-react";
import { SeletorPeriodo } from "@/components/SeletorPeriodo";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { recalculateAllForDataReferencia } from "@/lib/syncEngine";
import { haVersaoNovaPublicada } from "@/lib/versaoDoApp";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppHeader({ disableControls = false }: { disableControls?: boolean }) {
  const { dataReferencia, applyDataReferencia, setIsRecalculating } = useDataReferencia();
  const [isForceRecalculating, setIsForceRecalculating] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  /** Aba com build antigo nao pode recalcular: ela reescreve a carteira inteira
   *  com regras velhas. Melhor recarregar do que corromper os dados. */
  const bloqueadoPorVersaoAntiga = async () => {
    if (!(await haVersaoNovaPublicada())) return false;
    toast.info("Ha uma versao mais nova do app. Recarregando antes de recalcular...");
    setTimeout(() => window.location.reload(), 1200);
    return true;
  };

  const handleForceRecalculate = async () => {
    if (!user || isForceRecalculating) return;
    if (await bloqueadoPorVersaoAntiga()) return;
    setIsForceRecalculating(true);
    setIsRecalculating(true);
    try {
      await recalculateAllForDataReferencia(user.id, format(dataReferencia, "yyyy-MM-dd"));
      applyDataReferencia();
      toast.success("Reprocessamento completo realizado com sucesso");
    } catch (err) {
      console.error("Erro no reprocessamento forçado", err);
      toast.error("Erro ao reprocessar");
    } finally {
      setIsRecalculating(false);
      setIsForceRecalculating(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="relative">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground outline-none" style={{ transition: "color 120ms linear" }}>
            <span className="truncate max-w-[220px]">{user?.email}</span>
            <ChevronDown size={14} strokeWidth={1.5} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            <DropdownMenuItem onClick={() => navigate("/usuario")} className="text-xs cursor-pointer">
              Informações Pessoais
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-xs cursor-pointer text-destructive">
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className={`flex items-center gap-4${disableControls ? " pointer-events-none opacity-40" : ""}`}>
          <button
            onClick={() => navigate("/cadastrar-transacao")}
            className="flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs text-primary hover:bg-primary hover:text-primary-foreground bg-background"
            style={{ transition: "all 120ms linear" }}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>Cadastrar Transação</span>
          </button>

          <SeletorPeriodo disabled={disableControls} />

          {isAdmin && (
            <button
              onClick={handleForceRecalculate}
              disabled={isForceRecalculating}
              className="flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50 bg-background"
              style={{ transition: "all 120ms linear" }}
              title="Forçar reprocessamento completo de todos os ativos"
            >
              <RefreshCw size={12} strokeWidth={1.5} className={isForceRecalculating ? "animate-spin" : ""} />
              <span>Reprocessar</span>
            </button>
          )}

          <button className="relative text-muted-foreground hover:text-primary" style={{ transition: "color 120ms linear" }}>
            <Bell size={18} strokeWidth={1.5} />
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
          </button>
        </div>
      </header>

    </div>
  );
}
