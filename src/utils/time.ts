import type { DayOfWeek, EpochMs, LocalDate, LocalTime } from '@/types/domain';

/**
 * Time helpers. Durations are always derived from instant differences
 * (DST-safe). Local calendar fields are derived in a given IANA timezone.
 */

export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_MINUTE = 60;

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function secondsBetween(startMs: EpochMs, endMs: EpochMs): number {
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: DayOfWeek;
}

const WEEKDAY_INDEX: Record<string, DayOfWeek> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localParts(ms: EpochMs, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toLocalDate(ms: EpochMs, timeZone: string): LocalDate {
  const p = localParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function toLocalTime(ms: EpochMs, timeZone: string): LocalTime {
  const p = localParts(ms, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (ms) of `timeZone` from UTC at instant `ms`. */
function zoneOffsetMs(ms: EpochMs, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (ms % 1000));
}

/**
 * Convert a local wall-clock date+time in `timeZone` to an instant.
 * For times skipped by a DST spring-forward, resolves to the later offset;
 * for repeated times (fall-back), resolves to the first occurrence.
 */
export function localToEpoch(date: LocalDate, time: LocalTime, timeZone: string): EpochMs {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two-pass offset resolution handles transitions.
  const off1 = zoneOffsetMs(naiveUtc, timeZone);
  let candidate = naiveUtc - off1;
  const off2 = zoneOffsetMs(candidate, timeZone);
  if (off2 !== off1) candidate = naiveUtc - off2;
  // Prefer the earliest instant mapping to this wall time (fall-back ambiguity).
  const earlier = candidate - 3600_000;
  if (toLocalDate(earlier, timeZone) === date && toLocalTime(earlier, timeZone) === time) return earlier;
  return candidate;
}

/** Pure calendar arithmetic on LocalDate (no timezone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function dayOfWeek(date: LocalDate): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as DayOfWeek;
}

/** First day of the week containing `date`. `weekStartsOn` 1 = Monday. */
export function startOfWeek(date: LocalDate, weekStartsOn: DayOfWeek = 1): LocalDate {
  const diff = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: LocalDate): LocalDate {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(last)}`;
}

export function daysInRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:mm" → minutes since midnight. */
export function timeToMinutes(t: LocalTime): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function isValidLocalTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/**
 * Normalise what people actually type into "HH:mm", or null if unrecognised.
 * Accepts: 09:00, 9:00, 9, 9.30, 0930, 930, 9am, 5pm, 5:30 pm, 12am (→00:00), 17h30.
 */
export function normalizeTimeInput(input: string): LocalTime | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/) ?? s.match(/^(\d{1,2})(\d{2})(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer.startsWith('a')) h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  }
  if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function isValidLocalDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return addDays(d, 0) === d;
}

/** 5h 30m style, or H:MM:SS for timers. */
export function formatDuration(seconds: number, style: 'short' | 'clock' | 'decimal' = 'short'): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (style === 'clock') return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  if (style === 'decimal') return (s / 3600).toFixed(2);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Parse human duration input: "4", "4h", "5h 30m", "7:45", "7.75", "45m",
 * "5 hours 30 minutes". Returns seconds or null when invalid.
 */
export function parseDurationInput(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const clock = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60;
  const dec = s.match(/^(\d+(?:\.\d+)?)$/);
  if (dec) return Math.round(Number(dec[1]) * 3600);
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let total = 0;
  let matched = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    total += m[2].startsWith('h') ? n * 3600 : n * 60;
    matched += m[0];
  }
  if (!matched) return null;
  // Reject leftover garbage like "5h banana".
  const leftover = s.replace(re, '').replace(/\band\b|[\s,]+/g, '');
  if (leftover.length) return null;
  return Math.round(total);
}
