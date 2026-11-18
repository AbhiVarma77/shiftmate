import { Redirect } from 'expo-router';

import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';

/** Entry: sign up / sign in first, then onboarding (once), then the app. */
export default function Index() {
  const status = useAuthStore((s) => s.status);
  const onboardingDone = useSettingsStore((s) => s.settings.onboardingComplete);

  if (status === 'loading') return null;
  if (status === 'unauthenticated') return <Redirect href="/auth/sign-up" />;
  return <Redirect href={onboardingDone ? '/(tabs)' : '/onboarding'} />;
}
