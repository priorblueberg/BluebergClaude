import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CadastroPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // E-mail para onde foi o link de confirmacao. Preenchido, a tela troca o formulario pelo aviso.
  const [aguardandoConfirmacao, setAguardandoConfirmacao] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // O projeto exige confirmacao de e-mail: o link volta direto para o onboarding.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });

    if (error) {
      if (error.message?.toLowerCase().includes("user already registered")) {
        // User exists in auth but maybe has no profile - try signing in
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          toast.error("Este e-mail já está cadastrado. Faça login para continuar.");
          navigate("/auth");
        } else {
          const { data: hasProfile } = await supabase.rpc("check_email_exists", { p_email: email });
          if (hasProfile) {
            toast.success("Login realizado com sucesso!");
            navigate("/carteira");
          } else {
            toast.success("Complete seu cadastro!");
            navigate("/onboarding");
          }
        }
      } else {
        toast.error(error.message);
      }
    } else if (data?.user?.identities?.length === 0) {
      toast.error("Este e-mail já está cadastrado. Faça login para continuar.");
      navigate("/auth");
    } else if (!data?.session) {
      // Conta criada, mas sem sessao ate o e-mail ser confirmado. Mandar para o onboarding agora
      // so jogaria a pessoa no login sem explicacao.
      setAguardandoConfirmacao(email);
    } else {
      toast.success("Conta criada com sucesso!");
      navigate("/onboarding");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#0a2540] to-[#0a5eb8] flex-col justify-between p-12">
        <div />
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            Falta pouco para dominar seu patrimônio.
          </h2>
          <p className="text-white/70 text-lg max-w-md">
            Crie sua conta e comece a ter controle total das suas finanças em poucos minutos.
          </p>
        </div>
        <p className="text-white/40 text-sm">© 2025 Blueberg. Todos os direitos reservados.</p>
      </div>

      {/* Right panel - form */}
      <div className="flex w-full lg:w-1/2 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {aguardandoConfirmacao ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-[#0a2540]">Confirme seu e-mail</h1>
              <p className="text-[#4a6580]">
                Enviamos um link de confirmação para{" "}
                <span className="font-semibold text-[#0a2540]">{aguardandoConfirmacao}</span>. Abra o e-mail e
                clique no link para ativar sua conta.
              </p>
              <p className="text-sm text-[#8da4bf]">Não chegou? Confira a caixa de spam.</p>
              <Link to="/auth" className="inline-block pt-2 text-sm font-semibold text-[#0a5eb8]">
                Ir para o login
              </Link>
            </div>
          ) : (
          <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0a2540]">Crie sua conta</h1>
            <p className="mt-2 text-[#4a6580]">
              Preencha os dados abaixo para começar seu teste grátis.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#0a2540]">Email</Label>
              <Input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 rounded-xl border-[#d1dbe6] bg-[#f7f9fc] text-[#0a2540] placeholder:text-[#8da4bf] focus:border-[#0a5eb8] focus:ring-[#0a5eb8]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#0a2540]">Senha</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-12 rounded-xl border-[#d1dbe6] bg-[#f7f9fc] text-[#0a2540] placeholder:text-[#8da4bf] focus:border-[#0a5eb8] focus:ring-[#0a5eb8]"
              />
            </div>
            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#0a5eb8] text-base font-semibold text-white hover:bg-[#084a92] shadow-lg shadow-[#0a5eb8]/20"
              disabled={loading}
            >
              {loading ? "Criando conta..." : "Cadastrar"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/auth" className="text-sm text-[#4a6580] hover:text-[#0a5eb8] transition-colors">
              Já tem conta? <span className="font-semibold text-[#0a5eb8]">Entrar</span>
            </Link>
          </div>

          </>
          )}

          <div className="mt-4 text-center">
            <Link to="/" className="text-sm text-[#8da4bf] hover:text-[#0a5eb8] transition-colors">
              ← Voltar ao site
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CadastroPage;
