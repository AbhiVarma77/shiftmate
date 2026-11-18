import { migrate, LATEST_VERSION } from '@/database/migrations';
import { listJobs, listPayRates } from '@/repositories/jobsRepository';
import { getShift, listActiveShifts, listBreaks, listShifts } from '@/repositories/shiftsRepository';
import { DomainError } from '@/services/errors';
import { changePayRate, createJob, setJobActive, updateJobDetails } from '@/services/jobService';
import {
  createManualShift,
  deleteBreak,
  deleteShift,
  deleteShiftsOnDate,
  editShift,
  endBreak,
  pauseShift,
  resumeShift,
  saveBreak,
  startBreak,
  startShift,
  stopShift,
} from '@/services/shiftService';

import { createTestDb } from '../helpers/nodeDb';

const H = 3600;
const TZ = 'Europe/London';
const engine = { allowConcurrentShifts: false, timezone: TZ };
const T0 = Date.parse('2026-11-10T09:00:00Z');
const at = (h: number) => T0 + h * H * 1000;

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const a = await createJob(db, { companyName: 'Northwind Café', jobTitle: 'Barista', currency: 'GBP', hourlyRate: '12.50' }, at(-100));
  const b = await createJob(db, { companyName: 'Harbour Books', jobTitle: 'Assistant', currency: 'GBP', hourlyRate: '14.00' }, at(-100));
  return { db, a, b };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(DomainError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('migrations', () => {
  it('migrates to latest and is idempotent', async () => {
    const db = createTestDb();
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(await migrate(db)).toBe(LATEST_VERSION);
  });
});

describe('timer lifecycle', () => {
  it('start → break → pause/resume → stop computes net time and pay', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    expect(s.status).toBe('running');
    expect((await getShift(db, s.id))?.startAt).toBe(at(0)); // saved immediately

    await startBreak(db, s.id, 'paid', at(2));
    expect((await getShift(db, s.id))?.status).toBe('on_break');
    await endBreak(db, s.id, at(2.25));
    await pauseShift(db, s.id, at(4));
    await resumeShift(db, s.id, at(4.5));
    const done = await stopShift(db, s.id, at(8));

    expect(done).toMatchObject({
      status: 'completed',
      totalDurationSeconds: 8 * H,
      paidBreakSeconds: 0.25 * H,
      unpaidBreakSeconds: 0.5 * H,
      netWorkSeconds: 7.5 * H,
      hourlyRateSnapshot: '12.50',
      estimatedGrossPay: '93.75',
      currency: 'GBP',
    });
  });

  it('restores an active shift after an app restart (state lives in the DB)', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    // "Restart": nothing in memory, read from DB.
    const restored = await listActiveShifts(db);
    expect(restored.map((x) => x.id)).toEqual([s.id]);
    const done = await stopShift(db, restored[0].id, at(3));
    expect(done.netWorkSeconds).toBe(3 * H);
  });

  it('stopping while on break closes the break at stop time', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    await pauseShift(db, s.id, at(3));
    const done = await stopShift(db, s.id, at(4));
    expect(done.unpaidBreakSeconds).toBe(1 * H);
    expect(done.netWorkSeconds).toBe(3 * H);
    expect((await listBreaks(db, s.id)).every((b) => b.status === 'completed')).toBe(true);
  });

  it('overnight timer shift is dated by its start day', async () => {
    const { db, a } = await setup();
    const start = Date.parse('2026-11-10T22:00:00Z');
    const s = await startShift(db, { jobId: a.id }, engine, start);
    const done = await stopShift(db, s.id, start + 8 * H * 1000);
    expect(done.shiftDate).toBe('2026-11-10');
    expect(done.netWorkSeconds).toBe(8 * H);
  });

  it('prevents duplicate active shifts by default', async () => {
    const { db, a, b } = await setup();
    await startShift(db, { jobId: a.id }, engine, at(0));
    await expectCode(startShift(db, { jobId: a.id }, engine, at(1)), 'ACTIVE_SHIFT_EXISTS');
    await expectCode(startShift(db, { jobId: b.id }, engine, at(1)), 'ACTIVE_SHIFT_EXISTS');
  });

  it('allows concurrent shifts at different jobs only when enabled, never twice for one job', async () => {
    const { db, a, b } = await setup();
    const opts = { ...engine, allowConcurrentShifts: true };
    await startShift(db, { jobId: a.id }, opts, at(0));
    await startShift(db, { jobId: b.id }, opts, at(1));
    await expectCode(startShift(db, { jobId: a.id }, opts, at(2)), 'ACTIVE_SHIFT_EXISTS');
    expect(await listActiveShifts(db)).toHaveLength(2);
  });

  it('rejects a second simultaneous break', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    await startBreak(db, s.id, 'paid', at(1));
    await expectCode(startBreak(db, s.id, 'unpaid', at(1.1)), 'ALREADY_ON_BREAK');
  });

  it('cannot start a shift on an archived job', async () => {
    const { db, a } = await setup();
    await setJobActive(db, a.id, false, at(0));
    await expectCode(startShift(db, { jobId: a.id }, engine, at(1)), 'JOB_ARCHIVED');
  });
});

