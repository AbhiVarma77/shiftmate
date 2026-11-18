import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DatabaseGate } from '@/components/DatabaseGate';
import { DialogHost } from '@/components/ui/Dialog';
import { Loading } from '@/components/ui/Layout';
import { useDb } from '@/hooks/data';
import { useAuthGate } from '@/hooks/useAuthGate';
import { useCloudSync } from '@/hooks/useCloudSync';
import { upsertLocalUser } from '@/repositories/userRepository';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DatabaseGate>
        <Bootstrap>
          <ThemeProvider>
            <Navigator />
          </ThemeProvider>
        </Bootstrap>
      </DatabaseGate>
    </GestureHandlerRootView>
  );
}

function Bootstrap({ children }: { children: ReactNode }) {
  const db = useDb();
  const loaded = useSettingsStore((s) => s.loaded);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  useCloudSync();

  useEffect(() => {
    hydrate(db).finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, [db, hydrate]);

  // Subscribe to Supabase auth state changes (sign-in / sign-out / token refresh).
  useEffect(() => {
    const unsubscribe = initAuth();
    return unsubscribe;
  }, [initAuth]);

  // Persist authenticated user to local SQLite so shifts/jobs can FK to them.
  useEffect(() => {
    if (!user) return;
    upsertLocalUser(db, user).catch((e: unknown) =>
      console.warn('[ShiftMate] Failed to persist user locally:', e),
    );
  }, [db, user]);

  if (!loaded || authStatus === 'loading') return <Loading />;
  return <>{children}</>;
}

function Navigator() {
  const t = useTheme();
  useAuthGate();
  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.background }, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="auth" options={{ animation: 'fade' }} />
        <Stack.Screen name="shifts/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="jobs/form" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <DialogHost />
    </>
  );
}
