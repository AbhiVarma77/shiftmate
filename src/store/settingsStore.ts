import { create } from 'zustand';

import type { Db } from '@/database/types';
import { useDataStore } from '@/store/dataStore';
import { type AppSettings, DEFAULT_SETTINGS, loadSettings, saveSetting } from '@/repositories/settingsRepository';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  hydrate: (db: Db) => Promise<void>;
  update: <K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]) => Promise<void>;
}

/** Settings live in SQLite; this store is an in-memory mirror for rendering. */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  hydrate: async (db) => {
    set({ settings: await loadSettings(db), loaded: true });
  },
  update: async (db, key, value) => {
    const prev = get().settings;
    set({ settings: { ...prev, [key]: value } }); // optimistic
    try {
      await saveSetting(db, key, value);
      useDataStore.getState().invalidate(); // lets cloud sync pick the change up promptly
    } catch (e) {
      set({ settings: prev });
      throw e;
    }
  },
}));
