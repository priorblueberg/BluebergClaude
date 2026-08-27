import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Tela inicial da plataforma (rota "/"). A pagina comercial foi removida, entao
 * quem abre o site cai direto no login: fundo branco e so o box de credenciais.
 */
const AuthPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Check if email exists in profiles
    const { data: exists } = await supabase.rpc("check_email_exists", { p_email: email });

    if (!exists) {
      toast.error("Este e-mail não está cadastrado. Entre em contato com o administrador.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message?.toLowerCase().includes("invalid login credentials")) {
        toast.error("Senha incorreta. Verifique seus dados e tente novamente.");
      } else if (error.message?.toLowerCase().includes("email not confirmed")) {
        toast.error("E-mail ainda não confirmado. Verifique sua caixa de entrada.");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Login realizado com sucesso!");
      navigate("/carteira");
    }
    setLoading(false);
  };

  // Quem ja esta logado nao precisa ver o login de novo.
  if (!authLoading && user) return <Navigate to="/carteira" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#0a2540]">Bem-vindo de volta</h1>
          <p className="mt-2 text-[#4a6580]">
            Entre com suas credenciais para acessar a plataforma.
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
              autoFocus
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
            {loading ? "Carregando..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AuthPage;
