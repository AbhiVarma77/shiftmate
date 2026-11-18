import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Switch, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Segmented, TextField } from '@/components/ui/Controls';
import { Card, ErrorBanner, ListRow, Screen, Section } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useDb, useJobs, useLive, useMutation } from '@/hooks/data';
import { enqueueSync } from '@/repositories/outbox';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncNow, useSyncStore } from '@/store/syncStore';
import { useDataStore } from '@/store/dataStore';
import { useTheme } from '@/theme/ThemeProvider';
import { savePdf } from '@/lib/pdf';
import { collectAccountData, renderAccountExportHtml } from '@/services/export/dataExport';
import type { Db } from '@/database/types';
import type { ThemePreference } from '@/types/domain';
import { newId } from '@/utils/id';
import { formatDuration, parseDurationInput } from '@/utils/time';

async function saveAllJobsTarget(db: Db, seconds: number | null) {
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM weekly_targets WHERE job_id IS NULL AND deleted_at IS NULL');
    if (seconds == null) {
      if (existing) {
        await db.runAsync('UPDATE weekly_targets SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, existing.id]);
        await enqueueSync(db, 'weekly_targets', existing.id, now);
      }
      return;
    }
    const id = existing?.id ?? newId();
    await db.runAsync(
      `INSERT INTO weekly_targets (id, job_id, target_seconds, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET target_seconds = excluded.target_seconds, updated_at = excluded.updated_at`,
      [id, seconds, now, now],
    );
    await enqueueSync(db, 'weekly_targets', id, now);
  });
}

export default function Settings() {
  const t = useTheme();
  const db = useDb();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const jobs = useJobs(true);
  const pending = useLive((d) => d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue'), []);
  const target = useLive((d) => d.getFirstAsync<{ target_seconds: number }>('SELECT target_seconds FROM weekly_targets WHERE job_id IS NULL AND deleted_at IS NULL'), []);
  const [currencyDraft, setCurrencyDraft] = useState(settings.defaultCurrency);

  const user = useAuthStore((s) => s.user);

  const activeCount = (jobs.data ?? []).filter((j) => j.isActive).length;

  return (
    <Screen title="Settings" subtitle="Preferences for how ShiftMate works for you" back={false}>
      {/* ── Account ──────────────────────────────── */}
      <Section title="Account" style={{ marginTop: 0 }}>
        {user && (
          <Card style={{ gap: t.spacing.md }}>
            <ListRow
              title={(user.user_metadata?.full_name as string | undefined) || 'Your profile'}
              subtitle={user.email ?? undefined}
              leading={
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="person" size={20} color={t.colors.accent} />
                </View>
              }
              onPress={() => router.push('/account')}
              last
            />
            <Button label="Edit profile & account" variant="secondary" fullWidth onPress={() => router.push('/account')} />
            <CloudSyncStatus pending={pending.data?.n ?? 0} />
          </Card>
        )}
      </Section>

      {/* ── Work ──────────────────────────────────── */}
      <Section title="Work">
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <ListRow
            title="My Jobs"
            subtitle={`${activeCount} active${(jobs.data?.length ?? 0) > activeCount ? ` · ${(jobs.data?.length ?? 0) - activeCount} archived` : ''}`}
            leading={<Icon name="briefcase" color={t.colors.accent} />}
            onPress={() => router.push('/jobs')}
          />
          <ListRow title="Log a shift manually" leading={<Icon name="add" color={t.colors.accent} />} onPress={() => router.push('/shifts/new')} last />
        </Card>
        {!target.loading && <TargetEditor key={target.data?.target_seconds ?? 0} initialSeconds={target.data?.target_seconds ?? null} />}
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Allow simultaneous shifts</Text>
            <Text variant="caption" color="textSecondary">Run timers at two different jobs at once. Off by default to prevent accidental duplicates.</Text>
          </View>
          <Switch
            accessibilityLabel="Allow simultaneous shifts"
            value={settings.allowConcurrentShifts}
            onValueChange={(v) => update(db, 'allowConcurrentShifts', v)}
            trackColor={{ true: t.colors.accent, false: t.colors.borderStrong }}
          />
        </Card>
      </Section>

      <Section title="Appearance">
        <Card style={{ gap: t.spacing.lg }}>
          <Segmented<ThemePreference>
            label="Theme"
            value={settings.theme}
            onChange={(v) => update(db, 'theme', v)}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="label" color="textSecondary">Week starts on</Text>
            <Segmented
              label="Week starts on"
              value={String(settings.weekStartsOn)}
              onChange={(v) => update(db, 'weekStartsOn', Number(v) as 0 | 1 | 6)}
              options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }]}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField label="Default currency for new jobs" value={currencyDraft} onChangeText={(v) => setCurrencyDraft(v.toUpperCase())} maxLength={3} autoCapitalize="characters" />
            </View>
            <Button label="Save" variant="secondary" disabled={!/^[A-Z]{3}$/.test(currencyDraft) || currencyDraft === settings.defaultCurrency} onPress={() => update(db, 'defaultCurrency', currencyDraft)} />
          </View>
        </Card>
      </Section>

      <Section title="Data & privacy">
        <Card style={{ gap: t.spacing.md }}>
          <View style={{ gap: t.spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Icon name="lock" size={16} color={t.colors.accent} />
              <Text variant="bodyStrong">Saved to your account</Text>
            </View>
            <Text variant="caption" color="textSecondary">
              Everything you record — jobs, pay rates, shifts, breaks and settings — is saved on this device and backed up to your account, so it works offline and follows you to other devices.
            </Text>
          </View>
          <ExportButton />
        </Card>
      </Section>

      <Text variant="caption" color="textTertiary" align="center" style={{ marginTop: t.spacing.xxl }}>
        ShiftMate {Constants.expoConfig?.version ?? ''} · Your Work. Your Time. Your Earnings.
      </Text>
    </Screen>
  );
}

