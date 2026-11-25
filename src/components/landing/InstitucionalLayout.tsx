import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Instagram, Linkedin, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Moldura do site institucional: cabecalho com o menu das paginas de produto e rodape.
 * Usada pela pagina comercial (/) e pelas paginas de recursos (/recursos/*).
 *
 * Sem abertura de conta (Daniel, 25/11/2026): o unico botao de entrada e o Login.
 */
export const PAGINAS_DE_RECURSOS = [
  { to: "/recursos/renda-fixa", label: "Renda Fixa" },
  { to: "/recursos/fundos", label: "Fundos" },
  { to: "/recursos/acoes", label: "Ações" },
  { to: "/recursos/moedas", label: "Moedas" },
  { to: "/recursos/analise", label: "Análise da Carteira" },
  { to: "/recursos/metodologia", label: "Metodologia" },
];

const InstitucionalLayout = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();

  // Troca de pagina pelo menu comeca no topo, como num site comum.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-white text-[#0a2540] font-sans">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-[#e6ecf1]">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-4">
          <Link to="/" className="text-lg font-bold text-[#0a2540] tracking-tight">
            Blueberg
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {PAGINAS_DE_RECURSOS.map((p) => (
              <NavLink
                key={p.to}
                to={p.to}
                className={({ isActive }) =>
                  `rounded-full px-3 py-2 text-sm transition-colors ${
                    isActive ? "text-[#0a5eb8] font-semibold" : "text-[#4a6580] hover:text-[#0a2540]"
                  }`
                }
              >
                {p.label}
              </NavLink>
            ))}
          </nav>
          <Link to="/auth">
            <Button
              variant="outline"
              className="rounded-full border-[#0a2540] bg-[#0a2540] text-white hover:bg-[#0a2540]/90"
            >
              Login
            </Button>
          </Link>
        </div>
        {/* No celular o menu vira uma faixa rolavel logo abaixo do cabecalho. */}
        <nav className="md:hidden flex gap-1 overflow-x-auto px-4 pb-3">
          {PAGINAS_DE_RECURSOS.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${
                  isActive
                    ? "border-[#0a5eb8] text-[#0a5eb8] font-semibold"
                    : "border-[#e6ecf1] text-[#4a6580]"
                }`
              }
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {children}

      <footer className="bg-[#071b2e] py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid gap-8 md:grid-cols-3">
            <div>
              <p className="text-white font-bold text-lg mb-2">Blueberg</p>
              <p className="text-[#8da4bf] text-sm italic">
                A ponta do iceberg é apenas o começo da sua liberdade financeira.
              </p>
            </div>
            <div>
              <p className="text-white text-sm font-semibold mb-3">Recursos</p>
              <ul className="space-y-2">
                {PAGINAS_DE_RECURSOS.map((p) => (
                  <li key={p.to}>
                    <Link to={p.to} className="text-[#8da4bf] text-sm hover:text-white transition-colors">
                      {p.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:text-right">
              <div className="flex items-center gap-6 md:justify-end">
                <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                  <Instagram className="w-5 h-5" />
                </a>
                <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                  <Linkedin className="w-5 h-5" />
                </a>
                <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                  <Twitter className="w-5 h-5" />
                </a>
              </div>
              <p className="text-[#8da4bf] text-sm mt-4">Termos de Uso</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default InstitucionalLayout;
