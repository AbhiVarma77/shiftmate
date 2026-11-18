import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/data';
import { useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';

const SLIDES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'timer', title: 'Track every hour', body: 'One tap to start and stop. Your timer survives closing the app or restarting your phone.' },
  { icon: 'briefcase', title: 'All your jobs, one place', body: 'Separate employers, rates, schedules and records — never mixed up.' },
  { icon: 'money', title: 'Know what you have earned', body: 'Accurate gross estimates with overtime and historical pay rates.' },
  { icon: 'analytics', title: 'See the bigger picture', body: 'Daily, weekly and monthly reports, plus comparisons between periods and employers.' },
  { icon: 'lock', title: 'Safe in your account', body: 'Everything is saved on this device and backed up to your account, so it follows you to any phone or browser.' },
];

export default function Onboarding() {
  const t = useTheme();
  const db = useDb();
  const insets = useSafeAreaInsets();
  const update = useSettingsStore((s) => s.update);
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  const finish = async () => {
    await update(db, 'onboardingComplete', true);
    router.replace('/(tabs)');
    router.push('/jobs/form');
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: insets.top + t.spacing.xxl, paddingBottom: insets.bottom + t.spacing.xl, paddingHorizontal: t.spacing.xxl }}>
      <Animated.View entering={FadeInDown.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="clock" size={18} color={t.colors.onAccent} />
        </View>
        <Text variant="heading">ShiftMate</Text>
      </Animated.View>

      <View style={{ flex: 1, justifyContent: 'center', gap: t.spacing.xl }}>
        <Animated.View key={i} entering={FadeInRight.duration(320)} style={{ gap: t.spacing.xl }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={slide.icon} size={32} color={t.colors.accent} />
          </View>
          <Text variant="display" accessibilityRole="header">{slide.title}</Text>
          <Text variant="body" color="textSecondary" style={{ fontSize: 17, lineHeight: 26 }}>{slide.body}</Text>
        </Animated.View>
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`Step ${i + 1} of ${SLIDES.length}`}>
          {SLIDES.map((_, k) => (
            <View key={k} style={{ height: 6, width: k === i ? 22 : 6, borderRadius: 3, backgroundColor: k === i ? t.colors.accent : t.colors.borderStrong }} />
          ))}
        </View>
      </View>

      <View style={{ gap: t.spacing.md }}>
        {last ? (
          <>
            <Text variant="caption" color="textTertiary" align="center">Your Work. Your Time. Your Earnings.</Text>
            <Button label="Get started" size="lg" fullWidth onPress={finish} testID="onboarding-start" />
          </>
        ) : (
          <>
            <Button label="Continue" size="lg" fullWidth onPress={() => setI(i + 1)} testID="onboarding-next" />
            <Button label="Skip" variant="ghost" fullWidth onPress={() => setI(SLIDES.length - 1)} haptic={false} />
          </>
        )}
      </View>
    </View>
  );
}
