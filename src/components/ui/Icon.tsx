import { type AndroidSymbol, SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useTheme } from '@/theme/ThemeProvider';

/** One semantic icon name → SF Symbol (iOS) + Material Symbol (Android/web). */
export const ICONS = {
  home: { ios: 'house.fill', android: 'home' },
  analytics: { ios: 'chart.bar.fill', android: 'bar_chart' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  compare: { ios: 'arrow.left.arrow.right', android: 'compare_arrows' },
  settings: { ios: 'gearshape.fill', android: 'settings' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  stop: { ios: 'stop.fill', android: 'stop' },
  pause: { ios: 'pause.fill', android: 'pause' },
  coffee: { ios: 'cup.and.saucer.fill', android: 'coffee' },
  add: { ios: 'plus', android: 'add' },
  briefcase: { ios: 'briefcase.fill', android: 'work' },
  clock: { ios: 'clock', android: 'schedule' },
  calendar: { ios: 'calendar', android: 'calendar_month' },
  money: { ios: 'banknote', android: 'payments' },
  up: { ios: 'arrow.up.right', android: 'trending_up' },
  down: { ios: 'arrow.down.right', android: 'trending_down' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  edit: { ios: 'pencil', android: 'edit' },
  trash: { ios: 'trash', android: 'delete' },
  archive: { ios: 'archivebox', android: 'archive' },
  check: { ios: 'checkmark', android: 'check' },
  close: { ios: 'xmark', android: 'close' },
  timer: { ios: 'timer', android: 'timer' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  person: { ios: 'person.crop.circle', android: 'person' },
  cloud: { ios: 'icloud.and.arrow.up', android: 'cloud_upload' },
  bell: { ios: 'bell', android: 'notifications' },
  palette: { ios: 'paintpalette', android: 'palette' },
  download: { ios: 'square.and.arrow.down', android: 'download' },
  lock: { ios: 'lock.fill', android: 'lock' },
  info: { ios: 'info.circle', android: 'info' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  email: { ios: 'envelope.fill', android: 'mail' },
  eye: { ios: 'eye.fill', android: 'visibility' },
  'eye-off': { ios: 'eye.slash.fill', android: 'visibility_off' },
} as const satisfies Record<string, { ios: SFSymbol; android: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const t = useTheme();
  const def = ICONS[name];
  return (
    <SymbolView
      name={{ ios: def.ios, android: def.android, web: def.android }}
      size={size}
      tintColor={color ?? t.colors.text}
      weight="medium"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
