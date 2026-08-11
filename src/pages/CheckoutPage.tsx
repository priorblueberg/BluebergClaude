import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CreditCard, Lock, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const planNames: Record<string, string> = {
  "financas-pessoais": "Finanças Pessoais",
  "blueberg-global": "Blueberg Global",
  investimentos: "Investimentos",
};

const CheckoutPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plano = searchParams.get("plano") || "blueberg-global";
  const planName = planNames[plano] || "Blueberg Global";

  const form = {
    nome: "Maria S. Oliveira",
    email: "maria.oliveira@email.com",
    cardNumber: "4532 •••• •••• 7891",
    expiry: "12/28",
    cvv: "•••",
  };
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSuccess(true);
    }, 1500);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f7f9fc] flex items-center justify-center px-6">
        <div className="bg-white rounded-2xl border border-[#e6ecf1] p-10 max-w-md w-full text-center shadow-lg">
          <div className="w-16 h-16 rounded-full bg-[#0a5eb8]/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-9 h-9 text-[#0a5eb8]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0a2540] mb-3">
            Conta Cadastrada com Sucesso!
          </h1>
          <p className="text-[#4a6580] mb-8">
            Sua conta foi criada e seu plano <span className="font-semibold text-[#0a2540]">{planName}</span> está ativo. Faça login para começar.
          </p>
          <Button
            onClick={() => navigate("/auth")}
            className="w-full rounded-xl h-12 text-base font-semibold bg-[#0a5eb8] hover:bg-[#084a92] text-white shadow-lg shadow-[#0a5eb8]/20"
          >
            Ir para o Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f9fc] text-[#0a2540] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-[#e6ecf1]">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-bold text-[#0a2540] tracking-tight">Blueberg</Link>
          <Link
            to="/planos"
            className="flex items-center gap-2 text-[#4a6580] hover:text-[#0a2540] transition-colors text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar aos planos
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-12">
        {/* Trial Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-[#0a5eb8] to-[#53b4e8] p-5 mb-8 text-white text-center shadow-lg shadow-[#0a5eb8]/15">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-90" />
          <p className="font-semibold text-base leading-snug">
            Comece seu teste de 7 dias grátis hoje.
          </p>
          <p className="text-sm text-white/80 mt-1">
            O valor só será cobrado após este período. Cancele a qualquer momento em Configurações de Conta.
          </p>
        </div>

        {/* Plan Summary */}
        <div className="bg-white rounded-2xl border border-[#e6ecf1] p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#4a6580] uppercase tracking-wider font-medium mb-1">
                Plano selecionado
              </p>
              <p className="text-lg font-bold text-[#0a2540]">{planName}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-[#0a2540]">R$ 0,00</p>
              <p className="text-xs text-[#4a6580]">/mês após o teste</p>
            </div>
          </div>
        </div>

        {/* Checkout Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#e6ecf1] p-8 shadow-sm">
          <h2 className="text-xl font-bold text-[#0a2540] mb-6 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#0a5eb8]" />
            Dados de Pagamento
          </h2>

          <div className="space-y-5">
            <div>
              <Label htmlFor="nome" className="text-[#0a2540] font-medium text-sm mb-1.5 block">Nome completo</Label>
              <Input id="nome" value={form.nome} readOnly className="bg-[#f7f9fc] border-[#e6ecf1] rounded-xl h-12 text-[#0a2540] cursor-default" />
            </div>
            <div>
              <Label htmlFor="email" className="text-[#0a2540] font-medium text-sm mb-1.5 block">E-mail</Label>
              <Input id="email" value={form.email} readOnly className="bg-[#f7f9fc] border-[#e6ecf1] rounded-xl h-12 text-[#0a2540] cursor-default" />
            </div>
            <div>
              <Label htmlFor="card" className="text-[#0a2540] font-medium text-sm mb-1.5 block">Número do cartão</Label>
              <Input id="card" value={form.cardNumber} readOnly className="bg-[#f7f9fc] border-[#e6ecf1] rounded-xl h-12 text-[#0a2540] tracking-wider font-mono cursor-default" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="expiry" className="text-[#0a2540] font-medium text-sm mb-1.5 block">Validade</Label>
                <Input id="expiry" value={form.expiry} readOnly className="bg-[#f7f9fc] border-[#e6ecf1] rounded-xl h-12 text-[#0a2540] tracking-wider font-mono cursor-default" />
              </div>
              <div>
                <Label htmlFor="cvv" className="text-[#0a2540] font-medium text-sm mb-1.5 block">CVV</Label>
                <Input id="cvv" value={form.cvv} readOnly className="bg-[#f7f9fc] border-[#e6ecf1] rounded-xl h-12 text-[#0a2540] tracking-wider font-mono cursor-default" />
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full mt-8 rounded-xl h-13 text-base font-semibold bg-[#0a5eb8] hover:bg-[#084a92] text-white shadow-lg shadow-[#0a5eb8]/20 disabled:opacity-40"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processando...
              </span>
            ) : (
              "Iniciar teste grátis"
            )}
          </Button>

          <p className="text-center text-xs text-[#a0b4c8] mt-4 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Pagamento 100% seguro e criptografado
          </p>
        </form>
      </div>
    </div>
  );
};

export default CheckoutPage;
