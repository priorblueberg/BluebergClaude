import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { SubTabs } from "./SubTabs";
import { DataReferenciaProvider } from "@/contexts/DataReferenciaContext";
import { RecalculatingOverlay } from "./RecalculatingOverlay";

function AppLayoutInner() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const isCarteira = location.pathname.startsWith("/carteira");

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className="flex flex-1 flex-col min-h-screen"
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
    <DataReferenciaProvider>
      <AppLayoutInner />
    </DataReferenciaProvider>
  );
}
