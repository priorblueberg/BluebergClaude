import { useLocation, Link } from "react-router-dom";
import {
  Layers,
  LayoutGrid,
  ArrowLeftRight,
  Vault,
  
  Settings,
  Shield,
  Briefcase,
  Calculator,
  ClipboardList,
  ChevronsLeft,
  ChevronsRight,
  CalendarClock,
  Plus,
  Wallet,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useBoleta } from "@/contexts/BoletaContext";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const menuItems: MenuItem[] = [
  // Primeira opção do menu, a pedido do Daniel (21/09/2026). Só admin: é patrimônio pessoal, de
  // outro banco, e a edge function que o lê também só responde a admin.
  { title: "Patrimônio Global", url: "/patrimonio-global", icon: Wallet, adminOnly: true },
  { title: "Portfólios", url: "/portfolios", icon: Layers },
  { title: "Carteira de Investimentos", url: "/carteira", icon: LayoutGrid },
  { title: "Posição Consolidada", url: "/posicao-consolidada", icon: ClipboardList },
  { title: "Movimentações", url: "/movimentacoes", icon: ArrowLeftRight },
  { title: "Custódia", url: "/custodia", icon: Vault, adminOnly: true },
  { title: "Controle de Carteiras", url: "/controle-carteiras", icon: Briefcase, adminOnly: true },
  { title: "Eventos", url: "/eventos", icon: CalendarClock },
  
  { title: "Configurações", url: "/configuracoes", icon: Settings },
  { title: "Admin", url: "/admin", icon: Shield, adminOnly: true },
  { title: "Calculadora", url: "/calculadora", icon: Calculator, adminOnly: true },
];

export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  const isAdmin = useIsAdmin();
  const { abrirBoleta } = useBoleta();
  const isActive = (url: string) =>
    url === "/carteira" ? location.pathname.startsWith("/carteira") : location.pathname === url;

  const visibleItems = menuItems.filter(item => !item.adminOnly || isAdmin);
  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-30 flex flex-col bg-[hsl(213,60%,20%)]"
      style={{
        width: collapsed ? 56 : 220,
        transition: "width 120ms linear",
      }}
    >
      <div className="flex h-14 items-center gap-2 border-b border-[hsl(213,40%,28%)] px-4">
        {!collapsed && (
          <span className="text-base font-bold tracking-tight text-white">Blueberg</span>
        )}
        {collapsed && (
          <span className="text-base font-bold text-white">B</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {visibleItems.map((item) => {
          const active = isActive(item.url);
          const Icon = item.icon;

          return (
            <Link
              key={item.title}
              to={item.url}
              className="group relative flex h-9 items-center gap-3 px-3 text-xs font-medium transition-colors"
              style={{ transition: "color 120ms linear" }}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[hsl(210,100%,60%)]" />
              )}
              <Icon
                size={18}
                strokeWidth={1.5}
                className={active ? "text-[hsl(210,100%,60%)] shrink-0" : "text-[hsl(210,25%,60%)] shrink-0 group-hover:text-white"}
                style={{ transition: "color 120ms linear" }}
              />
              {!collapsed && (
                <span
                  className={`truncate ${active ? "text-white" : "text-[hsl(210,25%,60%)] group-hover:text-white"}`}
                >
                  {item.title}
                </span>
              )}
            </Link>
          );
        })}

        {/*
          "Cadastrar Transação" era um botao no header e virou a ultima opcao do menu (Daniel,
          19/09/2026). E uma acao, nao uma rota: por isso um <button> com a mesma altura, o mesmo
          espacamento e as mesmas cores dos itens de navegacao, e nunca com a marca de ativo.
        */}
        <button
          type="button"
          onClick={() => abrirBoleta()}
          title={collapsed ? "Cadastrar Transação" : undefined}
          className="group relative flex h-9 w-full items-center gap-3 px-3 text-xs font-medium transition-colors"
        >
          <Plus
            size={18}
            strokeWidth={1.5}
            className="shrink-0 text-[hsl(210,25%,60%)] group-hover:text-white"
            style={{ transition: "color 120ms linear" }}
          />
          {!collapsed && (
            <span className="truncate text-[hsl(210,25%,60%)] group-hover:text-white">
              Cadastrar Transação
            </span>
          )}
        </button>
      </nav>

      <div className="border-t border-[hsl(213,40%,28%)]">
        <button
          onClick={onToggle}
          className="flex h-10 w-full items-center justify-center text-[hsl(210,25%,60%)] hover:text-white transition-colors"
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}