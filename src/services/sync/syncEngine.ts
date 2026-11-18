/**
 * Cloud sync engine (Phase 10).
 *
 * Push: drains the transactional outbox (`sync_queue`) to the server. An entry
 * is removed only after the server confirms it, and only if it wasn't
 * re-queued meanwhile (payload unchanged) — so a newer local edit is never lost.
 *
 * Pull: fetches rows changed on the server since a per-table cursor and applies
 * them locally with last-writer-wins on `updated_at`. Pulled rows are written
 * directly (not through repositories) so they're never re-queued for upload.
 * Hard deletions arrive as tombstones from `deleted_records`.
 *
 * The engine only talks to a `RemoteStore`, so tests run it against an
 * in-memory server and the app plugs in Supabase (supabaseRemote.ts).
 */
import type { Db, SqlParam } from '@/database/types';
import type { SyncEntity } from '@/repositories/outbox';
import { type AppSettings, DEFAULT_SETTINGS, loadSettings } from '@/repositories/settingsRepository';

/** Parents before children, so local foreign keys are satisfied on pull. */
export const SYNC_ORDER: SyncEntity[] = [
  'jobs',
  'job_pay_rates',
  'job_overtime_rules',
  'job_schedules',
  'job_schedule_days',
  'weekly_targets',
  'shifts',
  'breaks',
];

/** Columns that exist only on the device / only on the server. */
const LOCAL_ONLY_COLUMNS = ['user_id', 'sync_status'];
const PUSH_BATCH = 100;
const PULL_PAGE = 500;
/** Re-read a little before the cursor: concurrent server commits can land slightly out of order. */
const PULL_OVERLAP_MS = 2 * 60 * 1000;
const CURSOR_KEY = (name: string) => `sync.cursor.${name}`;

export type RemoteRow = Record<string, unknown> & { id: string; updated_at: number; server_updated_at: string };
export interface RemoteDeletion {
  entity: string;
  entity_id: string;
  deleted_at: string;
}

export interface RemoteStore {
  upsert(entity: SyncEntity, rows: Record<string, unknown>[]): Promise<void>;
  remove(entity: SyncEntity, ids: string[]): Promise<void>;
  /** Rows with server_updated_at > since (all when null), ordered by server_updated_at, id. */
  pull(entity: SyncEntity, since: string | null, offset: number, limit: number): Promise<RemoteRow[]>;
  pullDeletions(since: string | null, offset: number, limit: number): Promise<RemoteDeletion[]>;
  getSettings(): Promise<RemoteSettings | null>;
  putSettings(value: RemoteSettings): Promise<void>;
}

export interface RemoteSettings {
  settings: Partial<AppSettings>;
  updated_at: number;
}

/**
 * offline — no connection; try again later, nothing marked as failed.
 * setup   — the cloud tables don't exist / are misconfigured on the server.
 * auth    — the session isn't allowed to write (expired or wrong policies).
 * rejected — the server refused these particular rows.
 */
export type SyncErrorKind = 'offline' | 'setup' | 'auth' | 'rejected';

export class SyncError extends Error {
  constructor(
    public readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  failed: number;
  /** True when settings were replaced by the account's newer copy (re-load the settings store). */
  settingsPulled: boolean;
}

interface QueueEntry {
  id: string;
  entity: SyncEntity;
  entity_id: string;
  payload: string;
  attempts: number;
}

/** Exponential backoff for rows the server rejected: 10s, 20s, 40s … capped at 30 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(10_000 * 2 ** attempts, 30 * 60 * 1000);
}

const columnCache = new WeakMap<Db, Map<string, string[]>>();
async function localColumns(db: Db, table: string): Promise<string[]> {
  let byTable = columnCache.get(db);
  if (!byTable) columnCache.set(db, (byTable = new Map()));
  const hit = byTable.get(table);
  if (hit) return hit;
  const cols = (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
  byTable.set(table, cols);
  return cols;
}

function toRemote(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  for (const c of LOCAL_ONLY_COLUMNS) delete out[c];
  return out;
}

/** An id-only tombstone (hard delete) vs a full row (insert/update/soft delete). */
function isHardDelete(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).length === 1 && 'id' in payload;
}

