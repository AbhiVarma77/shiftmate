import type { Db } from '@/database/types';
import {
  jobFromRow,
  type JobRow,
  overtimeRuleFromRow,
  type OvertimeRuleRow,
  payRateFromRow,
  type PayRateRow,
} from '@/database/mappers';
import type { Job, OvertimeRule, PayRate } from '@/types/domain';

import { enqueueSync } from './outbox';

export async function listJobs(db: Db, opts: { includeArchived?: boolean } = {}): Promise<Job[]> {
  const rows = await db.getAllAsync<JobRow>(
    `SELECT * FROM jobs WHERE deleted_at IS NULL ${opts.includeArchived ? '' : 'AND is_active = 1'}
     ORDER BY is_active DESC, company_name COLLATE NOCASE`,
  );
  return rows.map(jobFromRow);
}

export async function getJob(db: Db, id: string): Promise<Job | null> {
  const row = await db.getFirstAsync<JobRow>('SELECT * FROM jobs WHERE id = ?', [id]);
  return row ? jobFromRow(row) : null;
}

export async function insertJob(db: Db, j: Job): Promise<void> {
  await db.runAsync(
    `INSERT INTO jobs (id,user_id,company_name,company_logo,job_title,workplace_address,employment_type,currency,color,
      default_start_time,default_end_time,default_paid_break_seconds,default_unpaid_break_seconds,is_active,
      employment_start_date,employment_end_date,notes,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      j.id, j.userId, j.companyName, j.companyLogo, j.jobTitle, j.workplaceAddress, j.employmentType, j.currency, j.color,
      j.defaultStartTime, j.defaultEndTime, j.defaultPaidBreakSeconds, j.defaultUnpaidBreakSeconds, j.isActive ? 1 : 0,
      j.employmentStartDate, j.employmentEndDate, j.notes, j.createdAt, j.updatedAt, j.deletedAt,
    ],
  );
  await enqueueSync(db, 'jobs', j.id, j.updatedAt);
}

export async function updateJobRow(db: Db, j: Job): Promise<void> {
  await db.runAsync(
    `UPDATE jobs SET company_name=?,company_logo=?,job_title=?,workplace_address=?,employment_type=?,currency=?,color=?,
      default_start_time=?,default_end_time=?,default_paid_break_seconds=?,default_unpaid_break_seconds=?,is_active=?,
      employment_start_date=?,employment_end_date=?,notes=?,updated_at=?,deleted_at=?,sync_status='pending'
     WHERE id=?`,
    [
      j.companyName, j.companyLogo, j.jobTitle, j.workplaceAddress, j.employmentType, j.currency, j.color,
      j.defaultStartTime, j.defaultEndTime, j.defaultPaidBreakSeconds, j.defaultUnpaidBreakSeconds, j.isActive ? 1 : 0,
      j.employmentStartDate, j.employmentEndDate, j.notes, j.updatedAt, j.deletedAt, j.id,
    ],
  );
  await enqueueSync(db, 'jobs', j.id, j.updatedAt);
}

export async function listPayRates(db: Db, jobId: string): Promise<PayRate[]> {
  const rows = await db.getAllAsync<PayRateRow>(
    'SELECT * FROM job_pay_rates WHERE job_id = ? AND deleted_at IS NULL ORDER BY effective_from DESC',
    [jobId],
  );
  return rows.map(payRateFromRow);
}

export async function insertPayRate(db: Db, r: PayRate): Promise<void> {
  await db.runAsync(
    `INSERT INTO job_pay_rates (id,job_id,hourly_rate,currency,effective_from,effective_until,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [r.id, r.jobId, r.hourlyRate, r.currency, r.effectiveFrom, r.effectiveUntil, r.createdAt, r.updatedAt],
  );
  await enqueueSync(db, 'job_pay_rates', r.id, r.updatedAt);
}

export async function setPayRateUntil(db: Db, id: string, until: string | null, now: number): Promise<void> {
  await db.runAsync('UPDATE job_pay_rates SET effective_until = ?, updated_at = ? WHERE id = ?', [until, now, id]);
  await enqueueSync(db, 'job_pay_rates', id, now);
}

export async function listOvertimeRules(db: Db, jobId?: string): Promise<OvertimeRule[]> {
  const rows = await db.getAllAsync<OvertimeRuleRow>(
    `SELECT * FROM job_overtime_rules WHERE deleted_at IS NULL ${jobId ? 'AND job_id = ?' : ''} ORDER BY effective_from DESC`,
    jobId ? [jobId] : [],
  );
  return rows.map(overtimeRuleFromRow);
}

export async function insertOvertimeRule(db: Db, r: OvertimeRule): Promise<void> {
  await db.runAsync(
    `INSERT INTO job_overtime_rules (id,job_id,daily_threshold_seconds,weekly_threshold_seconds,multiplier,effective_from,effective_until,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [r.id, r.jobId, r.dailyThresholdSeconds, r.weeklyThresholdSeconds, r.multiplier, r.effectiveFrom, r.effectiveUntil, r.createdAt, r.updatedAt],
  );
  await enqueueSync(db, 'job_overtime_rules', r.id, r.updatedAt);
}

export async function setOvertimeRuleUntil(db: Db, id: string, until: string | null, now: number): Promise<void> {
  await db.runAsync('UPDATE job_overtime_rules SET effective_until = ?, updated_at = ? WHERE id = ?', [until, now, id]);
  await enqueueSync(db, 'job_overtime_rules', id, now);
}
