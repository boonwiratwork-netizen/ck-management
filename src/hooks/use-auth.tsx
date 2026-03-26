import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole = 'management' | 'ck_manager' | 'store_manager' | 'area_manager';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { full_name: string; status: string; branch_id: string | null } | null;
  role: AppRole | null;
  isManagement: boolean;
  isStoreManager: boolean;
  isAreaManager: boolean;
  isCkManager: boolean;
  brandAssignments: string[];
  loading: boolean;
  sessionLoading: boolean;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; status: string; branch_id: string | null } | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [brandAssignments, setBrandAssignments] = useState<string[]>([]);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const fetchUserData = async (userId: string) => {
    const [profileRes, roleRes, brandRes] = await Promise.all([
      supabase.from('profiles').select('full_name, status, branch_id').eq('user_id', userId).single(),
      supabase.from('user_roles').select('role').eq('user_id', userId).single(),
      supabase.from('user_brand_assignments').select('brand').eq('user_id', userId),
    ]);
    setProfile(profileRes.data || null);
    setRole((roleRes.data?.role as AppRole) || null);
    setBrandAssignments((brandRes.data || []).map(b => b.brand));
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchUserData(session.user.id), 0);
        } else {
          setProfile(null);
          setRole(null);
          setBrandAssignments([]);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
    setBrandAssignments([]);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role,
        isManagement: role === 'management',
        isStoreManager: role === 'store_manager',
        isAreaManager: role === 'area_manager',
        isCkManager: role === 'ck_manager',
        brandAssignments,
        loading,
        signIn,
        signOut,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
