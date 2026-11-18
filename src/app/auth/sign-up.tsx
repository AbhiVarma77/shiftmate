/**
 * Sign-up screen
 * ──────────────
 * Supports:
 *  • Email + password account creation
 *  • Sign up with Google (OAuth)
 *  • Sign up with Apple (native, iOS only)
 *
 * On success Supabase sends a confirmation email; a banner guides the user.
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
import { supabase } from '@/lib/supabase';
import { oauthRedirectUrl, signInWithGoogle } from '@/services/authService';
import { useTheme } from '@/theme/ThemeProvider';

WebBrowser.maybeCompleteAuthSession();

export default function SignUp() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const c = t.colors;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  // -------------------------------------------------------------------------
  // Email / password sign-up
  // -------------------------------------------------------------------------
  const handleEmailSignUp = async () => {
    if (!name.trim()) {
      await showAlert('Missing name', 'Please enter your full name.');
      return;
    }
    if (!email.trim()) {
      await showAlert('Missing email', 'Please enter your email address.');
      return;
    }
    if (password.length < 8) {
      await showAlert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      await showAlert('Passwords do not match', 'Please make sure both passwords are the same.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: oauthRedirectUrl() },
      });
      if (error) throw error;
      // If email confirmation is required the session won't be set yet.
      setPendingConfirmation(true);
    } catch (e: unknown) {
      await showAlert('Sign-up failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------
  const handleGoogleSignUp = async () => {
    setLoading(true);
    try {
      if (await signInWithGoogle()) router.replace('/');
    } catch (e: unknown) {
      await showAlert('Google sign-up failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Apple Sign-In (iOS only)
  // -------------------------------------------------------------------------
  const handleAppleSignUp = async () => {
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
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      await showAlert('Apple sign-up failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render — confirmation banner
  // -------------------------------------------------------------------------
  if (pendingConfirmation) {
    return (
      <View
        style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}
      >
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="email" size={32} color={c.accent} />
        </View>
        <Text variant="title" align="center">
          Check your email
        </Text>
        <Text variant="body" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          We sent a confirmation link to{'\n'}
          <Text variant="bodyStrong">{email}</Text>
          {'\n\n'}Open it to activate your account, then come back to sign in.
        </Text>
        <Button label="Go to sign in" fullWidth onPress={() => router.replace('/auth/sign-in')} />
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Render — form
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
          <Text variant="display">Create account</Text>
          <Text variant="body" color="textSecondary">
            Track your hours, breaks and pay across all your jobs. Your records are saved to your account and follow you to any phone.
          </Text>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ gap: 12, marginTop: 32 }}>
          {/* Full name */}
          <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Icon name="person" size={18} color={c.textTertiary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="Full name"
              placeholderTextColor={c.textTertiary}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              autoCapitalize="words"
            />
          </View>

          {/* Email */}
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

          {/* Password */}
          <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Icon name="lock" size={18} color={c.textTertiary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="Password (min 8 characters)"
              placeholderTextColor={c.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} color={c.textTertiary} />
            </Pressable>
          </View>

          {/* Confirm password */}
          <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Icon name="lock" size={18} color={c.textTertiary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              placeholder="Confirm password"
              placeholderTextColor={c.textTertiary}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirm}
              autoComplete="new-password"
            />
            <Pressable onPress={() => setShowConfirm((s) => !s)} hitSlop={8}>
              <Icon name={showConfirm ? 'eye-off' : 'eye'} size={18} color={c.textTertiary} />
            </Pressable>
          </View>

          <Button
            label="Create account"
            size="lg"
            fullWidth
            onPress={handleEmailSignUp}
            loading={loading}
          />
        </Animated.View>

        {/* Divider */}
        <Animated.View entering={FadeInDown.delay(180).duration(400)} style={[styles.dividerRow, { marginTop: 24 }]}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <Text variant="caption" color="textTertiary">
            or sign up with
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </Animated.View>

        {/* OAuth buttons */}
        <Animated.View entering={FadeInDown.delay(240).duration(400)} style={{ gap: 12, marginTop: 16 }}>
          <Pressable
            onPress={handleGoogleSignUp}
            disabled={loading}
            style={[styles.oauthBtn, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <GoogleLogo />
            <Text variant="bodyStrong">Continue with Google</Text>
          </Pressable>

          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
              buttonStyle={
                t.scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={t.radius.md}
              style={{ width: '100%', height: 56 }}
              onPress={handleAppleSignUp}
            />
          )}
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ marginTop: 32, alignItems: 'center', gap: 4 }}>
          <Text variant="caption" color="textTertiary">
            Already have an account?
          </Text>
          <Pressable onPress={() => router.push('/auth/sign-in')} hitSlop={8}>
            <Text variant="bodyStrong" color="accent">
              Sign in
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function GoogleLogo() {
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

