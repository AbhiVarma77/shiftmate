/**
 * Core domain types for ShiftMate.
 *
 * Conventions (see docs/DECISIONS.md):
 * - All instants are UTC epoch milliseconds (`EpochMs`).
 * - Calendar dates are local `YYYY-MM-DD` strings (`LocalDate`).
 * - Wall-clock times are `HH:mm` strings (`LocalTime`).
 * - Money and rates are decimal strings (`DecimalString`), never JS floats.
 */

export type UUID = string;
export type EpochMs = number;
export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:mm
export type DecimalString = string; // e.g. "12.50"
export type CurrencyCode = string; // ISO 4217, e.g. "GBP"

/** 0 = Sunday … 6 = Saturday (matches JS Date#getDay). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'casual'
  | 'temporary'
  | 'freelance'
  | 'other';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  casual: 'Casual',
  temporary: 'Temporary',
  freelance: 'Freelance',
  other: 'Other',
};

export type SyncStatus = 'pending' | 'synced' | 'error';

export interface Job {
  id: UUID;
  userId: UUID | null;
  companyName: string;
  companyLogo: string | null;
  jobTitle: string;
  workplaceAddress: string | null;
  employmentType: EmploymentType;
  currency: CurrencyCode;
  /** Brand colour used to distinguish this employer in charts and lists. */
  color: string;
  defaultStartTime: LocalTime | null;
  defaultEndTime: LocalTime | null;
  defaultPaidBreakSeconds: number;
  defaultUnpaidBreakSeconds: number;
  isActive: boolean;
  employmentStartDate: LocalDate | null;
  employmentEndDate: LocalDate | null;
  notes: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface PayRate {
  id: UUID;
  jobId: UUID;
  hourlyRate: DecimalString;
  currency: CurrencyCode;
  effectiveFrom: LocalDate;
  /** Inclusive last day, or null for open-ended. */
  effectiveUntil: LocalDate | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface OvertimeRule {
  id: UUID;
  jobId: UUID;
  /** Net hours per day after which overtime applies. Null = no daily threshold. */
  dailyThresholdSeconds: number | null;
  /** Net hours per week after which overtime applies. Null = no weekly threshold. */
  weeklyThresholdSeconds: number | null;
  multiplier: DecimalString; // e.g. "1.5"
  effectiveFrom: LocalDate;
  effectiveUntil: LocalDate | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export type ShiftEntryType = 'timer' | 'manual_times' | 'manual_duration';
export type ShiftStatus = 'running' | 'on_break' | 'completed';

export interface Shift {
  id: UUID;
  userId: UUID | null;
  /** Null for legacy/unassigned shifts awaiting an employer. */
  jobId: UUID | null;
  shiftDate: LocalDate;
  /** Null only for `manual_duration` entries. */
  startAt: EpochMs | null;
  /** Null while running, or for `manual_duration` entries. */
  endAt: EpochMs | null;
  /** IANA zone the shift was recorded in, for correct local-date grouping. */
  timezone: string;
  entryType: ShiftEntryType;
  status: ShiftStatus;
  plannedDurationSeconds: number | null;
  totalDurationSeconds: number;
  paidBreakSeconds: number;
  unpaidBreakSeconds: number;
  netWorkSeconds: number;
  hourlyRateSnapshot: DecimalString | null;
  /** Base (non-overtime) gross estimate, rounded to currency minor units. */
  estimatedGrossPay: DecimalString | null;
  currency: CurrencyCode | null;
  notes: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
  syncStatus: SyncStatus;
}

export type BreakType = 'paid' | 'unpaid';
export type BreakStatus = 'active' | 'completed';

export interface Break {
  id: UUID;
  shiftId: UUID;
  breakType: BreakType;
  startAt: EpochMs | null;
  endAt: EpochMs | null;
  /** Authoritative for manual duration-only breaks; derived otherwise. */
  durationSeconds: number;
  status: BreakStatus;
  notes: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface ScheduleDay {
  id: UUID;
  jobId: UUID;
  dayOfWeek: DayOfWeek;
  startTime: LocalTime;
  endTime: LocalTime;
  plannedBreakSeconds: number;
  isActive: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export interface WeeklyTarget {
  id: UUID;
  /** Null = applies to All Jobs combined. */
  jobId: UUID | null;
  targetSeconds: number;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export type ThemePreference = 'system' | 'light' | 'dark';
