/**
 * OAuth sign-in (Google) shared by the sign-in and sign-up screens.
 *
 * Flow (PKCE — see `flowType` in lib/supabase.ts):
 *  • Native: open Supabase's authorize URL in an auth session browser, wait for
 *    the redirect back to `shiftmate://auth/callback?code=…`, exchange the code.
 *  • Web: full-page redirect to Supabase; the `/auth/callback` route finishes
 *    the exchange. (A popup can't report back here because the web preview is
 *    cross-origin isolated, which severs `window.opener`.)
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

import { DomainError } from './errors';

export const OAUTH_CALLBACK_PATH = 'auth/callback';

export function oauthRedirectUrl(): string {
  return AuthSession.makeRedirectUri({ path: OAUTH_CALLBACK_PATH });
}

/** Reads params from both the query string and the hash fragment. */
export function parseCallbackParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts: string[] = [];
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  if (q !== -1) parts.push(url.slice(q + 1, h > q ? h : undefined));
  if (h !== -1) parts.push(url.slice(h + 1));
  for (const part of parts) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
  }
  return params;
}

/** Turns the redirect URL into a Supabase session. Throws on provider errors. */
export async function completeOAuthFromUrl(url: string): Promise<void> {
  const p = parseCallbackParams(url);
  if (p.error || p.error_description) {
    throw new DomainError('oauth_failed', p.error_description || p.error);
  }
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    if (error) throw error;
    return;
  }
  if (p.access_token && p.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
    if (error) throw error;
    return;
  }
  throw new DomainError('oauth_failed', 'Google did not return a sign-in code. Please try again.');
}

/**
 * Asks Supabase which sign-in methods are switched on, so we can explain a
 * disabled provider instead of sending the user to a raw JSON error page.
 * Returns null if the check itself fails (then we just try).
 */
export async function isProviderEnabled(provider: 'google' | 'apple'): Promise<boolean | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
    if (!res.ok) return null;
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return body.external?.[provider] ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts Google sign-in. Resolves `true` when signed in, `false` if the user
 * closed the browser. On web the page navigates away and this never resolves
 * meaningfully.
 */
export async function signInWithGoogle(): Promise<boolean> {
  if (!isSupabaseConfigured) {
    throw new DomainError(
      'auth_not_configured',
      'Cloud accounts are not set up yet. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server.',
    );
  }

  if ((await isProviderEnabled('google')) === false) {
    throw new DomainError(
      'provider_disabled',
      'Google sign-in is not switched on for this app yet. Please use email for now. (Developer: enable Google under Authentication → Sign In / Providers in Supabase.)',
    );
  }

  const redirectTo = oauthRedirectUrl();

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
    return false;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new DomainError('oauth_failed', 'Could not start Google sign-in.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;

  await completeOAuthFromUrl(result.url);
  return true;
}
