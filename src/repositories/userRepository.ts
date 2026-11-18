/**
 * Saves the authenticated Supabase user into the local SQLite `users` table.
 * On first sign-in a new row is inserted; on subsequent sign-ins the existing
 * row is updated with the latest remote metadata.
 */
import type { User } from '@supabase/supabase-js';

import type { Db } from '@/database/types';
import { newId } from '@/utils/id';

export async function upsertLocalUser(db: Db, user: User, now = Date.now()): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE remote_user_id = ?',
    [user.id],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE users
          SET email        = ?,
              display_name = ?,
              is_guest     = 0,
              updated_at   = ?
        WHERE remote_user_id = ?`,
      [user.email ?? null, user.user_metadata?.full_name ?? user.email ?? null, now, user.id],
    );
  } else {
    await db.runAsync(
      `INSERT INTO users (id, remote_user_id, email, display_name, is_guest, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        newId(),
        user.id,
        user.email ?? null,
        user.user_metadata?.full_name ?? user.email ?? null,
        now,
        now,
      ],
    );
  }
}

