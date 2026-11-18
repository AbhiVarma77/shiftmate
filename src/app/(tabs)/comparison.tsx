import { Big } from 'big.js';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ChipRow, TextField } from '@/components/ui/Controls';
import { Card, ErrorBanner, Screen, Section } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useJobs, useLive, useToday } from '@/hooks/data';
import { listShifts } from '@/repositories/shiftsRepository';
import { delta, type Delta, type PeriodSummary } from '@/services/analytics';
import { loadReport } from '@/services/reportService';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { Shift } from '@/types/domain';
import { formatDate } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { periodRange, shiftAnchor } from '@/utils/periods';
import { formatDuration, isValidLocalDate } from '@/utils/time';

type Mode = 'day' | 'week' | 'month' | 'jobs' | 'shifts' | 'custom';
const ALL = '__all__';

interface Side {
  label: string;
  hours: number;
  shifts: number;
  avg: number;
  overtime: number;
  breaks: number;
  earnings: Record<string, string>;
}

const fromSummary = (label: string, s: PeriodSummary): Side => ({
  label,
  hours: s.netSeconds,
  shifts: s.shiftCount,
  avg: s.averageShiftSeconds,
  overtime: s.overtimeSeconds,
  breaks: s.paidBreakSeconds + s.unpaidBreakSeconds,
  earnings: s.earnings,
});

const fromShift = (label: string, s: Shift | undefined): Side => ({
  label,
  hours: s?.netWorkSeconds ?? 0,
  shifts: s ? 1 : 0,
  avg: s?.netWorkSeconds ?? 0,
  overtime: 0,
  breaks: (s?.paidBreakSeconds ?? 0) + (s?.unpaidBreakSeconds ?? 0),
  earnings: s?.estimatedGrossPay && s.currency ? { [s.currency]: s.estimatedGrossPay } : {},
});

/** Effective hourly earnings for a currency, or null when there are no hours. */
function effectiveRate(side: Side, currency: string): string | null {
  if (!side.hours || !side.earnings[currency]) return null;
  return new Big(side.earnings[currency]).div(side.hours / 3600).toFixed(2);
}

