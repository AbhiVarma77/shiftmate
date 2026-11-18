import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';

import type { Db } from '@/database/types';
import { upsertLocalUser } from '@/repositories/userRepository';
import { useSettingsStore } from '@/store/settingsStore';
import { supabaseRemote } from '@/services/sync/supabaseRemote';
import { resetSyncCursors, type SyncErrorKind, SyncError, type SyncResult, syncOnce } from '@/services/sync/syncEngine';

export type SyncPhase = 'signed_out' | 'idle' | 'syncing' | 'ok' | SyncErrorKind;

interface SyncState {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  message: string | null;
}

export const useSyncStore = create<SyncState>(() => ({ phase: 'signed_out', lastSyncedAt: null, message: null }));

const ACCOUNT_KEY = 'sync.account';
let inFlight: Promise<SyncResult | null> | null = null;

/** Make sure this device's pull progress belongs to the signed-in account. */
async function prepareAccount(db: Db, user: User): Promise<string | null> {
  await upsertLocalUser(db, user);
  const prev = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ACCOUNT_KEY]);
  if (prev?.value !== JSON.stringify(user.id)) {
    await resetSyncCursors(db);
    await db.runAsync(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [ACCOUNT_KEY, JSON.stringify(user.id), Date.now()],
    );
  }
  const local = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE remote_user_id = ?', [user.id]);
  return local?.id ?? null;
}

/** Run one sync round. Concurrent calls share the round already in progress. */
export function syncNow(db: Db, user: User): Promise<SyncResult | null> {
  if (inFlight) return inFlight;
  useSyncStore.setState({ phase: 'syncing' });
  inFlight = (async () => {
    try {
      const localUserId = await prepareAccount(db, user);
      const result = await syncOnce(db, supabaseRemote, localUserId);
      if (result.settingsPulled) await useSettingsStore.getState().hydrate(db);
      useSyncStore.setState({
        phase: result.failed ? 'rejected' : 'ok',
        lastSyncedAt: Date.now(),
        message: result.failed ? `${result.failed} change(s) couldn't be uploaded and will be retried.` : null,
      });
      return result;
    } catch (e) {
      const kind: SyncErrorKind = e instanceof SyncError ? e.kind : 'rejected';
      useSyncStore.setState({ phase: kind, message: e instanceof Error ? e.message : String(e) });
      if (!(e instanceof SyncError)) console.warn('[ShiftMate] Sync failed:', e);
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function markSignedOut() {
  useSyncStore.setState({ phase: 'signed_out', message: null });
}
