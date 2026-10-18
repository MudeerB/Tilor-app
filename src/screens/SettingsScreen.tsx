import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { supabase } from '../services/supabase';
import { activityLogService } from '../services/activityLog';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { daysUntilPasswordExpiry } from '../utils/authValidation';
import { hapticFeedback } from '../utils/haptics';
import { dataCache } from '../services/dataCache';

interface SettingsScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

interface SettingRowProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeBg?: string;
  badgeColor?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}

const SETTINGS_KEY = 'tilor_settings';

const SettingRow: React.FC<SettingRowProps> = ({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  badge,
  badgeBg = '#F3E8FF',
  badgeColor = '#7C3AED',
  onPress,
  rightElement,
  danger = false,
}) => (
  <TouchableOpacity
    style={styles.settingRow}
    onPress={onPress}
    activeOpacity={onPress ? 0.7 : 1}
    disabled={!onPress}
  >
    <View style={[styles.settingIconBox, { backgroundColor: iconBg }]}>
      <Feather name={icon} size={16} color={iconColor} />
    </View>
    <View style={styles.settingTextGroup}>
      <View style={styles.settingTitleRow}>
        <Text style={[styles.settingTitle, danger && { color: '#EF4444' }]}>{title}</Text>
        {badge ? (
          <View style={[styles.rowBadge, { backgroundColor: badgeBg }]}>
            <Text style={[styles.rowBadgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.settingSubtitle}>{subtitle}</Text> : null}
    </View>
    {rightElement ?? (onPress && (
      <Feather name="chevron-right" size={16} color={danger ? '#EF4444' : '#CBD5E0'} />
    ))}
  </TouchableOpacity>
);

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [lowStockAlerts, setLowStockAlerts]       = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState(15);
  const [changePasswordModalVisible, setChangePasswordModalVisible] = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem(SETTINGS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.lowStockAlerts !== undefined) setLowStockAlerts(parsed.lowStockAlerts);
          if (parsed.lowStockThreshold !== undefined) setLowStockThreshold(parsed.lowStockThreshold);
        }
      } catch (err) {
        console.error('Error loading settings:', err);
      }
    };
    loadSettings();
  }, []);

  const saveSetting = async (key: string, value: any, rollbackFn?: () => void) => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      const current = stored ? JSON.parse(stored) : {};
      current[key] = value;
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch (err) {
      console.error('Error saving setting:', err);
      if (rollbackFn) rollbackFn();
      Alert.alert('Save Failed', 'Could not save your preferences to local storage.');
    }
  };

  const handleToggleLowStock = (val: boolean) => {
    hapticFeedback.light();
    const prev = lowStockAlerts;
    setLowStockAlerts(val);
    saveSetting('lowStockAlerts', val, () => setLowStockAlerts(prev));
  };

  const handleSetThreshold = (val: number) => {
    hapticFeedback.selection();
    const clamped = Math.max(1, Math.min(100, val));
    const prev = lowStockThreshold;
    setLowStockThreshold(clamped);
    saveSetting('lowStockThreshold', clamped, () => setLowStockThreshold(prev));
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              dataCache.clear();
              const { error } = await supabase.auth.signOut();
              if (error) {
                console.warn('[Settings] Supabase sign out notice:', error.message);
              }
            } catch (err) {
              console.warn('[Settings] Supabase sign out exception:', err);
            } finally {
              onLogout();
            }
          },
        },
      ]
    );
  };

  const handleClearLocalCache = () => {
    Alert.alert(
      'Clear Local Cache & Drafts',
      'This will remove offline estimate drafts, temporary cached bills, and local catalog snapshots stored on this device.\n\n✓ Your cloud data on Supabase (customers, inventory, past invoices) and login session will NOT be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              dataCache.clear();
              const keys = [
                'tilor_current_draft',
                'tilor_saved_estimate',
                'tilor_pending_bill',
                'tilor_active_direct_bill',
                'tilor_tile_catalog',
                'tilor_customers',
                'tilor_invoices',
                'tilor_credit_ledger',
              ];
              await AsyncStorage.multiRemove(keys);
              hapticFeedback.success();
              Alert.alert('Local Cache Cleared', 'Offline drafts and temporary cache have been successfully cleared from this device.');
            } catch (err) {
              hapticFeedback.error();
              Alert.alert('Error', 'Failed to clear local cache.');
            }
          },
        },
      ]
    );
  };

  const handleAdminPurgeAuditLogs = () => {
    Alert.alert(
      'Purge Aged Audit Logs',
      'Permanently delete security audit logs older than 2 years (730 days) across all shops?\n\nThis administrative maintenance action will be permanently recorded in the security audit ledger.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge Logs',
          style: 'destructive',
          onPress: async () => {
            const res = await activityLogService.adminPurgeOldAuditLogs(2);
            if (res.success) {
              Alert.alert(
                'Maintenance Complete',
                `Successfully purged ${res.deletedCount ?? 0} archived audit logs older than 2 years.`
              );
            } else {
              Alert.alert('Purge Failed', res.error || 'Failed to purge audit logs.');
            }
          },
        },
      ]
    );
  };

  const displayName = session.full_name || session.username || session.email || 'User';
  const passwordDaysRemaining = daysUntilPasswordExpiry(session.password_changed_at);
  const THRESHOLD_PRESETS = [5, 10, 15, 20, 25];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Banner - Edge-to-Edge */}
        <LinearGradient
          colors={['#5B21B6', '#6D28D9', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            {/* App Bar */}
            <View style={styles.appBar}>
              <View style={styles.logoRow}>
                <View style={styles.logoIcon}>
                  <Feather name="settings" size={16} color="#FFF" />
                </View>
                <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
              </View>
              <View style={styles.headerRightBadge}>
                <Text style={styles.headerRightText}>SETTINGS</Text>
              </View>
            </View>

            {/* Profile Hero */}
            <View style={styles.profileHero}>
              <LinearGradient colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.1)']} style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
              </LinearGradient>
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{displayName}</Text>
                <View style={styles.rolePillsRow}>
                  <View style={styles.rolePill}>
                    <View
                      style={[
                        styles.roleIndicator,
                        session.role === 'admin'
                          ? { backgroundColor: '#F59E0B' }
                          : session.role === 'owner'
                          ? { backgroundColor: '#10B981' }
                          : { backgroundColor: '#60A5FA' },
                      ]}
                    />
                    <Text style={styles.rolePillText}>
                      {session.role === 'admin'
                        ? 'Platform Admin'
                        : session.role === 'owner'
                        ? 'Store Owner'
                        : 'Operations Staff'}
                    </Text>
                  </View>
                  {session.shop_id ? (
                    <View style={styles.shopPill}>
                      <Feather name="home" size={9} color="#E9D5FF" />
                      <Text style={styles.shopPillText}>Shop #{session.shop_id.slice(0, 6).toUpperCase()}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Main Content Area */}
        <View style={styles.innerContent}>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 1. ACCOUNT & CREDENTIALS                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>ACCOUNT &amp; CREDENTIALS</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="mail"
            iconBg="#F3E8FF"
            iconColor="#7C3AED"
            title="Signed-in Account"
            subtitle={session.email || session.username}
          />
          <View style={styles.divider} />
          <SettingRow
            icon="key"
            iconBg="#FEF3C7"
            iconColor="#D97706"
            title="Password &amp; Security"
            subtitle={
              passwordDaysRemaining > 0
                ? `Rotates every 90 days · ${passwordDaysRemaining} days remaining`
                : 'Password expired · Rotation required'
            }
            badge={passwordDaysRemaining <= 0 ? 'Expired' : `${passwordDaysRemaining}d left`}
            badgeBg={passwordDaysRemaining <= 0 ? '#FEE2E2' : '#FEF3C7'}
            badgeColor={passwordDaysRemaining <= 0 ? '#DC2626' : '#D97706'}
            onPress={() => setChangePasswordModalVisible(true)}
          />
          <View style={styles.divider} />
          <SettingRow
            icon="clock"
            iconBg="#F0FDF4"
            iconColor="#22C55E"
            title="Current Session Started"
            subtitle={new Date(session.time).toLocaleString('en-IN', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          />
        </View>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 2. NOTIFICATIONS & INVENTORY ALERTS                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>NOTIFICATIONS &amp; INVENTORY ALERTS</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="bell"
            iconBg="#FFF7ED"
            iconColor="#F97316"
            title="Low Stock Alerts"
            subtitle={
              lowStockAlerts
                ? `Highlight products when warehouse stock drops below ${lowStockThreshold} boxes`
                : 'Low stock replenishment warnings are currently turned off'
            }
            rightElement={
              <Switch
                value={lowStockAlerts}
                onValueChange={handleToggleLowStock}
                trackColor={{ false: '#E2E8F0', true: '#DDD6FE' }}
                thumbColor={lowStockAlerts ? '#7C3AED' : '#CBD5E0'}
              />
            }
          />

          {/* Interactive Threshold Configurator */}
          {lowStockAlerts && (
            <View style={styles.thresholdBox}>
              <View style={styles.thresholdHeaderRow}>
                <Text style={styles.thresholdTitle}>Alert Threshold</Text>
                <View style={styles.thresholdStepper}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => handleSetThreshold(lowStockThreshold - 1)}
                    activeOpacity={0.7}
                  >
                    <Feather name="minus" size={14} color="#7C3AED" />
                  </TouchableOpacity>
                  <View style={styles.thresholdValBadge}>
                    <Text style={styles.thresholdValText}>{lowStockThreshold} bx</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => handleSetThreshold(lowStockThreshold + 1)}
                    activeOpacity={0.7}
                  >
                    <Feather name="plus" size={14} color="#7C3AED" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Quick Preset Chips */}
              <View style={styles.presetChipsRow}>
                {THRESHOLD_PRESETS.map((p) => {
                  const isActive = lowStockThreshold === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.presetChip, isActive && styles.presetChipActive]}
                      onPress={() => handleSetThreshold(p)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.presetChipText, isActive && styles.presetChipTextActive]}>
                        {p} bx
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 3. APP PREFERENCES                                                  */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>APP PREFERENCES</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="globe"
            iconBg="#EFF6FF"
            iconColor="#3B82F6"
            title="Billing Currency"
            subtitle="Indian Rupee (₹ INR)"
            badge="Standard"
            badgeBg="#DBEAFE"
            badgeColor="#1E40AF"
          />
        </View>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 4. ABOUT & SYSTEM                                                   */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>ABOUT &amp; SYSTEM</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="info"
            iconBg="#F0FDF4"
            iconColor="#16A34A"
            title="App Release Version"
            subtitle="Tilor v1.0.0"
          />
        </View>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 5. MAINTENANCE & DIAGNOSTICS                                        */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>MAINTENANCE &amp; DIAGNOSTICS</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="refresh-cw"
            iconBg="#FEF2F2"
            iconColor="#DC2626"
            title="Clear Local Offline Cache &amp; Drafts"
            subtitle="Remove temporary offline drafts &amp; cached records from this device"
            onPress={handleClearLocalCache}
          />
          {session.role === 'admin' && (
            <>
              <View style={styles.divider} />
              <SettingRow
                icon="shield"
                iconBg="#FEF2F2"
                iconColor="#DC2626"
                title="Purge Audit Logs (> 2 Years Old)"
                subtitle="Permanently clear archived security audit logs older than 730 days"
                onPress={handleAdminPurgeAuditLogs}
              />
            </>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 6. DANGER ZONE                                                      */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.sectionHeader}>DANGER ZONE</Text>
        <View style={styles.settingsCard}>
          <SettingRow
            icon="log-out"
            iconBg="#FEF2F2"
            iconColor="#EF4444"
            title="Sign Out"
            subtitle={`Signed in as ${displayName}`}
            onPress={handleLogout}
            danger
          />
        </View>

        <Text style={styles.footerNote}>
          Tilor · Shop Estimator &amp; Billing Suite{'\n'}Made with ♥ for tile merchants &amp; warehouse teams
        </Text>

        <View style={{ height: 28 }} />
      </View>
      </ScrollView>

      <BottomNavBar
        activeTab={activeTab}
        onTabPress={onTabChange}
        isOwner={session.role === 'owner' || session.role === 'admin'}
      />

      <ChangePasswordModal
        visible={changePasswordModalVisible}
        onClose={() => setChangePasswordModalVisible(false)}
        onSuccess={() => Alert.alert('Success', 'Password updated successfully!')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  header: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 20 },
  safeHeader: { paddingHorizontal: 20 },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  logoText: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  logoDot: { color: '#C084FC' },
  headerRightBadge: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  headerRightText: { fontSize: 10, fontWeight: '800', color: '#FFF', letterSpacing: 0.8 },

  // Profile Hero
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },
  avatarCircle: { width: 62, height: 62, borderRadius: 31, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  avatarInitial: { fontSize: 26, fontWeight: '800', color: '#FFF' },
  profileText: { flex: 1 },
  profileName: { fontSize: 19, fontWeight: '800', color: '#FFF', textTransform: 'capitalize' },
  rolePillsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  rolePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 6 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3 },
  rolePillText: { fontSize: 11, color: '#FFF', fontWeight: '700' },
  shopPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, gap: 5 },
  shopPillText: { fontSize: 10, color: '#E9D5FF', fontWeight: '600' },

  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 56 },
  innerContent: { paddingHorizontal: 16, paddingTop: 14 },
  sectionHeader: { fontSize: 11, fontWeight: '800', color: '#7C3AED', letterSpacing: 1.2, marginTop: 22, marginBottom: 8, marginLeft: 4 },

  // Cards & Rows
  settingsCard: { backgroundColor: '#FFF', borderRadius: 20, borderWidth: 1, borderColor: '#F3E8FF', overflow: 'hidden', boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  settingIconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  settingTextGroup: { flex: 1 },
  settingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingTitle: { fontSize: 15, fontWeight: '600', color: '#1E293B' },
  rowBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  rowBadgeText: { fontSize: 10, fontWeight: '800' },
  settingSubtitle: { fontSize: 13, color: '#64748B', marginTop: 3, lineHeight: 18 },
  divider: { height: 1, backgroundColor: '#F8F6FF', marginLeft: 66 },

  // Threshold Box
  thresholdBox: {
    backgroundColor: '#FAF5FF',
    marginHorizontal: 14,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3E8FF',
  },
  thresholdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  thresholdTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  thresholdStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 2,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3E8FF',
  },
  thresholdValBadge: {
    paddingHorizontal: 10,
  },
  thresholdValText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7C3AED',
  },
  presetChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 7,
    backgroundColor: '#FFF',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  presetChipActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
  },
  presetChipTextActive: {
    color: '#FFF',
  },

  footerNote: { textAlign: 'center', fontSize: 11, color: '#CBD5E0', marginTop: 28, marginBottom: 8, lineHeight: 18 },
});
