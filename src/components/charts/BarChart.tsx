import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Shown when the bar is selected. */
  detail: string;
  muted?: boolean; // e.g. future days in an in-progress period
}

/** Lightweight, accessible bar chart. Tap a bar to see its value. */
export function BarChart({ bars, height = 140, color }: { bars: Bar[]; height?: number; color?: string }) {
  const t = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const sel = bars.find((b) => b.key === selected);
  const dense = bars.length > 12;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="label" color="textSecondary" numeric style={{ minHeight: 18 }}>
        {sel ? `${sel.label}: ${sel.detail}` : 'Tap a bar for details'}
      </Text>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: dense ? 2 : 8 }}>
        {bars.map((b) => {
          const h = b.value > 0 ? Math.max(4, (b.value / max) * height) : 2;
          const isSel = b.key === selected;
          return (
            <Pressable
              key={b.key}
              accessibilityRole="button"
              accessibilityLabel={`${b.label}: ${b.detail}`}
              onPress={() => setSelected(isSel ? null : b.key)}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View
                style={{
                  height: h,
                  borderRadius: dense ? 2 : 6,
                  backgroundColor: b.value === 0 ? t.colors.border : isSel ? (color ?? t.colors.accentSecondary) : (color ?? t.colors.accent),
                  opacity: b.muted ? 0.35 : selected && !isSel ? 0.5 : 1,
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: dense ? 2 : 8 }}>
        {bars.map((b, i) => (
          <Text key={b.key} variant="caption" color="textTertiary" align="center" style={{ flex: 1 }} numberOfLines={1}>
            {dense ? (i % 5 === 0 ? b.label : '') : b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
