/** RemoteStore backed by the Supabase tables in supabase/migrations/*_cloud_sync.sql. */
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import { type RemoteDeletion, type RemoteRow, type RemoteSettings, type RemoteStore, SyncError } from './syncEngine';

/** Missing table/column → the SQL hasn't been run; permission/JWT → auth. */
const SETUP_CODES = new Set(['PGRST205', 'PGRST204', '42P01', '42703']);
const AUTH_CODES = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303']);

function toSyncError(error: PostgrestError | Error): SyncError {
  const code = 'code' in error ? error.code : '';
  const message = error.message || 'Unknown sync error';
  if (SETUP_CODES.has(code)) {
    return new SyncError('setup', 'Cloud tables are missing. Run supabase/migrations/20261113000000_cloud_sync.sql in the Supabase SQL Editor.');
  }
  if (AUTH_CODES.has(code)) return new SyncError('auth', `Not allowed to sync: ${message}. Try signing out and in again.`);
  if (!code && /fetch|network|timed? ?out|offline/i.test(message)) return new SyncError('offline', 'You are offline.');
  return new SyncError('rejected', message);
}

async function run<T>(p: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
  let res: { data: T | null; error: PostgrestError | null };
  try {
    res = await p;
  } catch (e) {
    throw toSyncError(e instanceof Error ? e : new Error(String(e)));
  }
  if (res.error) throw toSyncError(res.error);
  return (res.data ?? []) as T;
}

export const supabaseRemote: RemoteStore = {
  async upsert(entity, rows) {
    await run(supabase.from(entity).upsert(rows, { onConflict: 'id' }));
  },

  async remove(entity, ids) {
    await run(supabase.from(entity).delete().in('id', ids));
  },

  async pull(entity, since, offset, limit) {
    let q = supabase.from(entity).select('*');
    if (since) q = q.gt('server_updated_at', since);
    return run<RemoteRow[]>(q.order('server_updated_at').order('id').range(offset, offset + limit - 1));
  },

  async pullDeletions(since, offset, limit) {
    let q = supabase.from('deleted_records').select('entity, entity_id, deleted_at');
    if (since) q = q.gt('deleted_at', since);
    return run<RemoteDeletion[]>(q.order('deleted_at').order('entity_id').range(offset, offset + limit - 1));
  },

  async getSettings() {
    const rows = await run<RemoteSettings[]>(supabase.from('user_settings').select('settings, updated_at').limit(1));
    return rows[0] ?? null;
  },

  async putSettings(value) {
    const { data } = await supabase.auth.getSession();
    const ownerId = data.session?.user.id;
    if (!ownerId) throw new SyncError('auth', 'Not signed in.');
    await run(supabase.from('user_settings').upsert({ owner_id: ownerId, ...value }, { onConflict: 'owner_id' }));
  },
};
