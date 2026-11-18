import { NativeTabs } from 'expo-router/native-tabs';

import { ICONS } from '@/components/ui/Icon';
import { useTheme } from '@/theme/ThemeProvider';

const TABS = [
  { name: 'index', label: 'Home', icon: ICONS.home },
  { name: 'analytics', label: 'Analytics', icon: ICONS.analytics },
  { name: 'history', label: 'History', icon: ICONS.history },
  { name: 'comparison', label: 'Compare', icon: ICONS.compare },
  { name: 'settings', label: 'Settings', icon: ICONS.settings },
] as const;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs
      backgroundColor={t.colors.surface}
      indicatorColor={t.colors.accentMuted}
      iconColor={{ default: t.colors.textTertiary, selected: t.colors.accent }}
      labelStyle={{ default: { color: t.colors.textTertiary }, selected: { color: t.colors.accent } }}
      tintColor={t.colors.accent}>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.icon.ios} md={tab.icon.android} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
