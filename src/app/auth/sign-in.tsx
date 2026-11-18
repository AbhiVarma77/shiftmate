/**
 * Sign-in screen
 * ─────────────
 * Supports:
 *  • Email + password
 *  • Sign in with Google (OAuth via expo-auth-session)
 *  • Sign in with Apple  (native via expo-apple-authentication)
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { showAlert } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { signInWithGoogle } from '@/services/authService';
import { useTheme } from '@/theme/ThemeProvider';

// Required for OAuth redirect handling on mobile.
WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const c = t.colors;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // -------------------------------------------------------------------------
  // Not configured guard
  // -------------------------------------------------------------------------
  const notConfigured = !isSupabaseConfigured;

  // -------------------------------------------------------------------------
  // Email / password sign-in
  // -------------------------------------------------------------------------
  const handleEmailSignIn = async () => {
    if (!email.trim() || !password) {
      await showAlert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      // Auth state listener in _layout.tsx will redirect automatically.
    } catch (e: unknown) {
      await showAlert('Sign-in failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------
  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      if (await signInWithGoogle()) router.replace('/');
    } catch (e: unknown) {
      await showAlert('Google sign-in failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Apple Sign-In (iOS only)
  // -------------------------------------------------------------------------
  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token from Apple');

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return; // user dismissed
      await showAlert('Apple sign-in failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32, backgroundColor: c.background },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        {router.canGoBack() && (
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
            <Icon name="back" size={22} color={c.text} />
          </Pressable>
        )}

        {/* Logo */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.logoRow}>
          <View style={[styles.logoBox, { backgroundColor: c.accent }]}>
            <Icon name="clock" size={18} color={c.onAccent} />
          </View>
          <Text variant="heading">ShiftMate</Text>
        </Animated.View>

        {/* Title */}
        <Animated.View entering={FadeInDown.delay(60).duration(400)} style={{ gap: 6, marginTop: 32 }}>
          <Text variant="display">Welcome back</Text>
          <Text variant="body" color="textSecondary">
            Sign in to pick up right where you left off
          </Text>
        </Animated.View>

        {/* Not-configured banner */}
        {notConfigured && (
          <Animated.View
            entering={FadeInDown.delay(80).duration(400)}
            style={{ marginTop: 20, padding: 14, borderRadius: t.radius.md, backgroundColor: t.colors.warningMuted, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
          >
            <Icon name="warning" size={18} color={t.colors.warning} />
            <Text variant="caption" style={{ flex: 1, color: t.colors.warning, lineHeight: 18 }}>
              Supabase is not configured yet. Add your project URL and anon key to <Text variant="caption" style={{ fontFamily: 'Inter_600SemiBold', color: t.colors.warning }}>.env.local</Text> to enable sign-in.
            </Text>
          </Animated.View>
        )}

        {/* Form */}
        <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ gap: 12, marginTop: 32 }}>
          <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Icon name="email" size={18} color={c.textTertiary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="Email address"
              placeholderTextColor={c.textTertiary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />
          </View>

          <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Icon name="lock" size={18} color={c.textTertiary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="Password"
              placeholderTextColor={c.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} color={c.textTertiary} />
            </Pressable>
          </View>

          <Button label="Sign in" size="lg" fullWidth onPress={handleEmailSignIn} loading={loading} />
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(180).duration(400)} style={[styles.dividerRow, { marginTop: 24 }]}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <Text variant="caption" color="textTertiary">
            or continue with
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* OAuth buttons */}
        <Animated.View entering={FadeInDown.delay(240).duration(400)} style={{ gap: 12, marginTop: 16 }}>
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={loading}
            style={[styles.oauthBtn, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <GoogleLogo />
            <Text variant="bodyStrong">Continue with Google</Text>
          </Pressable>

          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                t.scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={t.radius.md}
              style={{ width: '100%', height: 56 }}
              onPress={handleAppleSignIn}
            />
          )}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ marginTop: 32, alignItems: 'center', gap: 4 }}>
          <Text variant="caption" color="textTertiary">
            Don&apos;t have an account?
          </Text>
          <Pressable onPress={() => router.push('/auth/sign-up')} hitSlop={8}>
            <Text variant="bodyStrong" color="accent">
              Create account
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Google SVG logo (no external dependency) ─────────────────────────────
function GoogleLogo() {
  // Simple coloured "G" text as a substitute to avoid SVG libraries.
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: '#4285F4' }}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  back: { marginBottom: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoBox: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 56,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
