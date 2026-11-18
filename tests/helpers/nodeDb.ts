// Test adapter: exposes node:sqlite (Node ≥22) through the expo-sqlite-shaped Db
// interface, so repositories run real SQL against an in-memory database.
import type { Db, SqlParam } from '@/database/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

export function createTestDb(): Db & { close(): void } {
  const raw = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execAsync(source: string) {
      raw.exec(source);
    },
    async runAsync(source: string, params: SqlParam[] = []) {
      const r = raw.prepare(source).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(source: string, params: SqlParam[] = []) {
      return raw.prepare(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, params: SqlParam[] = []) {
      return (raw.prepare(source).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      const sp = `sp${depth++}`;
      raw.exec(depth === 1 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      try {
        await task();
        raw.exec(depth === 1 ? 'COMMIT' : `RELEASE ${sp}`);
      } catch (e) {
        raw.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    close() {
      raw.close();
    },
  };
}
