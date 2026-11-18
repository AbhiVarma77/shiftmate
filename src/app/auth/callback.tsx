/**
 * OAuth redirect target (`/auth/callback`).
 * Web: finishes the PKCE code exchange after Supabase redirects back.
 * Native: the auth session browser already handled the URL, so just move on.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { completeOAuthFromUrl } from '@/services/authService';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthCallback() {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      router.replace('/');
      return;
    }
    completeOAuthFromUrl(window.location.href)
      .then(() => router.replace('/'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.'));
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: t.colors.background }}>
      {error ? (
        <>
          <Text variant="title" align="center">Google sign-in failed</Text>
          <Text variant="body" color="textSecondary" align="center" style={{ maxWidth: 360 }}>{error}</Text>
          <Button label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
        </>
      ) : (
        <>
          <ActivityIndicator color={t.colors.accent} />
          <Text variant="body" color="textSecondary">Signing you in…</Text>
        </>
      )}
    </View>
  );
}
