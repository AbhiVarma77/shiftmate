import { create } from 'zustand';

/**
 * SQLite is the source of truth. Screens read through hooks that re-query
 * whenever `version` changes; every mutation calls `invalidate()`.
 * Simple, predictable, and offline by construction.
 */
interface DataState {
  version: number;
  invalidate: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  version: 0,
  invalidate: () => set((s) => ({ version: s.version + 1 })),
}));
