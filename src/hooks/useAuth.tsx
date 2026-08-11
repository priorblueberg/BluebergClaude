import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasProfile: boolean | null;
  profileName: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshCustodia: () => Promise<boolean | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nome_completo")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Erro ao verificar perfil", error);
      setHasProfile(false);
      setProfileName(null);
      return;
    }

    setHasProfile(!!data);
    setProfileName(data?.nome_completo ?? null);
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setHasProfile(null);
    setProfileName(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let initialLoadDone = false;

    const hydrateUserState = async (nextUser: User | null, refreshProfileData = true) => {
      if (!isMounted) return;

      setUser(nextUser);

      if (!nextUser) {
        clearAuthState();
        return;
      }

      if (!refreshProfileData) return;

      // Only show loading spinner on initial load; subsequent auth events
      // (e.g. tab regain focus) must NOT unmount the tree.
      if (!initialLoadDone) {
        setLoading(true);
      }
      await loadProfile(nextUser.id);
      if (isMounted) {
        setLoading(false);
        initialLoadDone = true;
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const sessionUser = session?.user ?? null;

        if (event === "TOKEN_REFRESHED") {
          setUser(sessionUser);
          return;
        }

        // After initial load, silently refresh profile without flipping loading
        void hydrateUserState(sessionUser);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      void hydrateUserState(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [clearAuthState, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await loadProfile(user.id);
  }, [loadProfile, user]);

  const refreshCustodia = useCallback(async () => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("custodia")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if (error) {
      console.error("Erro ao atualizar custódia", error);
      return null;
    }

    return data.length > 0;
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, hasProfile, profileName, signOut, refreshProfile, refreshCustodia }),
    [user, loading, hasProfile, profileName, signOut, refreshProfile, refreshCustodia]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
