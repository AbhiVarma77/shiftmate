import { sumBreaks, validateBreak } from '@/services/calculations/breaks';
import { uniqueWorkingSeconds } from '@/services/calculations/intervals';
import { computeShiftPay, type PayableShift, totalPay } from '@/services/calculations/salary';
import { basePay, computeShiftTotals, rateForDate, shiftsOverlap } from '@/services/calculations/shifts';
import type { Break, OvertimeRule, PayRate } from '@/types/domain';

const H = 3600;
const T0 = Date.parse('2026-11-10T09:00:00Z');
const at = (hours: number) => T0 + hours * H * 1000;

function brk(type: 'paid' | 'unpaid', start: number | null, end: number | null, duration = 0, extra: Partial<Break> = {}): Break {
  return {
    id: Math.random().toString(36),
    shiftId: 's',
    breakType: type,
    startAt: start,
    endAt: end,
    durationSeconds: duration,
    status: end == null && start != null ? 'active' : 'completed',
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...extra,
  };
}

describe('shift totals', () => {
  it('paid breaks stay in net time, unpaid are deducted', () => {
    const t = computeShiftTotals(
      { entryType: 'timer', startAt: at(0), endAt: at(8), totalDurationSeconds: 0 },
      [brk('paid', at(2), at(2.25)), brk('unpaid', at(4), at(4.5))],
      at(10),
    );
    expect(t).toEqual({
      totalDurationSeconds: 8 * H,
      paidBreakSeconds: 0.25 * H,
      unpaidBreakSeconds: 0.5 * H,
      netWorkSeconds: 7.5 * H,
    });
  });

  it('running shift measures to now — survives restart because it uses timestamps', () => {
    const shift = { entryType: 'timer' as const, startAt: at(0), endAt: null, totalDurationSeconds: 0 };
    // Simulate app killed and reopened 3h later: same persisted data, new `now`.
    expect(computeShiftTotals(shift, [], at(1)).netWorkSeconds).toBe(1 * H);
    expect(computeShiftTotals(shift, [], at(3)).netWorkSeconds).toBe(3 * H);
  });

  it('an open unpaid break (pause) stops net time growing', () => {
    const shift = { entryType: 'timer' as const, startAt: at(0), endAt: null, totalDurationSeconds: 0 };
    const breaks = [brk('unpaid', at(2), null)];
    expect(computeShiftTotals(shift, breaks, at(2)).netWorkSeconds).toBe(2 * H);
    expect(computeShiftTotals(shift, breaks, at(3)).netWorkSeconds).toBe(2 * H);
  });

  it('overnight shift crossing midnight', () => {
    const start = Date.parse('2026-11-10T22:00:00Z');
    const end = Date.parse('2026-11-11T06:30:00Z');
    const t = computeShiftTotals({ entryType: 'timer', startAt: start, endAt: end, totalDurationSeconds: 0 }, [], end);
    expect(t.netWorkSeconds).toBe(8.5 * H);
  });

  it('duration-only entries use the stored duration, no invented timestamps', () => {
    const t = computeShiftTotals(
      { entryType: 'manual_duration', startAt: null, endAt: null, totalDurationSeconds: 7.75 * H },
      [brk('unpaid', null, null, 0.5 * H)],
      at(0),
    );
    expect(t.netWorkSeconds).toBe(7.25 * H);
  });

  it('multiple breaks sum correctly; deleted breaks ignored', () => {
    const totals = sumBreaks(
      [
        brk('paid', at(1), at(1.25)),
        brk('paid', at(3), at(3.25)),
        brk('unpaid', at(4), at(5)),
        brk('unpaid', at(6), at(7), 0, { deletedAt: 1 }),
      ],
      at(10),
    );
    expect(totals).toEqual({ paidSeconds: 0.5 * H, unpaidSeconds: 1 * H });
  });
});

