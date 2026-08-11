import { Link } from "react-router-dom";
import { Check, Crown, BarChart3, PiggyBank } from "lucide-react";
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
    ],
  },
  {
    id: "blueberg-global",
    name: "Blueberg Global",
    subtitle: "Caixa + Investimentos",
    price: "0,00",
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
    ],
  },
];

const LandingPricingSection = () => {
  return (
    <section className="bg-[#f7f9fc] py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-[#0a2540]">
          Planos que cabem no seu bolso
        </h2>
        <p className="text-center text-[#4a6580] mb-16 max-w-2xl mx-auto text-lg">
          Todos os planos incluem 7 dias de teste grátis. Cancele a qualquer momento.
        </p>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-7 flex flex-col bg-white transition-shadow ${
                plan.highlighted
                  ? "border-[#0a5eb8] shadow-xl shadow-[#0a5eb8]/10"
                  : "border-[#e6ecf1] shadow-sm hover:shadow-lg"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-[#0a5eb8] text-white text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider">
                    Mais popular
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg ${plan.iconBg} flex items-center justify-center`}>
                  <plan.icon className={`w-5 h-5 ${plan.iconColor}`} />
                </div>
                <h3 className="text-base font-bold text-[#0a2540]">{plan.name}</h3>
              </div>
              <p className="text-sm text-[#4a6580] mb-4">{plan.subtitle}</p>
              <div className="flex items-baseline gap-1 mb-5">
                <span className="text-xs text-[#4a6580]">R$</span>
                <span className="text-3xl font-bold text-[#0a2540]">{plan.price}</span>
                <span className="text-xs text-[#4a6580]">/mês</span>
              </div>
              <Link to="/cadastro" className="block mb-6">
                <Button
                  className={`w-full rounded-xl h-11 text-sm font-semibold ${
                    plan.highlighted
                      ? "bg-[#0a5eb8] hover:bg-[#084a92] text-white"
                      : "bg-[#0a2540] hover:bg-[#0a2540]/90 text-white"
                  }`}
                >
                  Assinar este plano
                </Button>
              </Link>
              <ul className="space-y-2.5 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-[#4a6580]">
                    <Check className={`w-4 h-4 mt-0.5 shrink-0 ${plan.highlighted ? "text-[#0a5eb8]" : "text-[#53b4e8]"}`} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LandingPricingSection;
