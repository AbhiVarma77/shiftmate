import { useSQLiteContext } from 'expo-sqlite';
import { type DependencyList, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { fromExpo } from '@/database/expoDb';
import type { Db } from '@/database/types';
import { listJobs } from '@/repositories/jobsRepository';
import { listActiveShifts, listBreaks } from '@/repositories/shiftsRepository';
import { DomainError } from '@/services/errors';
import { useDataStore } from '@/store/dataStore';
import type { Break, Job, Shift } from '@/types/domain';
import { deviceTimezone, toLocalDate } from '@/utils/time';

export function useDb(): Db {
  const sqlite = useSQLiteContext();
  return useMemo(() => fromExpo(sqlite), [sqlite]);
}

export interface Live<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Run an async DB query; re-run when deps change or any mutation invalidates data. */
export function useLive<T>(query: (db: Db) => Promise<T>, deps: DependencyList): Live<T> {
  const db = useDb();
  const version = useDataStore((s) => s.version);
  const invalidate = useDataStore((s) => s.invalidate);
  // Keeps showing previous data while a refetch runs (no flashing spinners).
  const [state, setState] = useState<{ data: T | undefined; error: Error | null }>({ data: undefined, error: null });
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    query(db).then(
      (data) => id === seq.current && setState({ data, error: null }),
      (error: Error) => id === seq.current && setState((s) => ({ data: s.data, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);

  return { ...state, loading: state.data === undefined && state.error == null, reload: invalidate };
}

/** Wrap a mutation: runs it, invalidates queries, and surfaces a readable error. */
export function useMutation<A extends unknown[], R>(fn: (db: Db, ...args: A) => Promise<R>) {
  const db = useDb();
  const invalidate = useDataStore((s) => s.invalidate);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        const r = await fn(db, ...args);
        invalidate();
        return r;
      } catch (e) {
        const msg = e instanceof DomainError ? e.message : 'Something went wrong. Your data is safe — please try again.';
        if (!(e instanceof DomainError)) console.error(e);
        setError(msg);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [db, fn, invalidate],
  );
  return { run, pending, error, setError };
}

/** Ticks for display only; time is always computed from persisted timestamps. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    // Snap immediately when returning from background.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setNow(Date.now()));
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs, enabled]);
  return now;
}

/** Today's local date; rolls over at midnight and on app resume. */
export function useToday(): string {
  const now = useNow(30_000);
  return toLocalDate(now, deviceTimezone());
}

export function useJobs(includeArchived = false): Live<Job[]> {
  return useLive((db) => listJobs(db, { includeArchived }), [includeArchived]);
}

export interface ActiveShift {
  shift: Shift;
  breaks: Break[];
}

export function useActiveShifts(): Live<ActiveShift[]> {
  return useLive(async (db) => {
    const shifts = await listActiveShifts(db);
    return Promise.all(shifts.map(async (shift) => ({ shift, breaks: await listBreaks(db, shift.id) })));
  }, []);
}
