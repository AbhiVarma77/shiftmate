import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, JobDot } from '@/components/ui/Layout';
import { choose, confirm } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { type ActiveShift, useMutation, useNow } from '@/hooks/data';
import { computeShiftTotals } from '@/services/calculations/shifts';
import { deleteShift, endBreak, pauseShift, startBreak, stopShift } from '@/services/shiftService';
import { useTheme } from '@/theme/ThemeProvider';
import type { Job } from '@/types/domain';
import { formatClock } from '@/utils/format';
import { formatMoney, payForSeconds, roundMoney } from '@/utils/money';
import { formatDuration } from '@/utils/time';

/** Live timer for a running shift. Display is derived from persisted timestamps every tick. */
export function ActiveShiftCard({ active, job, rate }: { active: ActiveShift; job: Job | undefined; rate: string | null }) {
  const t = useTheme();
  const now = useNow(1000);
  const { shift, breaks } = active;
  const totals = computeShiftTotals(shift, breaks, now);
  const onBreak = shift.status === 'on_break';
  const openBreak = breaks.find((b) => b.status === 'active');
  const currency = shift.currency ?? job?.currency ?? 'GBP';
  const earned = rate ? roundMoney(payForSeconds(rate, totals.netWorkSeconds), currency) : null;
  const planned = shift.plannedDurationSeconds;

  const stop = useMutation((db) => stopShift(db, shift.id));
  const discard = useMutation((db) => deleteShift(db, shift.id));
  const brk = useMutation((db, type: 'paid' | 'unpaid') => startBreak(db, shift.id, type));
  const pause = useMutation((db) => pauseShift(db, shift.id));
  const resume = useMutation((db) => endBreak(db, shift.id));
  const error = stop.error ?? discard.error ?? brk.error ?? pause.error ?? resume.error;

  const confirmStop = async () => {
    const choice = await choose({
      title: 'End shift?',
      message: `${formatDuration(totals.netWorkSeconds)} worked at ${job?.companyName ?? 'this job'}.`,
      options: [
        { value: 'save', label: 'End & save shift', description: 'Adds it to your history and reports' },
        { value: 'discard', label: 'Discard shift', description: 'Started by mistake? Delete it without saving', destructive: true },
      ],
      cancelLabel: 'Keep working',
    });
    if (choice === 'save') {
      const done = await stop.run().catch(() => undefined);
      if (done) router.push({ pathname: '/shifts/[id]', params: { id: done.id, completed: '1' } });
    } else if (choice === 'discard') {
      const sure = await confirm({
        title: 'Discard this shift?',
        message: 'It will be permanently deleted and will not appear anywhere. This cannot be undone.',
        confirmLabel: 'Discard permanently',
        destructive: true,
      });
      if (sure) discard.run().catch(() => {});
    }
  };

  const chooseBreak = async () => {
    const type = await choose({
      title: 'Start a break',
      options: [
        { value: 'paid', label: 'Paid break', description: 'Counts toward working time' },
        { value: 'unpaid', label: 'Unpaid break', description: 'Deducted from working time' },
      ],
    });
    if (type) brk.run(type).catch(() => {});
  };

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
      <Card style={{ borderColor: onBreak ? t.colors.warning : t.colors.accent, borderWidth: 1, gap: t.spacing.lg }}>
        <View style={styles.row}>
          <View style={[styles.row, { gap: t.spacing.sm, flex: 1 }]}>
            <JobDot color={job?.color ?? t.colors.accent} />
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {job?.companyName ?? 'Unassigned'}
            </Text>
          </View>
          <StatusPill onBreak={onBreak} label={onBreak ? (openBreak?.breakType === 'paid' ? 'Paid break' : 'On break') : 'Working'} />
        </View>

        <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
          <Text
            variant="timer"
            numeric
            accessibilityRole="timer"
            accessibilityLabel={`Worked ${formatDuration(totals.netWorkSeconds)}`}
            color={onBreak ? 'textSecondary' : 'text'}>
            {formatDuration(totals.netWorkSeconds, 'clock')}
          </Text>
          <Text variant="label" color="textSecondary" numeric>
            Started {shift.startAt ? formatClock(shift.startAt) : '—'}
            {earned ? `  ·  ${formatMoney(earned, currency)} est.` : ''}
          </Text>
          {onBreak && openBreak?.startAt && (
            <Text variant="caption" color="warning" numeric>
              Break {formatDuration(Math.floor((now - openBreak.startAt) / 1000), 'clock')}
            </Text>
          )}
          {planned != null && (
            <Text variant="caption" color={totals.netWorkSeconds >= planned ? 'accent' : 'textTertiary'}>
              {totals.netWorkSeconds >= planned ? 'Planned duration reached' : `${formatDuration(planned - totals.netWorkSeconds)} to planned end`}
            </Text>
          )}
        </View>

        {error && <ErrorBanner message={error} />}

        <View style={[styles.row, { gap: t.spacing.sm }]}>
          {onBreak ? (
            <Button label="End break" icon="play" variant="secondary" onPress={() => resume.run().catch(() => {})} loading={resume.pending} style={{ flex: 1 }} />
          ) : (
            <>
              <Button label="Pause" icon="pause" variant="secondary" onPress={() => pause.run().catch(() => {})} loading={pause.pending} style={{ flex: 1 }} accessibilityHint="Starts an unpaid break" />
              <Button label="Break" icon="coffee" variant="secondary" onPress={chooseBreak} loading={brk.pending} style={{ flex: 1 }} />
            </>
          )}
          <Button label="Stop" icon="stop" variant="danger" onPress={confirmStop} loading={stop.pending || discard.pending} style={{ flex: 1 }} testID="stop-shift" />
        </View>
      </Card>
    </Animated.View>
  );
}

function StatusPill({ onBreak, label }: { onBreak: boolean; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: t.radius.pill, backgroundColor: onBreak ? t.colors.warningMuted : t.colors.accentMuted }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: onBreak ? t.colors.warning : t.colors.accent }} />
      <Text variant="caption" color={onBreak ? 'warning' : 'accent'}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
