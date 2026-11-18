import type { Db } from '@/database/types';
import { getJob, listPayRates } from '@/repositories/jobsRepository';
import {
    getShift,
    insertShift,
    listActiveShifts,
    listBreaks,
    listShifts,
    purgeBreak,
    purgeShift,
    updateShiftRow,
    upsertBreak,
} from '@/repositories/shiftsRepository';
import type { Break, BreakType, EpochMs, LocalDate, Shift, UUID } from '@/types/domain';
import { newId } from '@/utils/id';
import { addDays, deviceTimezone, localToEpoch, toLocalDate } from '@/utils/time';
import { firstIssue, type ManualShiftInput, manualShiftSchema } from '@/validation/schemas';

import { BREAK_ERROR_MESSAGES, type CandidateBreak, validateBreak } from './calculations/breaks';
import { basePay, computeShiftTotals, rateForDate } from './calculations/shifts';
import { DomainError } from './errors';

/**
 * Shift engine. Every state transition is persisted immediately in a single
 * transaction (row + outbox). The running timer is derived from persisted
 * timestamps, so app kills / restarts never lose or distort time.
 */

export interface EngineOptions {
  allowConcurrentShifts: boolean;
  timezone?: string;
}

export interface OverlapOptions {
  /** User confirmed they really worked two jobs at once. */
  allowOverlapWithOtherJobs?: boolean;
}

async function requireShift(db: Db, id: UUID): Promise<Shift> {
  const s = await getShift(db, id);
  if (!s || s.deletedAt) throw new DomainError('SHIFT_NOT_FOUND', 'This shift no longer exists.');
  return s;
}

async function requireActive(db: Db, id: UUID): Promise<Shift> {
  const s = await requireShift(db, id);
  if (s.status === 'completed') throw new DomainError('SHIFT_NOT_ACTIVE', 'This shift has already ended.');
  return s;
}

/** Recompute derived totals and (for completed shifts) the pay snapshot. */
async function recalc(db: Db, shift: Shift, now: EpochMs, opts: { resnapshot?: boolean } = {}): Promise<Shift> {
  const breaks = await listBreaks(db, shift.id);
  const totals = computeShiftTotals(shift, breaks, now);
  let { hourlyRateSnapshot, currency, estimatedGrossPay } = shift;

  if (shift.status === 'completed') {
    if (shift.jobId == null) {
      hourlyRateSnapshot = null;
      currency = null;
      estimatedGrossPay = null;
    } else {
      if (opts.resnapshot || hourlyRateSnapshot == null) {
        const job = await getJob(db, shift.jobId);
        const rate = rateForDate(await listPayRates(db, shift.jobId), shift.shiftDate);
        hourlyRateSnapshot = rate?.hourlyRate ?? null;
        currency = rate?.currency ?? job?.currency ?? null;
      }
      estimatedGrossPay = hourlyRateSnapshot && currency ? basePay(totals.netWorkSeconds, hourlyRateSnapshot, currency) : null;
    }
  }
  return { ...shift, ...totals, hourlyRateSnapshot, currency, estimatedGrossPay, updatedAt: now, syncStatus: 'pending' };
}

async function assertNoOverlap(
  db: Db,
  candidate: { id?: UUID; jobId: UUID | null; startAt: EpochMs | null; endAt: EpochMs | null },
  now: EpochMs,
  opts: OverlapOptions,
): Promise<void> {
  if (candidate.startAt == null) return;
  const end = candidate.endAt ?? now;
  const rows = await db.getAllAsync<{ id: string; job_id: string | null }>(
    `SELECT id, job_id FROM shifts
     WHERE deleted_at IS NULL AND start_at IS NOT NULL AND id != ?
       AND start_at < ? AND COALESCE(end_at, ?) > ?`,
    [candidate.id ?? '', end, now, candidate.startAt],
  );
  if (rows.some((r) => r.job_id === candidate.jobId)) {
    throw new DomainError('DUPLICATE_SHIFT', 'This overlaps another shift for the same job.');
  }
  if (rows.length && !opts.allowOverlapWithOtherJobs) {
    throw new DomainError('OVERLAPS_OTHER_JOB', 'This overlaps a shift at another job. Confirm to save anyway.');
  }
}

// ── Timer ────────────────────────────────────────────────────────────────

