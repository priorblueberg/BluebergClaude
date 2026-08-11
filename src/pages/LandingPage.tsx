import { Link } from "react-router-dom";
import {
  Wallet,
  TrendingUp,
  Globe,
  ArrowLeftRight,
  BarChart3,
  PiggyBank,
  Layers,
  Instagram,
  Linkedin,
  Twitter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import heroDashboard from "@/assets/hero-dashboard.png";
import LandingPricingSection from "@/components/landing/LandingPricingSection";

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-white text-[#0a2540] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-[#e6ecf1]">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="text-lg font-bold text-[#0a2540] tracking-tight">Blueberg</span>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button
                variant="outline"
                className="rounded-full border-[#0a2540] bg-[#0a2540] text-white hover:bg-[#0a2540]/90"
              >
                Login
              </Button>
            </Link>
            <Link to="/cadastro">
              <Button className="rounded-full bg-[#0a5eb8] hover:bg-[#084a92] text-white">
                Cadastre-se
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-bold leading-tight tracking-tight text-[#0a2540]">
                Domine seu Patrimônio Global com a{" "}
                <span className="text-[#0a5eb8]">Blueberg</span>.
              </h1>
              <p className="text-lg md:text-xl text-[#4a6580] leading-relaxed max-w-lg">
                A única plataforma que alinha seu controle de caixa do dia a dia à
                gestão estratégica de seus investimentos em um só rastro histórico.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link to="/cadastro">
                  <Button
                    size="lg"
                    className="rounded-full bg-[#0a5eb8] hover:bg-[#084a92] text-white h-14 px-8 text-base font-semibold shadow-lg shadow-[#0a5eb8]/20"
                  >
                    Comece Agora — É Grátis
                  </Button>
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="rounded-2xl overflow-hidden shadow-2xl shadow-[#0a5eb8]/10 border border-[#e6ecf1]">
                <img
                  src={heroDashboard}
                  alt="Dashboard Blueberg"
                  className="w-full"
                  loading="eager"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="bg-[#f7f9fc] py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-[#0a2540]">
            Tudo o que você precisa em um só lugar
          </h2>
          <p className="text-center text-[#4a6580] mb-16 max-w-2xl mx-auto text-lg">
            Controle completo do seu dinheiro, dos gastos diários aos investimentos de longo prazo.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: Wallet,
                title: "Controle de Caixa Inteligente",
                desc: "Gerencie múltiplas contas de movimentação, cartões de crédito e dinheiro. Visualize o rastro completo de suas despesas com categorização automatizada.",
              },
              {
                icon: TrendingUp,
                title: "Gestão de Investimentos Profissional",
                desc: "Valorização diária da sua carteira e controle total de ativos realizados em corretoras.",
              },
              {
                icon: Globe,
                title: "Patrimônio Global",
                desc: "Não veja apenas números; entenda a composição total do seu patrimônio com detalhes minuciosos e históricos consolidados.",
              },
              {
                icon: ArrowLeftRight,
                title: "Movimentações Personalizadas",
                desc: "Crie contas customizadas e realize transferências entre contas sem afetar seu fluxo de caixa operacional.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-8 border border-[#e6ecf1] hover:shadow-lg hover:shadow-[#0a5eb8]/5 transition-shadow"
              >
                <div className="w-12 h-12 rounded-xl bg-[#0a5eb8]/10 flex items-center justify-center mb-5">
                  <item.icon className="w-6 h-6 text-[#0a5eb8]" />
                </div>
                <h3 className="text-lg font-semibold mb-3 text-[#0a2540]">{item.title}</h3>
                <p className="text-[#4a6580] leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Comparison Grid */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-[#0a2540]">
            Dois módulos. Uma visão completa.
          </h2>
          <p className="text-center text-[#4a6580] mb-16 max-w-2xl mx-auto text-lg">
            A Blueberg conecta o seu dia a dia financeiro à sua estratégia de longo prazo.
          </p>
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-[#e6ecf1] p-8 bg-white hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#0a5eb8] flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#0a2540]">Módulo Caixa</h3>
                  <span className="text-sm text-[#4a6580]">Liquidez & Gastos</span>
                </div>
              </div>
              <ul className="space-y-3 text-[#4a6580]">
                {[
                  "Extrato consolidado de todas as contas",
                  "Categorização inteligente de despesas",
                  "Controle de gastos mês a mês",
                  "Importação de extratos bancários",
                  "Visão de fluxo de caixa mensal",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0a5eb8] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-[#e6ecf1] p-8 bg-white hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#53b4e8] flex items-center justify-center">
                  <PiggyBank className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#0a2540]">Módulo Investimentos</h3>
                  <span className="text-sm text-[#4a6580]">Crescimento & Ativos</span>
                </div>
              </div>
              <ul className="space-y-3 text-[#4a6580]">
                {[
                  "Posição consolidada por carteira",
                  "Rentabilidade mensal vs CDI",
                  "Extrato detalhado de operações",
                  "Valorização diária dos ativos",
                  "Composição do patrimônio investido",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#53b4e8] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Transfer Bridge */}
          <div className="max-w-3xl mx-auto mt-12">
            <div className="rounded-2xl bg-gradient-to-r from-[#0a5eb8] to-[#53b4e8] p-8 text-white text-center">
              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-4">
                <Layers className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-2">Transferência entre Contas</h3>
              <p className="text-white/85 max-w-lg mx-auto leading-relaxed">
                O elo que organiza a migração do seu capital entre o gasto e o
                investimento. Movimente entre contas sem afetar seu fluxo de caixa
                operacional.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <LandingPricingSection />

      {/* CTA Final */}
      <section className="bg-[#0a2540] py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Pronto para dominar seu patrimônio?
          </h2>
          <p className="text-[#8da4bf] text-lg mb-8">
            Comece agora e tenha a visão completa das suas finanças em um só lugar.
          </p>
          <Link to="/cadastro">
            <Button
              size="lg"
              className="rounded-full bg-[#0a5eb8] hover:bg-[#084a92] text-white h-14 px-10 text-base font-semibold"
            >
              Criar Conta Gratuitamente
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#071b2e] py-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <p className="text-[#8da4bf] text-sm text-center md:text-left italic">
              Blueberg — A ponta do iceberg é apenas o começo da sua liberdade financeira.
            </p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                <Instagram className="w-5 h-5" />
              </a>
              <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                <Linkedin className="w-5 h-5" />
              </a>
              <a href="#" className="text-[#8da4bf] hover:text-white transition-colors">
                <Twitter className="w-5 h-5" />
              </a>
              <span className="text-[#8da4bf] text-sm">Termos de Uso</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
