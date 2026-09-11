/**
 * Campo de data com máscara dd/mm/aaaa e calendário em popover.
 *
 * Existe porque o `<input type="date">` nativo não deixa bloquear fim de semana nem mostrar uma
 * janela que depende do ativo (primeira e última cota do fundo). O calendário só deixa clicar o que
 * a boleta aceitaria; a digitação continua livre, e o erro aparece embaixo do campo.
 */
import { useEffect, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MSG_FORMATO = "Data inválida";

function mascarar(bruto: string): string {
  const d = bruto.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** dd/mm/aaaa completo e existente (31/02 não passa) para ISO, ou null. */
function paraISO(texto: string): string | null {
  if (texto.length !== 10) return null;
  const d = parse(texto, "dd/MM/yyyy", new Date());
  if (!isValid(d) || format(d, "dd/MM/yyyy") !== texto) return null;
  return format(d, "yyyy-MM-dd");
}

const paraTexto = (iso: string) => (iso ? format(new Date(iso + "T12:00:00"), "dd/MM/yyyy") : "");
const paraDate = (iso: string) => new Date(iso + "T12:00:00");

export default function CampoDataCalendario({
  value,
  onChange,
  min,
  max,
  mensagem,
  disabled,
}: {
  /** Data em ISO (aaaa-mm-dd), ou "" quando vazia ou incompleta. */
  value: string;
  onChange: (iso: string) => void;
  /** Primeiro dia clicável no calendário. */
  min: string;
  /** Último dia clicável; null ou ausente, sem teto. */
  max?: string | null;
  /** Mensagem de validação vinda da boleta, mostrada embaixo do campo. */
  mensagem?: string | null;
  disabled?: boolean;
}) {
  const [texto, setTexto] = useState(paraTexto(value));
  const [aberto, setAberto] = useState(false);

  // Valor que muda por fora (edição carregada, reset da boleta) atualiza o texto. Texto incompleto
  // enquanto o usuário digita fica como está.
  useEffect(() => {
    if (value && paraISO(texto) !== value) setTexto(paraTexto(value));
    if (!value && paraISO(texto)) setTexto("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const formatoInvalido = texto.length === 10 && paraISO(texto) === null;
  const erro = formatoInvalido ? MSG_FORMATO : mensagem ?? null;

  const digitar = (bruto: string) => {
    const m = mascarar(bruto);
    setTexto(m);
    onChange(paraISO(m) ?? "");
  };

  const escolher = (d: Date | undefined) => {
    setAberto(false);
    if (!d) return;
    const iso = format(d, "yyyy-MM-dd");
    setTexto(paraTexto(iso));
    onChange(iso);
  };

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="dd/mm/aaaa"
          value={texto}
          inputMode="numeric"
          disabled={disabled}
          className={cn("flex-1 min-w-0", erro ? "border-destructive ring-1 ring-destructive" : "")}
          onChange={(e) => digitar(e.target.value)}
        />
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="shrink-0" disabled={disabled} aria-label="Abrir calendário">
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value ? paraDate(value) : undefined}
              defaultMonth={value ? paraDate(value) : max ? paraDate(max) : undefined}
              onSelect={escolher}
              fromDate={paraDate(min)}
              toDate={max ? paraDate(max) : undefined}
              disabled={[
                { before: paraDate(min) },
                ...(max ? [{ after: paraDate(max) }] : []),
                { dayOfWeek: [0, 6] },
              ]}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>
      {erro && <p className="mt-1 text-xs font-medium text-destructive">{erro}</p>}
    </div>
  );
}
