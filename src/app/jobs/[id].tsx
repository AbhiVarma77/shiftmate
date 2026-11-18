import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ShiftRow } from '@/components/shift/ShiftRow';
import { Button } from '@/components/ui/Button';
import { Stat, TextField } from '@/components/ui/Controls';
import { Card, ErrorBanner, IconButton, JobDot, ListRow, Loading, Screen, Section } from '@/components/ui/Layout';
import { choose, confirm } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { useLive, useMutation, useToday } from '@/hooks/data';
import { getJob, listOvertimeRules, listPayRates } from '@/repositories/jobsRepository';
import { listShifts } from '@/repositories/shiftsRepository';
import { changePayRate, setJobActive } from '@/services/jobService';
import { loadReport } from '@/services/reportService';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { EMPLOYMENT_TYPE_LABELS } from '@/types/domain';
import { formatCurrencyTotals, formatDate } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { endOfMonth, formatDuration, startOfMonth } from '@/utils/time';

export default function JobDetails() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const weekStartsOn = useSettingsStore((s) => s.settings.weekStartsOn);
  const today = useToday();
  const data = useLive(async (db) => {
    const job = await getJob(db, id);
    if (!job) return null;
    const [rates, rules, recent, month] = await Promise.all([
      listPayRates(db, id),
      listOvertimeRules(db, id),
      listShifts(db, { jobId: id, limit: 5 }),
      loadReport(db, { from: startOfMonth(today), to: endOfMonth(today), jobId: id, weekStartsOn }),
    ]);
    return { job, rates, rules, recent, month: month.summary };
  }, [id, today, weekStartsOn]);

  const [rateDraft, setRateDraft] = useState<{ rate: string; from: string } | null>(null);
  const rateChange = useMutation((db, rate: string, from: string, reprice: boolean) => changePayRate(db, id, rate.replace(',', '.'), from, { repriceExisting: reprice }));
  const toggleActive = useMutation((db, active: boolean) => setJobActive(db, id, active));

  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <Screen back title="Job not found"><Text color="textSecondary">This job may have been removed.</Text></Screen>;
  const { job, rates, rules, recent, month } = data.data;
  const rule = rules.find((r) => r.effectiveUntil == null);

  const submitRate = async () => {
    if (!rateDraft) return;
    let reprice = false;
    if (rateDraft.from < today) {
      const choice = await choose({
        title: 'Back-dated rate',
        message: `You already have shifts since ${formatDate(rateDraft.from)}. What should happen to their pay?`,
        options: [
          { value: 'keep', label: 'Keep existing pay', description: 'Only new shifts use the new rate' },
          { value: 'reprice', label: 'Re-price them', description: 'Apply the new rate from that date' },
        ],
      });
      if (!choice) return;
      reprice = choice === 'reprice';
    }
    rateChange.run(rateDraft.rate, rateDraft.from, reprice).then(() => setRateDraft(null), () => {});
  };

  return (
    <Screen
      back
      subtitle={[job.jobTitle, EMPLOYMENT_TYPE_LABELS[job.employmentType]].filter(Boolean).join(' · ')}
      title={job.companyName}
      right={<IconButton icon="edit" label="Edit job" onPress={() => router.push({ pathname: '/jobs/form', params: { id } })} />}>
      {!job.isActive && (
        <Card style={{ backgroundColor: t.colors.warningMuted, borderColor: 'transparent' }}>
          <Text variant="label" color="warning">Archived. History is kept and still appears in reports.</Text>
        </Card>
      )}

      <Section title="This month">
        <Card style={{ flexDirection: 'row', gap: t.spacing.lg }}>
          <Stat label="Hours" value={formatDuration(month.netSeconds)} sub={`${month.shiftCount} shifts`} />
          <Stat label="Gross estimate" value={formatCurrencyTotals(month.earnings, job.currency)} sub={month.overtimeSeconds ? `${formatDuration(month.overtimeSeconds)} OT` : undefined} />
        </Card>
      </Section>

      <Section title="Salary" action={!rateDraft ? <Button label="Change rate" variant="ghost" onPress={() => setRateDraft({ rate: rates[0]?.hourlyRate ?? '', from: today })} haptic={false} /> : undefined}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          {rates.map((r, i) => (
            <ListRow
              key={r.id}
              title={formatMoney(r.hourlyRate, r.currency) + ' / hour'}
              subtitle={r.effectiveFrom === '1900-01-01' ? (r.effectiveUntil ? `Until ${formatDate(r.effectiveUntil)}` : 'Since the start') : `From ${formatDate(r.effectiveFrom, { day: 'numeric', month: 'short', year: 'numeric' })}${r.effectiveUntil ? ` to ${formatDate(r.effectiveUntil, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`}
              value={i === 0 ? 'Current' : undefined}
              last={i === rates.length - 1}
            />
          ))}
        </Card>
        {rateDraft && (
          <Card style={{ gap: t.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ flex: 1 }}><TextField label={`New rate (${job.currency})`} value={rateDraft.rate} onChangeText={(v) => setRateDraft({ ...rateDraft, rate: v })} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><TextField label="Effective from" value={rateDraft.from} onChangeText={(v) => setRateDraft({ ...rateDraft, from: v })} placeholder="YYYY-MM-DD" maxLength={10} /></View>
            </View>
            {rateChange.error && <ErrorBanner message={rateChange.error} />}
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button label="Cancel" variant="secondary" onPress={() => setRateDraft(null)} style={{ flex: 1 }} />
              <Button label="Save rate" onPress={submitRate} loading={rateChange.pending} style={{ flex: 1 }} />
            </View>
          </Card>
        )}
        <Text variant="caption" color="textTertiary">
          {rule
            ? `Overtime ×${rule.multiplier}${rule.dailyThresholdSeconds ? ` after ${formatDuration(rule.dailyThresholdSeconds)}/day` : ''}${rule.weeklyThresholdSeconds ? ` after ${formatDuration(rule.weeklyThresholdSeconds)}/week` : ''}.`
            : 'No overtime rules.'}{' '}
          Earnings are gross estimates before tax and deductions.
        </Text>
      </Section>

      <Section title="Recent shifts">
        {recent.length ? (
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            {recent.map((s, i) => <ShiftRow key={s.id} shift={s} job={job} showDate last={i === recent.length - 1} />)}
          </Card>
        ) : (
          <Text variant="body" color="textSecondary">No shifts logged for this job yet.</Text>
        )}
      </Section>

      <Section title="Details">
        <Card style={{ gap: t.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <JobDot color={job.color} />
            <Text variant="body">{job.currency} · {EMPLOYMENT_TYPE_LABELS[job.employmentType]}</Text>
          </View>
          {job.defaultStartTime && <Text variant="body" color="textSecondary">Usual hours {job.defaultStartTime}–{job.defaultEndTime ?? '?'}</Text>}
          {job.workplaceAddress && <Text variant="body" color="textSecondary">{job.workplaceAddress}</Text>}
          {job.notes && <Text variant="body" color="textSecondary">{job.notes}</Text>}
        </Card>
      </Section>

      <View style={{ marginTop: t.spacing.xxl }}>
        {toggleActive.error && <ErrorBanner message={toggleActive.error} />}
        <Button
          label={job.isActive ? 'Archive job' : 'Reactivate job'}
          icon="archive"
          variant={job.isActive ? 'danger' : 'secondary'}
          fullWidth
          loading={toggleActive.pending}
          onPress={async () => {
            if (!job.isActive) return toggleActive.run(true).catch(() => {});
            const ok = await confirm({ title: 'Archive job?', message: 'It will be hidden from pickers. All shifts and reports are kept.', confirmLabel: 'Archive', destructive: true });
            if (ok) toggleActive.run(false).catch(() => {});
          }}
        />
      </View>
    </Screen>
  );
}
