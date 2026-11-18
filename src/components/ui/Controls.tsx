import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { HIT_TARGET } from '@/theme/tokens';

import { Text } from './Text';

export function TextField({ label, error, hint, style, ...rest }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="label" color="textSecondary">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.colors.textTertiary}
        selectionColor={t.colors.accent}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        {...rest}
        style={[
          t.typography.body,
          {
            minHeight: HIT_TARGET,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.card,
            color: t.colors.text,
            borderWidth: 1,
            borderColor: error ? t.colors.danger : focused ? t.colors.accent : t.colors.border,
          },
          // Our border already shows focus; drop the browser's default ring.
          Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          style,
        ]}
      />
      {error ? <Text variant="caption" color="danger">{error}</Text> : hint ? <Text variant="caption" color="textTertiary">{hint}</Text> : null}
    </View>
  );
}

/** Segmented control for 2–4 mutually exclusive options. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.colors.surface, borderRadius: t.radius.md, padding: 3 }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.sm + 2,
              backgroundColor: selected ? t.colors.cardElevated : 'transparent',
              borderWidth: selected ? StyleSheet.hairlineWidth : 0,
              borderColor: t.colors.border,
            }}>
            <Text variant="label" color={selected ? 'text' : 'textSecondary'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontally scrolling filter chips. */
export function ChipRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Filter: ${o.label}`}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: t.spacing.md,
              borderRadius: t.radius.pill,
              backgroundColor: selected ? t.colors.accentMuted : t.colors.card,
              borderWidth: 1,
              borderColor: selected ? t.colors.accent : t.colors.border,
            }}>
            {o.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.color }} />}
            <Text variant="label" color={selected ? 'accent' : 'textSecondary'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ProgressBar({ progress, color, label }: { progress: number; color?: string; label?: string }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surface, overflow: 'hidden' }}>
      <View style={{ width: `${p * 100}%`, height: '100%', borderRadius: 3, backgroundColor: color ?? t.colors.accent }} />
    </View>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: t.spacing.xxs }} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text variant="caption" color="textSecondary">{label}</Text>
      <Text variant="stat" numeric adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
      {sub && <Text variant="caption" color="textTertiary" numeric>{sub}</Text>}
    </View>
  );
}
