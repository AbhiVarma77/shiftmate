import { formatMoney, payForSeconds, roundMoney, sumMoney } from '@/utils/money';
import {
  addDays,
  dayOfWeek,
  endOfMonth,
  formatDuration,
  isValidLocalDate,
  localToEpoch,
  normalizeTimeInput,
  parseDurationInput,
  startOfWeek,
  toLocalDate,
  toLocalTime,
} from '@/utils/time';

describe('money', () => {
  it('avoids float errors', () => {
    expect(sumMoney(['0.10', '0.20'], 'GBP')).toBe('0.30');
  });
  it('rounds half-up to minor units', () => {
    expect(roundMoney('1.005', 'GBP')).toBe('1.01');
    expect(roundMoney('1.004', 'GBP')).toBe('1.00');
    expect(roundMoney('1234.5', 'JPY')).toBe('1235');
    expect(roundMoney('1.2345', 'KWD')).toBe('1.235');
  });
  it('computes pay from seconds', () => {
    expect(roundMoney(payForSeconds('12.50', 25 * 3600), 'GBP')).toBe('312.50');
    expect(roundMoney(payForSeconds('13.33', 20 * 60), 'GBP')).toBe('4.44');
    expect(roundMoney(payForSeconds('10', 3600, '1.5'), 'GBP')).toBe('15.00');
  });
  it('formats currency', () => {
    expect(formatMoney('312.50', 'GBP', 'en-GB')).toBe('£312.50');
  });
});

describe('duration parsing', () => {
  it.each([
    ['4', 4 * 3600],
    ['4 hours', 4 * 3600],
    ['5h 30m', 5.5 * 3600],
    ['5 hours 30 minutes', 5.5 * 3600],
    ['7 hours and 45 minutes', 7.75 * 3600],
    ['7:45', 7.75 * 3600],
    ['7.75', 7.75 * 3600],
    ['45m', 45 * 60],
    ['8h', 8 * 3600],
  ])('parses %s', (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });
  it.each(['', 'banana', '5h banana', '7:75', '-3'])('rejects %s', (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });
  it('formats durations', () => {
    expect(formatDuration(5.5 * 3600)).toBe('5h 30m');
    expect(formatDuration(3661, 'clock')).toBe('01:01:01');
    expect(formatDuration(45 * 60)).toBe('45m');
  });
});

describe('time input normalisation', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['9', '09:00'],
    ['9.30', '09:30'],
    ['0930', '09:30'],
    ['930', '09:30'],
    ['17h30', '17:30'],
    ['9am', '09:00'],
    ['5pm', '17:00'],
    ['5:30 pm', '17:30'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    [' 23:59 ', '23:59'],
  ])('normalises %s → %s', (input, expected) => {
    expect(normalizeTimeInput(input)).toBe(expected);
  });
  it.each(['', '24:00', '9:60', '13pm', 'noon', '12345', '0am'])('rejects %s', (input) => {
    expect(normalizeTimeInput(input)).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('handles weeks, months, leap years', () => {
    expect(dayOfWeek('2026-11-10')).toBe(2); // Tuesday
    expect(startOfWeek('2026-11-10', 1)).toBe('2026-11-09');
    expect(startOfWeek('2026-11-08', 1)).toBe('2026-11-02'); // Sunday → previous Monday
    expect(startOfWeek('2026-11-10', 0)).toBe('2026-11-08');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidLocalDate('2026-02-30')).toBe(false);
  });
});

describe('timezones and DST', () => {
  const tz = 'Europe/London';
  it('maps local wall time to instants', () => {
    const ms = localToEpoch('2026-07-01', '09:00', tz); // BST, UTC+1
    expect(new Date(ms).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(toLocalTime(ms, tz)).toBe('09:00');
  });
  it('spring-forward night is one hour shorter', () => {
    // 2026-03-29 01:00 GMT → 02:00 BST
    const start = localToEpoch('2026-03-29', '00:00', tz);
    const end = localToEpoch('2026-03-29', '04:00', tz);
    expect((end - start) / 3600_000).toBe(3);
  });
  it('fall-back night is one hour longer', () => {
    // 2026-10-25 02:00 BST → 01:00 GMT
    const start = localToEpoch('2026-10-25', '00:00', tz);
    const end = localToEpoch('2026-10-25', '04:00', tz);
    expect((end - start) / 3600_000).toBe(5);
  });
  it('local date respects zone at midnight boundary', () => {
    const ms = Date.parse('2026-07-01T23:30:00Z');
    expect(toLocalDate(ms, 'UTC')).toBe('2026-07-01');
    expect(toLocalDate(ms, tz)).toBe('2026-07-02');
    expect(toLocalDate(ms, 'America/New_York')).toBe('2026-07-01');
  });
});
