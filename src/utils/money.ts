import { Big } from 'big.js';

import type { CurrencyCode, DecimalString } from '@/types/domain';

/**
 * Decimal-safe money helpers. Never do arithmetic on money with JS numbers.
 * Rounding is half-up ("commercial") to the currency's minor unit.
 */

Big.RM = Big.roundHalfUp;

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD']);

export function currencyMinorDigits(currency: CurrencyCode): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isValidDecimal(value: string): boolean {
  return DECIMAL_RE.test(value.trim());
}

export function toBig(value: DecimalString | number): Big {
  return new Big(value);
}

/** Round to the currency's minor unit and return a fixed-point string. */
export function roundMoney(value: Big | DecimalString, currency: CurrencyCode): DecimalString {
  const digits = currencyMinorDigits(currency);
  return new Big(value).round(digits, Big.roundHalfUp).toFixed(digits);
}

/** rate × seconds / 3600, unrounded. */
export function payForSeconds(hourlyRate: DecimalString, seconds: number, multiplier: DecimalString = '1'): Big {
  if (seconds <= 0) return new Big(0);
  return new Big(hourlyRate).times(multiplier).times(seconds).div(3600);
}

export function sumMoney(values: DecimalString[], currency: CurrencyCode): DecimalString {
  const total = values.reduce((acc, v) => acc.plus(v), new Big(0));
  return roundMoney(total, currency);
}

export function formatMoney(value: DecimalString, currency: CurrencyCode, locale?: string): string {
  const digits = currencyMinorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(value));
  } catch {
    return `${currency} ${new Big(value).toFixed(digits)}`;
  }
}

/** Total of money amounts grouped by currency; never mixes currencies. */
export type CurrencyTotals = Record<CurrencyCode, DecimalString>;

export function addToCurrencyTotals(totals: CurrencyTotals, currency: CurrencyCode, amount: DecimalString): CurrencyTotals {
  const prev = totals[currency] ?? '0';
  return { ...totals, [currency]: roundMoney(new Big(prev).plus(amount), currency) };
}
