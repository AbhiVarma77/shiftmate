import type { SQLiteDatabase } from 'expo-sqlite';

import type { Db } from './types';

/** Adapt expo-sqlite's SQLiteDatabase to the repository `Db` contract. */
export function fromExpo(sqlite: SQLiteDatabase): Db {
  return {
    execAsync: (source) => sqlite.execAsync(source),
    runAsync: (source, params = []) => sqlite.runAsync(source, params),
    getAllAsync: (source, params = []) => sqlite.getAllAsync(source, params),
    getFirstAsync: (source, params = []) => sqlite.getFirstAsync(source, params),
    withTransactionAsync: (task) => sqlite.withTransactionAsync(task),
  };
}
