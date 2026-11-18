import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  session: Session | null;
  user: User | null;
  status: AuthStatus;

  /** Bootstrap: load existing session and subscribe to auth changes. Call once on app start. */
  init: () => () => void; // returns unsubscribe fn

  signOut: (scope?: 'global' | 'local') => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  status: 'loading',

  init: () => {
    // If Supabase isn't configured, skip — the app works fully offline.
    if (!isSupabaseConfigured) {
      set({ status: 'unauthenticated' });
      return () => {};
    }

    // Restore persisted session on cold start.
    supabase.auth.getSession().then(({ data }) => {
      set({
        session: data.session,
        user: data.session?.user ?? null,
        status: data.session ? 'authenticated' : 'unauthenticated',
      });
    });

    // Listen for sign-in / sign-out / token refresh.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'authenticated' : 'unauthenticated',
      });
    });

    return () => listener.subscription.unsubscribe();
  },

  signOut: async (scope = 'global') => {
    if (isSupabaseConfigured) await supabase.auth.signOut({ scope });
    set({ session: null, user: null, status: 'unauthenticated' });
  },
}));
