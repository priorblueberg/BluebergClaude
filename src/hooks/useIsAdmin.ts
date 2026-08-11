import { useAuth } from "@/hooks/useAuth";

const ADMIN_EMAIL = "daniel.prior.soares@gmail.com";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.email === ADMIN_EMAIL;
}
