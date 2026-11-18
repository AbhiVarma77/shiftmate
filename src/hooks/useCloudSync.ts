import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { markSignedOut, syncNow } from '@/store/syncStore';

import { useDb } from './data';

const INTERVAL_MS = 60_000;
const AFTER_CHANGE_MS = 2_000;

/**
 * Keeps the device in sync with the cloud while signed in: on sign-in, every
 * minute, when the app returns to the foreground, and shortly after local edits.
 * Mount once, inside the database provider.
 */
export function useCloudSync() {
  const db = useDb();
  const user = useAuthStore((s) => s.user);
  const version = useDataStore((s) => s.version);
  const invalidate = useDataStore((s) => s.invalidate);
  const first = useRef(true);

  useEffect(() => {
    if (!user) {
      markSignedOut();
      return;
    }
    const run = () =>
      syncNow(db, user).then((r) => {
        // Only refresh screens when the cloud actually changed local data.
        if (r && r.pulled + r.deleted > 0) invalidate();
      });
    run();
    const timer = setInterval(run, INTERVAL_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [db, user, invalidate]);

  // Local edits bump `version`; upload them soon after (debounced).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!user) return;
    const t = setTimeout(() => syncNow(db, user), AFTER_CHANGE_MS);
    return () => clearTimeout(t);
  }, [db, user, version]);
}
