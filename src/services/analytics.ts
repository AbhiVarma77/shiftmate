import type { Break, CurrencyCode, DecimalString, LocalDate, Shift, UUID } from '@/types/domain';
import { addToCurrencyTotals, type CurrencyTotals } from '@/utils/money';

import { uniqueWorkingSeconds } from './calculations/intervals';
import type { ShiftPay } from './calculations/salary';

export interface JobBreakdown {
  jobId: UUID | null;
  netSeconds: number;
  shiftCount: number;
  overtimeSeconds: number;
  earnings: CurrencyTotals;
}

export interface PeriodSummary {
  from: LocalDate;
  to: LocalDate;
  shiftCount: number;
  /** Sum of employer-recorded net hours (may double-count concurrent jobs). */
  netSeconds: number;
  /** Actual unique elapsed working time across timed shifts. */
  uniqueTimedSeconds: number;
  /** Net time from duration-only entries (no timestamps → can't be de-duplicated). */
  durationOnlySeconds: number;
  paidBreakSeconds: number;
  unpaidBreakSeconds: number;
  overtimeSeconds: number;
  workingDays: number;
  averageShiftSeconds: number;
  averagePerDaySeconds: number;
  longestShiftSeconds: number;
  shortestShiftSeconds: number;
  earliestStart: number | null;
  latestEnd: number | null;
  earnings: CurrencyTotals;
  unpricedShifts: number;
  byJob: JobBreakdown[];
  byDay: Record<LocalDate, { netSeconds: number; earnings: CurrencyTotals }>;
  hasActive: boolean;
}

export interface SummaryInput {
  shift: Shift; // with live totals already applied for active shifts
  breaks: Break[];
  pay: ShiftPay | undefined;
}

export function summarize(items: SummaryInput[], from: LocalDate, to: LocalDate, now: number): PeriodSummary {
  const s: PeriodSummary = {
    from,
    to,
    shiftCount: 0,
    netSeconds: 0,
    uniqueTimedSeconds: 0,
    durationOnlySeconds: 0,
    paidBreakSeconds: 0,
    unpaidBreakSeconds: 0,
    overtimeSeconds: 0,
    workingDays: 0,
    averageShiftSeconds: 0,
    averagePerDaySeconds: 0,
    longestShiftSeconds: 0,
    shortestShiftSeconds: 0,
    earliestStart: null,
    latestEnd: null,
    earnings: {},
    unpricedShifts: 0,
    byJob: [],
    byDay: {},
    hasActive: false,
  };
  const jobs = new Map<string, JobBreakdown>();
  let shortest = Number.POSITIVE_INFINITY;

  for (const { shift, pay } of items) {
    const net = shift.netWorkSeconds;
    s.shiftCount += 1;
    s.netSeconds += net;
    s.paidBreakSeconds += shift.paidBreakSeconds;
    s.unpaidBreakSeconds += shift.unpaidBreakSeconds;
    if (shift.startAt == null) s.durationOnlySeconds += net;
    if (shift.status !== 'completed') s.hasActive = true;
    s.longestShiftSeconds = Math.max(s.longestShiftSeconds, net);
    shortest = Math.min(shortest, net);
    if (shift.startAt != null) s.earliestStart = s.earliestStart == null ? shift.startAt : Math.min(s.earliestStart, shift.startAt);
    const end = shift.endAt ?? (shift.startAt != null && shift.status !== 'completed' ? now : null);
    if (end != null) s.latestEnd = s.latestEnd == null ? end : Math.max(s.latestEnd, end);

    const key = shift.jobId ?? '__none__';
    const jb = jobs.get(key) ?? { jobId: shift.jobId, netSeconds: 0, shiftCount: 0, overtimeSeconds: 0, earnings: {} };
    jb.netSeconds += net;
    jb.shiftCount += 1;

    const day = (s.byDay[shift.shiftDate] ??= { netSeconds: 0, earnings: {} });
    day.netSeconds += net;

    if (pay) {
      s.overtimeSeconds += pay.overtimeSeconds;
      jb.overtimeSeconds += pay.overtimeSeconds;
    }
    if (pay?.currency && pay.grossPay != null) {
      s.earnings = addToCurrencyTotals(s.earnings, pay.currency, pay.grossPay);
      jb.earnings = addToCurrencyTotals(jb.earnings, pay.currency, pay.grossPay);
      day.earnings = addToCurrencyTotals(day.earnings, pay.currency, pay.grossPay);
    } else {
      s.unpricedShifts += 1;
    }
    jobs.set(key, jb);
  }

  s.uniqueTimedSeconds = uniqueWorkingSeconds(
    items.map((i) => ({ startAt: i.shift.startAt, endAt: i.shift.status === 'completed' ? i.shift.endAt : null, breaks: i.breaks })),
    now,
  );
  s.workingDays = Object.values(s.byDay).filter((d) => d.netSeconds > 0).length;
  s.averageShiftSeconds = s.shiftCount ? Math.round(s.netSeconds / s.shiftCount) : 0;
  s.averagePerDaySeconds = s.workingDays ? Math.round(s.netSeconds / s.workingDays) : 0;
  s.shortestShiftSeconds = s.shiftCount ? shortest : 0;
  s.byJob = [...jobs.values()].sort((a, b) => b.netSeconds - a.netSeconds);
  return s;
}

export interface Delta {
  current: number;
  previous: number;
  change: number;
  /** Null when previous is 0 (percentage undefined) — UI shows "new" instead of ∞. */
  percent: number | null;
}

export function delta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    change: current - previous,
    percent: previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / previous) * 100,
  };
}

/** Single-currency amount from totals, for comparisons. */
export function amountIn(totals: CurrencyTotals, currency: CurrencyCode): DecimalString {
  return totals[currency] ?? '0';
}
