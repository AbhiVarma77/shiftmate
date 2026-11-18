import type { Break, EpochMs } from '@/types/domain';

export interface Interval {
  start: EpochMs;
  end: EpochMs;
}

/** Merge overlapping/adjacent intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Subtract `cuts` from `base` intervals. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const mergedCuts = mergeIntervals(cuts);
  const out: Interval[] = [];
  for (const b of mergeIntervals(base)) {
    let pieces: Interval[] = [{ ...b }];
    for (const c of mergedCuts) {
      pieces = pieces.flatMap((p) => {
        if (c.end <= p.start || c.start >= p.end) return [p];
        const res: Interval[] = [];
        if (c.start > p.start) res.push({ start: p.start, end: c.start });
        if (c.end < p.end) res.push({ start: c.end, end: p.end });
        return res;
      });
    }
    out.push(...pieces);
  }
  return out;
}

export function totalSeconds(intervals: Interval[]): number {
  return Math.floor(intervals.reduce((acc, i) => acc + (i.end - i.start), 0) / 1000);
}

export interface TimedShiftInput {
  startAt: EpochMs | null;
  endAt: EpochMs | null;
  breaks: Pick<Break, 'breakType' | 'startAt' | 'endAt' | 'deletedAt'>[];
}

/**
 * Actual unique elapsed working time across shifts (possibly at different
 * employers). Overlapping time is counted once. Unpaid timed breaks are
 * removed. Duration-only shifts have no intervals and are excluded — callers
 * must report them separately.
 */
export function uniqueWorkingSeconds(shifts: TimedShiftInput[], now: EpochMs): number {
  const work: Interval[] = [];
  for (const s of shifts) {
    if (s.startAt == null) continue;
    const end = s.endAt ?? now;
    const own: Interval[] = [{ start: s.startAt, end }];
    const unpaid = s.breaks
      .filter((b) => !b.deletedAt && b.breakType === 'unpaid' && b.startAt != null)
      .map((b) => ({ start: b.startAt as number, end: b.endAt ?? now }));
    // Cut each shift's own unpaid breaks before union, so a break at job A
    // doesn't erase overlapping work at job B.
    work.push(...subtractIntervals(own, unpaid));
  }
  return totalSeconds(mergeIntervals(work));
}
