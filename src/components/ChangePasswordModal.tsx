/**
 * src/components/ChangePasswordModal.tsx
 *
 * Cross-platform password change modal for Android, iOS, and Web.
 * Replaces iOS-only Alert.prompt() to eliminate Android app crashes.
 * Enforces:
 * - Current password re-authentication.
 * - Password complexity (min 8 chars, 1 uppercase, 1 lowercase, 1 number).
 * - Match verification.
 * - Optional forced 90-day rotation mode (cannot dismiss until updated).
 */

import React, { useState, useEffect, useRef } from 'react';
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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Input } from './Input';
import { Button } from './Button';
import { changePasswordWithReauth } from '../services/auth';
import { validatePasswordStrength } from '../utils/authValidation';
import { theme } from '../theme/colors';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  isForcedRotation?: boolean;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  visible,
  onClose,
  onSuccess,
  isForcedRotation = false,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  const strength = validatePasswordStrength(newPassword);

  useEffect(() => {
    if (visible) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
      slideAnim.setValue(40);
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError(null);

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (!strength.isValid) {
      setError(strength.error || 'Password does not meet complexity requirements.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password cannot be the same as your current password.');
      return;
    }

    setLoading(true);
    const result = await changePasswordWithReauth(currentPassword, newPassword);
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Failed to update password.');
      return;
    }

    onSuccess?.();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!isForcedRotation) onClose();
      }}
    >
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        {!isForcedRotation && (
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        )}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoidingView}
        >
          <Animated.View
            style={[
              styles.card,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconCircle}>
                  <MaterialCommunityIcons name="lock-reset" size={26} color="#7C3AED" />
                </View>
                <View style={styles.titleWrapper}>
                  <Text style={styles.title}>
                    {isForcedRotation ? 'Password Expired' : 'Change Password'}
                  </Text>
                  <Text style={styles.subtitle}>
                    {isForcedRotation
                      ? 'Staff passwords must be rotated every 90 days. Please set a new password.'
                      : 'Verify your current password and create a new secure password.'}
                  </Text>
                </View>
                {!isForcedRotation && (
                  <TouchableOpacity
                    onPress={onClose}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={styles.closeBtn}
                  >
                    <Feather name="x" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Error Banner */}
              {error && (
                <View style={styles.errorBanner}>
                  <Feather name="alert-circle" size={15} color="#DC2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Current Password Field */}
              <Input
                label="Current Password"
                iconName="lock"
                isPassword
                placeholder="Enter current password"
                value={currentPassword}
                onChangeText={(t) => { setCurrentPassword(t); setError(null); }}
                autoCapitalize="none"
                returnKeyType="next"
              />

              {/* New Password Field */}
              <Input
                label="New Password"
                iconName="lock"
                isPassword
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setError(null); }}
                autoCapitalize="none"
                returnKeyType="next"
              />

              {/* Password Requirements Checklist */}
              {newPassword.length > 0 && (
                <View style={styles.rulesContainer}>
                  <View style={styles.ruleItem}>
                    <Feather
                      name={strength.hasMinLength ? 'check-circle' : 'circle'}
                      size={12}
                      color={strength.hasMinLength ? '#16A34A' : '#9CA3AF'}
                    />
                    <Text style={[styles.ruleText, strength.hasMinLength && styles.ruleTextPass]}>
                      At least 8 characters
                    </Text>
                  </View>
                  <View style={styles.ruleItem}>
                    <Feather
                      name={strength.hasUppercase ? 'check-circle' : 'circle'}
                      size={12}
                      color={strength.hasUppercase ? '#16A34A' : '#9CA3AF'}
                    />
                    <Text style={[styles.ruleText, strength.hasUppercase && styles.ruleTextPass]}>
                      At least 1 uppercase letter (A-Z)
                    </Text>
                  </View>
                  <View style={styles.ruleItem}>
                    <Feather
                      name={strength.hasLowercase ? 'check-circle' : 'circle'}
                      size={12}
                      color={strength.hasLowercase ? '#16A34A' : '#9CA3AF'}
                    />
                    <Text style={[styles.ruleText, strength.hasLowercase && styles.ruleTextPass]}>
                      At least 1 lowercase letter (a-z)
                    </Text>
                  </View>
                  <View style={styles.ruleItem}>
                    <Feather
                      name={strength.hasNumber ? 'check-circle' : 'circle'}
                      size={12}
                      color={strength.hasNumber ? '#16A34A' : '#9CA3AF'}
                    />
                    <Text style={[styles.ruleText, strength.hasNumber && styles.ruleTextPass]}>
                      At least 1 number (0-9)
                    </Text>
                  </View>
                </View>
              )}

              {/* Confirm Password Field */}
              <Input
                label="Confirm New Password"
                iconName="lock"
                isPassword
                placeholder="Type new password again"
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />

              {/* Action Buttons */}
              <View style={styles.actions}>
                {!isForcedRotation && (
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={onClose}
                    disabled={loading}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.submitBtnWrapper}>
                  <Button
                    title="Update Password"
                    onPress={handleSubmit}
                    loading={loading}
                  />
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  avoidingView: {
    width: '100%',
    maxWidth: 440,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    maxHeight: '90%',
  },
  scrollContent: {
    flexGrow: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  titleWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 18,
  },
  closeBtn: {
    padding: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  rulesContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    marginTop: -8,
    marginBottom: 16,
    gap: 6,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ruleText: {
    fontSize: 12,
    color: '#6B7280',
  },
  ruleTextPass: {
    color: '#16A34A',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4B5563',
  },
  submitBtnWrapper: {
    flex: 2,
  },
});
