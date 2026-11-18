import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { create } from 'zustand';

import { useTheme } from '@/theme/ThemeProvider';

import { Button } from './Button';
import { Text } from './Text';

/**
 * Cross-platform dialogs. React Native's Alert.alert is a no-op on web, and
 * native alerts can't be themed — so the app uses this everywhere instead.
 *
 *   if (await confirm({ title: 'End shift?', confirmLabel: 'End shift', destructive: true })) …
 *   const choice = await choose({ title: 'Start a break', options: [{ value: 'paid', label: 'Paid' }] });
 */

export interface DialogOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  destructive?: boolean;
}

interface DialogRequest {
  title: string;
  message?: string;
  options: DialogOption[];
  cancelLabel: string;
  resolve: (value: string | null) => void;
}

const useDialogStore = create<{ current: DialogRequest | null; queue: DialogRequest[] }>(() => ({ current: null, queue: [] }));

function open(req: Omit<DialogRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    const full: DialogRequest = { ...req, resolve };
    const { current, queue } = useDialogStore.getState();
    if (current) useDialogStore.setState({ queue: [...queue, full] });
    else useDialogStore.setState({ current: full });
  });
}

function close(value: string | null) {
  const { current, queue } = useDialogStore.getState();
  current?.resolve(value);
  const [next, ...rest] = queue;
  useDialogStore.setState({ current: next ?? null, queue: rest });
}

export async function confirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const v = await open({
    title: opts.title,
    message: opts.message,
    options: [{ value: 'ok', label: opts.confirmLabel ?? 'OK', destructive: opts.destructive }],
    cancelLabel: opts.cancelLabel ?? 'Cancel',
  });
  return v === 'ok';
}

/** Single-button notice. Use instead of Alert.alert, which does nothing on web. */
export async function showAlert(title: string, message?: string): Promise<void> {
  await open({ title, message, options: [], cancelLabel: 'OK' });
}

export function choose<T extends string>(opts: {
  title: string;
  message?: string;
  options: DialogOption<T>[];
  cancelLabel?: string;
}): Promise<T | null> {
  return open({ ...opts, cancelLabel: opts.cancelLabel ?? 'Cancel' }) as Promise<T | null>;
}

/** Mount once near the app root. */
export function DialogHost() {
  const t = useTheme();
  const current = useDialogStore((s) => s.current);

  // Resolve any open dialog as cancelled if the host unmounts.
  useEffect(() => () => close(null), []);

  if (!current) return null;
  const single = current.options.length === 1;

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close(null)} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close(null)} accessibilityLabel="Dismiss dialog" />
      </Animated.View>
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          entering={ZoomIn.duration(180).springify().damping(18)}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 380,
            backgroundColor: t.colors.cardElevated,
            borderRadius: t.radius.xxl,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.colors.border,
            padding: t.spacing.xxl,
            gap: t.spacing.lg,
          }}>
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="title" accessibilityRole="header">{current.title}</Text>
            {current.message && <Text variant="body" color="textSecondary">{current.message}</Text>}
          </View>
          <View style={{ gap: t.spacing.sm }}>
            {current.options.map((o) => (
              <View key={o.value} style={{ gap: 2 }}>
                <Button
                  label={o.label}
                  variant={o.destructive ? 'danger' : single ? 'primary' : 'secondary'}
                  fullWidth
                  onPress={() => close(o.value)}
                  testID={`dialog-${o.value}`}
                />
                {o.description && <Text variant="caption" color="textTertiary" align="center">{o.description}</Text>}
              </View>
            ))}
            <Button label={current.cancelLabel} variant="ghost" fullWidth onPress={() => close(null)} haptic={false} testID="dialog-cancel" />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