async function ack(db: Db, entry: QueueEntry, payload: Record<string, unknown>): Promise<void> {
  const r = await db.runAsync('DELETE FROM sync_queue WHERE id = ? AND payload = ?', [entry.id, entry.payload]);
  if (r.changes === 0 || isHardDelete(payload)) return; // re-queued meanwhile, or nothing left to mark
  const cols = await localColumns(db, entry.entity);
  if (cols.includes('sync_status')) {
    await db.runAsync(`UPDATE ${entry.entity} SET sync_status = 'synced' WHERE id = ? AND updated_at = ?`, [
      entry.entity_id,
      payload.updated_at as number,
    ]);
  }
}

async function markFailed(db: Db, entries: QueueEntry[], message: string, now: number): Promise<void> {
  for (const e of entries) {
    await db.runAsync(
      'UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ? AND payload = ?',
      [message.slice(0, 500), now + retryDelayMs(e.attempts), e.id, e.payload],
    );
  }
}

/** Upload due outbox entries. Throws SyncError for offline/setup/auth problems. */
export async function pushChanges(db: Db, remote: RemoteStore, now = Date.now()): Promise<{ pushed: number; failed: number }> {
  const entries = await db.getAllAsync<QueueEntry>(
    'SELECT id, entity, entity_id, payload, attempts FROM sync_queue WHERE next_attempt_at <= ? ORDER BY created_at',
    [now],
  );
  let pushed = 0;
  let failed = 0;

  for (const entity of SYNC_ORDER) {
    const mine = entries.filter((e) => e.entity === entity).map((e) => ({ e, p: JSON.parse(e.payload) as Record<string, unknown> }));
    const groups = [mine.filter((x) => !isHardDelete(x.p)), mine.filter((x) => isHardDelete(x.p))];

    for (const [g, group] of groups.entries()) {
      for (let i = 0; i < group.length; i += PUSH_BATCH) {
        const batch = group.slice(i, i + PUSH_BATCH);
        try {
          if (g === 0) await remote.upsert(entity, batch.map((x) => toRemote(x.p)));
          else await remote.remove(entity, batch.map((x) => x.e.entity_id));
        } catch (err) {
          if (err instanceof SyncError && err.kind !== 'rejected') throw err;
          await markFailed(db, batch.map((x) => x.e), err instanceof Error ? err.message : String(err), now);
          failed += batch.length;
          continue;
        }
        for (const x of batch) await ack(db, x.e, x.p);
        pushed += batch.length;
      }
    }
  }
  return { pushed, failed };
}

async function getCursor(db: Db, name: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [CURSOR_KEY(name)]);
  return row ? (JSON.parse(row.value) as string) : null;
}

async function setCursor(db: Db, name: string, value: string, now: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [CURSOR_KEY(name), JSON.stringify(value), now],
  );
}

function sinceFromCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  const t = Date.parse(cursor);
  return Number.isNaN(t) ? null : new Date(t - PULL_OVERLAP_MS).toISOString();
}

