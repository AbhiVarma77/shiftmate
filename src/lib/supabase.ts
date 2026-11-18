/**
 * Supabase client — single instance for the whole app.
 *
 * Uses expo-secure-store to persist the session so users stay logged in
 * across app restarts. Falls back to AsyncStorage on web.
 *
 * The client is always created so imports never crash. Use `isSupabaseConfigured`
 * to guard any auth call when env vars might be missing (e.g. in development
 * before .env.local is set up).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

/**
 * expo-secure-store keys must be ≤ 2048 bytes and contain only
 * alphanumeric characters and the symbols: `-`, `_`, `.`.
 * Supabase session keys can contain colons, so we sanitise them.
 */
function sanitiseKey(key: string) {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(sanitiseKey(key));
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    return SecureStore.setItemAsync(sanitiseKey(key), value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    return SecureStore.deleteItemAsync(sanitiseKey(key));
  },
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

/**
 * True only when both env vars are set with real values.
 * Check this before any auth operation to show a friendly message instead
 * of a network error when the app is run without credentials configured.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (__DEV__ && !isSupabaseConfigured) {
  console.warn(
    '[ShiftMate] Supabase is not configured.\n' +
      'Copy .env.example → .env.local and fill in EXPO_PUBLIC_SUPABASE_URL ' +
      'and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable cloud sync.',
  );
}

// Use safe placeholder values so createClient() never throws at module load time.
// All auth calls are guarded by `isSupabaseConfigured` so they won't fire against
// the placeholder URL.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE: OAuth redirects carry a one-time `code` we exchange in authService.
      flowType: 'pkce',
    },
  },
);
