/**
 * Two devices syncing through an in-memory server that behaves like the
 * Supabase schema: last-writer-wins on updated_at, server_updated_at cursors,
 * and tombstones for hard deletes.
 */
import { migrate } from '@/database/migrations';
import type { Db } from '@/database/types';
import { getJob } from '@/repositories/jobsRepository';
import { loadSettings, saveSetting } from '@/repositories/settingsRepository';
import type { SyncEntity } from '@/repositories/outbox';
import { getShift, listShifts } from '@/repositories/shiftsRepository';
import { createJob, updateJobDetails } from '@/services/jobService';
import { createManualShift, deleteShift, editShift } from '@/services/shiftService';
import {
  pullChanges,
  pushChanges,
  type RemoteDeletion,
  type RemoteRow,
  type RemoteSettings,
  type RemoteStore,
  SyncError,
  syncOnce,
} from '@/services/sync/syncEngine';

import { createTestDb } from '../helpers/nodeDb';

const T0 = Date.parse('2026-11-10T09:00:00Z');
const at = (h: number) => T0 + h * 3600 * 1000;

class FakeServer implements RemoteStore {
  tables = new Map<string, Map<string, RemoteRow>>();
  deletions: RemoteDeletion[] = [];
  private clock = Date.parse('2026-11-10T00:00:00Z');
  fail: SyncError | null = null;
  calls = 0;

  private stamp() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  table(e: string) {
    if (!this.tables.has(e)) this.tables.set(e, new Map());
    return this.tables.get(e)!;
  }
  async upsert(entity: SyncEntity, rows: Record<string, unknown>[]) {
    this.calls++;
    if (this.fail) throw this.fail;
    for (const r of rows) {
      expect(r).not.toHaveProperty('user_id');
      expect(r).not.toHaveProperty('sync_status');
      const prev = this.table(entity).get(r.id as string);
      if (prev && (r.updated_at as number) < prev.updated_at) continue; // LWW
      this.table(entity).set(r.id as string, { ...(r as RemoteRow), server_updated_at: this.stamp() });
    }
  }
  async remove(entity: SyncEntity, ids: string[]) {
    this.calls++;
    if (this.fail) throw this.fail;
    for (const id of ids) {
      if (this.table(entity).delete(id)) this.deletions.push({ entity, entity_id: id, deleted_at: this.stamp() });
    }
  }
  async pull(entity: SyncEntity, since: string | null, offset: number, limit: number) {
    if (this.fail) throw this.fail;
    return [...this.table(entity).values()]
      .filter((r) => !since || r.server_updated_at > since)
      .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))
      .slice(offset, offset + limit);
  }
  settings: RemoteSettings | null = null;
  async getSettings() {
    if (this.fail) throw this.fail;
    return this.settings;
  }
  async putSettings(value: RemoteSettings) {
    if (this.fail) throw this.fail;
    if (!this.settings || value.updated_at >= this.settings.updated_at) this.settings = value;
  }
  async pullDeletions(since: string | null, offset: number, limit: number) {
    if (this.fail) throw this.fail;
    return this.deletions.filter((d) => !since || d.deleted_at > since).slice(offset, offset + limit);
  }
}

