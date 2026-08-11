import { useState, useRef } from "react";
import { format, parse, isValid, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, CalendarIcon, ChevronDown, RefreshCw, Plus } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useDataReferencia } from "@/contexts/DataReferenciaContext";
import { recalculateAllForDataReferencia } from "@/lib/syncEngine";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getMaxDate() {
  return subDays(startOfDay(new Date()), 1);
}

function clampDate(date: Date): Date {
  const max = getMaxDate();
  return date > max ? max : date;
}

export function AppHeader({ disableControls = false }: { disableControls?: boolean }) {
  const { dataReferencia, setDataReferencia, applyDataReferencia, setIsRecalculating } = useDataReferencia();
  const [inputValue, setInputValue] = useState(format(dataReferencia, "dd/MM/yyyy"));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [isForceRecalculating, setIsForceRecalculating] = useState(false);
  // Staged date: what the user picked but hasn't applied yet
  const [stagedDate, setStagedDate] = useState<Date>(dataReferencia);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const isStagedSameAsApplied = format(stagedDate, "yyyy-MM-dd") === format(dataReferencia, "yyyy-MM-dd");

  const handleForceRecalculate = async () => {
    if (!user || isForceRecalculating) return;
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

  const handleApply = async () => {
    if (!user || isStagedSameAsApplied) return;
    const clamped = clampDate(stagedDate);
    setDataReferencia(clamped);
    setStagedDate(clamped);
    setInputValue(format(clamped, "dd/MM/yyyy"));
    setIsRecalculating(true);
    try {
      await recalculateAllForDataReferencia(user.id, format(clamped, "yyyy-MM-dd"));
      applyDataReferencia();
      toast.success("Data de referência aplicada com sucesso");
    } catch (err) {
      console.error("Erro ao aplicar data de referência", err);
      toast.error("Erro ao aplicar data de referência");
    } finally {
      setIsRecalculating(false);
    }
  };

  const stageDate = (date: Date) => {
    const clamped = clampDate(date);
    setStagedDate(clamped);
    setInputValue(format(clamped, "dd/MM/yyyy"));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
    let formatted = raw;
    if (raw.length > 2 && raw.length <= 4) {
      formatted = `${raw.slice(0, 2)}/${raw.slice(2)}`;
    } else if (raw.length > 4) {
      formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
    }
    setInputValue(formatted);
  };

  const commitInput = () => {
    const parsed = parse(inputValue, "dd/MM/yyyy", new Date());
    if (isValid(parsed)) {
      stageDate(parsed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
      commitInput();
    }
  };

  const handleDateSelect = (d: Date | undefined) => {
    if (d) {
      stageDate(d);
    }
    setCalendarOpen(false);
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  const maxDate = getMaxDate();

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

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Posição em:</span>
            <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1 bg-background">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onBlur={commitInput}
                onKeyDown={handleKeyDown}
                className="w-[80px] bg-transparent text-foreground text-xs outline-none"
                placeholder="dd/mm/aaaa"
              />
              <button
                onClick={() => setCalendarOpen(!calendarOpen)}
                className="text-muted-foreground hover:text-primary"
                style={{ transition: "color 120ms linear" }}
              >
                <CalendarIcon size={14} strokeWidth={1.5} />
              </button>
            </div>
            <button
              onClick={handleApply}
              disabled={isStagedSameAsApplied}
              className="rounded-md border border-primary px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground bg-background disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ transition: "all 120ms linear" }}
              title="Aplicar data de referência"
            >
              Aplicar
            </button>
          </div>

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

      {calendarOpen && (
        <div className="border-b border-border bg-card flex justify-end px-4 py-2">
          <Calendar
            mode="single"
            selected={dataReferencia}
            onSelect={handleDateSelect}
            locale={ptBR}
            disabled={{ after: maxDate }}
            className="pointer-events-auto"
          />
        </div>
      )}
    </div>
  );
}
