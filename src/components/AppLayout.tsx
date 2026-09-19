import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { SubTabs } from "./SubTabs";
import { DataReferenciaProvider } from "@/contexts/DataReferenciaContext";
import { BoletaProvider } from "@/contexts/BoletaContext";
import { PortfoliosProvider } from "@/hooks/usePortfolios";
import { RecalculatingOverlay } from "./RecalculatingOverlay";

function AppLayoutInner() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const isCarteira = location.pathname.startsWith("/carteira");

  /*
    Header fixo (Daniel, 19/09/2026). Ate aqui a coluna era `min-h-screen` e o `overflow-y-auto` do
    `main` nunca entrava em acao: sem altura limitada, quem rolava era a pagina inteira, e o header
    subia junto. Com `h-screen` e `overflow-hidden` na coluna, o `main` vira o unico elemento que
    rola - header e abas ficam parados, e a gaveta de detalhes, que e posicionada a 56px do topo,
    encosta neles em qualquer posicao da rolagem.
  */
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden"
        style={{
          marginLeft: collapsed ? 56 : 220,
          transition: "margin-left 120ms linear",
        }}
      >
        <AppHeader />
        {isCarteira && <SubTabs />}
        <main className="relative flex-1 overflow-y-auto p-6">
          <RecalculatingOverlay />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <PortfoliosProvider>
      <DataReferenciaProvider>
        <BoletaProvider>
          <AppLayoutInner />
        </BoletaProvider>
      </DataReferenciaProvider>
    </PortfoliosProvider>
  );
}
