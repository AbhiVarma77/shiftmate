import type { Db } from '@/database/types';
import { breakFromRow, type BreakRow, SHIFT_COLUMNS, shiftFromRow, type ShiftRow, shiftToParams } from '@/database/mappers';
import type { Break, Shift } from '@/types/domain';

import { enqueueDeletion, enqueueSync } from './outbox';

const PLACEHOLDERS = SHIFT_COLUMNS.split(',').map(() => '?').join(',');

export async function getShift(db: Db, id: string): Promise<Shift | null> {
  const row = await db.getFirstAsync<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [id]);
  return row ? shiftFromRow(row) : null;
}

/** Active (running or on break) shifts — restored on every app launch. */
export async function listActiveShifts(db: Db): Promise<Shift[]> {
  const rows = await db.getAllAsync<ShiftRow>(
    "SELECT * FROM shifts WHERE status != 'completed' AND deleted_at IS NULL ORDER BY start_at",
  );
  return rows.map(shiftFromRow);
}

export interface ShiftQuery {
  from?: string; // inclusive LocalDate
  to?: string; // inclusive LocalDate
  jobId?: string | null; // undefined = all jobs; null = unassigned only
  includeActive?: boolean;
  limit?: number;
}

export async function listShifts(db: Db, q: ShiftQuery = {}): Promise<Shift[]> {
  const where = ['deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (q.from) {
    where.push('shift_date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('shift_date <= ?');
    params.push(q.to);
  }
  if (q.jobId === null) where.push('job_id IS NULL');
  else if (q.jobId) {
    where.push('job_id = ?');
    params.push(q.jobId);
  }
  if (!q.includeActive) where.push("status = 'completed'");
  const limit = q.limit ? `LIMIT ${Math.floor(q.limit)}` : '';
  const rows = await db.getAllAsync<ShiftRow>(
    `SELECT * FROM shifts WHERE ${where.join(' AND ')} ORDER BY shift_date DESC, COALESCE(start_at, created_at) DESC ${limit}`,
    params,
  );
  return rows.map(shiftFromRow);
}

export async function insertShift(db: Db, s: Shift): Promise<void> {
  await db.runAsync(`INSERT INTO shifts (${SHIFT_COLUMNS}) VALUES (${PLACEHOLDERS})`, shiftToParams(s));
  await enqueueSync(db, 'shifts', s.id, s.updatedAt);
}

export async function updateShiftRow(db: Db, s: Shift): Promise<void> {
  const cols = SHIFT_COLUMNS.split(',').slice(1);
  await db.runAsync(`UPDATE shifts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
    ...shiftToParams(s).slice(1),
    s.id,
  ]);
  await enqueueSync(db, 'shifts', s.id, s.updatedAt);
}

export async function listBreaks(db: Db, shiftId: string, opts: { includeDeleted?: boolean } = {}): Promise<Break[]> {
  const rows = await db.getAllAsync<BreakRow>(
    `SELECT * FROM breaks WHERE shift_id = ? ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY COALESCE(start_at, created_at)`,
    [shiftId],
  );
  return rows.map(breakFromRow);
}

export async function listBreaksForShifts(db: Db, shiftIds: string[]): Promise<Map<string, Break[]>> {
  const map = new Map<string, Break[]>();
  if (!shiftIds.length) return map;
  // Chunk to stay under SQLite's bound-parameter limit.
  for (let i = 0; i < shiftIds.length; i += 500) {
    const chunk = shiftIds.slice(i, i + 500);
    const rows = await db.getAllAsync<BreakRow>(
      `SELECT * FROM breaks WHERE deleted_at IS NULL AND shift_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const r of rows) {
      const list = map.get(r.shift_id) ?? [];
      list.push(breakFromRow(r));
      map.set(r.shift_id, list);
    }
  }
  return map;
}

export async function upsertBreak(db: Db, b: Break): Promise<void> {
  await db.runAsync(
    `INSERT INTO breaks (id,shift_id,break_type,start_at,end_at,duration_seconds,status,notes,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET break_type=excluded.break_type,start_at=excluded.start_at,end_at=excluded.end_at,
       duration_seconds=excluded.duration_seconds,status=excluded.status,notes=excluded.notes,
       updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
    [b.id, b.shiftId, b.breakType, b.startAt, b.endAt, b.durationSeconds, b.status, b.notes, b.createdAt, b.updatedAt, b.deletedAt],
  );
  await enqueueSync(db, 'breaks', b.id, b.updatedAt);
}

/** Permanently remove a shift and its breaks. Call inside a transaction. */
export async function purgeShift(db: Db, shiftId: string, now: number): Promise<void> {
  const breakIds = await db.getAllAsync<{ id: string }>('SELECT id FROM breaks WHERE shift_id = ?', [shiftId]);
  await db.runAsync('DELETE FROM breaks WHERE shift_id = ?', [shiftId]);
  await db.runAsync('DELETE FROM shifts WHERE id = ?', [shiftId]);
  // Breaks are removed server-side by cascade; drop their queued snapshots.
  if (breakIds.length) {
    await db.runAsync(
      `DELETE FROM sync_queue WHERE entity = 'breaks' AND entity_id IN (${breakIds.map(() => '?').join(',')})`,
      breakIds.map((b) => b.id),
    );
  }
  await enqueueDeletion(db, 'shifts', shiftId, now);
}

export async function purgeBreak(db: Db, breakId: string, now: number): Promise<void> {
  await db.runAsync('DELETE FROM breaks WHERE id = ?', [breakId]);
  await enqueueDeletion(db, 'breaks', breakId, now);
}
