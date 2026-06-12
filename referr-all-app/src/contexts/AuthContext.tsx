import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as api from '../lib/api';
import type { Profile } from '../lib/types';

type AuthContextType = {
  user: Profile | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshProfile() {
    if (!api.getToken()) {
      setProfile(null);
      return;
    }
    try {
      const me = await api.fetchMe();
      setProfile(me);
    } catch {
      api.setToken(null);
      setProfile(null);
    }
  }

  useEffect(() => {
    (async () => {
      if (!api.getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.fetchMe();
        setProfile(me);
      } catch {
        api.setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function signOut() {
    await api.logout();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user: profile, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
