import type { Db } from '@/database/types';
import { newId } from '@/utils/id';

export type SyncEntity =
  | 'jobs'
  | 'job_pay_rates'
  | 'job_overtime_rules'
  | 'job_schedules'
  | 'job_schedule_days'
  | 'shifts'
  | 'breaks'
  | 'weekly_targets';

/**
 * Enqueue the current full row for sync. Call inside the same transaction as
 * the write. Coalesces to one entry per row (latest snapshot wins) and resets
 * retry state, so the server always receives the newest local version.
 */
export async function enqueueSync(db: Db, entity: SyncEntity, entityId: string, now: number): Promise<void> {
  const row = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${entity} WHERE id = ?`, [entityId]);
  if (!row) return;
  const operation = row.deleted_at ? 'delete' : 'upsert';
  const updatedAt = typeof row.updated_at === 'number' ? row.updated_at : now;
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entity_id, operation, payload, entity_updated_at, attempts, last_error, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, ?)
     ON CONFLICT(entity, entity_id) DO UPDATE SET
       operation = excluded.operation,
       payload = excluded.payload,
       entity_updated_at = excluded.entity_updated_at,
       attempts = 0, last_error = NULL, next_attempt_at = 0`,
    [newId(), entity, entityId, operation, JSON.stringify(row), updatedAt, now],
  );
}

/**
 * Record a permanent deletion. The local row is gone, so the queue keeps only
 * the id — no times, pay or notes — so the server can delete its copy too.
 */
export async function enqueueDeletion(db: Db, entity: SyncEntity, entityId: string, now: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entity_id, operation, payload, entity_updated_at, attempts, last_error, next_attempt_at, created_at)
     VALUES (?, ?, ?, 'delete', ?, ?, 0, NULL, 0, ?)
     ON CONFLICT(entity, entity_id) DO UPDATE SET
       operation = 'delete', payload = excluded.payload, entity_updated_at = excluded.entity_updated_at,
       attempts = 0, last_error = NULL, next_attempt_at = 0`,
    [newId(), entity, entityId, JSON.stringify({ id: entityId }), now, now],
  );
}