function later(a: string | null, b: string): string {
  return a && Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Insert or update one server row locally if it's newer. Returns true if anything changed. */
async function applyRemoteRow(db: Db, entity: SyncEntity, row: RemoteRow, localUserId: string | null): Promise<boolean> {
  const cols = await localColumns(db, entity);
  const names: string[] = [];
  const values: SqlParam[] = [];
  for (const c of cols) {
    if (c === 'user_id') {
      names.push(c);
      values.push(localUserId);
    } else if (c === 'sync_status') {
      names.push(c);
      values.push('synced');
    } else if (c in row) {
      const v = row[c];
      names.push(c);
      values.push(v == null ? null : typeof v === 'boolean' ? Number(v) : (v as SqlParam));
    }
  }
  const updates = names.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  const r = await db.runAsync(
    `INSERT INTO ${entity} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}
     WHERE excluded.updated_at > ${entity}.updated_at`,
    values,
  );
  return r.changes > 0;
}

/** Download server changes since the last pull. */
export async function pullChanges(
  db: Db,
  remote: RemoteStore,
  localUserId: string | null,
  now = Date.now(),
): Promise<{ pulled: number; deleted: number; skipped: number }> {
  let pulled = 0;
  let skipped = 0;

  for (const entity of SYNC_ORDER) {
    const cursor = await getCursor(db, entity);
    const since = sinceFromCursor(cursor);
    let newest = cursor;
    for (let offset = 0; ; offset += PULL_PAGE) {
      const rows = await remote.pull(entity, since, offset, PULL_PAGE);
      for (const row of rows) {
        try {
          if (await applyRemoteRow(db, entity, row, localUserId)) pulled++;
        } catch (e) {
          // A row that breaks a local rule (e.g. two running timers for one job,
          // or a parent that was deleted here) is skipped rather than blocking sync.
          skipped++;
          console.warn(`[ShiftMate] Skipped synced ${entity} row ${row.id}:`, e instanceof Error ? e.message : e);
        }
        newest = later(newest, row.server_updated_at);
      }
      if (rows.length < PULL_PAGE) break;
    }
    if (newest && newest !== cursor) await setCursor(db, entity, newest, now);
  }

  let deleted = 0;
  const delCursor = await getCursor(db, 'deleted_records');
  let delNewest = delCursor;
  const known = new Set<string>(SYNC_ORDER);
  for (let offset = 0; ; offset += PULL_PAGE) {
    const rows = await remote.pullDeletions(sinceFromCursor(delCursor), offset, PULL_PAGE);
    for (const d of rows) {
      if (known.has(d.entity)) {
        const r = await db.runAsync(`DELETE FROM ${d.entity} WHERE id = ?`, [d.entity_id]);
        await db.runAsync('DELETE FROM sync_queue WHERE entity = ? AND entity_id = ?', [d.entity, d.entity_id]);
        deleted += r.changes;
      }
      delNewest = later(delNewest, d.deleted_at);
    }
    if (rows.length < PULL_PAGE) break;
  }
  if (delNewest && delNewest !== delCursor) await setCursor(db, 'deleted_records', delNewest, now);

  return { pulled, deleted, skipped };
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

/**
 * Settings are one document per account, last-writer-wins on the newest
 * local `settings.updated_at`. Returns which way they moved.
 */
export async function syncSettings(db: Db, remote: RemoteStore): Promise<'pushed' | 'pulled' | 'none'> {
  const rows = await db.getAllAsync<{ key: string; updated_at: number }>(
    `SELECT key, updated_at FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(', ')})`,
    SETTING_KEYS,
  );
  const localUpdated = rows.reduce((m, r) => Math.max(m, r.updated_at), 0);
  const server = await remote.getSettings();
  const serverUpdated = server?.updated_at ?? 0;

  if (server && serverUpdated > localUpdated) {
    await db.withTransactionAsync(async () => {
      for (const key of SETTING_KEYS) {
        if (!(key in server.settings)) continue;
        await db.runAsync(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          [key, JSON.stringify(server.settings[key]), serverUpdated],
        );
      }
    });
    return 'pulled';
  }
  if (localUpdated > serverUpdated) {
    await remote.putSettings({ settings: await loadSettings(db), updated_at: localUpdated });
    return 'pushed';
  }
  return 'none';
}

/** One full round: upload local changes, then download remote ones. */
export async function syncOnce(db: Db, remote: RemoteStore, localUserId: string | null, now = Date.now()): Promise<SyncResult> {
  const { pushed, failed } = await pushChanges(db, remote, now);
  const { pulled, deleted } = await pullChanges(db, remote, localUserId, now);
  const settingsPulled = (await syncSettings(db, remote)) === 'pulled';
  return { pushed, pulled, deleted, failed, settingsPulled };
}

/** Forget pull progress (e.g. after switching accounts) so the next sync re-downloads everything. */
export async function resetSyncCursors(db: Db): Promise<void> {
  await db.runAsync("DELETE FROM settings WHERE key LIKE 'sync.cursor.%'");
}