describe('break validation', () => {
  const shift = { startAt: at(0), endAt: at(8) };
  const existing = [brk('unpaid', at(4), at(5))];

  it('accepts a valid break', () => {
    expect(validateBreak({ breakType: 'paid', startAt: at(1), endAt: at(1.5) }, shift, existing, at(9))).toBeNull();
  });
  it('rejects end before start', () => {
    expect(validateBreak({ breakType: 'paid', startAt: at(2), endAt: at(1) }, shift, existing, at(9))).toBe('END_BEFORE_START');
  });
  it('rejects breaks outside the shift', () => {
    expect(validateBreak({ breakType: 'paid', startAt: at(-1), endAt: at(0.5) }, shift, existing, at(9))).toBe('OUTSIDE_SHIFT');
    expect(validateBreak({ breakType: 'paid', startAt: at(7.5), endAt: at(8.5) }, shift, existing, at(9))).toBe('OUTSIDE_SHIFT');
  });
  it('rejects overlapping breaks', () => {
    expect(validateBreak({ breakType: 'paid', startAt: at(4.5), endAt: at(5.5) }, shift, existing, at(9))).toBe('OVERLAPS_EXISTING');
  });
  it('allows editing a break in place without self-overlap', () => {
    const b = existing[0];
    expect(validateBreak({ id: b.id, breakType: 'unpaid', startAt: at(4), endAt: at(5.5) }, shift, existing, at(9))).toBeNull();
  });
  it('prevents starting a second open break', () => {
    const running = { startAt: at(0), endAt: null };
    const open = [brk('unpaid', at(1), null)];
    expect(validateBreak({ breakType: 'paid', startAt: at(2), endAt: null }, running, open, at(3))).toBe('ALREADY_ON_BREAK');
  });
  it('duration breaks cannot exceed the shift', () => {
    expect(validateBreak({ breakType: 'unpaid', startAt: null, endAt: null, durationSeconds: 9 * H }, shift, [], at(9))).toBe('EXCEEDS_SHIFT');
  });
});

describe('overlap and unique working time', () => {
  it('detects overlapping shifts', () => {
    expect(shiftsOverlap({ startAt: at(0), endAt: at(4) }, { startAt: at(3), endAt: at(6) }, at(9))).toBe(true);
    expect(shiftsOverlap({ startAt: at(0), endAt: at(4) }, { startAt: at(4), endAt: at(6) }, at(9))).toBe(false);
  });
  it('does not double count overlapping time across employers', () => {
    const unique = uniqueWorkingSeconds(
      [
        { startAt: at(0), endAt: at(4), breaks: [] },
        { startAt: at(3), endAt: at(6), breaks: [] },
      ],
      at(9),
    );
    expect(unique).toBe(6 * H); // sum of employer hours would be 7h
  });
  it('an unpaid break at one job does not erase concurrent work at another', () => {
    const unique = uniqueWorkingSeconds(
      [
        { startAt: at(0), endAt: at(4), breaks: [brk('unpaid', at(1), at(2))] },
        { startAt: at(0), endAt: at(4), breaks: [] },
      ],
      at(9),
    );
    expect(unique).toBe(4 * H);
  });
});

const rate = (id: string, hourlyRate: string, from: string, until: string | null = null): PayRate => ({
  id,
  jobId: 'A',
  hourlyRate,
  currency: 'GBP',
  effectiveFrom: from,
  effectiveUntil: until,
  createdAt: 0,
  updatedAt: 0,
});

describe('pay rates', () => {
  const rates = [rate('r1', '11.00', '2026-01-01', '2026-03-31'), rate('r2', '12.50', '2026-04-01')];
  it('picks the historical rate effective on the shift date', () => {
    expect(rateForDate(rates, '2026-02-15')?.hourlyRate).toBe('11.00');
    expect(rateForDate(rates, '2026-04-01')?.hourlyRate).toBe('12.50');
    expect(rateForDate(rates, '2025-12-31')).toBeNull();
  });
  it('base pay rounds to minor units', () => {
    expect(basePay(25 * H, '12.50', 'GBP')).toBe('312.50');
  });
});

function shift(id: string, jobId: string | null, date: string, hours: number, rateStr: string | null, currency: string | null, order = 0): PayableShift {
  return {
    id,
    jobId,
    shiftDate: date,
    startAt: Date.parse(`${date}T09:00:00Z`) + order,
    createdAt: 0,
    netWorkSeconds: hours * H,
    hourlyRateSnapshot: rateStr,
    currency,
  };
}

const otRule = (jobId: string, daily: number | null, weekly: number | null, multiplier = '1.5'): OvertimeRule => ({
  id: `ot-${jobId}`,
  jobId,
  dailyThresholdSeconds: daily == null ? null : daily * H,
  weeklyThresholdSeconds: weekly == null ? null : weekly * H,
  multiplier,
  effectiveFrom: '2000-01-01',
  effectiveUntil: null,
  createdAt: 0,
  updatedAt: 0,
});

