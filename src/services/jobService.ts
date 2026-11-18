import type { Db } from '@/database/types';
import {
    getJob,
    insertJob,
    insertOvertimeRule,
    insertPayRate,
    listOvertimeRules,
    listPayRates,
    setOvertimeRuleUntil,
    setPayRateUntil,
    updateJobRow,
} from '@/repositories/jobsRepository';
import { listShifts, updateShiftRow } from '@/repositories/shiftsRepository';
import type { Job, LocalDate } from '@/types/domain';
import { newId } from '@/utils/id';
import { isValidDecimal } from '@/utils/money';
import { addDays, isValidLocalDate } from '@/utils/time';
import { firstIssue, type JobInput, jobInputSchema, overtimeInputSchema } from '@/validation/schemas';

import { basePay } from './calculations/shifts';
import { DomainError } from './errors';

/** Rates with no explicit start apply to all history. */
const BEGINNING_OF_TIME: LocalDate = '1900-01-01';

export async function createJob(db: Db, input: JobInput, now = Date.now()): Promise<Job> {
  const parsed = jobInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_JOB', firstIssue(parsed.error));
  const v = parsed.data;
  const job: Job = {
    id: newId(),
    userId: null,
    companyName: v.companyName,
    companyLogo: v.companyLogo,
    jobTitle: v.jobTitle,
    workplaceAddress: v.workplaceAddress || null,
    employmentType: v.employmentType,
    currency: v.currency,
    color: v.color,
    defaultStartTime: v.defaultStartTime,
    defaultEndTime: v.defaultEndTime,
    defaultPaidBreakSeconds: v.defaultPaidBreakMinutes * 60,
    defaultUnpaidBreakSeconds: v.defaultUnpaidBreakMinutes * 60,
    isActive: true,
    employmentStartDate: v.employmentStartDate,
    employmentEndDate: v.employmentEndDate,
    notes: v.notes || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.withTransactionAsync(async () => {
    await insertJob(db, job);
    await insertPayRate(db, {
      id: newId(),
      jobId: job.id,
      hourlyRate: v.hourlyRate,
      currency: v.currency,
      effectiveFrom: BEGINNING_OF_TIME,
      effectiveUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    if (v.overtime) {
      await insertOvertimeRule(db, {
        id: newId(),
        jobId: job.id,
        dailyThresholdSeconds: v.overtime.dailyThresholdHours == null ? null : Math.round(v.overtime.dailyThresholdHours * 3600),
        weeklyThresholdSeconds: v.overtime.weeklyThresholdHours == null ? null : Math.round(v.overtime.weeklyThresholdHours * 3600),
        multiplier: v.overtime.multiplier,
        effectiveFrom: BEGINNING_OF_TIME,
        effectiveUntil: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return job;
}

export type JobDetailsPatch = Partial<
  Pick<
    Job,
    | 'companyName'
    | 'companyLogo'
    | 'jobTitle'
    | 'workplaceAddress'
    | 'employmentType'
    | 'color'
    | 'defaultStartTime'
    | 'defaultEndTime'
    | 'defaultPaidBreakSeconds'
    | 'defaultUnpaidBreakSeconds'
    | 'employmentStartDate'
    | 'employmentEndDate'
    | 'notes'
  >
>;

/** Edit descriptive details. Pay changes go through `changePayRate` to keep history. */
export async function updateJobDetails(db: Db, id: string, patch: JobDetailsPatch, now = Date.now()): Promise<Job> {
  const job = await requireJob(db, id);
  const next: Job = { ...job, ...patch, updatedAt: now };
  if (!next.companyName.trim()) throw new DomainError('INVALID_JOB', 'Company name is required.');
  if (next.employmentStartDate && next.employmentEndDate && next.employmentEndDate < next.employmentStartDate) {
    throw new DomainError('INVALID_JOB', 'End date must be after start date.');
  }
  await db.withTransactionAsync(() => updateJobRow(db, next));
  return next;
}

/** Archive keeps all history; the job just stops appearing in pickers. */
export async function setJobActive(db: Db, id: string, isActive: boolean, now = Date.now()): Promise<Job> {
  const job = await requireJob(db, id);
  const next = { ...job, isActive, updatedAt: now };
  await db.withTransactionAsync(() => updateJobRow(db, next));
  return next;
}

/**
 * Record a new hourly rate from `effectiveFrom`. Previous rate is closed the
 * day before, so history is preserved. Existing shift snapshots are untouched
 * unless `repriceExisting` is set — then completed shifts on/after the date
 * are re-snapshotted at the new rate (explicit user choice for back-dating).
 */
export async function changePayRate(
  db: Db,
  jobId: string,
  hourlyRate: string,
  effectiveFrom: LocalDate,
  opts: { repriceExisting?: boolean } = {},
  now = Date.now(),
): Promise<void> {
  const job = await requireJob(db, jobId);
  if (!isValidDecimal(hourlyRate) || Number(hourlyRate) < 0) throw new DomainError('INVALID_RATE', 'Enter a valid hourly rate.');
  if (!isValidLocalDate(effectiveFrom)) throw new DomainError('INVALID_DATE', 'Enter a valid effective date.');
  const rates = await listPayRates(db, jobId);
  const latest = rates[0];
  if (latest && effectiveFrom <= latest.effectiveFrom) {
    throw new DomainError('RATE_DATE_CONFLICT', `New rate must start after ${latest.effectiveFrom}.`);
  }
  await db.withTransactionAsync(async () => {
    if (latest && (latest.effectiveUntil == null || latest.effectiveUntil >= effectiveFrom)) {
      await setPayRateUntil(db, latest.id, addDays(effectiveFrom, -1), now);
    }
    await insertPayRate(db, {
      id: newId(),
      jobId,
      hourlyRate,
      currency: job.currency,
      effectiveFrom,
      effectiveUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    if (opts.repriceExisting) {
      const affected = await listShifts(db, { jobId, from: effectiveFrom });
      for (const s of affected) {
        await updateShiftRow(db, {
          ...s,
          hourlyRateSnapshot: hourlyRate,
          currency: job.currency,
          estimatedGrossPay: basePay(s.netWorkSeconds, hourlyRate, job.currency),
          updatedAt: now,
          syncStatus: 'pending',
        });
      }
    }
  });
}

export async function setOvertimeRule(
  db: Db,
  jobId: string,
  input: { dailyThresholdHours: number | null; weeklyThresholdHours: number | null; multiplier: string } | null,
  effectiveFrom: LocalDate,
  now = Date.now(),
): Promise<void> {
  await requireJob(db, jobId);
  const parsed = input ? overtimeInputSchema.safeParse(input) : null;
  if (parsed && !parsed.success) throw new DomainError('INVALID_OVERTIME', firstIssue(parsed.error));
  const rules = await listOvertimeRules(db, jobId);
  const latest = rules[0];
  if (latest && effectiveFrom <= latest.effectiveFrom) {
    throw new DomainError('RULE_DATE_CONFLICT', `New rule must start after ${latest.effectiveFrom}.`);
  }
  await db.withTransactionAsync(async () => {
    if (latest && latest.effectiveUntil == null) await setOvertimeRuleUntil(db, latest.id, addDays(effectiveFrom, -1), now);
    if (parsed?.success) {
      const v = parsed.data;
      await insertOvertimeRule(db, {
        id: newId(),
        jobId,
        dailyThresholdSeconds: v.dailyThresholdHours == null ? null : Math.round(v.dailyThresholdHours * 3600),
        weeklyThresholdSeconds: v.weeklyThresholdHours == null ? null : Math.round(v.weeklyThresholdHours * 3600),
        multiplier: v.multiplier,
        effectiveFrom,
        effectiveUntil: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

async function requireJob(db: Db, id: string): Promise<Job> {
  const job = await getJob(db, id);
  if (!job || job.deletedAt) throw new DomainError('JOB_NOT_FOUND', 'This job no longer exists.');
  return job;
}
