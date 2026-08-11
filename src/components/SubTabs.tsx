import { Link, useLocation } from "react-router-dom";

const tabs = [
  { label: "Renda Fixa", url: "/carteira/renda-fixa" },
  // MVP2: Renda Variável, Fundos, Tesouro Direto
];

export function SubTabs() {
  const { pathname } = useLocation();

  return (
    <div className="flex gap-6 border-b border-border bg-card px-6 h-10 items-end overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname === tab.url;
        return (
          <Link
            key={tab.url}
            to={tab.url}
            className={`whitespace-nowrap pb-2 text-xs font-medium border-b-2 transition-colors ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={{ transition: "color 120ms linear, border-color 120ms linear" }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
