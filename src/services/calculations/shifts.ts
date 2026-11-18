import type { Break, EpochMs, PayRate, Shift } from '@/types/domain';
import { payForSeconds, roundMoney } from '@/utils/money';
import { secondsBetween } from '@/utils/time';

import { sumBreaks } from './breaks';

export interface ShiftTotals {
  totalDurationSeconds: number;
  paidBreakSeconds: number;
  unpaidBreakSeconds: number;
  netWorkSeconds: number;
}

/**
 * Compute totals from persisted timestamps. For a running shift, `now` is the
 * measurement point. Never depends on an in-memory ticking timer.
 *
 * Paid breaks stay inside paid working time; unpaid breaks are deducted.
 */
export function computeShiftTotals(
  shift: Pick<Shift, 'entryType' | 'startAt' | 'endAt' | 'totalDurationSeconds'>,
  breaks: Pick<Break, 'breakType' | 'startAt' | 'endAt' | 'durationSeconds' | 'deletedAt'>[],
  now: EpochMs,
): ShiftTotals {
  const total =
    shift.entryType === 'manual_duration' || shift.startAt == null
      ? Math.max(0, shift.totalDurationSeconds)
      : secondsBetween(shift.startAt, shift.endAt ?? now);
  const { paidSeconds, unpaidSeconds } = sumBreaks(breaks, now);
  const unpaid = Math.min(unpaidSeconds, total);
  return {
    totalDurationSeconds: total,
    paidBreakSeconds: paidSeconds,
    unpaidBreakSeconds: unpaid,
    netWorkSeconds: Math.max(0, total - unpaid),
  };
}

/** The pay rate in effect for `date` (inclusive ranges). Latest effectiveFrom wins. */
export function rateForDate(rates: PayRate[], date: string): PayRate | null {
  const applicable = rates
    .filter((r) => r.effectiveFrom <= date && (r.effectiveUntil == null || r.effectiveUntil >= date))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return applicable[0] ?? null;
}

/** Base gross pay for a shift at its snapshot rate, rounded to minor units. */
export function basePay(netWorkSeconds: number, hourlyRate: string, currency: string): string {
  return roundMoney(payForSeconds(hourlyRate, netWorkSeconds), currency);
}

/** Two timed shifts overlap if their [start, end) intervals intersect. */
export function shiftsOverlap(
  a: { startAt: EpochMs | null; endAt: EpochMs | null },
  b: { startAt: EpochMs | null; endAt: EpochMs | null },
  now: EpochMs,
): boolean {
  if (a.startAt == null || b.startAt == null) return false;
  const aEnd = a.endAt ?? now;
  const bEnd = b.endAt ?? now;
  return a.startAt < bEnd && b.startAt < aEnd;
}
