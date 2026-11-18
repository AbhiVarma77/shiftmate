jest.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: jest.fn() } }, isSupabaseConfigured: true }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'shiftmate://auth/callback' }));

import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { changePassword, profileFromUser, requestEmailChange, signInMethods, updateProfile } from '@/services/profileService';

const updateUser = supabase.auth.updateUser as jest.Mock;
const user = (meta: Record<string, unknown>, app: Record<string, unknown> = {}) => ({ user_metadata: meta, app_metadata: app }) as unknown as User;

beforeEach(() => {
  updateUser.mockReset();
  updateUser.mockImplementation(async (attrs: { data?: Record<string, unknown> }) => ({ data: { user: user(attrs.data ?? {}) }, error: null }));
});

describe('profile', () => {
  it('reads name and phone from the account', () => {
    expect(profileFromUser(user({ full_name: 'Sam Rivera', phone: '+44 7700 900123' }))).toEqual({ fullName: 'Sam Rivera', phone: '+44 7700 900123' });
    expect(profileFromUser(null)).toEqual({ fullName: '', phone: '' });
  });

  it('saves a trimmed name and phone to the account', async () => {
    const saved = await updateProfile({ fullName: '  Sam Rivera ', phone: ' +44 7700 900123 ' });
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: 'Sam Rivera', phone: '+44 7700 900123' } });
    expect(saved).toEqual({ fullName: 'Sam Rivera', phone: '+44 7700 900123' });
  });

  it('rejects an empty name or a bad phone number without calling the server', async () => {
    await expect(updateProfile({ fullName: '  ', phone: '' })).rejects.toThrow('Please enter your name.');
    await expect(updateProfile({ fullName: 'Sam', phone: 'call me' })).rejects.toThrow(/valid phone/);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('shows the server error message when saving fails', async () => {
    updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Network request failed' } });
    await expect(updateProfile({ fullName: 'Sam', phone: '' })).rejects.toThrow('Network request failed');
  });

  it('reports how the account signs in', () => {
    expect(signInMethods(user({}, { providers: ['google'] }))).toEqual(['google']);
    expect(signInMethods(user({}, { provider: 'email' }))).toEqual(['email']);
  });
});

describe('email change', () => {
  it('requests a confirmed change to the new address', async () => {
    await requestEmailChange('old@example.com', ' New@Example.com ');
    expect(updateUser).toHaveBeenCalledWith({ email: 'new@example.com' }, { emailRedirectTo: 'shiftmate://auth/callback' });
  });

  it('rejects invalid or unchanged addresses', async () => {
    await expect(requestEmailChange('a@example.com', 'not-an-email')).rejects.toThrow('valid email');
    await expect(requestEmailChange('a@example.com', 'A@example.com')).rejects.toThrow('already your email');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('password change', () => {
  it('updates the password when both entries match', async () => {
    await changePassword('correct-horse', 'correct-horse');
    expect(updateUser).toHaveBeenCalledWith({ password: 'correct-horse' });
  });

  it('enforces length and confirmation', async () => {
    await expect(changePassword('short', 'short')).rejects.toThrow('at least 8');
    await expect(changePassword('longenough1', 'longenough2')).rejects.toThrow('do not match');
    expect(updateUser).not.toHaveBeenCalled();
  });
});