export default function Compare() {
  const t = useTheme();
  const weekStartsOn = useSettingsStore((s) => s.settings.weekStartsOn);
  const jobs = useJobs(true);
  const today = useToday();
  const [mode, setMode] = useState<Mode>('week');
  const [filter, setFilter] = useState(ALL);
  const jobList = jobs.data ?? [];
  const [jobA, setJobA] = useState<string>('');
  const [jobB, setJobB] = useState<string>('');
  const a = jobA || jobList[0]?.id || '';
  const b = jobB || jobList.find((j) => j.id !== a)?.id || '';
  const [custom, setCustom] = useState({ aFrom: shiftAnchor('month', today, -1), aTo: today, bFrom: shiftAnchor('month', today, -2), bTo: shiftAnchor('month', today, -1) });
  const jobId = filter === ALL ? undefined : filter;

  const result = useLive(async (db): Promise<{ left: Side; right: Side } | null> => {
    if (mode === 'day' || mode === 'week' || mode === 'month') {
      const cur = periodRange(mode, today, weekStartsOn);
      const prev = periodRange(mode, shiftAnchor(mode, today, -1), weekStartsOn);
      const [c, p] = await Promise.all([loadReport(db, { ...cur, jobId, weekStartsOn }), loadReport(db, { ...prev, jobId, weekStartsOn })]);
      const names = { day: ['Today', 'Yesterday'], week: ['This week', 'Last week'], month: ['This month', 'Last month'] }[mode];
      return { left: fromSummary(names[0], c.summary), right: fromSummary(names[1], p.summary) };
    }
    if (mode === 'jobs') {
      if (!a || !b) return null;
      const range = periodRange('month', today, weekStartsOn);
      const [ra, rb] = await Promise.all([loadReport(db, { ...range, jobId: a, weekStartsOn }), loadReport(db, { ...range, jobId: b, weekStartsOn })]);
      const name = (id: string) => jobList.find((j) => j.id === id)?.companyName ?? 'Job';
      return { left: fromSummary(name(a), ra.summary), right: fromSummary(name(b), rb.summary) };
    }
    if (mode === 'shifts') {
      const [latest, previous] = await listShifts(db, { jobId, limit: 2 });
      return { left: fromShift(latest ? `Latest (${formatDate(latest.shiftDate)})` : 'Latest', latest), right: fromShift(previous ? `Previous (${formatDate(previous.shiftDate)})` : 'Previous', previous) };
    }
    const valid = [custom.aFrom, custom.aTo, custom.bFrom, custom.bTo].every(isValidLocalDate) && custom.aFrom <= custom.aTo && custom.bFrom <= custom.bTo;
    if (!valid) return null;
    const [ra, rb] = await Promise.all([
      loadReport(db, { from: custom.aFrom, to: custom.aTo, jobId, weekStartsOn }),
      loadReport(db, { from: custom.bFrom, to: custom.bTo, jobId, weekStartsOn }),
    ]);
    return { left: fromSummary('Range A', ra.summary), right: fromSummary('Range B', rb.summary) };
  }, [mode, jobId, a, b, today, weekStartsOn, custom, jobList.length]);

  const currencies = useMemo(() => {
    const r = result.data;
    return r ? [...new Set([...Object.keys(r.left.earnings), ...Object.keys(r.right.earnings)])] : [];
  }, [result.data]);

  const r = result.data;
  const summary = r ? writtenSummary(r.left, r.right, currencies) : null;

  return (
    <Screen title="Compare" back={false}>
      <View style={{ gap: t.spacing.md }}>
        <ChipRow
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Week vs last' },
            { value: 'month', label: 'Month vs last' },
            { value: 'day', label: 'Today vs yesterday' },
            { value: 'shifts', label: 'Last two shifts' },
            { value: 'jobs', label: 'Job vs job' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {mode !== 'jobs' && (
          <ChipRow value={filter} onChange={setFilter} options={[{ value: ALL, label: 'All Jobs' }, ...jobList.map((j) => ({ value: j.id, label: j.companyName, color: j.color }))]} />
        )}
        {mode === 'jobs' && (
          <Card style={{ gap: t.spacing.md }}>
            {jobList.length < 2 ? (
              <Text variant="body" color="textSecondary">Add at least two jobs to compare employers.</Text>
            ) : (
              <>
                <Text variant="label" color="textSecondary">This month · first job</Text>
                <ChipRow value={a} onChange={setJobA} options={jobList.map((j) => ({ value: j.id, label: j.companyName, color: j.color }))} />
                <Text variant="label" color="textSecondary">Compared with</Text>
                <ChipRow value={b} onChange={setJobB} options={jobList.filter((j) => j.id !== a).map((j) => ({ value: j.id, label: j.companyName, color: j.color }))} />
              </>
            )}
          </Card>
        )}
        {mode === 'custom' && (
          <Card style={{ gap: t.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ flex: 1 }}><TextField label="A from" value={custom.aFrom} onChangeText={(v) => setCustom({ ...custom, aFrom: v })} maxLength={10} /></View>
              <View style={{ flex: 1 }}><TextField label="A to" value={custom.aTo} onChangeText={(v) => setCustom({ ...custom, aTo: v })} maxLength={10} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ flex: 1 }}><TextField label="B from" value={custom.bFrom} onChangeText={(v) => setCustom({ ...custom, bFrom: v })} maxLength={10} /></View>
              <View style={{ flex: 1 }}><TextField label="B to" value={custom.bTo} onChangeText={(v) => setCustom({ ...custom, bTo: v })} maxLength={10} /></View>
            </View>
            {!r && <Text variant="caption" color="danger">Enter valid YYYY-MM-DD ranges with start before end.</Text>}
          </Card>
        )}
      </View>

      {result.error && <ErrorBanner message="Couldn't build this comparison." />}

      {r && (
        <>
          <Card style={{ marginTop: t.spacing.lg, flexDirection: 'row' }}>
            {[r.left, r.right].map((side, i) => (
              <View key={i} style={{ flex: 1, gap: 4, alignItems: i ? 'flex-end' : 'flex-start' }}>
                <Text variant="overline" color={i ? 'textSecondary' : 'accent'} numberOfLines={1}>{side.label}</Text>
                <Text variant="stat" numeric>{formatDuration(side.hours)}</Text>
              </View>
            ))}
          </Card>
          {summary && <Text variant="body" color="textSecondary" style={{ marginTop: t.spacing.md }}>{summary}</Text>}

          <Section title="Details">
            <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
              <MetricRow label="Hours worked" d={delta(r.left.hours, r.right.hours)} fmt={(v) => formatDuration(v)} />
              <MetricRow label="Shifts" d={delta(r.left.shifts, r.right.shifts)} fmt={String} />
              <MetricRow label="Average shift" d={delta(r.left.avg, r.right.avg)} fmt={(v) => formatDuration(v)} />
              <MetricRow label="Overtime" d={delta(r.left.overtime, r.right.overtime)} fmt={(v) => formatDuration(v)} />
              <MetricRow label="Breaks" d={delta(r.left.breaks, r.right.breaks)} fmt={(v) => formatDuration(v)} neutral />
              {currencies.map((c) => (
                <MetricRow key={c} label={`Earnings (${c})`} d={delta(Number(r.left.earnings[c] ?? 0), Number(r.right.earnings[c] ?? 0))} fmt={(v) => formatMoney(String(v.toFixed(2)), c)} />
              ))}
              {currencies.map((c) => {
                const la = effectiveRate(r.left, c);
                const rb = effectiveRate(r.right, c);
                return <MetricRow key={`rate-${c}`} label={`Avg hourly (${c})`} d={delta(Number(la ?? 0), Number(rb ?? 0))} fmt={(v) => formatMoney(v.toFixed(2), c)} last />;
              })}
            </Card>
            <Text variant="caption" color="textTertiary">
              {mode === 'jobs' ? 'Both jobs compared for this month. ' : ''}Change shown is left vs right. Earnings are gross estimates, compared per currency.
            </Text>
          </Section>
        </>
      )}
    </Screen>
  );
}

