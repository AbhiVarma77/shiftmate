/**
 * Minimal database surface used by repositories. Matches expo-sqlite's
 * SQLiteDatabase async API so production code passes the real database,
 * while tests pass a node:sqlite adapter running the same SQL.
 */
export type SqlParam = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface Db {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqlParam[]): Promise<RunResult>;
  getAllAsync<T>(source: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params?: SqlParam[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
