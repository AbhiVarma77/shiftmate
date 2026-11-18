import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { HIT_TARGET } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Standard scrollable screen with safe-area padding and optional large title. */
export function Screen({
  title,
  subtitle,
  back,
  right,
  children,
  scroll = true,
  onRefresh,
  refreshing,
  contentStyle,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: ViewStyle;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const header = (title || back || right) && (
    <View style={{ gap: t.spacing.xs, marginBottom: t.spacing.xl }}>
      {(back || right) && (
        <View style={styles.headerRow}>
          {back ? <IconButton icon="back" label="Go back" onPress={() => router.back()} /> : <View />}
          {right}
        </View>
      )}
      {subtitle && <Text variant="label" color="textSecondary">{subtitle}</Text>}
      {title && <Text variant="display" accessibilityRole="header">{title}</Text>}
    </View>
  );
  const padding: ViewStyle = {
    // On web, native tabs render as a top bar; leave room for it.
    paddingTop: insets.top + t.spacing.md + (Platform.OS === 'web' && !back ? 64 : 0),
    paddingBottom: insets.bottom + 120,
    paddingHorizontal: t.spacing.xl,
  };
  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: t.colors.background }, padding, contentStyle]}>
        {header}
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} /> : undefined}>
      {header}
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: ViewStyle; padded?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.card,
          borderRadius: t.radius.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          padding: padded ? t.spacing.lg : 0,
          shadowColor: t.colors.shadow,
          shadowOpacity: t.scheme === 'dark' ? 0 : 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: t.scheme === 'dark' ? 0 : 1,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Section({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[{ marginTop: t.spacing.xxl, gap: t.spacing.md }, style]}>
      <View style={styles.headerRow}>
        <Text variant="overline" color="textSecondary" accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function IconButton({ icon, label, onPress, tone = 'default' }: { icon: IconName; label: string; onPress: () => void; tone?: 'default' | 'accent' }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: t.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'accent' ? t.colors.accentMuted : t.colors.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.border,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Icon name={icon} size={18} color={tone === 'accent' ? t.colors.accent : t.colors.text} />
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  valueSub,
  leading,
  onPress,
  showChevron = !!onPress,
  last,
  testID,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  valueSub?: string;
  leading?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  last?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const body = (
    <View
      style={[
        styles.row,
        {
          minHeight: HIT_TARGET + 12,
          paddingVertical: t.spacing.md,
          gap: t.spacing.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: t.colors.border,
        },
      ]}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{title}</Text>
        {subtitle && <Text variant="caption" color="textSecondary" numberOfLines={2}>{subtitle}</Text>}
      </View>
      {(value || valueSub) && (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {value && <Text variant="bodyStrong" numeric>{value}</Text>}
          {valueSub && <Text variant="caption" color="textSecondary" numeric>{valueSub}</Text>}
        </View>
      )}
      {showChevron && <Icon name="chevronRight" size={14} color={t.colors.textTertiary} />}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: t.spacing.huge, paddingHorizontal: t.spacing.xl, gap: t.spacing.md }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={t.colors.accent} />
      </View>
      <Text variant="heading" align="center">{title}</Text>
      <Text variant="body" color="textSecondary" align="center">{message}</Text>
      {action && <View style={{ marginTop: t.spacing.sm }}>{action}</View>}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
      <ActivityIndicator color={t.colors.accent} />
    </View>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', backgroundColor: t.colors.dangerMuted, padding: t.spacing.md, borderRadius: t.radius.md }}>
      <Icon name="warning" size={16} color={t.colors.danger} />
      <Text variant="label" color="danger" style={{ flex: 1 }}>{message}</Text>
    </View>
  );
}

export function JobDot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