export async function startShift(
  db: Db,
  input: { jobId: UUID; plannedDurationSeconds?: number | null; notes?: string | null },
  engine: EngineOptions,
  now = Date.now(),
): Promise<Shift> {
  const job = await getJob(db, input.jobId);
  if (!job || job.deletedAt) throw new DomainError('JOB_NOT_FOUND', 'Choose a job to start a shift.');
  if (!job.isActive) throw new DomainError('JOB_ARCHIVED', 'Reactivate this job before starting a shift.');

  const active = await listActiveShifts(db);
  if (active.some((s) => s.jobId === job.id)) {
    throw new DomainError('ACTIVE_SHIFT_EXISTS', `A shift is already running for ${job.companyName}.`);
  }
  if (active.length && !engine.allowConcurrentShifts) {
    throw new DomainError('ACTIVE_SHIFT_EXISTS', 'Stop your current shift before starting another.');
  }

  const tz = engine.timezone ?? deviceTimezone();
  const shift: Shift = {
    id: newId(),
    userId: null,
    jobId: job.id,
    shiftDate: toLocalDate(now, tz),
    startAt: now,
    endAt: null,
    timezone: tz,
    entryType: 'timer',
    status: 'running',
    plannedDurationSeconds: input.plannedDurationSeconds ?? null,
    totalDurationSeconds: 0,
    paidBreakSeconds: 0,
    unpaidBreakSeconds: 0,
    netWorkSeconds: 0,
    hourlyRateSnapshot: null,
    estimatedGrossPay: null,
    currency: job.currency,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: 'pending',
  };
  await db.withTransactionAsync(() => insertShift(db, shift));
  return shift;
}

