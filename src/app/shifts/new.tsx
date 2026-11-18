import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ChipRow, Segmented, TextField } from '@/components/ui/Controls';
import { ErrorBanner, IconButton, Loading, Screen, Section } from '@/components/ui/Layout';
import { confirm } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import { useJobs, useMutation, useToday } from '@/hooks/data';
import { DomainError } from '@/services/errors';
import { createManualShift } from '@/services/shiftService';
import { useTheme } from '@/theme/ThemeProvider';
import type { Job } from '@/types/domain';
import type { ManualShiftInput } from '@/validation/schemas';
import { addDays, formatDuration, isValidLocalDate, normalizeTimeInput, parseDurationInput, timeToMinutes } from '@/utils/time';

type Mode = 'times' | 'duration';

export default function ManualShift() {
  const jobs = useJobs();
  if (jobs.loading) return <Loading />;
  return <ManualShiftForm jobs={jobs.data ?? []} />;
}

function ManualShiftForm({ jobs }: { jobs: Job[] }) {
  const t = useTheme();
  const today = useToday();
  const first = jobs[0];
  const [mode, setMode] = useState<Mode>('times');
  const [jobId, setJobIdRaw] = useState<string>(first?.id ?? '');
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(first?.defaultStartTime ?? '');
  const [end, setEnd] = useState(first?.defaultEndTime ?? '');
  const [duration, setDuration] = useState('');
  const [paid, setPaid] = useState(String(Math.round((first?.defaultPaidBreakSeconds ?? 0) / 60)));
  const [unpaid, setUnpaid] = useState(String(Math.round((first?.defaultUnpaidBreakSeconds ?? 0) / 60)));
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  /** Switching job applies that job's defaults (an event handler, not an effect). */
  const setJobId = (id: string) => {
    setJobIdRaw(id);
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.defaultStartTime) setStart(j.defaultStartTime);
    if (j.defaultEndTime) setEnd(j.defaultEndTime);
    setPaid(String(Math.round(j.defaultPaidBreakSeconds / 60)));
    setUnpaid(String(Math.round(j.defaultUnpaidBreakSeconds / 60)));
  };

  const parsedDuration = parseDurationInput(duration);
  const startN = normalizeTimeInput(start);
  const endN = normalizeTimeInput(end);
  const overnight = !!startN && !!endN && timeToMinutes(endN) <= timeToMinutes(startN);
  const preview =
    mode === 'times' && startN && endN
      ? ((timeToMinutes(endN) - timeToMinutes(startN) + 1440) % 1440 || 1440) * 60
      : mode === 'duration'
        ? parsedDuration
        : null;

  const save = useMutation((db, input: ManualShiftInput, allowOverlap: boolean) => createManualShift(db, input, { allowOverlapWithOtherJobs: allowOverlap }));

  const submit = async (allowOverlap = false) => {
    setLocalError(null);
    if (!isValidLocalDate(date)) return setLocalError('Enter the date as YYYY-MM-DD.');
    const common = { jobId: jobId || null, shiftDate: date, paidBreakMinutes: Number(paid) || 0, unpaidBreakMinutes: Number(unpaid) || 0, notes: notes.trim() || null };
    let input: ManualShiftInput;
    if (mode === 'times') {
      if (!startN || !endN) return setLocalError('Enter times like 09:00, 9:30 or 5pm.');
      input = { mode: 'times', startTime: startN, endTime: endN, ...common };
    } else {
      if (parsedDuration == null) return setLocalError('Try a duration like "7h 45m", "5:30" or "8".');
      input = { mode: 'duration', durationSeconds: parsedDuration, ...common };
    }
    try {
      const s = await save.run(input, allowOverlap);
      if (s) router.replace({ pathname: '/shifts/[id]', params: { id: s.id } });
    } catch (e) {
      if (e instanceof DomainError && e.code === 'OVERLAPS_OTHER_JOB') {
        save.setError(null);
        const ok = await confirm({
          title: 'Overlapping shift',
          message: 'This overlaps a shift at another job. Did you really work both at the same time?',
          confirmLabel: 'Save anyway',
        });
        if (ok) submit(true);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title="Log a shift" right={<IconButton icon="close" label="Close" onPress={() => router.back()} />}>
        <View style={{ gap: t.spacing.lg }}>
          <Segmented label="Entry type" value={mode} onChange={setMode} options={[{ value: 'times', label: 'Start & end' }, { value: 'duration', label: 'Duration only' }]} />
          {jobs.length > 0 ? (
            <View style={{ gap: t.spacing.xs }}>
              <Text variant="label" color="textSecondary">Job</Text>
              <ChipRow value={jobId} onChange={setJobId} options={jobs.map((j) => ({ value: j.id, label: j.companyName, color: j.color }))} />
            </View>
          ) : (
            <Text variant="caption" color="textSecondary">No jobs yet — this shift will be saved as unassigned. You can assign it later.</Text>
          )}
          <View style={{ gap: t.spacing.xs }}>
            <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" maxLength={10} keyboardType="numbers-and-punctuation" />
            <ChipRow value={date} onChange={setDate} options={[{ value: today, label: 'Today' }, { value: addDays(today, -1), label: 'Yesterday' }, { value: addDays(today, -2), label: '2 days ago' }]} />
          </View>
        </View>

        <Section title={mode === 'times' ? 'Hours' : 'Duration'}>
          {mode === 'times' ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ flex: 1 }}><TextField label="Start" value={start} onChangeText={setStart} onBlur={() => startN && setStart(startN)} error={start.trim() && !startN ? 'Try 09:00 or 9am' : null} placeholder="09:00" maxLength={5} keyboardType="numbers-and-punctuation" testID="manual-start" /></View>
              <View style={{ flex: 1 }}><TextField label="End" value={end} onChangeText={setEnd} onBlur={() => endN && setEnd(endN)} error={end.trim() && !endN ? 'Try 17:00 or 5pm' : null} placeholder="17:00" maxLength={5} keyboardType="numbers-and-punctuation" hint={overnight ? 'Ends next day' : undefined} testID="manual-end" /></View>
            </View>
          ) : (
            <TextField label="Time worked" value={duration} onChangeText={setDuration} placeholder="e.g. 7h 45m" hint="Accepts 8, 5:30, 7h 45m, 5 hours 30 minutes" error={duration && parsedDuration == null ? 'Not a recognised duration.' : null} />
          )}
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}><TextField label="Paid break (min)" value={paid} onChangeText={(v) => setPaid(v.replace(/\D/g, ''))} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><TextField label="Unpaid break (min)" value={unpaid} onChangeText={(v) => setUnpaid(v.replace(/\D/g, ''))} keyboardType="number-pad" /></View>
          </View>
          {preview != null && (
            <Text variant="label" color="textSecondary" numeric>
              Net working time: {formatDuration(Math.max(0, preview - (Number(unpaid) || 0) * 60))}
            </Text>
          )}
        </Section>

        <Section title="Notes">
          <TextField label="Notes" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} placeholder="Optional" />
        </Section>

        <View style={{ marginTop: t.spacing.xxl, gap: t.spacing.md }}>
          {(localError || save.error) && <ErrorBanner message={(localError ?? save.error)!} />}
          <Button label="Save shift" size="lg" fullWidth onPress={() => submit(false)} loading={save.pending} testID="manual-save" />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
