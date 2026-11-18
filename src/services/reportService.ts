import type { Db } from '@/database/types';
import { listOvertimeRules, listPayRates } from '@/repositories/jobsRepository';
import { listBreaksForShifts, listShifts } from '@/repositories/shiftsRepository';
import type { Break, DayOfWeek, LocalDate, OvertimeRule, Shift } from '@/types/domain';
import { startOfWeek } from '@/utils/time';

import { summarize, type PeriodSummary } from './analytics';
import { computeShiftPay, type ShiftPay } from './calculations/salary';
import { computeShiftTotals, rateForDate } from './calculations/shifts';

export interface ReportQuery {
  from: LocalDate;
  to: LocalDate;
  jobId?: string; // undefined = All Jobs
  weekStartsOn: DayOfWeek;
}

export interface ReportResult {
  summary: PeriodSummary;
  shifts: Shift[];
  /** Per-shift pay including overtime, keyed by shift id. */
  pays: Map<string, ShiftPay>;
  breaks: Map<string, Break[]>;
}

/**
 * Build a period report from real records. Fetches from the start of the
 * first week so weekly overtime sees earlier days, includes active shifts
 * with live totals (priced at today's effective rate), then filters to range.
 */
export async function loadReport(db: Db, q: ReportQuery, now = Date.now()): Promise<ReportResult> {
  const fetchFrom = startOfWeek(q.from, q.weekStartsOn);
  const raw = await listShifts(db, { from: fetchFrom, to: q.to, jobId: q.jobId, includeActive: true });
  const breaksMap = await listBreaksForShifts(db, raw.map((s) => s.id));

  const rateCache = new Map<string, Awaited<ReturnType<typeof listPayRates>>>();
  const live: Shift[] = [];
  for (const s of raw) {
    if (s.status === 'completed') {
      live.push(s);
      continue;
    }
    const totals = computeShiftTotals(s, breaksMap.get(s.id) ?? [], now);
    let { hourlyRateSnapshot, currency } = s;
    if (s.jobId) {
      if (!rateCache.has(s.jobId)) rateCache.set(s.jobId, await listPayRates(db, s.jobId));
      const rate = rateForDate(rateCache.get(s.jobId) ?? [], s.shiftDate);
      hourlyRateSnapshot = rate?.hourlyRate ?? null;
      currency = rate?.currency ?? currency;
    }
    live.push({ ...s, ...totals, hourlyRateSnapshot, currency });
  }

  const rules = await listOvertimeRules(db);
  const rulesByJob: Record<string, OvertimeRule[]> = {};
  for (const r of rules) (rulesByJob[r.jobId] ??= []).push(r);
  const pays = new Map(computeShiftPay(live, rulesByJob, q.weekStartsOn).map((p) => [p.shiftId, p]));

  const inRange = live.filter((s) => s.shiftDate >= q.from && s.shiftDate <= q.to);
  const summary = summarize(
    inRange.map((shift) => ({ shift, breaks: breaksMap.get(shift.id) ?? [], pay: pays.get(shift.id) })),
    q.from,
    q.to,
    now,
  );
  return { summary, shifts: inRange, pays, breaks: breaksMap };
}