describe('manual entry', () => {
  it('records start/end times with breaks', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(
      db,
      { mode: 'times', jobId: a.id, shiftDate: '2026-11-09', startTime: '09:00', endTime: '17:00', paidBreakMinutes: 15, unpaidBreakMinutes: 30 },
      { timezone: TZ },
      at(0),
    );
    expect(s).toMatchObject({ entryType: 'manual_times', netWorkSeconds: 7.5 * H, estimatedGrossPay: '93.75' });
  });

  it('handles overnight manual shifts', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(
      db,
      { mode: 'times', jobId: a.id, shiftDate: '2026-11-08', startTime: '22:00', endTime: '06:00' },
      { timezone: TZ },
      at(0),
    );
    expect(s.totalDurationSeconds).toBe(8 * H);
    expect(s.shiftDate).toBe('2026-11-08');
  });

  it('duration-only entries keep no invented timestamps', async () => {
    const { db, b } = await setup();
    const s = await createManualShift(db, { mode: 'duration', jobId: b.id, shiftDate: '2026-11-09', durationSeconds: 5.5 * H }, {}, at(0));
    expect(s).toMatchObject({ entryType: 'manual_duration', startAt: null, endAt: null, netWorkSeconds: 5.5 * H, estimatedGrossPay: '77.00' });
  });

  it('rejects breaks longer than the shift and future shifts', async () => {
    const { db, a } = await setup();
    await expectCode(
      createManualShift(db, { mode: 'duration', jobId: a.id, shiftDate: '2026-11-09', durationSeconds: H, unpaidBreakMinutes: 90 }, {}, at(0)),
      'EXCEEDS_SHIFT',
    );
    await expectCode(
      createManualShift(db, { mode: 'times', jobId: a.id, shiftDate: '2026-11-11', startTime: '09:00', endTime: '10:00' }, { timezone: TZ }, at(0)),
      'FUTURE_SHIFT',
    );
  });

  it('blocks same-job overlaps; other-job overlaps need confirmation', async () => {
    const { db, a, b } = await setup();
    const base = { mode: 'times' as const, shiftDate: '2026-11-09', startTime: '09:00', endTime: '13:00' };
    await createManualShift(db, { ...base, jobId: a.id }, { timezone: TZ }, at(0));
    await expectCode(createManualShift(db, { ...base, jobId: a.id, startTime: '12:00', endTime: '15:00' }, { timezone: TZ }, at(0)), 'DUPLICATE_SHIFT');
    await expectCode(createManualShift(db, { ...base, jobId: b.id, startTime: '12:00', endTime: '15:00' }, { timezone: TZ }, at(0)), 'OVERLAPS_OTHER_JOB');
    await createManualShift(db, { ...base, jobId: b.id, startTime: '12:00', endTime: '15:00' }, { timezone: TZ, allowOverlapWithOtherJobs: true }, at(0));
    // Back-to-back (starts exactly when B's shift ends) is not an overlap.
    await createManualShift(db, { ...base, jobId: a.id, startTime: '15:00', endTime: '16:00' }, { timezone: TZ }, at(0));
  });

  it('allows unassigned shifts; they carry no pay until assigned', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(db, { mode: 'duration', jobId: null, shiftDate: '2026-11-09', durationSeconds: 2 * H }, {}, at(0));
    expect(s.estimatedGrossPay).toBeNull();
    const assigned = await editShift(db, s.id, { jobId: a.id }, {}, at(1));
    expect(assigned.estimatedGrossPay).toBe('25.00');
  });
});

