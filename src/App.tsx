import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import {
  CarteiraVisaoGeral,
  CarteiraRendaVariavel,
  CarteiraFundos,
  CarteiraMoedas,
  CarteiraTesouroDireto,
  
  Movimentacoes,
  Eventos,
  Configuracoes,
  Usuario,
  Admin,
  Custodia,
  ControleCarteiras,
} from "@/pages/AppPages";
import CarteiraRendaFixa from "@/pages/CarteiraRendaFixaPage";
import CalculadoraPage from "@/pages/CalculadoraPage";
import PosicaoConsolidadaPage from "@/pages/PosicaoConsolidadaPage";
import PortfoliosPage from "@/pages/PortfoliosPage";
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";
import { RecursoRendaFixa, RecursoFundos, RecursoAcoesMoedas, RecursoAnalise } from "./pages/RecursosPages";
import AuthPage from "./pages/AuthPage";
import OnboardingPage from "./pages/OnboardingPage";
import PlanosPage from "./pages/PlanosPage";
import CheckoutPage from "./pages/CheckoutPage";
import GenerateDocxPage from "./pages/GenerateDocxPage";

const queryClient = new QueryClient();

const ProtectedRoute = () => {
  const { user, loading, hasProfile } = useAuth();

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  if (!user) return <Navigate to="/auth" replace />;
  if (hasProfile === null)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  if (!hasProfile) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
};

/**
 * Rotas restritas a admin. O menu ja esconde os links (adminOnly no
 * AppSidebar), mas esconder nao e proteger: sem isto, qualquer usuario logado
 * abria /admin ou /custodia digitando a URL.
 */
const AdminRoute = () => {
  const { isAdmin } = useAuth();

  if (isAdmin === null)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  if (!isAdmin) return <Navigate to="/carteira" replace />;
  return <Outlet />;
};

const OnboardingRoute = () => {
  const { user, loading, hasProfile } = useAuth();
  if (loading || hasProfile === null)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  if (!user) return <Navigate to="/auth" replace />;
  if (hasProfile) return <Navigate to="/carteira" replace />;
  return <OnboardingPage />;
};

const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes. A raiz e a pagina comercial e o login fica em /auth.
                Abertura de conta fechada (25/11/2026): /cadastro so redireciona. */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            {/* Paginas de recursos do institucional (25/11/2026). */}
            <Route path="/recursos/renda-fixa" element={<RecursoRendaFixa />} />
            <Route path="/recursos/fundos" element={<RecursoFundos />} />
            <Route path="/recursos/acoes-e-moedas" element={<RecursoAcoesMoedas />} />
            <Route path="/recursos/analise" element={<RecursoAnalise />} />
            <Route path="/cadastro" element={<Navigate to="/auth" replace />} />
            <Route path="/onboarding" element={<OnboardingRoute />} />
            
            <Route path="/planos" element={<PlanosPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/gerar-docx" element={<GenerateDocxPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/welcome" element={<Navigate to="/carteira" replace />} />
                <Route path="/portfolios" element={<PortfoliosPage />} />
                {/* /carteira e a lamina de Investimentos (Total). Antes ela caia
                    direto na carteira de Renda Fixa por ser a unica categoria. */}
                <Route path="/carteira" element={<CarteiraVisaoGeral />} />
                <Route path="/carteira/renda-fixa" element={<CarteiraRendaFixa />} />
                <Route path="/carteira/renda-variavel" element={<CarteiraRendaVariavel />} />
                <Route path="/carteira/fundos" element={<CarteiraFundos />} />
                <Route path="/carteira/moedas" element={<CarteiraMoedas />} />
                <Route path="/carteira/tesouro-direto" element={<CarteiraTesouroDireto />} />
                <Route path="/posicao-consolidada" element={<PosicaoConsolidadaPage />} />
                <Route path="/movimentacoes" element={<Movimentacoes />} />
                <Route path="/eventos" element={<Eventos />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route path="/usuario" element={<Usuario />} />

                {/* Somente admin */}
                <Route element={<AdminRoute />}>
                  {/* Modulo Caixa em STANDBY (Daniel, 25/11/2026): Patrimonio Global, Caixa e Receitas e
                      Despesas sairam do ar ate a reabertura. As telas continuam no codigo; para religar,
                      volte o element de cada rota para a pagina e tire o standby no AppSidebar. */}
                  <Route path="/patrimonio-global" element={<Navigate to="/carteira" replace />} />
                  <Route path="/caixa" element={<Navigate to="/carteira" replace />} />
                  <Route path="/receitas-e-despesas" element={<Navigate to="/carteira" replace />} />
                  {/* Gerenciais: fora do menu (standby), mas a URL segue valendo para admin. */}
                  <Route path="/custodia" element={<Custodia />} />
                  <Route path="/controle-carteiras" element={<ControleCarteiras />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/calculadora" element={<CalculadoraPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