function MetricRow({ label, d, fmt, neutral, last }: { label: string; d: Delta; fmt: (v: number) => string; neutral?: boolean; last?: boolean }) {
  const t = useTheme();
  const up = d.change > 0;
  const tone = d.change === 0 || neutral ? 'textSecondary' : up ? 'success' : 'danger';
  const pct = d.percent == null ? 'New' : `${up ? '+' : ''}${d.percent.toFixed(0)}%`;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${fmt(d.current)} versus ${fmt(d.previous)}, ${d.change === 0 ? 'no change' : pct}`}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.md, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: t.colors.border, gap: t.spacing.sm }}>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      <Text variant="bodyStrong" numeric>{fmt(d.current)}</Text>
      <Text variant="caption" color="textTertiary" numeric style={{ minWidth: 64, textAlign: 'right' }}>{fmt(d.previous)}</Text>
      <View style={{ minWidth: 56, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        {d.change !== 0 && !neutral && <Icon name={up ? 'up' : 'down'} size={11} color={t.colors[tone]} />}
        <Text variant="caption" color={tone} numeric>{d.change === 0 ? '—' : pct}</Text>
      </View>
    </View>
  );
}

function writtenSummary(left: Side, right: Side, currencies: string[]): string {
  if (left.hours === 0 && right.hours === 0) return 'No hours recorded in either period yet.';
  if (right.hours === 0) return `${left.label}: ${formatDuration(left.hours)} worked — nothing to compare against in ${right.label.toLowerCase()}.`;
  const d = delta(left.hours, right.hours);
  const dir = d.change === 0 ? 'the same hours as' : d.change > 0 ? `${formatDuration(d.change)} more than` : `${formatDuration(-d.change)} less than`;
  let text = `${left.label} you worked ${dir} ${right.label.toLowerCase()}`;
  if (d.percent != null && d.change !== 0) text += ` (${d.change > 0 ? '+' : ''}${d.percent.toFixed(0)}%)`;
  const c = currencies[0];
  if (c && currencies.length === 1) {
    const e = new Big(left.earnings[c] ?? 0).minus(right.earnings[c] ?? 0);
    if (!e.eq(0)) text += `, earning ${formatMoney(e.abs().toFixed(2), c)} ${e.gt(0) ? 'more' : 'less'}`;
  }
  return `${text}.`;
}

