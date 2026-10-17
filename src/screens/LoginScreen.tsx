/**
 * src/screens/LoginScreen.tsx
 *
 * Full rewrite — Supabase Auth replacing hardcoded credentials.
 *
 * Bug fixes from Loginscreenbugs.md:
 *  #1  Password visibility toggle        ✅ Already in Input.tsx (isPassword prop)
 *  #3  Session expiry handling           ✅ JWT auto-expiry 1hr/7-day refresh
 *  #4  No Forgot Password flow           ✅ ForgotPasswordModal
 *  #6  No rate limiting protection       ✅ Supabase built-in + 429 countdown UI
 *  #7  No email validation               ✅ Regex validation before submit
 *  #9  No offline detection              ✅ NetInfo check on submit
 *  #13 Error message auto-dismiss        ✅ 5s timeout
 *  #14 No keyboard "Go" button           ✅ returnKeyType="go" on password field
 *  #15 No app version display            ✅ Version in footer
 *  #20 No haptic feedback on error       ✅ expo-haptics on failure
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  Animated,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';

import { theme } from '../theme/colors';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { ForgotPasswordModal } from '../components/ForgotPasswordModal';
import { signIn } from '../services/auth';
import { UserProfile } from '../types/auth';

// Read from package.json at build time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require('../../package.json').version ?? '1.0.0';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Component ────────────────────────────────────────────────────────────────

interface LoginScreenProps {
  onLoginSuccess: (profile: UserProfile) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [errorMsg, setErrorMsg]             = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [forgotVisible, setForgotVisible]   = useState(false);

  // Bug #6: Rate-limit countdown state
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shakeAnim   = useRef(new Animated.Value(0)).current;
  const passwordRef = useRef<any>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bug #13: Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (errorMsg) {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setErrorMsg(null), 5000);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [errorMsg]);

  // Clean up rate-limit interval on unmount
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
    };
  }, []);

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: false }),
      Animated.timing(shakeAnim, { toValue:  8, duration: 60, useNativeDriver: false }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: false }),
      Animated.timing(shakeAnim, { toValue:  8, duration: 60, useNativeDriver: false }),
      Animated.timing(shakeAnim, { toValue:  0, duration: 60, useNativeDriver: false }),
    ]).start();
  }, [shakeAnim]);

  const showError = useCallback(
    (msg: string, rateLimit = false) => {
      // Bug #20: Haptic feedback on error
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg(msg);
      triggerShake();

      if (rateLimit) {
        // Show 60-second countdown for rate-limit errors
        setRateLimitSeconds(60);
        if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
        rateLimitTimerRef.current = setInterval(() => {
          setRateLimitSeconds((prev) => {
            if (prev <= 1) {
              clearInterval(rateLimitTimerRef.current!);
              rateLimitTimerRef.current = null;
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    },
    [triggerShake]
  );

  const handleLogin = useCallback(async () => {
    Keyboard.dismiss();
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorMsg(null);

    // Prevent login while rate-limited
    if (rateLimitSeconds > 0) {
      showError(`Too many attempts. Try again in ${rateLimitSeconds}s.`);
      return;
    }

    const emailVal = email.trim().toLowerCase();
    const passVal  = password;

    // Validation
    if (!emailVal || !passVal) {
      showError('Please enter your email and password.');
      return;
    }

    // Bug #7: Email format validation
    if (!EMAIL_REGEX.test(emailVal)) {
      showError('Please enter a valid email address.');
      return;
    }

    // Bug #9: Offline detection
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      showError('No internet connection. Check your network and try again.');
      return;
    }

    setLoading(true);

    const result = await signIn(emailVal, passVal);

    setLoading(false);

    if (result.error) {
      const isRateLimited = result.error.toLowerCase().includes('wait');
      showError(result.error, isRateLimited);
      return;
    }

    // Success
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onLoginSuccess(result.profile!);
  }, [email, password, rateLimitSeconds, showError, onLoginSuccess]);

  const isLocked = rateLimitSeconds > 0;

  return (
    <LinearGradient
      colors={theme.colors.bgGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.background}
    >
      <StatusBar barStyle="light-content" />

      {/* Background radial blobs */}
      <View style={[styles.blob, styles.blob1]} pointerEvents="none" />
      <View style={[styles.blob, styles.blob2]} pointerEvents="none" />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.contentContainer}>
            {/* Header / Logo */}
            <View style={styles.header}>
              <LinearGradient
                colors={['#A855F7', '#6D28D9']}
                style={styles.logoCard}
              >
                <MaterialCommunityIcons name="ruler" size={28} color="#FFFFFF" />
              </LinearGradient>
              <Text style={styles.title}>
                Tilor<Text style={styles.titleDot}>.</Text>
              </Text>
              <Text style={styles.subtitle}>Shop Estimator &amp; Billing Suite</Text>
            </View>

            {/* Glass Card */}
            <Animated.View
              style={[
                styles.glassCard,
                { transform: [{ translateX: shakeAnim }] },
              ]}
            >
              <Text style={styles.cardTitle}>Sign In</Text>

              {/* Error Banner */}
              {errorMsg && (
                <View style={styles.errorBanner}>
                  <Feather
                    name="alert-circle"
                    size={14}
                    color={theme.colors.errorText}
                    style={styles.errorIcon}
                  />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}

              {/* Rate-limit countdown banner */}
              {isLocked && !errorMsg && (
                <View style={styles.lockBanner}>
                  <Feather name="lock" size={14} color="#FBBF24" style={styles.errorIcon} />
                  <Text style={styles.lockText}>
                    Too many attempts. Retry in{' '}
                    <Text style={styles.lockSeconds}>{rateLimitSeconds}s</Text>
                  </Text>
                </View>
              )}

              {/* Bug #7: Email field (replacing Username) */}
              <Input
                label="Email address"
                iconName="mail"
                placeholder="you@example.com"
                value={email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errorMsg) setErrorMsg(null);
                }}
                error={!!errorMsg}
              />

              {/* Bug #1: Password with toggle (already supported by Input.tsx) */}
              <Input
                ref={passwordRef}
                label="Password"
                iconName="lock"
                placeholder="••••••••"
                isPassword
                value={password}
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMsg) setErrorMsg(null);
                }}
                error={!!errorMsg}
              />

              {/* Bug #4: Forgot Password link */}
              <TouchableOpacity
                style={styles.forgotRow}
                onPress={() => setForgotVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>

              {/* Submit */}
              <View style={styles.buttonWrapper}>
                <Button
                  title={isLocked ? `Locked (${rateLimitSeconds}s)` : 'Sign In'}
                  onPress={handleLogin}
                  loading={loading}
                  disabled={isLocked}
                />
              </View>
            </Animated.View>

            {/* Bug #15: App version footer */}
            <Text style={styles.versionText}>Tilor v{APP_VERSION} · Expo SDK 57</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Bug #4: Forgot Password Modal */}
      <ForgotPasswordModal
        visible={forgotVisible}
        onClose={() => setForgotVisible(false)}
      />
    </LinearGradient>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
  },
  blob1: {
    width: 320,
    height: 320,
    top: -80,
    right: -80,
    backgroundColor: theme.colors.blob1,
  },
  blob2: {
    width: 250,
    height: 250,
    bottom: -80,
    left: -80,
    backgroundColor: theme.colors.blob2,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCard: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0px 8px 24px rgba(124, 58, 237, 0.35)',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  titleDot: {
    color: theme.colors.accentPurple,
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(216, 180, 254, 0.5)',
    marginTop: 4,
  },
  glassCard: {
    width: '100%',
    backgroundColor: theme.colors.glassBg,
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    borderRadius: 28,
    padding: 24,
    boxShadow: '0px 24px 64px rgba(0, 0, 0, 0.4)',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.errorBg,
    borderWidth: 1,
    borderColor: theme.colors.errorBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  lockText: {
    fontSize: 12,
    color: '#FBBF24',
    fontWeight: '500',
    flex: 1,
  },
  lockSeconds: {
    fontWeight: '700',
  },
  errorIcon: {
    marginRight: 8,
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.errorText,
    fontWeight: '500',
    flex: 1,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 16,
    paddingVertical: 4,
  },
  forgotText: {
    fontSize: 12,
    color: '#C084FC',
    fontWeight: '600',
  },
  buttonWrapper: {
    marginTop: 4,
  },
  versionText: {
    fontSize: 10,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});
