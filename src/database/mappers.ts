import type {
  Break,
  DayOfWeek,
  EmploymentType,
  Job,
  OvertimeRule,
  PayRate,
  ScheduleDay,
  Shift,
  ShiftEntryType,
  ShiftStatus,
  SyncStatus,
} from '@/types/domain';

/** Row ⇄ domain mapping. Keeps snake_case SQL out of the rest of the app. */

export interface JobRow {
  id: string;
  user_id: string | null;
  company_name: string;
  company_logo: string | null;
  job_title: string;
  workplace_address: string | null;
  employment_type: string;
  currency: string;
  color: string;
  default_start_time: string | null;
  default_end_time: string | null;
  default_paid_break_seconds: number;
  default_unpaid_break_seconds: number;
  is_active: number;
  employment_start_date: string | null;
  employment_end_date: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export const jobFromRow = (r: JobRow): Job => ({
  id: r.id,
  userId: r.user_id,
  companyName: r.company_name,
  companyLogo: r.company_logo,
  jobTitle: r.job_title,
  workplaceAddress: r.workplace_address,
  employmentType: r.employment_type as EmploymentType,
  currency: r.currency,
  color: r.color,
  defaultStartTime: r.default_start_time,
  defaultEndTime: r.default_end_time,
  defaultPaidBreakSeconds: r.default_paid_break_seconds,
  defaultUnpaidBreakSeconds: r.default_unpaid_break_seconds,
  isActive: r.is_active === 1,
  employmentStartDate: r.employment_start_date,
  employmentEndDate: r.employment_end_date,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export interface PayRateRow {
  id: string;
  job_id: string;
  hourly_rate: string;
  currency: string;
  effective_from: string;
  effective_until: string | null;
  created_at: number;
  updated_at: number;
}

export const payRateFromRow = (r: PayRateRow): PayRate => ({
  id: r.id,
  jobId: r.job_id,
  hourlyRate: r.hourly_rate,
  currency: r.currency,
  effectiveFrom: r.effective_from,
  effectiveUntil: r.effective_until,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface OvertimeRuleRow {
  id: string;
  job_id: string;
  daily_threshold_seconds: number | null;
  weekly_threshold_seconds: number | null;
  multiplier: string;
  effective_from: string;
  effective_until: string | null;
  created_at: number;
  updated_at: number;
}

export const overtimeRuleFromRow = (r: OvertimeRuleRow): OvertimeRule => ({
  id: r.id,
  jobId: r.job_id,
  dailyThresholdSeconds: r.daily_threshold_seconds,
  weeklyThresholdSeconds: r.weekly_threshold_seconds,
  multiplier: r.multiplier,
  effectiveFrom: r.effective_from,
  effectiveUntil: r.effective_until,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ShiftRow {
  id: string;
  user_id: string | null;
  job_id: string | null;
  shift_date: string;
  start_at: number | null;
  end_at: number | null;
  timezone: string;
  entry_type: string;
  status: string;
  planned_duration_seconds: number | null;
  total_duration_seconds: number;
  paid_break_seconds: number;
  unpaid_break_seconds: number;
  net_work_seconds: number;
  hourly_rate_snapshot: string | null;
  estimated_gross_pay: string | null;
  currency: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  sync_status: string;
}

export const shiftFromRow = (r: ShiftRow): Shift => ({
  id: r.id,
  userId: r.user_id,
  jobId: r.job_id,
  shiftDate: r.shift_date,
  startAt: r.start_at,
  endAt: r.end_at,
  timezone: r.timezone,
  entryType: r.entry_type as ShiftEntryType,
  status: r.status as ShiftStatus,
  plannedDurationSeconds: r.planned_duration_seconds,
  totalDurationSeconds: r.total_duration_seconds,
  paidBreakSeconds: r.paid_break_seconds,
  unpaidBreakSeconds: r.unpaid_break_seconds,
  netWorkSeconds: r.net_work_seconds,
  hourlyRateSnapshot: r.hourly_rate_snapshot,
  estimatedGrossPay: r.estimated_gross_pay,
  currency: r.currency,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  syncStatus: r.sync_status as SyncStatus,
});

export const shiftToParams = (s: Shift) => [
  s.id,
  s.userId,
  s.jobId,
  s.shiftDate,
  s.startAt,
  s.endAt,
  s.timezone,
  s.entryType,
  s.status,
  s.plannedDurationSeconds,
  s.totalDurationSeconds,
  s.paidBreakSeconds,
  s.unpaidBreakSeconds,
  s.netWorkSeconds,
  s.hourlyRateSnapshot,
  s.estimatedGrossPay,
  s.currency,
  s.notes,
  s.createdAt,
  s.updatedAt,
  s.deletedAt,
  s.syncStatus,
];

export const SHIFT_COLUMNS =
  'id,user_id,job_id,shift_date,start_at,end_at,timezone,entry_type,status,planned_duration_seconds,total_duration_seconds,paid_break_seconds,unpaid_break_seconds,net_work_seconds,hourly_rate_snapshot,estimated_gross_pay,currency,notes,created_at,updated_at,deleted_at,sync_status';

export interface BreakRow {
  id: string;
  shift_id: string;
  break_type: string;
  start_at: number | null;
  end_at: number | null;
  duration_seconds: number;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export const breakFromRow = (r: BreakRow): Break => ({
  id: r.id,
  shiftId: r.shift_id,
  breakType: r.break_type as Break['breakType'],
  startAt: r.start_at,
  endAt: r.end_at,
  durationSeconds: r.duration_seconds,
  status: r.status as Break['status'],
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export interface ScheduleDayRow {
  id: string;
  job_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  planned_break_seconds: number;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export const scheduleDayFromRow = (r: ScheduleDayRow): ScheduleDay => ({
  id: r.id,
  jobId: r.job_id,
  dayOfWeek: r.day_of_week as DayOfWeek,
  startTime: r.start_time,
  endTime: r.end_time,
  plannedBreakSeconds: r.planned_break_seconds,
  isActive: r.is_active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});