export async function startBreak(db: Db, shiftId: UUID, breakType: BreakType, now = Date.now()): Promise<Break> {
  const shift = await requireActive(db, shiftId);
  const siblings = await listBreaks(db, shiftId);
  const err = validateBreak({ breakType, startAt: now, endAt: null }, { startAt: shift.startAt, endAt: null }, siblings, now);
  if (err) throw new DomainError(err, BREAK_ERROR_MESSAGES[err]);
  const b: Break = {
    id: newId(),
    shiftId,
    breakType,
    startAt: now,
    endAt: null,
    durationSeconds: 0,
    status: 'active',
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.withTransactionAsync(async () => {
    await upsertBreak(db, b);
    await updateShiftRow(db, await recalc(db, { ...shift, status: 'on_break' }, now));
  });
  return b;
}

export async function endBreak(db: Db, shiftId: UUID, now = Date.now()): Promise<Shift> {
  const shift = await requireActive(db, shiftId);
  const open = (await listBreaks(db, shiftId)).find((b) => b.status === 'active');
  if (!open) throw new DomainError('NO_ACTIVE_BREAK', 'You are not on a break.');
  let next: Shift = shift;
  await db.withTransactionAsync(async () => {
    await closeBreak(db, open, now);
    next = await recalc(db, { ...shift, status: 'running' }, now);
    await updateShiftRow(db, next);
  });
  return next;
}

/** Pause = an unpaid break; Resume ends it. Kept as named actions for the UI. */
export const pauseShift = (db: Db, shiftId: UUID, now = Date.now()) => startBreak(db, shiftId, 'unpaid', now);
export const resumeShift = (db: Db, shiftId: UUID, now = Date.now()) => endBreak(db, shiftId, now);

async function closeBreak(db: Db, b: Break, now: EpochMs): Promise<void> {
  const end = Math.max(now, b.startAt ?? now);
  await upsertBreak(db, {
    ...b,
    endAt: end,
    durationSeconds: Math.floor((end - (b.startAt ?? end)) / 1000),
    status: 'completed',
    updatedAt: now,
  });
}

export async function stopShift(db: Db, shiftId: UUID, now = Date.now()): Promise<Shift> {
  const shift = await requireActive(db, shiftId);
  let done: Shift = shift;
  await db.withTransactionAsync(async () => {
    const open = (await listBreaks(db, shiftId)).find((b) => b.status === 'active');
    if (open) await closeBreak(db, open, now);
    done = await recalc(db, { ...shift, endAt: Math.max(now, shift.startAt ?? now), status: 'completed' }, now, {
      resnapshot: true,
    });
    await updateShiftRow(db, done);
  });
  return done;
}

// ── Manual entry ────────────────────────────────────────────────────────

export async function createManualShift(
  db: Db,
  input: ManualShiftInput,
  opts: OverlapOptions & { timezone?: string } = {},
  now = Date.now(),
): Promise<Shift> {
  const parsed = manualShiftSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_SHIFT', firstIssue(parsed.error));
  const v = parsed.data;
  const tz = opts.timezone ?? deviceTimezone();

  if (v.jobId) {
    const job = await getJob(db, v.jobId);
    if (!job || job.deletedAt) throw new DomainError('JOB_NOT_FOUND', 'Choose a valid job.');
  }

  let startAt: EpochMs | null = null;
  let endAt: EpochMs | null = null;
  let total = 0;
  if (v.mode === 'times') {
    startAt = localToEpoch(v.shiftDate, v.startTime, tz);
    endAt = localToEpoch(v.shiftDate, v.endTime, tz);
    // End at or before start ⇒ overnight shift ending the next day.
    if (endAt <= startAt) {
      endAt = localToEpoch(addDays(v.shiftDate, 1), v.endTime, tz);
    }
    total = Math.floor((endAt - startAt) / 1000);
    if (total > 24 * 3600) throw new DomainError('INVALID_SHIFT', 'A shift cannot exceed 24 hours.');
    if (startAt > now) throw new DomainError('FUTURE_SHIFT', 'You cannot log a shift that has not started yet.');
    if (endAt > now) throw new DomainError('FUTURE_SHIFT', 'That end time is still in the future. Log it once it has finished, or use Start shift on Home to time it live.');
  } else {
    total = v.durationSeconds;
  }

  const breakSeconds = (v.paidBreakMinutes + v.unpaidBreakMinutes) * 60;
  if (breakSeconds > total) throw new DomainError('EXCEEDS_SHIFT', BREAK_ERROR_MESSAGES.EXCEEDS_SHIFT);

  const base: Shift = {
    id: newId(),
    userId: null,
    jobId: v.jobId,
    shiftDate: v.shiftDate,
    startAt,
    endAt,
    timezone: tz,
    entryType: v.mode === 'times' ? 'manual_times' : 'manual_duration',
    status: 'completed',
    plannedDurationSeconds: null,
    totalDurationSeconds: total,
    paidBreakSeconds: 0,
    unpaidBreakSeconds: 0,
    netWorkSeconds: 0,
    hourlyRateSnapshot: null,
    estimatedGrossPay: null,
    currency: null,
    notes: v.notes || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: 'pending',
  };
  await assertNoOverlap(db, base, now, opts);

  let saved = base;
  await db.withTransactionAsync(async () => {
    await insertShift(db, base);
    for (const [type, minutes] of [
      ['paid', v.paidBreakMinutes],
      ['unpaid', v.unpaidBreakMinutes],
    ] as const) {
      if (minutes > 0) await upsertBreak(db, durationBreak(base.id, type, minutes * 60, now));
    }
    saved = await recalc(db, base, now, { resnapshot: true });
    await updateShiftRow(db, saved);
  });
  return saved;
}

function durationBreak(shiftId: UUID, breakType: BreakType, seconds: number, now: EpochMs): Break {
  return {
    id: newId(),
    shiftId,
    breakType,
    startAt: null,
    endAt: null,
    durationSeconds: seconds,
    status: 'completed',
    notes: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ── Editing ─────────────────────────────────────────────────────────────

export interface ShiftPatch {
  jobId?: UUID | null;
  startAt?: EpochMs;
  endAt?: EpochMs;
  /** Only for manual_duration entries. */
  totalDurationSeconds?: number;
  notes?: string | null;
}

/**
 * Edit a completed shift. The pay snapshot is re-taken only when the job or
 * the date changes — otherwise the historical rate is preserved.
 */
export async function editShift(db: Db, shiftId: UUID, patch: ShiftPatch, opts: OverlapOptions = {}, now = Date.now()): Promise<Shift> {
  const shift = await requireShift(db, shiftId);
  if (shift.status !== 'completed') throw new DomainError('SHIFT_ACTIVE', 'Stop the shift before editing it.');

  const next: Shift = { ...shift };
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.jobId !== undefined) {
    if (patch.jobId) {
      const job = await getJob(db, patch.jobId);
      if (!job || job.deletedAt) throw new DomainError('JOB_NOT_FOUND', 'Choose a valid job.');
    }
    next.jobId = patch.jobId;
  }
  if (shift.entryType === 'manual_duration') {
    if (patch.startAt !== undefined || patch.endAt !== undefined) {
      throw new DomainError('INVALID_SHIFT', 'Duration-only entries have no start or end time.');
    }
    if (patch.totalDurationSeconds !== undefined) {
      if (patch.totalDurationSeconds <= 0 || patch.totalDurationSeconds > 24 * 3600) {
        throw new DomainError('INVALID_SHIFT', 'Duration must be between 1 minute and 24 hours.');
      }
      next.totalDurationSeconds = patch.totalDurationSeconds;
    }
  } else {
    if (patch.startAt !== undefined) next.startAt = patch.startAt;
    if (patch.endAt !== undefined) next.endAt = patch.endAt;
    if (next.startAt == null || next.endAt == null || next.endAt <= next.startAt) {
      throw new DomainError('INVALID_SHIFT', 'A shift must end after it starts.');
    }
    if (next.endAt - next.startAt > 24 * 3600_000) throw new DomainError('INVALID_SHIFT', 'A shift cannot exceed 24 hours.');
    next.shiftDate = toLocalDate(next.startAt, next.timezone);
    // Timed breaks must still fit inside the new bounds.
    const breaks = await listBreaks(db, shiftId);
    for (const b of breaks.filter((x) => x.startAt != null)) {
      const err = validateBreak(b, { startAt: next.startAt, endAt: next.endAt }, breaks, now);
      if (err) throw new DomainError(err, `An existing break no longer fits: ${BREAK_ERROR_MESSAGES[err]}`);
    }
  }
  await assertNoOverlap(db, next, now, opts);

  const resnapshot = next.jobId !== shift.jobId || next.shiftDate !== shift.shiftDate;
  let saved = next;
  await db.withTransactionAsync(async () => {
    saved = await recalc(db, next, now, { resnapshot });
    await updateShiftRow(db, saved);
  });
  return saved;
}

/**
 * Permanently delete a shift and its breaks from the device. Works for
 * completed shifts and for discarding a running one. Cannot be undone.
 */
export async function deleteShift(db: Db, shiftId: UUID, now = Date.now()): Promise<void> {
  await requireShift(db, shiftId);
  await db.withTransactionAsync(() => purgeShift(db, shiftId, now));
}

/** Permanently delete every completed shift on a date (optionally for one job). Returns how many. */
export async function deleteShiftsOnDate(db: Db, date: LocalDate, jobId?: UUID | null, now = Date.now()): Promise<number> {
  const shifts = (await listShifts(db, { from: date, to: date, jobId })).filter((s) => s.status === 'completed');
  if (!shifts.length) return 0;
  await db.withTransactionAsync(async () => {
    for (const s of shifts) await purgeShift(db, s.id, now);
  });
  return shifts.length;
}

// ── Break editing ───────────────────────────────────────────────────────

export async function saveBreak(db: Db, shiftId: UUID, candidate: CandidateBreak, now = Date.now()): Promise<Break> {
  const shift = await requireShift(db, shiftId);
  const siblings = await listBreaks(db, shiftId);
  const existing = candidate.id ? siblings.find((b) => b.id === candidate.id) : undefined;
  if (candidate.id && !existing) throw new DomainError('BREAK_NOT_FOUND', 'This break no longer exists.');
  if (shift.entryType === 'manual_duration' && candidate.startAt != null) {
    throw new DomainError('INVALID_BREAK', 'Duration-only shifts take duration-only breaks.');
  }
  const err = validateBreak(
    candidate,
    { startAt: shift.startAt, endAt: shift.endAt, totalDurationSeconds: shift.startAt == null ? shift.totalDurationSeconds : undefined },
    siblings,
    now,
  );
  if (err) throw new DomainError(err, BREAK_ERROR_MESSAGES[err]);

  const isOpen = candidate.startAt != null && candidate.endAt == null;
  if (isOpen && shift.status === 'completed') throw new DomainError('INVALID_BREAK', 'Breaks on finished shifts need an end time.');
  const b: Break = {
    id: existing?.id ?? newId(),
    shiftId,
    breakType: candidate.breakType,
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    durationSeconds:
      candidate.startAt != null && candidate.endAt != null
        ? Math.floor((candidate.endAt - candidate.startAt) / 1000)
        : (candidate.durationSeconds ?? 0),
    status: isOpen ? 'active' : 'completed',
    notes: existing?.notes ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.withTransactionAsync(async () => {
    await upsertBreak(db, b);
    await updateShiftRow(db, await recalc(db, shift, now));
  });
  return b;
}

export async function deleteBreak(db: Db, shiftId: UUID, breakId: UUID, now = Date.now()): Promise<void> {
  const shift = await requireShift(db, shiftId);
  const b = (await listBreaks(db, shiftId)).find((x) => x.id === breakId);
  if (!b) throw new DomainError('BREAK_NOT_FOUND', 'This break no longer exists.');
  await db.withTransactionAsync(async () => {
    await purgeBreak(db, b.id, now);
    const status = shift.status === 'on_break' && b.status === 'active' ? 'running' : shift.status;
    await updateShiftRow(db, await recalc(db, { ...shift, status }, now));
  });
}
