import { router } from 'expo-router';

import { JobDot, ListRow } from '@/components/ui/Layout';
import type { Job, Shift } from '@/types/domain';
import { formatClock, formatDate } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { formatDuration } from '@/utils/time';

export function shiftTimeLabel(s: Shift): string {
  if (s.entryType === 'manual_duration' || s.startAt == null) return 'Duration entry';
  const start = formatClock(s.startAt, s.timezone);
  const end = s.endAt ? formatClock(s.endAt, s.timezone) : 'now';
  return `${start} – ${end}`;
}

export function ShiftRow({ shift, job, showDate, last }: { shift: Shift; job: Job | undefined; showDate?: boolean; last?: boolean }) {
  const subtitle = [showDate ? formatDate(shift.shiftDate) : null, shiftTimeLabel(shift)].filter(Boolean).join('  ·  ');
  return (
    <ListRow
      testID={`shift-row-${shift.id}`}
      title={job?.companyName ?? 'Unassigned shift'}
      subtitle={subtitle}
      value={formatDuration(shift.netWorkSeconds)}
      valueSub={shift.estimatedGrossPay && shift.currency ? formatMoney(shift.estimatedGrossPay, shift.currency) : undefined}
      leading={<JobDot color={job?.color ?? '#64748B'} />}
      onPress={() => router.push({ pathname: '/shifts/[id]', params: { id: shift.id } })}
      last={last}
    />
  );
}
