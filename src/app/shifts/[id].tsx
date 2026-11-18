import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { shiftTimeLabel } from '@/components/shift/ShiftRow';
import { Button } from '@/components/ui/Button';
import { ChipRow, Segmented, Stat, TextField } from '@/components/ui/Controls';
import { Card, ErrorBanner, IconButton, JobDot, ListRow, Loading, Screen, Section } from '@/components/ui/Layout';
import { confirm } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { useJobs, useLive, useMutation, useNow } from '@/hooks/data';
import { getShift, listBreaks } from '@/repositories/shiftsRepository';
import type { CandidateBreak } from '@/services/calculations/breaks';
import { deleteBreak, deleteShift, editShift, saveBreak } from '@/services/shiftService';
import { useTheme } from '@/theme/ThemeProvider';
import type { Break } from '@/types/domain';
import { formatClock, formatDate } from '@/utils/format';
import { formatMoney } from '@/utils/money';
import { addDays, formatDuration, localToEpoch, normalizeTimeInput, parseDurationInput, toLocalDate, toLocalTime } from '@/utils/time';

export default function ShiftDetails() {
  const t = useTheme();
  const { id, completed } = useLocalSearchParams<{ id: string; completed?: string }>();
  const jobs = useJobs(true);
  const now = useNow(1000);
  const data = useLive(async (db) => {
    const shift = await getShift(db, id);
    return shift && !shift.deletedAt ? { shift, breaks: await listBreaks(db, id) } : null;
  }, [id]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '', duration: '', notes: '' });
  const [breakDraft, setBreakDraft] = useState<{ type: 'paid' | 'unpaid'; start: string; end: string; minutes: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const edit = useMutation(editShift);
  const remove = useMutation((db) => deleteShift(db, id));
  const addBreak = useMutation((db, c: CandidateBreak) => saveBreak(db, id, c));
  const removeBreak = useMutation((db, breakId: string) => deleteBreak(db, id, breakId));

  if (data.loading && !data.data) return <Loading />;
  if (!data.data) return <Screen back title="Shift not found"><Text color="textSecondary">It may have been deleted.</Text></Screen>;
  const { shift, breaks } = data.data;
  const job = jobs.data?.find((j) => j.id === shift.jobId);
  const timed = shift.startAt != null;
  const active = shift.status !== 'completed';
  const error = localError ?? edit.error ?? remove.error ?? addBreak.error ?? removeBreak.error;

  const beginEdit = () => {
    setDraft({
      start: shift.startAt ? toLocalTime(shift.startAt, shift.timezone) : '',
      end: shift.endAt ? toLocalTime(shift.endAt, shift.timezone) : '',
      duration: timed ? '' : formatDuration(shift.totalDurationSeconds),
      notes: shift.notes ?? '',
    });
    setEditing(true);
  };

  /** Resolve an HH:mm on the shift's date (or the next day for an overnight end). */
  const resolveTimes = (start: string, end: string) => {
    const s = localToEpoch(shift.shiftDate, start, shift.timezone);
    let e = localToEpoch(shift.shiftDate, end, shift.timezone);
    if (e <= s) e = localToEpoch(addDays(shift.shiftDate, 1), end, shift.timezone);
    return { s, e };
  };

  const saveEdit = async () => {
    setLocalError(null);
    try {
      if (timed) {
        const ds = normalizeTimeInput(draft.start);
        const de = normalizeTimeInput(draft.end);
        if (!ds || !de) return setLocalError('Enter times like 09:00, 9:30 or 5pm.');
        const { s, e } = resolveTimes(ds, de);
        await edit.run(id, { startAt: s, endAt: e, notes: draft.notes.trim() || null });
      } else {
        const secs = parseDurationInput(draft.duration);
        if (secs == null) return setLocalError('Try a duration like "7h 45m".');
        await edit.run(id, { totalDurationSeconds: secs, notes: draft.notes.trim() || null });
      }
      setEditing(false);
    } catch {
      /* surfaced via edit.error */
    }
  };

  const saveBreakDraft = async () => {
    if (!breakDraft) return;
    setLocalError(null);
    let candidate: CandidateBreak;
    if (timed && breakDraft.start) {
      const bs = normalizeTimeInput(breakDraft.start);
      const be = normalizeTimeInput(breakDraft.end);
      if (!bs || !be) return setLocalError('Enter break times like 12:00 or 12:30pm.');
      // Anchor break times to the shift's start day, rolling into the next day if before shift start.
      const anchor = (hhmm: string) => {
        let ms = localToEpoch(shift.shiftDate, hhmm, shift.timezone);
        if (shift.startAt && ms < shift.startAt) ms = localToEpoch(addDays(shift.shiftDate, 1), hhmm, shift.timezone);
        return ms;
      };
      candidate = { breakType: breakDraft.type, startAt: anchor(bs), endAt: anchor(be) };
    } else {
      const m = Number(breakDraft.minutes);
      if (!m || m <= 0) return setLocalError('Enter the break length in minutes.');
      if (timed) return setLocalError('For timed shifts, enter when the break started and ended.');
      candidate = { breakType: breakDraft.type, startAt: null, endAt: null, durationSeconds: m * 60 };
    }
    try {
      await addBreak.run(candidate);
      setBreakDraft(null);
    } catch {
      /* surfaced */
    }
  };

  const breakLabel = (b: Break) =>
    b.startAt ? `${formatClock(b.startAt, shift.timezone)} – ${b.endAt ? formatClock(b.endAt, shift.timezone) : 'now'}` : 'Duration entry';

  return (
    <Screen
      back
      subtitle={formatDate(shift.shiftDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      title={job?.companyName ?? 'Unassigned shift'}
      right={!active && !editing ? <IconButton icon="edit" label="Edit shift" onPress={beginEdit} /> : undefined}>
      {completed && (
        <Animated.View entering={FadeInDown.duration(320)}>
          <Card style={{ backgroundColor: t.colors.accentMuted, borderColor: 'transparent', marginBottom: t.spacing.lg, gap: t.spacing.xs }}>
            <Text variant="heading" color="accent">Shift complete</Text>
            <Text variant="body" color="textSecondary">
              Nice work — {formatDuration(shift.netWorkSeconds)} logged
              {shift.estimatedGrossPay && shift.currency ? `, about ${formatMoney(shift.estimatedGrossPay, shift.currency)} gross` : ''}.
            </Text>
          </Card>
        </Animated.View>
      )}

      <Card style={{ gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <JobDot color={job?.color ?? t.colors.textTertiary} />
          <Text variant="label" color="textSecondary" numeric>{shiftTimeLabel(shift)}</Text>
          {shift.entryType !== 'timer' && <Text variant="caption" color="textTertiary">· Manual</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
          <Stat label="Net worked" value={formatDuration(shift.netWorkSeconds)} sub={`of ${formatDuration(shift.totalDurationSeconds)} total`} />
          <Stat
            label="Gross estimate"
            value={shift.estimatedGrossPay && shift.currency ? formatMoney(shift.estimatedGrossPay, shift.currency) : '—'}
            sub={shift.hourlyRateSnapshot ? `at ${shift.hourlyRateSnapshot}/h` : job ? 'No rate set' : 'Assign a job'}
          />
        </View>
        <Text variant="caption" color="textTertiary">Overtime is calculated in weekly and monthly reports, where thresholds apply.</Text>
      </Card>

      {!shift.jobId && (jobs.data?.length ?? 0) > 0 && (
        <Section title="Assign to a job">
          <ChipRow value="" onChange={(jid) => edit.run(id, { jobId: jid }).catch(() => {})} options={(jobs.data ?? []).filter((j) => j.isActive).map((j) => ({ value: j.id, label: j.companyName, color: j.color }))} />
        </Section>
      )}

      {editing && (
        <Section title="Edit">
          <Card style={{ gap: t.spacing.md }}>
            {timed ? (
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <View style={{ flex: 1 }}><TextField label="Start" value={draft.start} onChangeText={(v) => setDraft({ ...draft, start: v })} maxLength={5} keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><TextField label="End" value={draft.end} onChangeText={(v) => setDraft({ ...draft, end: v })} maxLength={5} keyboardType="numbers-and-punctuation" /></View>
              </View>
            ) : (
              <TextField label="Duration" value={draft.duration} onChangeText={(v) => setDraft({ ...draft, duration: v })} />
            )}
            <TextField label="Notes" value={draft.notes} onChangeText={(v) => setDraft({ ...draft, notes: v })} multiline />
            {(jobs.data?.length ?? 0) > 1 && shift.jobId && (
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="label" color="textSecondary">Job</Text>
                <ChipRow value={shift.jobId} onChange={(jid) => edit.run(id, { jobId: jid }).catch(() => {})} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: j.companyName, color: j.color }))} />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button label="Save" onPress={saveEdit} loading={edit.pending} style={{ flex: 1 }} />
            </View>
          </Card>
        </Section>
      )}

      <Section title="Breaks" action={!active && !breakDraft ? <Button label="Add break" variant="ghost" onPress={() => setBreakDraft({ type: 'unpaid', start: '', end: '', minutes: '' })} haptic={false} /> : undefined}>
        {breaks.length ? (
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            {breaks.map((b, i) => (
              <ListRow
                key={b.id}
                title={b.breakType === 'paid' ? 'Paid break' : 'Unpaid break'}
                subtitle={breakLabel(b) + (b.breakType === 'paid' ? ' · counts as work' : ' · deducted')}
                value={formatDuration(b.startAt ? Math.floor(((b.endAt ?? now) - b.startAt) / 1000) : b.durationSeconds)}
                onPress={
                  b.status === 'completed'
                    ? async () => {
                        if (await confirm({ title: 'Delete break?', message: 'Working time will be recalculated.', confirmLabel: 'Delete', destructive: true })) {
                          removeBreak.run(b.id).catch(() => {});
                        }
                      }
                    : undefined
                }
                showChevron={false}
                last={i === breaks.length - 1}
              />
            ))}
          </Card>
        ) : (
          <Text variant="body" color="textSecondary">No breaks recorded.</Text>
        )}
        {breakDraft && (
          <Card style={{ gap: t.spacing.md }}>
            <Segmented value={breakDraft.type} onChange={(v) => setBreakDraft({ ...breakDraft, type: v })} options={[{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }]} />
            {timed ? (
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <View style={{ flex: 1 }}><TextField label="From" value={breakDraft.start} onChangeText={(v) => setBreakDraft({ ...breakDraft, start: v })} placeholder="12:00" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><TextField label="To" value={breakDraft.end} onChangeText={(v) => setBreakDraft({ ...breakDraft, end: v })} placeholder="12:30" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
              </View>
            ) : (
              <TextField label="Minutes" value={breakDraft.minutes} onChangeText={(v) => setBreakDraft({ ...breakDraft, minutes: v.replace(/\D/g, '') })} keyboardType="number-pad" />
            )}
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button label="Cancel" variant="secondary" onPress={() => setBreakDraft(null)} style={{ flex: 1 }} />
              <Button label="Add break" onPress={saveBreakDraft} loading={addBreak.pending} style={{ flex: 1 }} />
            </View>
          </Card>
        )}
        {breaks.length > 0 && <Text variant="caption" color="textTertiary">Tap a break to delete it.</Text>}
      </Section>

      {shift.notes && !editing && (
        <Section title="Notes">
          <Text variant="body" color="textSecondary">{shift.notes}</Text>
        </Section>
      )}

      <View style={{ marginTop: t.spacing.xxl, gap: t.spacing.md }}>
        {error && <ErrorBanner message={error} />}
        {!active && (
          <Button
            label="Delete shift permanently"
            icon="trash"
            variant="danger"
            fullWidth
            loading={remove.pending}
            onPress={async () => {
              if (await confirm({ title: 'Delete this shift permanently?', message: 'The shift and its breaks will be erased from this device and removed from all reports. This cannot be undone.', confirmLabel: 'Delete permanently', destructive: true })) {
                remove.run().then(() => router.back(), () => {});
              }
            }}
          />
        )}
        <Text variant="caption" color="textTertiary" align="center">
          Recorded {toLocalDate(shift.createdAt, shift.timezone)} · {shift.timezone}
        </Text>
      </View>
    </Screen>
  );
}
