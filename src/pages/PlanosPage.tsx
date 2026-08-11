import { Link, useNavigate } from "react-router-dom";
import { Check, Crown, BarChart3, PiggyBank, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const plans = [
  {
    id: "financas-pessoais",
    name: "Finanças Pessoais",
    subtitle: "Controle de caixa e gastos",
    price: "0,00",
    icon: BarChart3,
    iconBg: "bg-[#0a5eb8]/10",
    iconColor: "text-[#0a5eb8]",
    highlighted: false,
    features: [
      "Extrato consolidado de todas as contas",
      "Categorização inteligente de despesas",
      "Controle de gastos mês a mês",
      "Importação de extratos bancários",
      "Visão de fluxo de caixa mensal",
      "Múltiplas contas de movimentação",
      "Relatórios mensais de despesas",
    ],
  },
  {
    id: "blueberg-global",
    name: "Blueberg Global",
    subtitle: "Acesso completo — Caixa + Investimentos",
    price: "10,00",
    icon: Crown,
    iconBg: "bg-[#0a5eb8]",
    iconColor: "text-white",
    highlighted: true,
    features: [
      "Tudo do plano Finanças Pessoais",
      "Tudo do plano Investimentos",
      "Visão patrimonial consolidada",
      "Transferência entre contas e carteiras",
      "Histórico completo do patrimônio",
      "Suporte prioritário",
      "Acesso antecipado a novos recursos",
    ],
  },
  {
    id: "investimentos",
    name: "Investimentos",
    subtitle: "Gestão de carteira e rentabilidade",
    price: "0,00",
    icon: PiggyBank,
    iconBg: "bg-[#53b4e8]/10",
    iconColor: "text-[#53b4e8]",
    highlighted: false,
    features: [
      "Posição consolidada por carteira",
      "Rentabilidade mensal vs CDI",
      "Extrato detalhado de operações",
      "Valorização diária dos ativos",
      "Composição do patrimônio investido",
      "Múltiplas carteiras de investimento",
      "Relatórios de performance",
    ],
  },
];

const PlanosPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-[#0a2540] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-[#e6ecf1]">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-bold text-[#0a2540] tracking-tight">Blueberg</Link>
          <Link to="/" className="flex items-center gap-2 text-[#4a6580] hover:text-[#0a2540] transition-colors text-sm font-medium">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao site
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-8 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-[#0a2540] mb-4">
            Escolha o plano ideal para você
          </h1>
          <p className="text-lg text-[#4a6580] max-w-2xl mx-auto">
            Todos os planos incluem 7 dias de teste grátis. Cancele a qualquer momento.
          </p>
        </div>
      </section>

      {/* Plans Grid */}
      <section className="pb-24 px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6 items-start">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-8 flex flex-col transition-shadow ${
                plan.highlighted
                  ? "border-[#0a5eb8] shadow-xl shadow-[#0a5eb8]/10 scale-[1.02] md:scale-105"
                  : "border-[#e6ecf1] shadow-sm hover:shadow-lg"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-[#0a5eb8] text-white text-xs font-semibold px-4 py-1.5 rounded-full uppercase tracking-wider">
                    Mais popular
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div className={`w-11 h-11 rounded-xl ${plan.iconBg} flex items-center justify-center`}>
                  <plan.icon className={`w-5 h-5 ${plan.iconColor}`} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#0a2540]">{plan.name}</h3>
                </div>
              </div>
              <p className="text-sm text-[#4a6580] mb-6">{plan.subtitle}</p>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-[#4a6580]">R$</span>
                  <span className="text-4xl font-bold text-[#0a2540]">{plan.price}</span>
                  <span className="text-sm text-[#4a6580]">/mês</span>
                </div>
              </div>

              <Button
                onClick={() => navigate(`/checkout?plano=${plan.id}`)}
                className={`w-full rounded-xl h-12 text-base font-semibold mb-8 ${
                  plan.highlighted
                    ? "bg-[#0a5eb8] hover:bg-[#084a92] text-white shadow-lg shadow-[#0a5eb8]/20"
                    : "bg-[#0a2540] hover:bg-[#0a2540]/90 text-white"
                }`}
              >
                Assinar este plano
              </Button>

              <ul className="space-y-3 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-[#4a6580]">
                    <Check className={`w-4 h-4 mt-0.5 shrink-0 ${plan.highlighted ? "text-[#0a5eb8]" : "text-[#53b4e8]"}`} />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default PlanosPage;
