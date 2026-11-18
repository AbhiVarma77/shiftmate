import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Segmented, TextField } from '@/components/ui/Controls';
import { Card, ErrorBanner, IconButton, Loading, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useJobs, useLive, useMutation } from '@/hooks/data';
import { getJob, listOvertimeRules, listPayRates } from '@/repositories/jobsRepository';
import { createJob, updateJobDetails } from '@/services/jobService';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { JOB_COLORS } from '@/theme/tokens';
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '@/types/domain';
import { DomainError } from '@/services/errors';
import { normalizeTimeInput } from '@/utils/time';

const TYPES = Object.entries(EMPLOYMENT_TYPE_LABELS) as [EmploymentType, string][];

/** Add Job (no id) or Edit Job (?id=). Pay-rate changes on edit go through Salary to preserve history. */
interface FormState {
  companyName: string;
  jobTitle: string;
  workplaceAddress: string;
  employmentType: EmploymentType;
  currency: string;
  hourlyRate: string;
  color: string;
  defaultStartTime: string;
  defaultEndTime: string;
  paidBreak: string;
  unpaidBreak: string;
  overtimeOn: boolean;
  dailyOt: string;
  weeklyOt: string;
  multiplier: string;
  notes: string;
}

/** Loads what the form needs, then mounts it with initial values (no effect-driven prefill). */
export default function JobForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const defaultCurrency = useSettingsStore((s) => s.settings.defaultCurrency);
  const existingJobs = useJobs(true);
  const existing = useLive(async (db) => {
    if (!id) return null;
    const [job, rates, rules] = await Promise.all([getJob(db, id), listPayRates(db, id), listOvertimeRules(db, id)]);
    return job ? { job, rate: rates[0], rule: rules.find((r) => r.effectiveUntil == null) } : null;
  }, [id]);

  if (existingJobs.loading || existing.loading) return <Loading />;
  const e = existing.data;
  const used = new Set((existingJobs.data ?? []).map((j) => j.color));
  const initial: FormState = {
    companyName: e?.job.companyName ?? '',
    jobTitle: e?.job.jobTitle ?? '',
    workplaceAddress: e?.job.workplaceAddress ?? '',
    employmentType: e?.job.employmentType ?? 'part_time',
    currency: e?.job.currency ?? defaultCurrency,
    hourlyRate: e?.rate?.hourlyRate ?? '',
    color: e?.job.color ?? JOB_COLORS.find((c) => !used.has(c)) ?? JOB_COLORS[used.size % JOB_COLORS.length],
    defaultStartTime: e?.job.defaultStartTime ?? '',
    defaultEndTime: e?.job.defaultEndTime ?? '',
    paidBreak: String(Math.round((e?.job.defaultPaidBreakSeconds ?? 0) / 60)),
    unpaidBreak: String(Math.round((e?.job.defaultUnpaidBreakSeconds ?? 0) / 60)),
    overtimeOn: false,
    dailyOt: '8',
    weeklyOt: '40',
    multiplier: '1.5',
    notes: e?.job.notes ?? '',
  };
  return <JobFormBody id={id} initial={initial} currentRate={e?.rate?.hourlyRate ?? null} />;
}

