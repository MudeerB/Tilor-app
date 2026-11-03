import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, ScrollView, TouchableOpacity } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { supabase } from '../services/supabase';
import { theme } from '../theme/colors';
import { validatePasswordStrength } from '../utils/authValidation';
import { activityLogService } from '../services/activityLog';

interface UpdatePasswordScreenProps {
  onSuccess: () => void;
  onSignOut?: () => void;
}

export const UpdatePasswordScreen: React.FC<UpdatePasswordScreenProps> = ({ onSuccess, onSignOut }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    Keyboard.dismiss();
    setError(null);

    const strength = validatePasswordStrength(password);
    if (!strength.isValid) {
      setError(strength.error || 'Password does not meet complexity requirements.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (!updateError) {
      const nowIso = new Date().toISOString();
      try {
        await supabase.rpc('record_password_change');
      } catch {}
      try {
        const { data: authSession } = await supabase.auth.getSession();
        const uid = authSession?.session?.user?.id;
        if (uid) {
          const { data: u } = await supabase
            .from('users')
            .update({ password_changed_at: nowIso })
            .eq('id', uid)
            .select('shop_id, email, full_name, role')
            .single();

          if (u?.shop_id) {
            activityLogService.logActivity({
              shopId: u.shop_id,
              userId: uid,
              userName: u.full_name || u.email,
              userRole: u.role,
              entityType: 'user',
              entityId: uid,
              entityName: u.full_name || u.email,
              action: 'password_rotated',
              details: { reason: 'mandatory_first_login_or_expiry_rotation' },
            }).catch(() => {});
          }
        }
      } catch {}
    }
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      onSuccess();
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="lock-reset" size={32} color="#A855F7" />
            </View>
            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
              Please enter your new password below.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color={theme.colors.errorText} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Input
            label="New Password"
            iconName="lock"
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            value={password}
            onChangeText={(t) => { setPassword(t); setError(null); }}
            secureTextEntry
            autoCapitalize="none"
            returnKeyType="next"
          />

          <Input
            label="Confirm Password"
            iconName="lock"
            placeholder="Type it again"
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
            secureTextEntry
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleUpdate}
          />

          <View style={styles.btnWrapper}>
            <Button
              title="Update Password"
              onPress={handleUpdate}
              loading={loading}
            />
          </View>

          {onSignOut && (
            <TouchableOpacity
              onPress={onSignOut}
              style={styles.signOutBtn}
              activeOpacity={0.7}
            >
              <Feather name="log-out" size={14} color="#C084FC" />
              <Text style={styles.signOutBtnText}>Cancel & Sign Out</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0920', // Tilor deep background
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1A1230',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(168,85,247,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.2)',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(216,180,254,0.6)',
    textAlign: 'center',
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
    marginBottom: 20,
  },
  errorText: {
    fontSize: 13,
    color: theme.colors.errorText,
    flex: 1,
  },
  btnWrapper: {
    marginTop: 24,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 10,
  },
  signOutBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C084FC',
  },
});
