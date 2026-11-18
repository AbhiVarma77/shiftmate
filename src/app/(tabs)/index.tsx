import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ActiveShiftCard } from '@/components/shift/ActiveShiftCard';
import { ShiftRow } from '@/components/shift/ShiftRow';
import { Button } from '@/components/ui/Button';
import { ChipRow, ProgressBar, Stat } from '@/components/ui/Controls';
import { Card, EmptyState, ErrorBanner, IconButton, JobDot, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useActiveShifts, useJobs, useLive, useMutation, useNow } from '@/hooks/data';
import { listPayRates } from '@/repositories/jobsRepository';
import { listShifts } from '@/repositories/shiftsRepository';
import { rateForDate } from '@/services/calculations/shifts';
import { loadReport } from '@/services/reportService';
import { startShift } from '@/services/shiftService';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCurrencyTotals, formatDate, greeting } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { addDays, deviceTimezone, formatDuration, startOfWeek, toLocalDate } from '@/utils/time';

const ALL = '__all__';

export default function HomeScreen() {
  const t = useTheme();
  const settings = useSettingsStore((s) => s.settings);
  const jobs = useJobs();
  const active = useActiveShifts();
  const [filter, setFilter] = useState<string>(ALL);
  const jobId = filter === ALL ? undefined : filter;
  const jobsById = useMemo(() => new Map((jobs.data ?? []).map((j) => [j.id, j])), [jobs.data]);

  // Refresh aggregate cards each minute while a shift runs; the timer itself ticks every second.
  const minute = useNow(60_000, !!active.data?.length);
  const today = toLocalDate(minute, deviceTimezone());
  const weekStart = startOfWeek(today, settings.weekStartsOn);

  const todayReport = useLive((db) => loadReport(db, { from: today, to: today, jobId, weekStartsOn: settings.weekStartsOn }), [today, jobId, minute]);
  const weekReport = useLive((db) => loadReport(db, { from: weekStart, to: addDays(weekStart, 6), jobId, weekStartsOn: settings.weekStartsOn }), [weekStart, jobId, minute]);
  const recent = useLive((db) => listShifts(db, { jobId, limit: 5 }), [jobId]);
  const target = useLive(
    (db) => db.getFirstAsync<{ target_seconds: number }>("SELECT target_seconds FROM weekly_targets WHERE deleted_at IS NULL AND IFNULL(job_id,'__all__') = ?", [jobId ?? '__all__']),
    [jobId],
  );
  const activeRates = useLive(async (db) => {
    const out: Record<string, string | null> = {};
    for (const a of active.data ?? []) {
      out[a.shift.id] = a.shift.jobId ? (rateForDate(await listPayRates(db, a.shift.jobId), a.shift.shiftDate)?.hourlyRate ?? null) : null;
    }
    return out;
  }, [active.data]);

  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const start = useMutation((db, id: string) => startShift(db, { jobId: id }, { allowConcurrentShifts: settings.allowConcurrentShifts }));

  const activeJobs = jobs.data ?? [];
  const startJobId = selectedJob ?? (jobId && jobsById.has(jobId) ? jobId : activeJobs[0]?.id);
  const visibleActive = (active.data ?? []).filter((a) => !jobId || a.shift.jobId === jobId);
  const week = weekReport.data?.summary;
  const day = todayReport.data?.summary;
  const previous = (recent.data ?? [])[0];

  if (jobs.data && activeJobs.length === 0 && !active.data?.length) {
    return (
      <Screen subtitle={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })} title={greeting()}>
        <Card>
          <EmptyState
            icon="briefcase"
            title="Add your first job"
            message="ShiftMate tracks hours and earnings per employer. Add a job to start your first shift."
            action={<Button label="Add a job" icon="add" onPress={() => router.push('/jobs/form')} testID="add-first-job" />}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      subtitle={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
      title={greeting()}
      right={<IconButton icon="add" label="Log a shift manually" tone="accent" onPress={() => router.push('/shifts/new')} />}
      back={false}>
      <ChipRow
        value={filter}
        onChange={setFilter}
        options={[{ value: ALL, label: 'All Jobs' }, ...activeJobs.map((j) => ({ value: j.id, label: j.companyName, color: j.color }))]}
      />

      <View style={{ marginTop: t.spacing.lg, gap: t.spacing.md }}>
        {visibleActive.map((a) => (
          <ActiveShiftCard key={a.shift.id} active={a} job={a.shift.jobId ? jobsById.get(a.shift.jobId) : undefined} rate={activeRates.data?.[a.shift.id] ?? null} />
        ))}

        {(visibleActive.length === 0 || settings.allowConcurrentShifts) && startJobId && (
          <Card style={{ gap: t.spacing.lg }}>
            <View style={{ gap: t.spacing.xs }}>
              <Text variant="overline" color="textSecondary">Ready to start</Text>
              <Text variant="title" numeric>00:00:00</Text>
            </View>
            {activeJobs.length > 1 && (
              <ChipRow
                value={startJobId}
                onChange={setSelectedJob}
                options={activeJobs.map((j) => ({ value: j.id, label: j.companyName, color: j.color }))}
              />
            )}
            {(() => {
              const j = jobsById.get(startJobId);
              if (!j) return null;
              const sched = j.defaultStartTime && j.defaultEndTime ? `  ·  ${j.defaultStartTime}–${j.defaultEndTime}` : '';
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                  <JobDot color={j.color} />
                  <Text variant="label" color="textSecondary" style={{ flex: 1 }}>
                    {j.jobTitle ? `${j.jobTitle} · ` : ''}
                    {j.companyName}
                    {sched}
                  </Text>
                </View>
              );
            })()}
            {start.error && <ErrorBanner message={start.error} />}
            <Button label="Start shift" icon="play" size="lg" fullWidth onPress={() => start.run(startJobId).catch(() => {})} loading={start.pending} testID="start-shift" />
          </Card>
        )}
      </View>

      <Section title="Today">
        <Card style={{ flexDirection: 'row', gap: t.spacing.lg }}>
          <Stat label="Hours" value={formatDuration(day?.netSeconds ?? 0)} sub={`${day?.shiftCount ?? 0} shift${day?.shiftCount === 1 ? '' : 's'}`} />
          <Stat label="Earnings (gross est.)" value={formatCurrencyTotals(day?.earnings ?? {}, settings.defaultCurrency)} sub={day?.overtimeSeconds ? `${formatDuration(day.overtimeSeconds)} overtime` : undefined} />
        </Card>
      </Section>

      <Section title="This week" action={<Text variant="caption" color="textTertiary">{formatDate(weekStart)} – {formatDate(addDays(weekStart, 6))}</Text>}>
        <Card style={{ gap: t.spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
            <Stat label="Hours" value={formatDuration(week?.netSeconds ?? 0)} />
            <Stat label="Earnings (gross est.)" value={formatCurrencyTotals(week?.earnings ?? {}, settings.defaultCurrency)} />
          </View>
          {target.data?.target_seconds ? (
            <View style={{ gap: t.spacing.xs }}>
              <ProgressBar progress={(week?.netSeconds ?? 0) / target.data.target_seconds} label="Weekly target progress" />
              <Text variant="caption" color="textSecondary" numeric>
                {formatDuration(week?.netSeconds ?? 0)} of {formatDuration(target.data.target_seconds)} target
              </Text>
            </View>
          ) : null}
          {!jobId && (week?.byJob.length ?? 0) > 1 && (
            <View style={{ gap: t.spacing.sm }}>
              {week!.byJob.map((b) => {
                const j = b.jobId ? jobsById.get(b.jobId) : undefined;
                return (
                  <View key={b.jobId ?? 'none'} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                    <JobDot color={j?.color ?? t.colors.textTertiary} size={8} />
                    <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{j?.companyName ?? 'Unassigned'}</Text>
                    <Text variant="label" color="textSecondary" numeric>{formatDuration(b.netSeconds)}</Text>
                    <Text variant="label" numeric style={{ minWidth: 72, textAlign: 'right' }}>{formatCurrencyTotals(b.earnings)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </Section>

      {previous && (
        <Section title="Recent shifts" action={<Button label="See all" variant="ghost" onPress={() => router.push('/history')} haptic={false} />}>
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            {(recent.data ?? []).map((s, i, arr) => (
              <ShiftRow key={s.id} shift={s} job={s.jobId ? jobsById.get(s.jobId) : undefined} showDate last={i === arr.length - 1} />
            ))}
          </Card>
          {previous.estimatedGrossPay && previous.currency && (
            <Text variant="caption" color="textTertiary">
              Last shift: {formatDuration(previous.netWorkSeconds)} · {formatMoney(previous.estimatedGrossPay, previous.currency)} gross estimate
            </Text>
          )}
        </Section>
      )}

      {(todayReport.error || weekReport.error) && <ErrorBanner message="Couldn't load your totals. Pull to retry." />}
    </Screen>
  );
}
