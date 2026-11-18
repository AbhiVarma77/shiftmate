/**
 * Profile & account — the signed-in user's own details, each part saved
 * separately to their Supabase account: profile (name, phone), email,
 * password. App preferences live on the Settings tab.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Controls';
import { confirm } from '@/components/ui/Dialog';
import { Card, ErrorBanner, Screen, Section } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/data';
import { useSignOut } from '@/hooks/useSignOut';
import { clearLocalAccountData } from '@/repositories/accountRepository';
import { DomainError } from '@/services/errors';
import { changePassword, deleteAccount, profileFromUser, requestEmailChange, signInMethods, updateProfile } from '@/services/profileService';
import { useAuthStore } from '@/store/authStore';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';

/** Runs a save, tracking busy / error / success message for one section. */
function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await fn());
    } catch (e) {
      setError(e instanceof DomainError ? e.message : "Couldn't save your changes. Please try again.");
      if (!(e instanceof DomainError)) console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

function Success({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', backgroundColor: t.colors.accentMuted, padding: t.spacing.md, borderRadius: t.radius.md }}>
      <Icon name="check" size={16} color={t.colors.accent} />
      <Text variant="label" style={{ flex: 1, color: t.colors.accent }}>{message}</Text>
    </View>
  );
}

const PROVIDER_LABELS: Record<string, string> = { email: 'Email & password', google: 'Google', apple: 'Apple' };

export default function Account() {
  const t = useTheme();
  const user = useAuthStore((s) => s.user);
  const { signOut, signingOut } = useSignOut();

  const initial = profileFromUser(user);
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const profileSave = useSave();
  const emailSave = useSave();
  const passwordSave = useSave();

  const db = useDb();
  const signOutStore = useAuthStore((s) => s.signOut);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const invalidate = useDataStore((s) => s.invalidate);
  const deletion = useSave();

  const handleDelete = async () => {
    const first = await confirm({
      title: 'Delete your account?',
      message: 'This permanently deletes your account and every job, shift and setting backed up to it, and removes them from this phone. It cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!first) return;
    const second = await confirm({
      title: 'Are you sure?',
      message: 'Last chance — nothing can be recovered after this.',
      confirmLabel: 'Yes, delete everything',
      cancelLabel: 'Keep my account',
      destructive: true,
    });
    if (!second) return;
    await deletion.run(async () => {
      await deleteAccount();
      await clearLocalAccountData(db);
      await signOutStore('local');
      await hydrate(db);
      invalidate();
      router.replace('/auth/sign-up');
      return 'Account deleted.';
    });
  };

  if (!user) return null; // the auth gate is already redirecting

  const methods = signInMethods(user);
  const hasPassword = methods.includes('email');
  const profileChanged = fullName.trim() !== initial.fullName || phone.trim() !== initial.phone;
  const pendingEmail = user.new_email;
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title="Profile & account" subtitle="Your details are saved to your account">
        {/* ── Profile ─────────────────────────────── */}
        <Section title="Profile" style={{ marginTop: 0 }}>
          <Card style={{ gap: t.spacing.lg }}>
            <TextField label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" autoCapitalize="words" maxLength={80} testID="profile-name" />
            <TextField
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="+44 7700 900123"
              maxLength={20}
              testID="profile-phone"
            />
            {profileSave.error && <ErrorBanner message={profileSave.error} />}
            {profileSave.done && <Success message={profileSave.done} />}
            <Button
              label="Save profile"
              fullWidth
              disabled={!profileChanged}
              loading={profileSave.busy}
              onPress={() =>
                profileSave.run(async () => {
                  const saved = await updateProfile({ fullName, phone });
                  setFullName(saved.fullName);
                  setPhone(saved.phone);
                  return 'Profile saved.';
                })
              }
            />
          </Card>
        </Section>

        {/* ── Email ───────────────────────────────── */}
        <Section title="Email">
          <Card style={{ gap: t.spacing.lg }}>
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              testID="profile-email"
            />
            {pendingEmail && !emailSave.done && (
              <Text variant="caption" color="textSecondary">
                Waiting for you to confirm {pendingEmail}. Check that inbox for the link.
              </Text>
            )}
            {emailSave.error && <ErrorBanner message={emailSave.error} />}
            {emailSave.done && <Success message={emailSave.done} />}
            <Button
              label="Change email"
              variant="secondary"
              fullWidth
              disabled={!email.trim() || email.trim().toLowerCase() === user.email?.toLowerCase()}
              loading={emailSave.busy}
              onPress={() =>
                emailSave.run(async () => {
                  await requestEmailChange(user.email, email);
                  return `We sent a confirmation link to ${email.trim()}. Your email changes once you open it.`;
                })
              }
            />
          </Card>
        </Section>

        {/* ── Password ────────────────────────────── */}
        <Section title="Password">
          <Card style={{ gap: t.spacing.lg }}>
            {!hasPassword && (
              <Text variant="caption" color="textSecondary">
                You sign in with {methods.map((m) => PROVIDER_LABELS[m] ?? m).join(' / ')}. Set a password to also sign in with your email.
              </Text>
            )}
            <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" testID="profile-password" />
            <TextField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" testID="profile-password-confirm" />
            {passwordSave.error && <ErrorBanner message={passwordSave.error} />}
            {passwordSave.done && <Success message={passwordSave.done} />}
            <Button
              label={hasPassword ? 'Change password' : 'Set password'}
              variant="secondary"
              fullWidth
              disabled={!password}
              loading={passwordSave.busy}
              onPress={() =>
                passwordSave.run(async () => {
                  await changePassword(password, confirmPassword);
                  setPassword('');
                  setConfirmPassword('');
                  return 'Password updated.';
                })
              }
            />
          </Card>
        </Section>

        {/* ── Account ─────────────────────────────── */}
        <Section title="Account">
          <Card style={{ gap: t.spacing.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="caption" color="textSecondary">Signs in with</Text>
              <Text variant="bodyStrong">{methods.map((m) => PROVIDER_LABELS[m] ?? m).join(', ')}</Text>
            </View>
            {memberSince && (
              <View style={{ gap: 2 }}>
                <Text variant="caption" color="textSecondary">Member since</Text>
                <Text variant="bodyStrong">{memberSince}</Text>
              </View>
            )}
            <Button label="Sign out" variant="danger" fullWidth loading={signingOut} onPress={signOut} />
          </Card>
        </Section>

        {/* ── Danger zone ─────────────────────────── */}
        <Section title="Danger zone">
          <Card style={{ gap: t.spacing.md }}>
            <Text variant="caption" color="textSecondary">
              Deleting your account removes it and all backed-up data from our servers, and clears this phone. Download your data first if you want to keep a copy (Settings → Data & privacy).
            </Text>
            {deletion.error && <ErrorBanner message={deletion.error} />}
            <Button label="Delete account" variant="danger" fullWidth loading={deletion.busy} onPress={handleDelete} testID="delete-account" />
          </Card>
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}
