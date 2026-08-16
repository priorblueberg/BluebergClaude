import { useAuth } from "@/hooks/useAuth";

/**
 * Papel do usuario, vindo de invest.user_roles pela funcao invest.is_admin().
 * Antes isso era uma comparacao de e-mail hardcoded aqui, que ia parar no
 * bundle publico e nao valia nada do lado do servidor.
 *
 * Retorna false enquanto o papel ainda esta carregando: quem precisa
 * distinguir "carregando" de "nao e admin" (ex.: guarda de rota) deve ler
 * isAdmin direto do useAuth, onde null = indefinido.
 */
export function useIsAdmin(): boolean {
  const { isAdmin } = useAuth();
  return isAdmin === true;
}
