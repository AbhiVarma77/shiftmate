import type { Db } from '@/database/types';
import type { DayOfWeek, ThemePreference } from '@/types/domain';

export interface AppSettings {
  theme: ThemePreference;
  weekStartsOn: DayOfWeek;
  defaultCurrency: string;
  /** When false (default), only one shift may run at a time across all jobs. */
  allowConcurrentShifts: boolean;
  onboardingComplete: boolean;
  biometricLock: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  weekStartsOn: 1,
  defaultCurrency: 'GBP',
  allowConcurrentShifts: false,
  onboardingComplete: false,
  biometricLock: false,
};

export async function loadSettings(db: Db): Promise<AppSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (key in out) {
      try {
        (out as unknown as Record<string, unknown>)[key] = JSON.parse(value);
      } catch {
        // Ignore malformed values; keep defaults.
      }
    }
  }
  return out;
}

export async function saveSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K], now = Date.now()): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, JSON.stringify(value), now],
  );
}
