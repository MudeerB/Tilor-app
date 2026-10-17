/**
 * src/components/ForgotPasswordModal.tsx
 *
 * Modal for password reset flow.
 * Calls supabase.auth.resetPasswordForEmail() and shows confirmation.
 * Fixes Bug #4 from Loginscreenbugs.md: No Forgot Password Flow
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Keyboard,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Input } from './Input';
import { Button } from './Button';
import { resetPassword } from '../services/auth';
import { theme } from '../theme/colors';

interface ForgotPasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  visible,
  onClose,
}) => {
  const [email, setEmail]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [sent, setSent]           = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    if (visible) {
      setSent(false);
      setEmail('');
      setError(null);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
      slideAnim.setValue(40);
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleSend = async () => {
    Keyboard.dismiss();
    setError(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    const err = await resetPassword(email.trim());
    setLoading(false);

    if (err) {
      setError(err);
    } else {
      setSent(true);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={Keyboard.dismiss}>
        <Animated.View
          style={[
            styles.sheet,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Feather name="mail" size={20} color="#A855F7" />
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Feather name="x" size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <Text style={styles.title}>Reset Password</Text>

          {!sent ? (
            <>
              <Text style={styles.desc}>
                Enter the email address linked to your account and we'll send a reset link.
              </Text>

              {error && (
                <View style={styles.errorBanner}>
                  <Feather name="alert-circle" size={13} color={theme.colors.errorText} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Input
                label="Email address"
                iconName="mail"
                placeholder="you@example.com"
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                error={!!error}
              />

              <View style={styles.actions}>
                <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <View style={styles.sendBtnWrapper}>
                  <Button
                    title="Send Reset Link"
                    onPress={handleSend}
                    loading={loading}
                  />
                </View>
              </View>
            </>
          ) : (
            /* Success state */
            <View style={styles.successState}>
              <View style={styles.successIcon}>
                <Feather name="check-circle" size={36} color="#22C55E" />
              </View>
              <Text style={styles.successTitle}>Check your email</Text>
              <Text style={styles.successDesc}>
                We've sent a password reset link to{'\n'}
                <Text style={styles.successEmail}>{email}</Text>
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1A1230',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(168,85,247,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    alignSelf: 'flex-start',
    maxWidth: 44,
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  desc: {
    fontSize: 13,
    color: 'rgba(216,180,254,0.6)',
    lineHeight: 20,
    marginBottom: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.errorText,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 14,
    color: 'rgba(216,180,254,0.5)',
    fontWeight: '500',
  },
  sendBtnWrapper: {
    flex: 1,
  },
  successState: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  successDesc: {
    fontSize: 13,
    color: 'rgba(216,180,254,0.6)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  successEmail: {
    color: '#C084FC',
    fontWeight: '600',
  },
  doneBtn: {
    backgroundColor: 'rgba(168,85,247,0.2)',
    borderRadius: 14,
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.3)',
  },
  doneBtnText: {
    color: '#C084FC',
    fontSize: 14,
    fontWeight: '600',
  },
});
