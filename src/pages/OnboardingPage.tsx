import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const OnboardingPage = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!nomeCompleto.trim()) {
      toast.error("Por favor, informe seu nome completo.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("profiles").insert({
      user_id: user.id,
      email: user.email,
      nome_completo: nomeCompleto.trim(),
      data_nascimento: dataNascimento || null,
    });

    if (error) {
      toast.error("Erro ao salvar perfil: " + error.message);
    } else {
      toast.success("Perfil criado com sucesso!");
      await refreshProfile();
      navigate("/carteira/renda-fixa");
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
            Estamos quase lá!
          </h2>
          <p className="text-white/70 text-lg max-w-md">
            Complete seu perfil para ter acesso completo à plataforma e começar a dominar seu patrimônio.
          </p>
        </div>
        <p className="text-white/40 text-sm">© 2025 Blueberg. Todos os direitos reservados.</p>
      </div>

      {/* Right panel - form */}
      <div className="flex w-full lg:w-1/2 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0a2540]">Complete seu cadastro</h1>
            <p className="mt-2 text-[#4a6580]">
              Precisamos de algumas informações para personalizar sua experiência.
            </p>
          </div>

          {/* Step indicator */}
          <div className="mb-8 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-[#0a5eb8] flex items-center justify-center text-white text-sm font-semibold">1</div>
              <span className="text-sm font-medium text-[#0a2540]">Dados Pessoais</span>
            </div>
            <div className="flex-1 h-px bg-[#d1dbe6]" />
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-[#d1dbe6] flex items-center justify-center text-[#8da4bf] text-sm font-semibold">2</div>
              <span className="text-sm text-[#8da4bf]">Dashboard</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#0a2540]">Nome Completo</Label>
              <Input
                type="text"
                placeholder="Seu nome completo"
                value={nomeCompleto}
                onChange={(e) => setNomeCompleto(e.target.value)}
                required
                className="h-12 rounded-xl border-[#d1dbe6] bg-[#f7f9fc] text-[#0a2540] placeholder:text-[#8da4bf] focus:border-[#0a5eb8] focus:ring-[#0a5eb8]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#0a2540]">Data de Nascimento</Label>
              <Input
                type="date"
                value={dataNascimento}
                onChange={(e) => setDataNascimento(e.target.value)}
                className="h-12 rounded-xl border-[#d1dbe6] bg-[#f7f9fc] text-[#0a2540] placeholder:text-[#8da4bf] focus:border-[#0a5eb8] focus:ring-[#0a5eb8]"
              />
            </div>
            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#0a5eb8] text-base font-semibold text-white hover:bg-[#084a92] shadow-lg shadow-[#0a5eb8]/20"
              disabled={loading}
            >
              {loading ? "Salvando..." : "Continuar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