describe('salary engine', () => {
  it('reproduces the multi-employer example: £312.50 + £252.00 = £564.50', () => {
    const shifts = [
      ...[5, 5, 5, 5, 5].map((h, i) => shift(`a${i}`, 'A', `2026-11-0${i + 2}`, h, '12.50', 'GBP')),
      ...[6, 6, 6].map((h, i) => shift(`b${i}`, 'B', `2026-11-0${i + 2}`, h, '14.00', 'GBP', 1)),
    ];
    const pays = computeShiftPay(shifts, {});
    const a = totalPay(pays.filter((p) => p.jobId === 'A'));
    const b = totalPay(pays.filter((p) => p.jobId === 'B'));
    expect(a.gross.GBP).toBe('312.50');
    expect(b.gross.GBP).toBe('252.00');
    expect(totalPay(pays).gross).toEqual({ GBP: '564.50' });
  });

  it('never applies one employer rate to another employer', () => {
    const pays = computeShiftPay([shift('a', 'A', '2026-11-02', 1, '10.00', 'GBP'), shift('b', 'B', '2026-11-02', 1, '20.00', 'GBP')], {});
    expect(pays.find((p) => p.shiftId === 'a')?.grossPay).toBe('10.00');
    expect(pays.find((p) => p.shiftId === 'b')?.grossPay).toBe('20.00');
  });

  it('keeps currencies separate', () => {
    const pays = computeShiftPay([shift('a', 'A', '2026-11-02', 2, '10.00', 'GBP'), shift('b', 'B', '2026-11-02', 2, '15.00', 'EUR')], {});
    expect(totalPay(pays).gross).toEqual({ GBP: '20.00', EUR: '30.00' });
  });

  it('applies daily overtime', () => {
    const pays = computeShiftPay([shift('a', 'A', '2026-11-02', 10, '10.00', 'GBP')], { A: [otRule('A', 8, null)] });
    expect(pays[0]).toMatchObject({ regularSeconds: 8 * H, overtimeSeconds: 2 * H, regularPay: '80.00', overtimePay: '30.00', grossPay: '110.00' });
  });

  it('daily overtime spans multiple shifts on the same day', () => {
    const pays = computeShiftPay(
      [shift('a1', 'A', '2026-11-02', 5, '10.00', 'GBP', 0), shift('a2', 'A', '2026-11-02', 5, '10.00', 'GBP', 1)],
      { A: [otRule('A', 8, null)] },
    );
    expect(pays.find((p) => p.shiftId === 'a2')?.overtimeSeconds).toBe(2 * H);
  });

  it('applies weekly overtime without double-counting daily overtime', () => {
    // Mon–Fri 9h each, daily threshold 8h, weekly 40h.
    const shifts = [2, 3, 4, 5, 6].map((d) => shift(`d${d}`, 'A', `2026-11-0${d}`, 9, '10.00', 'GBP'));
    const totals = totalPay(computeShiftPay(shifts, { A: [otRule('A', 8, 40)] }));
    // 5h daily OT; regular 40h hits weekly threshold exactly → no extra.
    expect(totals.overtimeSeconds).toBe(5 * H);
    expect(totals.regularSeconds).toBe(40 * H);
  });

  it('weekly threshold resets each week', () => {
    const shifts = [
      shift('w1', 'A', '2026-11-08', 45, '10.00', 'GBP'), // Sunday, week of Nov 2
      shift('w2', 'A', '2026-11-09', 45, '10.00', 'GBP'), // Monday, new week
    ];
    const pays = computeShiftPay(shifts, { A: [otRule('A', null, 40)] });
    expect(pays.map((p) => p.overtimeSeconds)).toEqual([5 * H, 5 * H]);
  });

  it('rounds each shift then sums displayed lines', () => {
    // 3 × 20 minutes at £13.33 = 3 × £4.44 (not £13.33)
    const shifts = [0, 1, 2].map((i) => ({ ...shift(`s${i}`, 'A', '2026-11-02', 0, '13.33', 'GBP', i), netWorkSeconds: 20 * 60 }));
    expect(totalPay(computeShiftPay(shifts, {})).gross.GBP).toBe('13.32');
  });

  it('unassigned or unpriced shifts are excluded from money but counted', () => {
    const totals = totalPay(computeShiftPay([shift('u', null, '2026-11-02', 3, null, null)], {}));
    expect(totals.unpricedShifts).toBe(1);
    expect(totals.gross).toEqual({});
    expect(totals.regularSeconds).toBe(3 * H);
  });
});
