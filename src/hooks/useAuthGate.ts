import { router, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '@/store/authStore';

/**
 * An account is required. Signed-out users can only see the auth screens
 * (sign-up first); once signed in they're sent into the app and can't land
 * back on the auth screens. `auth/callback` is exempt: it finishes sign-in.
 */
export function useAuthGate() {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments() as string[];
  const inAuth = segments[0] === 'auth';
  const onCallback = inAuth && segments[1] === 'callback';

  useEffect(() => {
    if (status === 'loading' || onCallback) return;
    if (status === 'unauthenticated' && !inAuth) router.replace('/auth/sign-up');
    else if (status === 'authenticated' && inAuth) router.replace('/');
  }, [status, inAuth, onCallback]);
}