describe('editing and history', () => {
  it('editing times recalculates totals and validates breaks', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(
      db,
      { mode: 'times', jobId: a.id, shiftDate: '2026-11-09', startTime: '09:00', endTime: '17:00' },
      { timezone: TZ },
      at(0),
    );
    const brk = await saveBreak(db, s.id, { breakType: 'unpaid', startAt: s.startAt! + 3 * H * 1000, endAt: s.startAt! + 4 * H * 1000 }, at(0));
    expect((await getShift(db, s.id))?.netWorkSeconds).toBe(7 * H);
    // Shrinking the shift so the break falls outside is rejected.
    await expectCode(editShift(db, s.id, { endAt: s.startAt! + 2 * H * 1000 }, {}, at(0)), 'OUTSIDE_SHIFT');
    await deleteBreak(db, s.id, brk.id, at(0));
    expect((await getShift(db, s.id))?.netWorkSeconds).toBe(8 * H);
  });

  it('pay-rate changes preserve historical snapshots unless repricing is requested', async () => {
    const { db, a } = await setup();
    const old = await createManualShift(db, { mode: 'duration', jobId: a.id, shiftDate: '2026-11-02', durationSeconds: 10 * H }, {}, at(0));
    await changePayRate(db, a.id, '13.00', '2026-11-09', {}, at(1));
    const fresh = await createManualShift(db, { mode: 'duration', jobId: a.id, shiftDate: '2026-11-09', durationSeconds: 10 * H }, {}, at(2));
    expect((await getShift(db, old.id))?.estimatedGrossPay).toBe('125.00');
    expect(fresh.estimatedGrossPay).toBe('130.00');
    const rates = await listPayRates(db, a.id);
    expect(rates.map((r) => [r.hourlyRate, r.effectiveFrom, r.effectiveUntil])).toEqual([
      ['13.00', '2026-11-09', null],
      ['12.50', '1900-01-01', '2026-11-08'],
    ]);
    // Back-dated reprice: explicit opt-in.
    await changePayRate(db, a.id, '15.00', '2026-11-10', { repriceExisting: true }, at(3));
    expect((await getShift(db, fresh.id))?.estimatedGrossPay).toBe('130.00'); // before 11-10, untouched
  });

  it('archived jobs keep their shift history', async () => {
    const { db, a } = await setup();
    await createManualShift(db, { mode: 'duration', jobId: a.id, shiftDate: '2026-11-02', durationSeconds: H }, {}, at(0));
    await setJobActive(db, a.id, false, at(1));
    expect((await listJobs(db)).map((j) => j.id)).not.toContain(a.id);
    expect((await listJobs(db, { includeArchived: true })).map((j) => j.id)).toContain(a.id);
    expect(await listShifts(db, { jobId: a.id })).toHaveLength(1);
    await setJobActive(db, a.id, true, at(2));
    expect((await listJobs(db)).map((j) => j.id)).toContain(a.id);
  });

  it('permanently deletes a shift and its breaks, leaving only an id-only tombstone for sync', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(
      db,
      { mode: 'duration', jobId: a.id, shiftDate: '2026-11-02', durationSeconds: 4 * H, unpaidBreakMinutes: 30, notes: 'private note' },
      {},
      at(0),
    );
    await deleteShift(db, s.id, at(1));

    const rows = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM shifts WHERE id = ?', [s.id]);
    const brks = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM breaks WHERE shift_id = ?', [s.id]);
    expect(rows?.n).toBe(0);
    expect(brks?.n).toBe(0);

    const queue = await db.getAllAsync<{ entity: string; operation: string; payload: string }>(
      'SELECT entity, operation, payload FROM sync_queue WHERE entity IN (?, ?)',
      ['shifts', 'breaks'],
    );
    expect(queue).toEqual([{ entity: 'shifts', operation: 'delete', payload: JSON.stringify({ id: s.id }) }]);
    expect(JSON.stringify(queue)).not.toContain('private note');
  });

  it('can discard a running shift', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    await pauseShift(db, s.id, at(1));
    await deleteShift(db, s.id, at(2));
    expect(await listActiveShifts(db)).toHaveLength(0);
    // The job is free to start again.
    await startShift(db, { jobId: a.id }, engine, at(3));
  });

  it('deletes every completed shift on a date, optionally for one job', async () => {
    const { db, a, b } = await setup();
    const mk = (jobId: string, date: string) => createManualShift(db, { mode: 'duration', jobId, shiftDate: date, durationSeconds: H }, {}, at(0));
    await mk(a.id, '2026-11-02');
    await mk(b.id, '2026-11-02');
    await mk(a.id, '2026-11-03');
    expect(await deleteShiftsOnDate(db, '2026-11-02', a.id, at(1))).toBe(1);
    expect((await listShifts(db, { from: '2026-11-02', to: '2026-11-02' })).map((s) => s.jobId)).toEqual([b.id]);
    expect(await deleteShiftsOnDate(db, '2026-11-02', undefined, at(2))).toBe(1);
    expect(await listShifts(db, { from: '2026-11-02', to: '2026-11-02' })).toHaveLength(0);
    expect(await listShifts(db, { from: '2026-11-03', to: '2026-11-03' })).toHaveLength(1); // other days untouched
  });

  it('permanently deletes a single break and recalculates the shift', async () => {
    const { db, a } = await setup();
    const s = await createManualShift(db, { mode: 'duration', jobId: a.id, shiftDate: '2026-11-02', durationSeconds: 4 * H, unpaidBreakMinutes: 30 }, {}, at(0));
    const [brk] = await listBreaks(db, s.id);
    await deleteBreak(db, s.id, brk.id, at(1));
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM breaks WHERE id = ?', [brk.id]))?.n).toBe(0);
    expect((await getShift(db, s.id))?.netWorkSeconds).toBe(4 * H);
  });

  it('validates job input', async () => {
    const { db, a } = await setup();
    await expectCode(createJob(db, { companyName: ' ', currency: 'GBP', hourlyRate: '10' }), 'INVALID_JOB');
    await expectCode(createJob(db, { companyName: 'X', currency: 'pounds', hourlyRate: '10' }), 'INVALID_JOB');
    await expectCode(createJob(db, { companyName: 'X', currency: 'GBP', hourlyRate: 'abc' }), 'INVALID_JOB');
    const updated = await updateJobDetails(db, a.id, { jobTitle: 'Head Barista' }, at(0));
    expect(updated.jobTitle).toBe('Head Barista');
  });
});

describe('outbox', () => {
  it('coalesces multiple writes into one queue entry per row with the latest snapshot', async () => {
    const { db, a } = await setup();
    const s = await startShift(db, { jobId: a.id }, engine, at(0));
    await pauseShift(db, s.id, at(1));
    await resumeShift(db, s.id, at(2));
    await stopShift(db, s.id, at(3));
    const rows = await db.getAllAsync<{ payload: string }>("SELECT payload FROM sync_queue WHERE entity='shifts' AND entity_id=?", [s.id]);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payload).status).toBe('completed');
  });
});
