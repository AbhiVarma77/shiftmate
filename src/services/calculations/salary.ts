import { Big } from 'big.js';

import type { CurrencyCode, DayOfWeek, DecimalString, LocalDate, OvertimeRule, Shift, UUID } from '@/types/domain';
import { addToCurrencyTotals, type CurrencyTotals, payForSeconds, roundMoney } from '@/utils/money';
import { startOfWeek } from '@/utils/time';

/**
 * Salary engine.
 *
 * - Each shift is paid at its own `hourlyRateSnapshot` (captured from the
 *   job's pay-rate history for the shift date), so later rate changes never
 *   rewrite history and one employer's rate is never applied to another.
 * - Overtime is period-dependent, so it is derived here from the overtime
 *   rule effective on the shift date, never stored on the shift.
 * - Daily overtime is applied first; only remaining regular time counts
 *   toward the weekly threshold (no double counting).
 * - Each component is rounded to currency minor units per shift; totals are
 *   exact sums of the displayed lines.
 */

export type PayableShift = Pick<
  Shift,
  'id' | 'jobId' | 'shiftDate' | 'startAt' | 'createdAt' | 'netWorkSeconds' | 'hourlyRateSnapshot' | 'currency'
>;

export interface ShiftPay {
  shiftId: UUID;
  jobId: UUID | null;
  shiftDate: LocalDate;
  regularSeconds: number;
  overtimeSeconds: number;
  /** Null when the shift has no rate (unassigned or no rate configured). */
  currency: CurrencyCode | null;
  regularPay: DecimalString | null;
  overtimePay: DecimalString | null;
  grossPay: DecimalString | null;
}

export function overtimeRuleForDate(rules: OvertimeRule[], date: LocalDate): OvertimeRule | null {
  return (
    rules
      .filter((r) => r.effectiveFrom <= date && (r.effectiveUntil == null || r.effectiveUntil >= date))
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null
  );
}

function orderKey(s: PayableShift): number {
  return s.startAt ?? s.createdAt;
}

/**
 * Compute pay for shifts. `rulesByJob` maps jobId → overtime rules.
 * Pass every shift in the affected weeks (not just the report range) so the
 * weekly threshold sees prior days; then filter results to the range.
 */
export function computeShiftPay(
  shifts: PayableShift[],
  rulesByJob: Record<UUID, OvertimeRule[]>,
  weekStartsOn: DayOfWeek = 1,
): ShiftPay[] {
  const results: ShiftPay[] = [];
  const byJob = new Map<string, PayableShift[]>();
  for (const s of shifts) {
    const key = s.jobId ?? '__unassigned__';
    const list = byJob.get(key) ?? [];
    list.push(s);
    byJob.set(key, list);
  }

  for (const [jobKey, jobShifts] of byJob) {
    const rules = jobKey === '__unassigned__' ? [] : (rulesByJob[jobKey] ?? []);
    const sorted = [...jobShifts].sort((a, b) =>
      a.shiftDate === b.shiftDate ? orderKey(a) - orderKey(b) : a.shiftDate < b.shiftDate ? -1 : 1,
    );
    const dailyUsed = new Map<LocalDate, number>();
    const weeklyRegularUsed = new Map<LocalDate, number>();

    for (const s of sorted) {
      const net = Math.max(0, s.netWorkSeconds);
      const rule = overtimeRuleForDate(rules, s.shiftDate);
      let overtime = 0;
      let regular = net;

      if (rule?.dailyThresholdSeconds != null) {
        const before = dailyUsed.get(s.shiftDate) ?? 0;
        const remaining = Math.max(0, rule.dailyThresholdSeconds - before);
        const dailyOt = Math.max(0, net - remaining);
        overtime += dailyOt;
        regular = net - dailyOt;
      }
      dailyUsed.set(s.shiftDate, (dailyUsed.get(s.shiftDate) ?? 0) + net);

      if (rule?.weeklyThresholdSeconds != null) {
        const wk = startOfWeek(s.shiftDate, weekStartsOn);
        const before = weeklyRegularUsed.get(wk) ?? 0;
        const remaining = Math.max(0, rule.weeklyThresholdSeconds - before);
        const weeklyOt = Math.max(0, regular - remaining);
        overtime += weeklyOt;
        regular -= weeklyOt;
        weeklyRegularUsed.set(wk, before + regular);
      }

      if (!s.hourlyRateSnapshot || !s.currency) {
        results.push({
          shiftId: s.id,
          jobId: s.jobId,
          shiftDate: s.shiftDate,
          regularSeconds: regular,
          overtimeSeconds: overtime,
          currency: null,
          regularPay: null,
          overtimePay: null,
          grossPay: null,
        });
        continue;
      }

      const multiplier = rule?.multiplier ?? '1';
      const regularPay = roundMoney(payForSeconds(s.hourlyRateSnapshot, regular), s.currency);
      const overtimePay = roundMoney(payForSeconds(s.hourlyRateSnapshot, overtime, multiplier), s.currency);
      results.push({
        shiftId: s.id,
        jobId: s.jobId,
        shiftDate: s.shiftDate,
        regularSeconds: regular,
        overtimeSeconds: overtime,
        currency: s.currency,
        regularPay,
        overtimePay,
        grossPay: roundMoney(new Big(regularPay).plus(overtimePay), s.currency),
      });
    }
  }
  return results;
}

export interface PayTotals {
  regularSeconds: number;
  overtimeSeconds: number;
  gross: CurrencyTotals;
  regular: CurrencyTotals;
  overtime: CurrencyTotals;
  /** Count of shifts with no rate (excluded from money totals). */
  unpricedShifts: number;
}

/** Aggregate per-shift pay. Currencies are kept separate — never summed together. */
export function totalPay(pays: ShiftPay[]): PayTotals {
  let totals: PayTotals = {
    regularSeconds: 0,
    overtimeSeconds: 0,
    gross: {},
    regular: {},
    overtime: {},
    unpricedShifts: 0,
  };
  for (const p of pays) {
    totals.regularSeconds += p.regularSeconds;
    totals.overtimeSeconds += p.overtimeSeconds;
    if (!p.currency || p.grossPay == null) {
      totals.unpricedShifts += 1;
      continue;
    }
    totals = {
      ...totals,
      gross: addToCurrencyTotals(totals.gross, p.currency, p.grossPay),
      regular: addToCurrencyTotals(totals.regular, p.currency, p.regularPay ?? '0'),
      overtime: addToCurrencyTotals(totals.overtime, p.currency, p.overtimePay ?? '0'),
    };
  }
  return totals;
}
