import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ShiftRow } from '@/components/shift/ShiftRow';
import { Button } from '@/components/ui/Button';
import { ChipRow } from '@/components/ui/Controls';
import { Card, EmptyState, ErrorBanner, IconButton, Screen, Section } from '@/components/ui/Layout';
import { confirm } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useJobs, useLive, useMutation } from '@/hooks/data';
import { listShifts } from '@/repositories/shiftsRepository';
import { deleteShiftsOnDate } from '@/services/shiftService';
import { useTheme } from '@/theme/ThemeProvider';
import type { Shift } from '@/types/domain';
import { formatDate } from '@/utils/format';
import { formatDuration } from '@/utils/time';

const ALL = '__all__';
const UNASSIGNED = '__none__';
const PAGE = 60;

export default function History() {
  const t = useTheme();
  const jobs = useJobs(true);
  const [filter, setFilter] = useState(ALL);
  const [limit, setLimit] = useState(PAGE);
  const jobId = filter === ALL ? undefined : filter === UNASSIGNED ? null : filter;
  const shifts = useLive((db) => listShifts(db, { jobId, limit }), [filter, limit]);
  const jobsById = useMemo(() => new Map((jobs.data ?? []).map((j) => [j.id, j])), [jobs.data]);

  const groups = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts.data ?? []) map.set(s.shiftDate, [...(map.get(s.shiftDate) ?? []), s]);
    return [...map.entries()];
  }, [shifts.data]);

  const removeDay = useMutation((db, date: string) => deleteShiftsOnDate(db, date, jobId));
  const confirmDeleteDay = async (date: string, count: number) => {
    const scope = jobId === undefined ? '' : jobId === null ? ' unassigned' : ` ${jobsById.get(jobId)?.companyName ?? ''}`;
    const ok = await confirm({
      title: `Delete ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}?`,
      message: `All ${count}${scope} shift${count === 1 ? '' : 's'} on this day and their breaks will be permanently erased from this device and from every report. This cannot be undone.`,
      confirmLabel: `Delete ${count} shift${count === 1 ? '' : 's'}`,
      destructive: true,
    });
    if (ok) removeDay.run(date).catch(() => {});
  };

  const hasUnassigned = (shifts.data ?? []).some((s) => !s.jobId) || filter === UNASSIGNED;

  return (
    <Screen title="History" right={<IconButton icon="add" label="Log a shift manually" tone="accent" onPress={() => router.push('/shifts/new')} />} back={false}>
      <ChipRow
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setLimit(PAGE);
        }}
        options={[
          { value: ALL, label: 'All Jobs' },
          ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.companyName + (j.isActive ? '' : ' (archived)'), color: j.color })),
          ...(hasUnassigned ? [{ value: UNASSIGNED, label: 'Unassigned' }] : []),
        ]}
      />
      {removeDay.error && <View style={{ marginTop: t.spacing.lg }}><ErrorBanner message={removeDay.error} /></View>}
      {shifts.error && <View style={{ marginTop: t.spacing.lg }}><ErrorBanner message="Couldn't load your history." /></View>}
      {shifts.data && shifts.data.length === 0 && (
        <Card style={{ marginTop: t.spacing.lg }}>
          <EmptyState icon="history" title="No shifts yet" message="Completed and manually logged shifts will appear here." action={<Button label="Log a shift" icon="add" onPress={() => router.push('/shifts/new')} />} />
        </Card>
      )}
      {groups.map(([date, list]) => (
        <Section
          key={date}
          title={formatDate(date, { weekday: 'long', day: 'numeric', month: 'short' })}
          action={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
              <Text variant="caption" color="textSecondary" numeric>{formatDuration(list.reduce((a, s) => a + s.netWorkSeconds, 0))}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete all shifts on ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                hitSlop={10}
                onPress={() => confirmDeleteDay(date, list.length)}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                testID={`delete-day-${date}`}>
                <Icon name="trash" size={15} color={t.colors.textTertiary} />
              </Pressable>
            </View>
          }>
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            {list.map((s, i) => <ShiftRow key={s.id} shift={s} job={s.jobId ? jobsById.get(s.jobId) : undefined} last={i === list.length - 1} />)}
          </Card>
        </Section>
      ))}
      {(shifts.data?.length ?? 0) >= limit && (
        <Button label="Load more" variant="secondary" fullWidth style={{ marginTop: t.spacing.xl }} onPress={() => setLimit((l) => l + PAGE)} />
      )}
    </Screen>
  );
}
