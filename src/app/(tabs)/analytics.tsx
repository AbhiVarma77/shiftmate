import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BarChart } from '@/components/charts/BarChart';
import { ShiftRow } from '@/components/shift/ShiftRow';
import { ChipRow, ProgressBar, Segmented, Stat } from '@/components/ui/Controls';
import { Card, ErrorBanner, IconButton, JobDot, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useJobs, useLive, useToday } from '@/hooks/data';
import { loadReport } from '@/services/reportService';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { LocalDate } from '@/types/domain';
import { formatClock, formatCurrencyTotals, formatDate } from '@/utils/format';
import { type Period, periodRange, shiftAnchor } from '@/utils/periods';
import { addDays, daysInRange, formatDuration, startOfWeek } from '@/utils/time';

const ALL = '__all__';

export default function Analytics() {
  const t = useTheme();
  const weekStartsOn = useSettingsStore((s) => s.settings.weekStartsOn);
  const currency = useSettingsStore((s) => s.settings.defaultCurrency);
  const jobs = useJobs(true);
  const today = useToday();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);
  const [filter, setFilter] = useState(ALL);
  const jobId = filter === ALL ? undefined : filter;
  const { from, to } = periodRange(period, anchor, weekStartsOn);
  const report = useLive((db) => loadReport(db, { from, to, jobId, weekStartsOn }), [from, to, jobId, weekStartsOn]);
  const target = useLive(
    (db) => db.getFirstAsync<{ target_seconds: number }>("SELECT target_seconds FROM weekly_targets WHERE deleted_at IS NULL AND IFNULL(job_id,'__all__') = ?", [jobId ?? ALL]),
    [jobId],
  );
  const jobsById = useMemo(() => new Map((jobs.data ?? []).map((j) => [j.id, j])), [jobs.data]);
  const s = report.data?.summary;
  const inProgress = to >= today && from <= today;
  const isFuture = from > today;

  const title =
    period === 'day'
      ? formatDate(from, { weekday: 'long', day: 'numeric', month: 'long' })
      : period === 'week'
        ? `${formatDate(from, { day: 'numeric', month: 'short' })} – ${formatDate(to, { day: 'numeric', month: 'short' })}`
        : formatDate(from, { month: 'long', year: 'numeric' });

  const bars = useMemo(() => {
    if (!s || period === 'day') return [];
    if (period === 'week') {
      return daysInRange(from, to).map((d) => ({
        key: d,
        label: formatDate(d, { weekday: 'narrow' }),
        value: s.byDay[d]?.netSeconds ?? 0,
        detail: `${formatDuration(s.byDay[d]?.netSeconds ?? 0)} · ${formatCurrencyTotals(s.byDay[d]?.earnings ?? {}, currency)}`,
        muted: d > today,
      }));
    }
    return daysInRange(from, to).map((d) => ({
      key: d,
      label: String(Number(d.slice(8))),
      value: s.byDay[d]?.netSeconds ?? 0,
      detail: `${formatDuration(s.byDay[d]?.netSeconds ?? 0)}`,
      muted: d > today,
    }));
  }, [s, period, from, to, today, currency]);

  const weeklyBreakdown = useMemo(() => {
    if (!s || period !== 'month') return [];
    const weeks: { start: LocalDate; seconds: number }[] = [];
    for (let w = startOfWeek(from, weekStartsOn); w <= to; w = addDays(w, 7)) {
      const secs = daysInRange(w < from ? from : w, addDays(w, 6) > to ? to : addDays(w, 6)).reduce((a, d) => a + (s.byDay[d]?.netSeconds ?? 0), 0);
      weeks.push({ start: w, seconds: secs });
    }
    return weeks;
  }, [s, period, from, to, weekStartsOn]);

  return (
    <Screen title="Analytics" back={false}>
      <View style={{ gap: t.spacing.md }}>
        <Segmented label="Reporting period" value={period} onChange={(p) => { setPeriod(p); setAnchor(today); }} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <ChipRow value={filter} onChange={setFilter} options={[{ value: ALL, label: 'All Jobs' }, ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.companyName, color: j.color }))]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="back" label="Previous period" onPress={() => setAnchor(shiftAnchor(period, anchor, -1))} />
          <View style={{ alignItems: 'center' }}>
            <Text variant="heading">{title}</Text>
            <Text variant="caption" color={inProgress ? 'accent' : 'textTertiary'}>{isFuture ? 'Upcoming' : inProgress ? 'In progress' : 'Completed period'}</Text>
          </View>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconButton icon="back" label="Next period" onPress={() => setAnchor(shiftAnchor(period, anchor, 1))} />
          </View>
        </View>
      </View>

      {report.error && <ErrorBanner message="Couldn't build this report." />}

      {s && (
        <>
          <Card style={{ marginTop: t.spacing.lg, gap: t.spacing.lg }}>
            <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
              <Stat label="Hours worked" value={formatDuration(s.netSeconds)} sub={`${s.shiftCount} shift${s.shiftCount === 1 ? '' : 's'}`} />
              <Stat label="Gross estimate" value={formatCurrencyTotals(s.earnings, currency)} sub={s.overtimeSeconds ? `incl. ${formatDuration(s.overtimeSeconds)} overtime` : 'No overtime'} />
            </View>
            {period === 'week' && target.data?.target_seconds ? (
              <View style={{ gap: t.spacing.xs }}>
                <ProgressBar progress={s.netSeconds / target.data.target_seconds} label="Weekly target" />
                <Text variant="caption" color="textSecondary" numeric>
                  {Math.round((s.netSeconds / target.data.target_seconds) * 100)}% of {formatDuration(target.data.target_seconds)} target
                </Text>
              </View>
            ) : null}
            {bars.length > 0 && <BarChart bars={bars} />}
          </Card>

          <Section title="Breakdown">
            <Card style={{ gap: t.spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
                {period === 'day' ? (
                  <>
                    <Stat label="Started" value={s.earliestStart ? formatClock(s.earliestStart) : '—'} />
                    <Stat label="Finished" value={s.latestEnd ? formatClock(s.latestEnd) : '—'} />
                  </>
                ) : (
                  <>
                    <Stat label="Average shift" value={formatDuration(s.averageShiftSeconds)} />
                    <Stat label={period === 'month' ? 'Avg per day' : 'Working days'} value={period === 'month' ? formatDuration(s.averagePerDaySeconds) : String(s.workingDays)} />
                  </>
                )}
              </View>
              {period !== 'day' && (
                <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
                  <Stat label="Longest" value={formatDuration(s.longestShiftSeconds)} />
                  <Stat label="Shortest" value={formatDuration(s.shortestShiftSeconds)} />
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
                <Stat label="Paid breaks" value={formatDuration(s.paidBreakSeconds)} />
                <Stat label="Unpaid breaks" value={formatDuration(s.unpaidBreakSeconds)} />
              </View>
              {period === 'month' && <Stat label="Working days" value={String(s.workingDays)} />}
            </Card>
            {!jobId && s.uniqueTimedSeconds + s.durationOnlySeconds < s.netSeconds && (
              <Text variant="caption" color="textTertiary">
                Some shifts at different jobs overlapped. Sum of employer hours is {formatDuration(s.netSeconds)}; unique time actually worked was{' '}
                {formatDuration(s.uniqueTimedSeconds + s.durationOnlySeconds)}.
              </Text>
            )}
            {s.unpricedShifts > 0 && (
              <Text variant="caption" color="textTertiary">{s.unpricedShifts} shift(s) have no pay rate or job and are excluded from earnings.</Text>
            )}
            {s.hasActive && <Text variant="caption" color="accent">Includes a shift still in progress.</Text>}
          </Section>

          {period === 'month' && weeklyBreakdown.length > 0 && (
            <Section title="By week">
              <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
                {weeklyBreakdown.map((w, i) => (
                  <View key={w.start} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: t.spacing.md, borderBottomWidth: i === weeklyBreakdown.length - 1 ? 0 : 0.5, borderBottomColor: t.colors.border }}>
                    <Text variant="body">Week of {formatDate(w.start, { day: 'numeric', month: 'short' })}</Text>
                    <Text variant="bodyStrong" numeric>{formatDuration(w.seconds)}</Text>
                  </View>
                ))}
              </Card>
            </Section>
          )}

          {!jobId && s.byJob.length > 0 && (
            <Section title="By job">
              <Card style={{ gap: t.spacing.md }}>
                {s.byJob.map((b) => {
                  const j = b.jobId ? jobsById.get(b.jobId) : undefined;
                  return (
                    <View key={b.jobId ?? 'none'} style={{ gap: t.spacing.xs }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                        <JobDot color={j?.color ?? t.colors.textTertiary} />
                        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{j?.companyName ?? 'Unassigned'}</Text>
                        <Text variant="label" color="textSecondary" numeric>{formatDuration(b.netSeconds)}</Text>
                        <Text variant="bodyStrong" numeric>{formatCurrencyTotals(b.earnings, j?.currency)}</Text>
                      </View>
                      <ProgressBar progress={s.netSeconds ? b.netSeconds / s.netSeconds : 0} color={j?.color} label={`${j?.companyName ?? 'Unassigned'} share`} />
                    </View>
                  );
                })}
              </Card>
            </Section>
          )}

          {period === 'day' && (report.data?.shifts.length ?? 0) > 0 && (
            <Section title="Shifts">
              <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
                {report.data!.shifts.map((sh, i, arr) => <ShiftRow key={sh.id} shift={sh} job={sh.jobId ? jobsById.get(sh.jobId) : undefined} last={i === arr.length - 1} />)}
              </Card>
            </Section>
          )}

          {s.shiftCount === 0 && (
            <Text variant="body" color="textSecondary" align="center" style={{ marginTop: t.spacing.xxl }}>
              No shifts in this period.
            </Text>
          )}
          <Text variant="caption" color="textTertiary" style={{ marginTop: t.spacing.xl }}>
            Earnings are gross estimates before tax and deductions. Currencies are shown separately and never combined.
          </Text>
        </>
      )}
    </Screen>
  );
}
