jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: { auth: {} }, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'shiftmate://auth/callback' }));

import { completeOAuthFromUrl, isProviderEnabled, parseCallbackParams, signInWithGoogle } from '@/services/authService';

describe('parseCallbackParams', () => {
  it('reads the PKCE code from the query string', () => {
    expect(parseCallbackParams('shiftmate://auth/callback?code=abc-123')).toEqual({ code: 'abc-123' });
  });

  it('reads tokens from the hash fragment', () => {
    expect(parseCallbackParams('http://localhost:8083/auth/callback#access_token=a&refresh_token=r')).toEqual({
      access_token: 'a',
      refresh_token: 'r',
    });
  });

  it('merges query and hash and decodes values', () => {
    expect(parseCallbackParams('x://cb?error=access_denied#error_description=User+denied%20access')).toEqual({
      error: 'access_denied',
      error_description: 'User denied access',
    });
  });

  it('returns empty for a bare URL', () => {
    expect(parseCallbackParams('shiftmate://auth/callback')).toEqual({});
  });
});

describe('completeOAuthFromUrl', () => {
  it('surfaces provider errors', async () => {
    await expect(completeOAuthFromUrl('x://cb?error_description=Unsupported+provider')).rejects.toThrow('Unsupported provider');
  });

  it('rejects a redirect with no code or tokens', async () => {
    await expect(completeOAuthFromUrl('x://cb')).rejects.toThrow(/did not return/);
  });
});

describe('signInWithGoogle', () => {
  it('explains missing Supabase config instead of opening a dead URL', async () => {
    await expect(signInWithGoogle()).rejects.toThrow(/\.env\.local/);
  });
});

describe('disabled Google provider', () => {
  const mockSupabase = jest.requireMock<{ isSupabaseConfigured: boolean }>('@/lib/supabase');
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    mockSupabase.isSupabaseConfigured = false;
  });

  it('reads provider status from Supabase settings', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: false, email: true } }) })) as unknown as typeof fetch;
    expect(await isProviderEnabled('google')).toBe(false);
  });

  it('explains instead of opening the raw "provider is not enabled" page', async () => {
    mockSupabase.isSupabaseConfigured = true;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: false } }) })) as unknown as typeof fetch;
    await expect(signInWithGoogle()).rejects.toThrow(/Google sign-in is not switched on/);
  });

  it('treats a failed check as unknown rather than blocking', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await isProviderEnabled('google')).toBeNull();
  });
});