function JobFormBody({ id, initial, currentRate }: { id?: string; initial: FormState; currentRate: string | null }) {
  const t = useTheme();
  const editing = !!id;
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation(async (db) => {
    const start = f.defaultStartTime.trim() ? normalizeTimeInput(f.defaultStartTime) : null;
    const end = f.defaultEndTime.trim() ? normalizeTimeInput(f.defaultEndTime) : null;
    if ((f.defaultStartTime.trim() && !start) || (f.defaultEndTime.trim() && !end)) {
      throw new DomainError('INVALID_TIME', 'Enter default times like 09:00, 9:30 or 5pm.');
    }
    const common = {
      companyName: f.companyName,
      jobTitle: f.jobTitle,
      workplaceAddress: f.workplaceAddress.trim() || null,
      employmentType: f.employmentType,
      color: f.color,
      defaultStartTime: start,
      defaultEndTime: end,
      notes: f.notes.trim() || null,
    };
    if (editing && id) {
      return updateJobDetails(db, id, {
        ...common,
        defaultPaidBreakSeconds: (Number(f.paidBreak) || 0) * 60,
        defaultUnpaidBreakSeconds: (Number(f.unpaidBreak) || 0) * 60,
      });
    }
    return createJob(db, {
      ...common,
      currency: f.currency,
      hourlyRate: f.hourlyRate.replace(',', '.'),
      defaultPaidBreakMinutes: Number(f.paidBreak) || 0,
      defaultUnpaidBreakMinutes: Number(f.unpaidBreak) || 0,
      overtime: f.overtimeOn
        ? {
            dailyThresholdHours: f.dailyOt ? Number(f.dailyOt) : null,
            weeklyThresholdHours: f.weeklyOt ? Number(f.weeklyOt) : null,
            multiplier: f.multiplier.replace(',', '.'),
          }
        : null,
    });
  });

  const submit = async () => {
    try {
      const job = await save.run();
      if (job) router.back();
    } catch {
      /* shown via save.error */
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title={editing ? 'Edit job' : 'Add a job'} right={<IconButton icon="close" label="Close" onPress={() => router.back()} />}>
        <View style={{ gap: t.spacing.lg }}>
          <TextField label="Company name" value={f.companyName} onChangeText={(v) => set('companyName', v)} placeholder="e.g. Northwind Café" autoFocus={!editing} testID="job-company" />
          <TextField label="Job title" value={f.jobTitle} onChangeText={(v) => set('jobTitle', v)} placeholder="e.g. Barista" />
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="label" color="textSecondary">Colour</Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' }}>
              {JOB_COLORS.map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: f.color === c }}
                  accessibilityLabel={`Colour ${c}`}
                  onPress={() => set('color', c)}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, borderWidth: 3, borderColor: f.color === c ? t.colors.text : 'transparent' }}
                />
              ))}
            </View>
          </View>
        </View>

        <Section title="Pay">
          {editing ? (
            <Card style={{ gap: t.spacing.sm }}>
              <Text variant="bodyStrong" numeric>{currentRate ? `${currentRate} ${f.currency} / hour` : 'No rate set'}</Text>
              <Text variant="caption" color="textSecondary">
                To change the rate, use Salary on the job page — rate history is kept so past shifts stay correct.
              </Text>
            </Card>
          ) : (
            <View style={{ gap: t.spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <View style={{ flex: 2 }}>
                  <TextField label="Hourly rate" value={f.hourlyRate} onChangeText={(v) => set('hourlyRate', v)} keyboardType="decimal-pad" placeholder="12.50" testID="job-rate" />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField label="Currency" value={f.currency} onChangeText={(v) => set('currency', v.toUpperCase())} autoCapitalize="characters" maxLength={3} />
                </View>
              </View>
              <Segmented
                label="Overtime"
                value={f.overtimeOn ? 'on' : 'off'}
                onChange={(v) => set('overtimeOn', v === 'on')}
                options={[{ value: 'off', label: 'No overtime' }, { value: 'on', label: 'Overtime rules' }]}
              />
              {f.overtimeOn && (
                <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                  <View style={{ flex: 1 }}><TextField label="After h/day" value={f.dailyOt} onChangeText={(v) => set('dailyOt', v)} keyboardType="decimal-pad" hint="Blank = none" /></View>
                  <View style={{ flex: 1 }}><TextField label="After h/week" value={f.weeklyOt} onChangeText={(v) => set('weeklyOt', v)} keyboardType="decimal-pad" hint="Blank = none" /></View>
                  <View style={{ flex: 1 }}><TextField label="Multiplier" value={f.multiplier} onChangeText={(v) => set('multiplier', v)} keyboardType="decimal-pad" /></View>
                </View>
              )}
            </View>
          )}
        </Section>

        <Section title="Employment">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {TYPES.map(([value, label]) => {
              const sel = f.employmentType === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  onPress={() => set('employmentType', value)}
                  style={{ paddingHorizontal: t.spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.colors.accent : t.colors.border, backgroundColor: sel ? t.colors.accentMuted : t.colors.card }}>
                  <Text variant="label" color={sel ? 'accent' : 'textSecondary'}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextField label="Workplace address" value={f.workplaceAddress} onChangeText={(v) => set('workplaceAddress', v)} placeholder="Optional" />
        </Section>

        <Section title="Default shift">
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}><TextField label="Start" value={f.defaultStartTime} onChangeText={(v) => set('defaultStartTime', v)} onBlur={() => set('defaultStartTime', normalizeTimeInput(f.defaultStartTime) ?? f.defaultStartTime)} error={f.defaultStartTime.trim() && !normalizeTimeInput(f.defaultStartTime) ? 'Try 09:00 or 9am' : null} placeholder="09:00" testID="job-start" keyboardType="numbers-and-punctuation" maxLength={5} /></View>
            <View style={{ flex: 1 }}><TextField label="End" value={f.defaultEndTime} onChangeText={(v) => set('defaultEndTime', v)} onBlur={() => set('defaultEndTime', normalizeTimeInput(f.defaultEndTime) ?? f.defaultEndTime)} error={f.defaultEndTime.trim() && !normalizeTimeInput(f.defaultEndTime) ? 'Try 17:00 or 5pm' : null} placeholder="17:00" testID="job-end" keyboardType="numbers-and-punctuation" maxLength={5} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}><TextField label="Paid break (min)" value={f.paidBreak} onChangeText={(v) => set('paidBreak', v.replace(/\D/g, ''))} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><TextField label="Unpaid break (min)" value={f.unpaidBreak} onChangeText={(v) => set('unpaidBreak', v.replace(/\D/g, ''))} keyboardType="number-pad" /></View>
          </View>
        </Section>

        <Section title="Notes">
          <TextField label="Notes" value={f.notes} onChangeText={(v) => set('notes', v)} multiline style={{ minHeight: 88, textAlignVertical: 'top' }} placeholder="Optional" />
        </Section>

        <View style={{ marginTop: t.spacing.xxl, gap: t.spacing.md }}>
          {save.error && <ErrorBanner message={save.error} />}
          <Button label={editing ? 'Save changes' : 'Add job'} size="lg" fullWidth onPress={submit} loading={save.pending} testID="job-save" />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