async function device(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const jobSyncStatus = async (db: Db, id: string) =>
  (await db.getFirstAsync<{ sync_status: string }>('SELECT sync_status FROM jobs WHERE id = ?', [id]))?.sync_status;
const queueCount = async (db: Db) => (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue'))!.n;

async function jobWithShift(db: Db) {
  const job = await createJob(db, { companyName: 'Northwind Café', jobTitle: 'Barista', currency: 'GBP', hourlyRate: '12.50' }, at(-10));
  const shift = await createManualShift(
    db,
    { mode: 'times', jobId: job.id, shiftDate: '2026-11-09', startTime: '09:00', endTime: '17:00', paidBreakMinutes: 0, unpaidBreakMinutes: 30 },
    {},
    at(-5),
  );
  return { job, shift };
}

describe('cloud sync', () => {
  it('uploads queued changes and clears the outbox only after the server confirms', async () => {
    const server = new FakeServer();
    const a = await device();
    const { job, shift } = await jobWithShift(a);
    expect(await queueCount(a)).toBeGreaterThan(0);

    const r = await pushChanges(a, server, at(0));
    expect(r.failed).toBe(0);
    expect(await queueCount(a)).toBe(0);
    expect(server.table('jobs').get(job.id)?.company_name).toBe('Northwind Café');
    expect(server.table('shifts').get(shift.id)?.net_work_seconds).toBe(shift.netWorkSeconds);
    expect(server.table('job_pay_rates').size).toBe(1);
    expect(await jobSyncStatus(a, job.id)).toBe('synced');
  });

  it('copies everything to a second device', async () => {
    const server = new FakeServer();
    const a = await device();
    const b = await device();
    const { job, shift } = await jobWithShift(a);
    await syncOnce(a, server, null, at(0));

    const r = await syncOnce(b, server, null, at(0));
    expect(r.pulled).toBeGreaterThanOrEqual(3); // job, pay rate, shift
    expect((await getJob(b, job.id))?.companyName).toBe('Northwind Café');
    expect((await getShift(b, shift.id))?.netWorkSeconds).toBe(shift.netWorkSeconds);
    // Pulled rows are not re-queued for upload.
    expect(await queueCount(b)).toBe(0);
  });

  it('propagates edits both ways with last-writer-wins', async () => {
    const server = new FakeServer();
    const a = await device();
    const b = await device();
    const { job, shift } = await jobWithShift(a);
    await syncOnce(a, server, null, at(0));
    await syncOnce(b, server, null, at(0));

    await editShift(b, shift.id, { notes: 'Covered for Sam' }, {}, at(1));
    await syncOnce(b, server, null, at(1));
    await syncOnce(a, server, null, at(1));
    expect((await getShift(a, shift.id))?.notes).toBe('Covered for Sam');

    // Concurrent edits: the later updated_at wins on both devices.
    await updateJobDetails(a, job.id, { jobTitle: 'Head barista' }, at(3));
    await updateJobDetails(b, job.id, { jobTitle: 'Supervisor' }, at(2));
    await syncOnce(b, server, null, at(4));
    await syncOnce(a, server, null, at(4));
    await syncOnce(b, server, null, at(4));
    expect((await getJob(a, job.id))?.jobTitle).toBe('Head barista');
    expect((await getJob(b, job.id))?.jobTitle).toBe('Head barista');
  });

  it('removes permanently deleted shifts on other devices', async () => {
    const server = new FakeServer();
    const a = await device();
    const b = await device();
    const { shift } = await jobWithShift(a);
    await syncOnce(a, server, null, at(0));
    await syncOnce(b, server, null, at(0));

    await deleteShift(a, shift.id, at(1));
    await syncOnce(a, server, null, at(1));
    expect(server.table('shifts').has(shift.id)).toBe(false);

    const r = await syncOnce(b, server, null, at(1));
    expect(r.deleted).toBe(1);
    expect(await getShift(b, shift.id)).toBeNull();
    expect(await listShifts(b, { from: '2026-11-09', to: '2026-11-09' })).toHaveLength(0);
  });

  it('keeps the outbox intact while offline and does not count it as a failure', async () => {
    const server = new FakeServer();
    const a = await device();
    await jobWithShift(a);
    const before = await queueCount(a);
    server.fail = new SyncError('offline', 'You are offline.');

    await expect(syncOnce(a, server, null, at(0))).rejects.toMatchObject({ kind: 'offline' });
    expect(await queueCount(a)).toBe(before);
    const attempts = await a.getAllAsync<{ attempts: number }>('SELECT attempts FROM sync_queue');
    expect(attempts.every((x) => x.attempts === 0)).toBe(true);

    server.fail = null;
    await syncOnce(a, server, null, at(0));
    expect(await queueCount(a)).toBe(0);
  });

  it('backs off rows the server rejects, then retries them', async () => {
    const server = new FakeServer();
    const a = await device();
    await jobWithShift(a);
    server.fail = new SyncError('rejected', 'check constraint failed');

    const r = await pushChanges(a, server, at(0));
    expect(r.failed).toBeGreaterThan(0);
    const row = await a.getFirstAsync<{ attempts: number; last_error: string; next_attempt_at: number }>('SELECT * FROM sync_queue LIMIT 1');
    expect(row).toMatchObject({ attempts: 1, last_error: 'check constraint failed' });
    expect(row!.next_attempt_at).toBeGreaterThan(at(0));

    // Not retried before the backoff expires…
    server.fail = null;
    server.calls = 0;
    await pushChanges(a, server, at(0) + 1000);
    expect(server.calls).toBe(0);
    // …then uploaded once it has.
    await pushChanges(a, server, at(1));
    expect(await queueCount(a)).toBe(0);
  });

  it('does not lose an edit made while an upload was in flight', async () => {
    const server = new FakeServer();
    const a = await device();
    const { job } = await jobWithShift(a);
    const realUpsert = server.upsert.bind(server);
    server.upsert = async (entity, rows) => {
      await realUpsert(entity, rows);
      if (entity === 'jobs') await updateJobDetails(a, job.id, { notes: 'edited mid-sync' }, at(1));
    };
    await pushChanges(a, server, at(0));
    // The newer edit is still queued and pending.
    const q = await a.getFirstAsync<{ payload: string }>("SELECT payload FROM sync_queue WHERE entity = 'jobs'");
    expect(JSON.parse(q!.payload).notes).toBe('edited mid-sync');
    expect(await jobSyncStatus(a, job.id)).toBe('pending');
  });

  it('only re-reads recent changes on later pulls', async () => {
    const server = new FakeServer();
    const a = await device();
    const b = await device();
    await jobWithShift(a);
    await syncOnce(a, server, null, at(0));
    expect((await pullChanges(b, server, null, at(0))).pulled).toBeGreaterThan(0);
    expect((await pullChanges(b, server, null, at(0))).pulled).toBe(0);
  });

  it('saves settings to the account and restores them on another device', async () => {
    const server = new FakeServer();
    const a = await device();
    const b = await device();
    await saveSetting(a, 'theme', 'dark', at(0));
    await saveSetting(a, 'defaultCurrency', 'EUR', at(0));
    expect((await syncOnce(a, server, null, at(0))).settingsPulled).toBe(false);
    expect(server.settings?.settings).toMatchObject({ theme: 'dark', defaultCurrency: 'EUR' });

    const r = await syncOnce(b, server, null, at(0));
    expect(r.settingsPulled).toBe(true);
    expect(await loadSettings(b)).toMatchObject({ theme: 'dark', defaultCurrency: 'EUR' });

    // A later change on B wins over A's older copy.
    await saveSetting(b, 'weekStartsOn', 0, at(2));
    await syncOnce(b, server, null, at(2));
    await syncOnce(a, server, null, at(2));
    expect((await loadSettings(a)).weekStartsOn).toBe(0);
    // Nothing moves when both sides already match.
    expect((await syncOnce(a, server, null, at(3))).settingsPulled).toBe(false);
  });
});
