import type { DayOfWeek, LocalDate } from '@/types/domain';

import { addDays, endOfMonth, startOfMonth, startOfWeek } from './time';

export type Period = 'day' | 'week' | 'month';

export function periodRange(period: Period, anchor: LocalDate, weekStartsOn: DayOfWeek): { from: LocalDate; to: LocalDate } {
  if (period === 'day') return { from: anchor, to: anchor };
  if (period === 'week') {
    const from = startOfWeek(anchor, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

/** Move the anchor one period forward/back. Months clamp to day 1 (no overflow). */
export function shiftAnchor(period: Period, anchor: LocalDate, dir: number): LocalDate {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
}
