/**
 * Alertas do Sininho.
 *
 * Quem cria alerta e o servidor (hoje, o detector de mudanca na composicao do fundo). O cliente
 * so le os seus e muda o status - a tabela so aceita update em `status` e `resolvido_em`.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface DetalheMudancaDeFundo {
  fundo_id: string;
  fundo_nome: string;
  cnpj: string;
  subclasse: string | null;
  ultima_cota_em: string;
  ultima_cota: number | null;
  sinal: "cota_zero" | "virou_subclasses" | "serie_parou";
  evidencias?: Record<string, unknown>;
  codigos_custodia: string[];
  saldo_cotas: number;
}

export interface Alerta {
  id: string;
  tipo: string;
  titulo: string;
  detalhe: DetalheMudancaDeFundo;
  status: "aberto" | "resolvido" | "descartado";
  criado_em: string;
}

/** A tabela e mais nova que os tipos gerados do Supabase. */
const tabela = () => supabase.from("alertas" as never) as any;

/** De quanto em quanto tempo o sino confere se chegou alerta novo. */
const INTERVALO_MS = 5 * 60 * 1000;

export function useAlertas() {
  const { user } = useAuth();
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  const carregar = useCallback(async () => {
    if (!user) return;
    const { data } = await tabela()
      .select("id, tipo, titulo, detalhe, status, criado_em")
      .eq("user_id", user.id)
      .eq("status", "aberto")
      .order("criado_em", { ascending: false });
    setAlertas((data ?? []) as Alerta[]);
  }, [user]);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [carregar]);

  const marcar = useCallback(async (id: string, status: "resolvido" | "descartado") => {
    const { error } = await tabela().update({ status, resolvido_em: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    await carregar();
  }, [carregar]);

  return { alertas, carregar, marcar };
}