function TargetEditor({ initialSeconds }: { initialSeconds: number | null }) {
  const t = useTheme();
  const [draft, setDraft] = useState(initialSeconds ? formatDuration(initialSeconds) : '');
  const save = useMutation((d, secs: number | null) => saveAllJobsTarget(d, secs));
  return (
    <Card style={{ gap: t.spacing.md }}>
      <TextField label="Weekly target (all jobs)" value={draft} onChangeText={setDraft} placeholder="e.g. 30h" hint="Leave blank for no target" />
      {save.error && <ErrorBanner message={save.error} />}
      <Button
        label="Save target"
        variant="secondary"
        loading={save.pending}
        onPress={() => {
          const trimmed = draft.trim();
          const secs = trimmed ? parseDurationInput(trimmed) : null;
          if (trimmed && (secs == null || secs <= 0 || secs > 168 * 3600)) return save.setError('Enter hours like "30" or "37h 30m".');
          save.run(secs).catch(() => {});
        }}
      />
    </Card>
  );
}

function CloudSyncStatus({ pending }: { pending: number }) {
  const t = useTheme();
  const db = useDb();
  const user = useAuthStore((s) => s.user);
  const invalidate = useDataStore((s) => s.invalidate);
  const { phase, lastSyncedAt, message } = useSyncStore();

  const status =
    phase === 'syncing'
      ? 'Syncing…'
      : phase === 'offline'
        ? 'Offline — will sync when you reconnect'
        : phase === 'setup'
          ? 'Cloud database not set up'
          : phase === 'auth'
            ? 'Sync not allowed'
            : phase === 'rejected'
              ? 'Some changes failed to upload'
              : pending > 0
                ? `${pending} change(s) waiting to upload`
                : lastSyncedAt
                  ? `Up to date · ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Not synced yet';
  const problem = phase === 'setup' || phase === 'auth' || phase === 'rejected';

  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Icon name={problem ? 'warning' : 'lock'} size={16} color={problem ? t.colors.warning : t.colors.accent} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>{status}</Text>
        <Button
          label="Sync now"
          variant="secondary"
          loading={phase === 'syncing'}
          onPress={() => {
            if (user) syncNow(db, user).then((r) => r && r.pulled + r.deleted > 0 && invalidate());
          }}
        />
      </View>
      {message && phase !== 'ok' && (
        <Text variant="caption" color="textSecondary">{message}</Text>
      )}
    </View>
  );
}

function ExportButton() {
  const db = useDb();
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await collectAccountData(db, {
        name: (user?.user_metadata?.full_name as string | undefined) ?? null,
        email: user?.email ?? null,
      });
      await savePdf(renderAccountExportHtml(data), `ShiftMate data ${new Date().toISOString().slice(0, 10)}`);
    } catch (e) {
      console.error(e);
      setError("Couldn't create the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      {error && <ErrorBanner message={error} />}
      <Button label="Download all my data (PDF)" variant="secondary" fullWidth loading={busy} onPress={download} />
      <Text variant="caption" color="textTertiary" align="center">
        {Platform.OS === 'web' ? 'Choose "Save as PDF" in the print window.' : 'Save it to Files or share it.'}
      </Text>
    </View>
  );
}
