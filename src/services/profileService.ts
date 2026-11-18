/**
 * The signed-in user's own profile: name, phone, email and password.
 * Stored on the Supabase account (auth user + user_metadata), so it follows
 * the user to every device; the local `users` row is refreshed by the auth
 * listener when Supabase reports USER_UPDATED.
 */
import type { User } from '@supabase/supabase-js';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

import { oauthRedirectUrl } from './authService';
import { DomainError } from './errors';

export interface Profile {
  fullName: string;
  phone: string;
}

export function profileFromUser(user: User | null): Profile {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    fullName: typeof meta.full_name === 'string' ? meta.full_name : '',
    phone: typeof meta.phone === 'string' ? meta.phone : '',
  };
}

/** How the account signs in, e.g. ["email"] or ["google"]. */
export function signInMethods(user: User | null): string[] {
  const providers = (user?.app_metadata?.providers as string[] | undefined) ?? [user?.app_metadata?.provider as string].filter(Boolean);
  return providers.length ? providers : ['email'];
}

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Please enter your name.').max(80, 'Name is too long (80 characters max).'),
  phone: z
    .string()
    .trim()
    .max(20, 'Phone number is too long.')
    .refine((v) => v === '' || /^\+?[0-9 ()-]{6,20}$/.test(v), 'Enter a valid phone number, e.g. +44 7700 900123.'),
});
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');
const passwordSchema = z
  .object({ password: z.string(), confirm: z.string() })
  .refine((v) => v.password.length >= 8, { message: 'Password must be at least 8 characters.', path: ['password'] })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });

function invalid(error: z.ZodError): never {
  throw new DomainError('INVALID_PROFILE', error.issues[0]?.message ?? 'Please check your details.');
}

function fail(e: { message?: string } | null): never {
  throw new DomainError('PROFILE_UPDATE_FAILED', e?.message || "Couldn't save your changes. Please try again.");
}

export async function updateProfile(input: Profile): Promise<Profile> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { data, error } = await supabase.auth.updateUser({ data: { full_name: parsed.data.fullName, phone: parsed.data.phone } });
  if (error) fail(error);
  return profileFromUser(data.user);
}

/**
 * Supabase sends a confirmation link; the address only changes once it's
 * clicked (to both old and new address if "secure email change" is on).
 */
export async function requestEmailChange(currentEmail: string | null | undefined, nextEmail: string): Promise<void> {
  const parsed = emailSchema.safeParse(nextEmail);
  if (!parsed.success) invalid(parsed.error);
  if (parsed.data === currentEmail?.toLowerCase()) throw new DomainError('INVALID_PROFILE', 'That is already your email address.');
  const { error } = await supabase.auth.updateUser({ email: parsed.data }, { emailRedirectTo: oauthRedirectUrl() });
  if (error) fail(error);
}

export async function changePassword(password: string, confirm: string): Promise<void> {
  const parsed = passwordSchema.safeParse({ password, confirm });
  if (!parsed.success) invalid(parsed.error);
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) fail(error);
}

/** Permanently deletes the signed-in account on the server. The caller clears local data and signs out. */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    throw new DomainError('ACCOUNT_DELETE_FAILED', "Couldn't delete your account. Check your connection and try again.");
  }
}
