import { useState } from 'react';

import { confirm } from '@/components/ui/Dialog';
import { clearLocalAccountData, pendingUploadCount } from '@/repositories/accountRepository';
import { useAuthStore } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow } from '@/store/syncStore';

import { useDb } from './data';

/**
 * Sign out safely: upload pending changes first, warn if some couldn't be
 * uploaded, then clear this account's records from the device so the next
 * person who signs in here starts clean. The cloud copy is untouched.
 */
export function useSignOut() {
  const db = useDb();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const invalidate = useDataStore((s) => s.invalidate);
  const [signingOut, setSigningOut] = useState(false);

  const run = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'Your records are saved in your account and will be back when you sign in again.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok || !user) return;
    setSigningOut(true);
    try {
      await syncNow(db, user);
      const unsent = await pendingUploadCount(db);
      if (unsent > 0) {
        const force = await confirm({
          title: `${unsent} change(s) not backed up yet`,
          message: "They couldn't be uploaded (you may be offline). Signing out now removes them from this device for good.",
          confirmLabel: 'Sign out anyway',
          cancelLabel: 'Stay signed in',
          destructive: true,
        });
        if (!force) return;
      }
      await clearLocalAccountData(db);
      await signOut();
      await hydrate(db);
      invalidate();
    } finally {
      setSigningOut(false);
    }
  };

  return { signOut: run, signingOut };
}
