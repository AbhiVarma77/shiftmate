import type { Db } from '@/database/types';

/** Children before parents so foreign keys never block the wipe. */
const ACCOUNT_TABLES = [
  'breaks',
  'shifts',
  'job_schedule_days',
  'job_schedules',
  'job_overtime_rules',
  'job_pay_rates',
  'weekly_targets',
  'jobs',
  'sync_queue',
  'users',
  'settings',
];

/**
 * Remove the signed-in account's data from this device (on sign-out), so the
 * next person to sign in here starts clean. The cloud copy is untouched and
 * comes back on the next sign-in.
 */
export async function clearLocalAccountData(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of ACCOUNT_TABLES) await db.runAsync(`DELETE FROM ${t}`);
  });
}

export async function pendingUploadCount(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue'))?.n ?? 0;
}
