import type { Db } from './types';

/**
 * Forward-only migrations tracked with PRAGMA user_version.
 * Never edit a shipped migration — append a new one. Each runs in a
 * transaction so a failure leaves the database at the previous version.
 *
 * Conventions: UUID TEXT primary keys; instants are INTEGER epoch ms;
 * calendar dates are TEXT YYYY-MM-DD; money/rates are TEXT decimals;
 * soft deletes via deleted_at so deletions can sync.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  remote_user_id TEXT,
  email TEXT,
  display_name TEXT,
  is_guest INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id),
  company_name TEXT NOT NULL,
  company_logo TEXT,
  job_title TEXT NOT NULL DEFAULT '',
  workplace_address TEXT,
  employment_type TEXT NOT NULL DEFAULT 'part_time'
    CHECK (employment_type IN ('full_time','part_time','casual','temporary','freelance','other')),
  currency TEXT NOT NULL DEFAULT 'GBP',
  color TEXT NOT NULL DEFAULT '#10B981',
  default_start_time TEXT,
  default_end_time TEXT,
  default_paid_break_seconds INTEGER NOT NULL DEFAULT 0,
  default_unpaid_break_seconds INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  employment_start_date TEXT,
  employment_end_date TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_jobs_active ON jobs(is_active, deleted_at);

CREATE TABLE job_pay_rates (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  hourly_rate TEXT NOT NULL,
  currency TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_pay_rates_job ON job_pay_rates(job_id, effective_from);

CREATE TABLE job_overtime_rules (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  daily_threshold_seconds INTEGER,
  weekly_threshold_seconds INTEGER,
  multiplier TEXT NOT NULL DEFAULT '1.5',
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_ot_rules_job ON job_overtime_rules(job_id, effective_from);

CREATE TABLE job_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Weekly schedule',
  is_active INTEGER NOT NULL DEFAULT 1,
  reminders_enabled INTEGER NOT NULL DEFAULT 0,
  reminder_lead_minutes INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_schedules_job ON job_schedules(job_id);

CREATE TABLE job_schedule_days (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_id TEXT NOT NULL REFERENCES job_schedules(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  planned_break_seconds INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_schedule_days_job ON job_schedule_days(job_id, day_of_week);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id),
  job_id TEXT REFERENCES jobs(id),
  shift_date TEXT NOT NULL,
  start_at INTEGER,
  end_at INTEGER,
  timezone TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('timer','manual_times','manual_duration')),
  status TEXT NOT NULL CHECK (status IN ('running','on_break','completed')),
  planned_duration_seconds INTEGER,
  total_duration_seconds INTEGER NOT NULL DEFAULT 0,
  paid_break_seconds INTEGER NOT NULL DEFAULT 0,
  unpaid_break_seconds INTEGER NOT NULL DEFAULT 0,
  net_work_seconds INTEGER NOT NULL DEFAULT 0,
  hourly_rate_snapshot TEXT,
  estimated_gross_pay TEXT,
  currency TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at),
  CHECK (entry_type = 'manual_duration' OR start_at IS NOT NULL)
);
CREATE INDEX idx_shifts_date ON shifts(shift_date, deleted_at);
CREATE INDEX idx_shifts_job_date ON shifts(job_id, shift_date);
CREATE INDEX idx_shifts_status ON shifts(status);
-- At most one active shift per job (DB-level duplicate guard).
CREATE UNIQUE INDEX uq_shifts_one_active_per_job
  ON shifts(job_id) WHERE status != 'completed' AND deleted_at IS NULL;

CREATE TABLE breaks (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  break_type TEXT NOT NULL CHECK (break_type IN ('paid','unpaid')),
  start_at INTEGER,
  end_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','completed')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at >= start_at)
);
CREATE INDEX idx_breaks_shift ON breaks(shift_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE weekly_targets (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  target_seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX uq_weekly_targets_job ON weekly_targets(IFNULL(job_id, '__all__')) WHERE deleted_at IS NULL;

-- Outbox: every local write enqueues an idempotent upsert of the full row.
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload TEXT NOT NULL,
  entity_updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- Coalesce: one pending entry per entity row (latest wins).
CREATE UNIQUE INDEX uq_sync_queue_entity ON sync_queue(entity, entity_id);
CREATE INDEX idx_sync_queue_due ON sync_queue(next_attempt_at);
`,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function migrate(db: Db): Promise<number> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
  }
  return current;
}
