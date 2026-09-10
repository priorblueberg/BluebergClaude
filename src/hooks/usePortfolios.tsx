/**
 * Portfólios da conta e o portfólio em uso.
 *
 * O portfólio em uso mora no banco (`profiles.portfolio_ativo_id`), e não na URL nem no navegador:
 * é a RLS que isola os dados, então o app inteiro já enxerga só o portfólio em uso sem filtrar nada.
 *
 * Trocar de portfólio recarrega a página. Os caches de série do motor, as consultas das lâminas e
 * o estado de cada tela foram montados com os dados do portfólio anterior, e recarregar é a única
 * forma de não sobrar nenhum.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalizarNomeDePortfolio, traduzirErroDePortfolio } from "@/lib/portfolios";

export interface Portfolio {
  id: string;
  nome: string;
  created_at: string;
  /** É o portfólio em uso. */
  ativo: boolean;
  posicoes: number;
  movimentacoes: number;
}

interface PortfoliosContextType {
  portfolios: Portfolio[];
  ativo: Portfolio | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  criar: (nome: string) => Promise<void>;
  renomear: (id: string, nome: string) => Promise<void>;
  excluir: (id: string) => Promise<void>;
  /** Passa a usar o portfólio e recarrega a página em `destino`. */
  ativar: (id: string, destino?: string) => Promise<void>;
}

const PortfoliosContext = createContext<PortfoliosContextType | null>(null);

export function PortfoliosProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc("resumo_dos_portfolios");
    if (error) throw new Error(traduzirErroDePortfolio(error));
    setPortfolios((data ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      created_at: p.created_at,
      ativo: p.ativo,
      posicoes: Number(p.posicoes),
      movimentacoes: Number(p.movimentacoes),
    })));
  }, [user]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    recarregar()
      .catch((e) => console.error("Erro ao carregar portfólios", e))
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [recarregar]);

  const criar = useCallback(async (nome: string) => {
    const { error } = await supabase.from("portfolios").insert({ nome: normalizarNomeDePortfolio(nome) });
    if (error) throw new Error(traduzirErroDePortfolio(error));
    await recarregar();
  }, [recarregar]);

  const renomear = useCallback(async (id: string, nome: string) => {
    const { error } = await supabase.from("portfolios").update({ nome: normalizarNomeDePortfolio(nome) }).eq("id", id);
    if (error) throw new Error(traduzirErroDePortfolio(error));
    await recarregar();
  }, [recarregar]);

  const ativar = useCallback(async (id: string, destino = "/carteira") => {
    const { error } = await supabase.rpc("definir_portfolio_ativo", { p_portfolio: id });
    if (error) throw new Error(traduzirErroDePortfolio(error));
    window.location.assign(destino);
  }, []);

  const excluir = useCallback(async (id: string) => {
    const eraOEmUso = portfolios.find((p) => p.id === id)?.ativo ?? false;
    const { error } = await supabase.from("portfolios").delete().eq("id", id);
    if (error) throw new Error(traduzirErroDePortfolio(error));
    // Apagado o portfólio em uso, o banco passa a usar o mais antigo: a página inteira muda.
    if (eraOEmUso) {
      window.location.assign("/portfolios");
      return;
    }
    await recarregar();
  }, [portfolios, recarregar]);

  const value = useMemo<PortfoliosContextType>(() => ({
    portfolios,
    ativo: portfolios.find((p) => p.ativo) ?? null,
    carregando,
    recarregar,
    criar,
    renomear,
    excluir,
    ativar,
  }), [portfolios, carregando, recarregar, criar, renomear, excluir, ativar]);

  return <PortfoliosContext.Provider value={value}>{children}</PortfoliosContext.Provider>;
}

export function usePortfolios() {
  const ctx = useContext(PortfoliosContext);
  if (!ctx) throw new Error("usePortfolios precisa estar dentro de PortfoliosProvider");
  return ctx;
}
