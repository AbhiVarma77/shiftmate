import type { Break, BreakType, EpochMs } from '@/types/domain';
import { secondsBetween } from '@/utils/time';

/** Effective duration of a break; open breaks are measured up to `now`. */
export function breakDurationSeconds(b: Pick<Break, 'startAt' | 'endAt' | 'durationSeconds'>, now: EpochMs): number {
  if (b.startAt == null) return Math.max(0, b.durationSeconds);
  return secondsBetween(b.startAt, b.endAt ?? now);
}

export interface BreakTotals {
  paidSeconds: number;
  unpaidSeconds: number;
}

export function sumBreaks(breaks: Pick<Break, 'breakType' | 'startAt' | 'endAt' | 'durationSeconds' | 'deletedAt'>[], now: EpochMs): BreakTotals {
  let paidSeconds = 0;
  let unpaidSeconds = 0;
  for (const b of breaks) {
    if (b.deletedAt) continue;
    const d = breakDurationSeconds(b, now);
    if (b.breakType === 'paid') paidSeconds += d;
    else unpaidSeconds += d;
  }
  return { paidSeconds, unpaidSeconds };
}

export type BreakValidationError =
  | 'END_BEFORE_START'
  | 'OUTSIDE_SHIFT'
  | 'OVERLAPS_EXISTING'
  | 'ALREADY_ON_BREAK'
  | 'NEGATIVE_DURATION'
  | 'EXCEEDS_SHIFT';

export interface CandidateBreak {
  id?: string;
  breakType: BreakType;
  startAt: EpochMs | null;
  endAt: EpochMs | null;
  durationSeconds?: number;
}

interface ShiftBounds {
  startAt: EpochMs | null;
  endAt: EpochMs | null; // null = still running
  totalDurationSeconds?: number; // for duration-only shifts
}

/**
 * Validate a break against its shift and sibling breaks.
 * Timed breaks must sit inside the shift and not overlap others.
 * Duration-only breaks must not, together with siblings, exceed the shift.
 */
export function validateBreak(
  candidate: CandidateBreak,
  shift: ShiftBounds,
  siblings: Pick<Break, 'id' | 'startAt' | 'endAt' | 'durationSeconds' | 'deletedAt'>[],
  now: EpochMs,
): BreakValidationError | null {
  const others = siblings.filter((s) => !s.deletedAt && s.id !== candidate.id);

  if (candidate.startAt == null) {
    const d = candidate.durationSeconds ?? 0;
    if (d < 0) return 'NEGATIVE_DURATION';
    const shiftTotal =
      shift.totalDurationSeconds ?? (shift.startAt != null ? secondsBetween(shift.startAt, shift.endAt ?? now) : 0);
    const used = others.reduce((acc, o) => acc + breakDurationSeconds(o, now), 0);
    if (used + d > shiftTotal) return 'EXCEEDS_SHIFT';
    return null;
  }

  const start = candidate.startAt;
  const end = candidate.endAt; // null = starting an open break
  if (end != null && end <= start) return 'END_BEFORE_START';

  if (shift.startAt != null) {
    if (start < shift.startAt) return 'OUTSIDE_SHIFT';
    const shiftEnd = shift.endAt ?? now;
    if ((end ?? start) > shiftEnd || start > shiftEnd) return 'OUTSIDE_SHIFT';
  }

  if (end == null && others.some((o) => o.startAt != null && o.endAt == null)) return 'ALREADY_ON_BREAK';

  const candEnd = end ?? Number.POSITIVE_INFINITY;
  for (const o of others) {
    if (o.startAt == null) continue;
    const oEnd = o.endAt ?? Number.POSITIVE_INFINITY;
    if (start < oEnd && o.startAt < candEnd) return 'OVERLAPS_EXISTING';
  }
  return null;
}

export const BREAK_ERROR_MESSAGES: Record<BreakValidationError, string> = {
  END_BEFORE_START: 'A break must end after it starts.',
  OUTSIDE_SHIFT: 'Breaks must fall within the shift.',
  OVERLAPS_EXISTING: 'This break overlaps another break.',
  ALREADY_ON_BREAK: 'You are already on a break.',
  NEGATIVE_DURATION: 'Break duration cannot be negative.',
  EXCEEDS_SHIFT: 'Breaks cannot be longer than the shift.',
};
