import type { CurrencyTotals } from './money';
import { formatMoney } from './money';

/** Render per-currency totals without ever summing across currencies. */
export function formatCurrencyTotals(totals: CurrencyTotals, fallbackCurrency = 'GBP'): string {
  const entries = Object.entries(totals);
  if (!entries.length) return formatMoney('0', fallbackCurrency);
  return entries.map(([cur, amt]) => formatMoney(amt, cur)).join(' · ');
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatClock(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(ms));
}
