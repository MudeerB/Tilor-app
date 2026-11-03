/**
 * src/screens/SuperadminPortalScreen.tsx
 *
 * Store-Centric Superadmin Portal.
 * Top level: Displays ONLY the list of registered showrooms.
 * Clicking on any showroom drills down into that showroom's dedicated management hub:
 *   1. Overview: Showroom telemetry (Total Staff, Total Bills, Gross Revenue, Catalog Items) & Profile.
 *   2. Staff & Users: Complete CRUD scoped strictly to that showroom (Create, Read, Update/Edit, Suspend/Restore, Delete, Reset Password).
 *   3. Settings: Edit showroom profile, GST rate, address, phone, and tax identifiers.
 *
 * Styled per /ui-ux-pro-max: Dark Tech + Status Glassmorphism, accessible contrast,
 * responsive layout, vector icons, and haptic feedback.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { UserSession, UserProfile, ShopRecord, UserRole } from '../types/auth';
import { NavTab, BottomNavBar } from '../components/BottomNavBar';
import { useShop } from '../context/ShopContext';
import { adminService } from '../services/adminService';
import { hapticFeedback } from '../utils/haptics';

interface SuperadminPortalScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

interface ShowroomMetrics {
  totalStaff: number;
  totalInvoices: number;
  totalRevenue: number;
  totalProducts: number;
}

// Generates a clean, secure temporary password (e.g. Tilor@8721)
const generateSecureTempPassword = (): string => {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const randomChar = chars.charAt(Math.floor(Math.random() * chars.length));
  return `Tilor@${randomChar}${digits}`;
};

// Safe clipboard copy helper for Web and React Native
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[Clipboard] Failed to copy to clipboard', err);
  }
  return false;
};

// Formats currency nicely (e.g. ₹1,25,000)
const formatCurrency = (amount: number, currency: string = 'INR'): string => {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
};

export const SuperadminPortalScreen: React.FC<SuperadminPortalScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const { shops, activeShop, loadingShops, refreshShops, switchShop } = useShop();

  // ── Drilldown Navigation State ───────────────────────────────
  // When null, shows the Showrooms Hub list. When set, shows the Showroom Detail Dashboard.
  const [selectedShowroom, setSelectedShowroom] = useState<ShopRecord | null>(null);
  const [showroomSubTab, setShowroomSubTab] = useState<'overview' | 'users' | 'settings'>('overview');

  // Showrooms Hub search
  const [searchShopText, setSearchShopText] = useState('');

  // ── Showroom Metrics State ───────────────────────────────────
  const [metrics, setMetrics] = useState<ShowroomMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // ── Users for Selected Showroom ──────────────────────────────
  const [showroomUsers, setShowroomUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchUserText, setSearchUserText] = useState('');
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  // ── Modal: Create Showroom ───────────────────────────────────
  const [isCreateShopModalOpen, setIsCreateShopModalOpen] = useState(false);
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopGstin, setShopGstin] = useState('');
  const [shopGstRate, setShopGstRate] = useState('18');
  const [shopCurrency, setShopCurrency] = useState('INR');
  const [createShopSubmitting, setCreateShopSubmitting] = useState(false);
  const [createShopError, setCreateShopError] = useState<string | null>(null);

  // ── Modal: Add User for Selected Showroom ────────────────────
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'owner' | 'admin' | 'staff'>('staff');
  const [newUserPassword, setNewUserPassword] = useState(generateSecureTempPassword());
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createdUserSuccessData, setCreatedUserSuccessData] = useState<{
    email: string;
    fullName: string;
    role: string;
    tempPass: string;
  } | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);

  // ── Modal: Edit User (Role/Name) ─────────────────────────────
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [editingTargetUser, setEditingTargetUser] = useState<UserProfile | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState<'owner' | 'admin' | 'staff'>('staff');
  const [editUserSubmitting, setEditUserSubmitting] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);

  // ── Modal: Reset Password ────────────────────────────────────
  const [isResetPassModalOpen, setIsResetPassModalOpen] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState<UserProfile | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetPassSubmitting, setResetPassSubmitting] = useState(false);
  const [resetPassError, setResetPassError] = useState<string | null>(null);
  const [resetPassSuccess, setResetPassSuccess] = useState(false);

  // ── Showroom Settings Form State ─────────────────────────────
  const [editShopName, setEditShopName] = useState('');
  const [editShopAddress, setEditShopAddress] = useState('');
  const [editShopPhone, setEditShopPhone] = useState('');
  const [editShopGstin, setEditShopGstin] = useState('');
  const [editShopGstRate, setEditShopGstRate] = useState('18');
  const [editShopCurrency, setEditShopCurrency] = useState('INR');
  const [savingShopSettings, setSavingShopSettings] = useState(false);
  const [shopSettingsError, setShopSettingsError] = useState<string | null>(null);
  const [shopSettingsSuccess, setShopSettingsSuccess] = useState(false);

  // Synchronize settings form whenever selectedShowroom changes
  useEffect(() => {
    if (selectedShowroom) {
      setEditShopName(selectedShowroom.name);
      setEditShopAddress(selectedShowroom.settings?.address || '');
      setEditShopPhone(selectedShowroom.settings?.phone || '');
      setEditShopGstin(selectedShowroom.settings?.gstin || '');
      setEditShopGstRate(selectedShowroom.gst_rate?.toString() || '18');
      setEditShopCurrency(selectedShowroom.currency || 'INR');
      setShopSettingsError(null);
      setShopSettingsSuccess(false);
    }
  }, [selectedShowroom]);

  // ── Load Showroom Specific Data (Metrics & Staff) ────────────
  const loadShowroomData = useCallback(async (shopId: string) => {
    setLoadingMetrics(true);
    setLoadingUsers(true);
    try {
      const [metricsRes, usersRes] = await Promise.all([
        adminService.fetchShopMetrics(shopId),
        adminService.fetchAllUsers(shopId),
      ]);

      if (metricsRes.success && metricsRes.data) {
        setMetrics(metricsRes.data);
      }
      if (usersRes.success && usersRes.data) {
        setShowroomUsers(usersRes.data);
      }
    } catch (err) {
      console.error('[SuperadminPortal] Error loading showroom data:', err);
    } finally {
      setLoadingMetrics(false);
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (selectedShowroom?.id) {
      loadShowroomData(selectedShowroom.id);
    }
  }, [selectedShowroom?.id, loadShowroomData]);

  // Keep selectedShowroom updated if global shops list refreshes
  useEffect(() => {
    if (selectedShowroom) {
      const updated = shops.find((s) => s.id === selectedShowroom.id);
      if (updated) setSelectedShowroom(updated);
    }
  }, [shops, selectedShowroom]);

  // ── Filtered Showrooms ───────────────────────────────────────
  const filteredShops = useMemo(() => {
    const q = searchShopText.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.settings?.address && s.settings.address.toLowerCase().includes(q)) ||
        (s.settings?.gstin && s.settings.gstin.toLowerCase().includes(q)) ||
        (s.settings?.phone && s.settings.phone.toLowerCase().includes(q))
    );
  }, [shops, searchShopText]);

  // ── Filtered Users for Current Showroom ──────────────────────
  const filteredShowroomUsers = useMemo(() => {
    const q = searchUserText.trim().toLowerCase();
    if (!q) return showroomUsers;
    return showroomUsers.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        u.role.toLowerCase().includes(q)
    );
  }, [showroomUsers, searchUserText]);

  // ── Handlers: Drilldown ──────────────────────────────────────
  const handleSelectShowroom = (shop: ShopRecord) => {
    hapticFeedback.selection();
    setSelectedShowroom(shop);
    setShowroomSubTab('overview');
    setSearchUserText('');
  };

  const handleBackToShowrooms = () => {
    hapticFeedback.light();
    setSelectedShowroom(null);
    setMetrics(null);
    setShowroomUsers([]);
  };

  // ── Handlers: Create Showroom ────────────────────────────────
  const handleOpenCreateShop = () => {
    hapticFeedback.selection();
    setShopName('');
    setShopAddress('');
    setShopPhone('');
    setShopGstin('');
    setShopGstRate('18');
    setShopCurrency('INR');
    setCreateShopError(null);
    setIsCreateShopModalOpen(true);
  };

  const handleCreateShop = async () => {
    const trimmedName = shopName.trim();
    if (!trimmedName) {
      setCreateShopError('Showroom name is required.');
      hapticFeedback.error();
      return;
    }

    const rateNum = parseFloat(shopGstRate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
      setCreateShopError('Please enter a valid GST percentage (0 to 100).');
      hapticFeedback.error();
      return;
    }

    setCreateShopSubmitting(true);
    setCreateShopError(null);
    try {
      const res = await adminService.createShop({
        name: trimmedName,
        gstRate: rateNum,
        currency: shopCurrency.trim().toUpperCase() || 'INR',
        settings: {
          address: shopAddress.trim(),
          phone: shopPhone.trim(),
          gstin: shopGstin.trim().toUpperCase(),
        },
      });

      if (res.success && res.data) {
        hapticFeedback.success();
        await refreshShops();
        setIsCreateShopModalOpen(false);
        // Automatically drill into the newly registered showroom
        setSelectedShowroom(res.data);
        setShowroomSubTab('overview');
      } else {
        hapticFeedback.error();
        setCreateShopError(res.error || 'Failed to create showroom.');
      }
    } catch (err: any) {
      hapticFeedback.error();
      setCreateShopError(err?.message || 'An unexpected error occurred.');
    } finally {
      setCreateShopSubmitting(false);
    }
  };

  // ── Handlers: Save Showroom Settings ─────────────────────────
  const handleSaveShopSettings = async () => {
    if (!selectedShowroom) return;
    const trimmedName = editShopName.trim();
    if (!trimmedName) {
      setShopSettingsError('Showroom name cannot be empty.');
      hapticFeedback.error();
      return;
    }

    const rateNum = parseFloat(editShopGstRate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
      setShopSettingsError('Please enter a valid GST rate between 0 and 100.');
      hapticFeedback.error();
      return;
    }

    setSavingShopSettings(true);
    setShopSettingsError(null);
    setShopSettingsSuccess(false);

    try {
      const res = await adminService.updateShop(selectedShowroom.id, {
        name: trimmedName,
        gst_rate: rateNum,
        currency: editShopCurrency.trim().toUpperCase() || 'INR',
        settings: {
          ...(selectedShowroom.settings || {}),
          address: editShopAddress.trim(),
          phone: editShopPhone.trim(),
          gstin: editShopGstin.trim().toUpperCase(),
        },
      });

      if (res.success && res.data) {
        hapticFeedback.success();
        setShopSettingsSuccess(true);
        setSelectedShowroom(res.data);
        await refreshShops();
        setTimeout(() => setShopSettingsSuccess(false), 3000);
      } else {
        hapticFeedback.error();
        setShopSettingsError(res.error || 'Failed to update showroom settings.');
      }
    } catch (err: any) {
      hapticFeedback.error();
      setShopSettingsError(err?.message || 'Failed to update settings.');
    } finally {
      setSavingShopSettings(false);
    }
  };

  // ── Handlers: Add User for Selected Showroom ─────────────────
  const handleOpenCreateUser = () => {
    if (!selectedShowroom) return;
    hapticFeedback.selection();
    setNewUserName('');
    setNewUserEmail('');
    setNewUserRole('staff');
    setNewUserPassword(generateSecureTempPassword());
    setShowNewUserPassword(false);
    setCreateUserError(null);
    setCreatedUserSuccessData(null);
    setCopiedPass(false);
    setIsCreateUserModalOpen(true);
  };

  const handleCreateUser = async () => {
    if (!selectedShowroom) return;
    const trimmedName = newUserName.trim();
    const trimmedEmail = newUserEmail.trim().toLowerCase();

    if (!trimmedName) {
      setCreateUserError('Full name is required.');
      hapticFeedback.error();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setCreateUserError('Please enter a valid email address.');
      hapticFeedback.error();
      return;
    }

    if (newUserPassword.length < 8) {
      setCreateUserError('Temporary password must be at least 8 characters long.');
      hapticFeedback.error();
      return;
    }

    setCreateUserSubmitting(true);
    setCreateUserError(null);
    try {
      const res = await adminService.createUser({
        fullName: trimmedName,
        email: trimmedEmail,
        role: newUserRole,
        shopId: selectedShowroom.id,
        password: newUserPassword,
      });

      if (res.success && res.data) {
        hapticFeedback.success();
        setCreatedUserSuccessData({
          email: trimmedEmail,
          fullName: trimmedName,
          role: newUserRole.toUpperCase(),
          tempPass: newUserPassword,
        });
        await loadShowroomData(selectedShowroom.id);
      } else {
        hapticFeedback.error();
        setCreateUserError(res.error || 'Failed to provision user.');
      }
    } catch (err: any) {
      hapticFeedback.error();
      setCreateUserError(err?.message || 'An unexpected error occurred.');
    } finally {
      setCreateUserSubmitting(false);
    }
  };

  // ── Handlers: Edit User (Role & Name) ─────────────────────────
  const handleOpenEditUser = (user: UserProfile) => {
    hapticFeedback.selection();
    setEditingTargetUser(user);
    setEditUserName(user.full_name || '');
    setEditUserRole((user.role === 'superadmin' ? 'admin' : user.role) as any);
    setEditUserError(null);
    setIsEditUserModalOpen(true);
  };

  const handleSaveEditUser = async () => {
    if (!editingTargetUser || !selectedShowroom) return;
    const trimmedName = editUserName.trim();
    if (!trimmedName) {
      setEditUserError('Name cannot be empty.');
      hapticFeedback.error();
      return;
    }

    setEditUserSubmitting(true);
    setEditUserError(null);
    try {
      const res = await adminService.updateUser(editingTargetUser.id, {
        full_name: trimmedName,
        role: editUserRole,
      });

      if (res.success && res.data) {
        hapticFeedback.success();
        setIsEditUserModalOpen(false);
        setEditingTargetUser(null);
        await loadShowroomData(selectedShowroom.id);
      } else {
        hapticFeedback.error();
        setEditUserError(res.error || 'Failed to update user.');
      }
    } catch (err: any) {
      hapticFeedback.error();
      setEditUserError(err?.message || 'An error occurred.');
    } finally {
      setEditUserSubmitting(false);
    }
  };

  // ── Handlers: Toggle Status (Suspend / Restore) ──────────────
  const handleToggleUserStatus = async (user: UserProfile) => {
    if (user.id === session.id) {
      hapticFeedback.error();
      Alert.alert('Action Forbidden', 'You cannot suspend your own Superadmin account.');
      return;
    }

    const newStatus = !user.is_active;
    const actionLabel = newStatus ? 'Activate' : 'Suspend';

    const confirmAction = async () => {
      setTogglingUserId(user.id);
      try {
        const res = await adminService.toggleUserStatus(user.id, newStatus);
        if (res.success) {
          hapticFeedback.success();
          setShowroomUsers((prev) =>
            prev.map((u) => (u.id === user.id ? { ...u, is_active: newStatus } : u))
          );
        } else {
          hapticFeedback.error();
          Alert.alert('Status Update Failed', res.error || 'Failed to update status.');
        }
      } catch (err: any) {
        hapticFeedback.error();
        console.error('Error toggling status:', err);
      } finally {
        setTogglingUserId(null);
      }
    };

    if (Platform.OS === 'web') {
      const ok = window.confirm(
        `${actionLabel} access for "${user.full_name || user.email}"?`
      );
      if (ok) confirmAction();
    } else {
      Alert.alert(
        `${actionLabel} Account`,
        `Are you sure you want to ${actionLabel.toLowerCase()} access for ${
          user.full_name || user.email
        }?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: actionLabel,
            style: newStatus ? 'default' : 'destructive',
            onPress: confirmAction,
          },
        ]
      );
    }
  };

  // ── Handlers: Delete User ────────────────────────────────────
  const handleDeleteUser = (user: UserProfile) => {
    if (user.id === session.id) {
      Alert.alert('Action Forbidden', 'You cannot delete your own account.');
      return;
    }

    const performDelete = async () => {
      try {
        const res = await adminService.deleteUser(user.id);
        if (res.success) {
          hapticFeedback.success();
          if (selectedShowroom) await loadShowroomData(selectedShowroom.id);
          Alert.alert('User Removed', `Account for "${user.full_name || user.email}" has been removed.`);
        } else {
          hapticFeedback.error();
          Alert.alert('Deletion Blocked', res.error || 'Failed to delete user.');
        }
      } catch (err: any) {
        hapticFeedback.error();
        Alert.alert('Error', err?.message || 'Failed to delete user.');
      }
    };

    if (Platform.OS === 'web') {
      const ok = window.confirm(
        `Permanently remove user "${user.full_name || user.email}" from ${selectedShowroom?.name}?\n\nThis will only proceed if they have zero finalized billing records.`
      );
      if (ok) performDelete();
    } else {
      Alert.alert(
        'Delete User Account',
        `Permanently remove ${user.full_name || user.email} from this showroom?\n\nIf they have finalized invoices, deletion will be blocked to maintain audit integrity.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: performDelete },
        ]
      );
    }
  };

  // ── Handlers: Reset Password ─────────────────────────────────
  const handleOpenResetPass = (user: UserProfile) => {
    hapticFeedback.selection();
    setResetTargetUser(user);
    setResetPasswordInput(generateSecureTempPassword());
    setResetPassError(null);
    setResetPassSuccess(false);
    setIsResetPassModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetTargetUser) return;
    if (resetPasswordInput.length < 8) {
      setResetPassError('Password must be at least 8 characters long.');
      hapticFeedback.error();
      return;
    }

    setResetPassSubmitting(true);
    setResetPassError(null);
    try {
      const res = await adminService.resetUserPassword(resetTargetUser.id, resetPasswordInput);
      if (res.success) {
        hapticFeedback.success();
        setResetPassSuccess(true);
      } else {
        hapticFeedback.error();
        setResetPassError(res.error || 'Failed to reset password.');
      }
    } catch (err: any) {
      hapticFeedback.error();
      setResetPassError(err?.message || 'An error occurred.');
    } finally {
      setResetPassSubmitting(false);
    }
  };

  // Role pill styling helper
  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case 'superadmin':
        return { bg: '#F3E8FF', text: '#7C3AED', label: 'SUPERADMIN' };
      case 'owner':
        return { bg: '#FEF3C7', text: '#B45309', label: 'OWNER' };
      case 'admin':
        return { bg: '#EFF6FF', text: '#1D4ED8', label: 'ADMIN' };
      case 'staff':
      default:
        return { bg: '#EEF2FF', text: '#4338CA', label: 'STAFF' };
    }
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Top Header ────────────────────────────────────────── */}
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#2E1065']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']} style={styles.safeHeader}>
          {selectedShowroom ? (
            /* ── Drilldown Header (Back Breadcrumb) ── */
            <View style={styles.drilldownHeaderBar}>
              <TouchableOpacity
                style={styles.backBreadcrumbBtn}
                onPress={handleBackToShowrooms}
                activeOpacity={0.7}
              >
                <Feather name="arrow-left" size={16} color="#FFFFFF" />
                <Text style={styles.backBreadcrumbText}>All Showrooms</Text>
              </TouchableOpacity>

              <View style={styles.drilldownTitleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.drilldownShowroomTitle} numberOfLines={1}>
                    {selectedShowroom.name}
                  </Text>
                  <Text style={styles.drilldownShowroomSubtitle} numberOfLines={1}>
                    {selectedShowroom.settings?.address || 'Showroom Management Hub'}
                  </Text>
                </View>

                {activeShop?.id === selectedShowroom.id ? (
                  <View style={styles.activeContextBadge}>
                    <View style={styles.activeDot} />
                    <Text style={styles.activeContextBadgeText}>ACTIVE STORE</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.setContextBtn}
                    onPress={() => switchShop(selectedShowroom)}
                    activeOpacity={0.8}
                  >
                    <Feather name="check" size={13} color="#FFFFFF" />
                    <Text style={styles.setContextBtnText}>Set as Active</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            /* ── Top Level Showrooms Hub Header ── */
            <>
              <View style={styles.headerTopRow}>
                <View style={styles.headerBrand}>
                  <View style={styles.shieldIconBox}>
                    <Feather name="shield" size={18} color="#FFFFFF" />
                  </View>
                  <View>
                    <Text style={styles.headerTitle}>Superadmin Portal</Text>
                    <Text style={styles.headerSubtitle}>Multi-Tenant Showroom Hub</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={() => {
                    hapticFeedback.light();
                    refreshShops();
                  }}
                  accessibilityLabel="Refresh showrooms"
                >
                  <Feather name="refresh-cw" size={14} color="#DDD6FE" />
                </TouchableOpacity>
              </View>

              {/* Quick Glance Telemetry */}
              <View style={styles.metricsRow}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>TOTAL SHOWROOMS</Text>
                  <Text style={styles.metricVal}>{shops.length}</Text>
                </View>
                <View style={styles.metricCardWide}>
                  <Text style={styles.metricLabel}>CURRENT APP CONTEXT</Text>
                  <Text style={styles.metricValStore} numberOfLines={1}>
                    {activeShop?.name || 'None Selected'}
                  </Text>
                </View>
              </View>
            </>
          )}
        </SafeAreaView>
      </LinearGradient>

      {/* ── Sub Navigation Tabs (Visible when drilled into a showroom) ── */}
      {selectedShowroom && (
        <View style={styles.showroomTabBar}>
          <TouchableOpacity
            style={[styles.showroomTabBtn, showroomSubTab === 'overview' && styles.showroomTabBtnActive]}
            onPress={() => {
              hapticFeedback.light();
              setShowroomSubTab('overview');
            }}
          >
            <Feather
              name="activity"
              size={15}
              color={showroomSubTab === 'overview' ? '#7C3AED' : '#64748B'}
            />
            <Text
              style={[
                styles.showroomTabBtnText,
                showroomSubTab === 'overview' && styles.showroomTabBtnTextActive,
              ]}
            >
              Overview
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.showroomTabBtn, showroomSubTab === 'users' && styles.showroomTabBtnActive]}
            onPress={() => {
              hapticFeedback.light();
              setShowroomSubTab('users');
            }}
          >
            <Feather
              name="users"
              size={15}
              color={showroomSubTab === 'users' ? '#7C3AED' : '#64748B'}
            />
            <Text
              style={[
                styles.showroomTabBtnText,
                showroomSubTab === 'users' && styles.showroomTabBtnTextActive,
              ]}
            >
              Staff ({showroomUsers.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.showroomTabBtn, showroomSubTab === 'settings' && styles.showroomTabBtnActive]}
            onPress={() => {
              hapticFeedback.light();
              setShowroomSubTab('settings');
            }}
          >
            <Feather
              name="sliders"
              size={15}
              color={showroomSubTab === 'settings' ? '#7C3AED' : '#64748B'}
            />
            <Text
              style={[
                styles.showroomTabBtnText,
                showroomSubTab === 'settings' && styles.showroomTabBtnTextActive,
              ]}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Main Scroll Area ────────────────────────────────────── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ══════════════════════════════════════════════════════════ */}
        {/* VIEW 1: TOP LEVEL SHOWROOMS HUB                            */}
        {/* ══════════════════════════════════════════════════════════ */}
        {!selectedShowroom && (
          <View style={styles.sectionWrap}>
            <View style={styles.actionsHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Tenant Showrooms</Text>
                <Text style={styles.sectionSub}>
                  Select any showroom to manage staff, view performance, and configure tax rules.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={handleOpenCreateShop}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={14} color="#FFFFFF" />
                <Text style={styles.primaryActionBtnText}>New Showroom</Text>
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.searchBarContainer}>
              <Feather name="search" size={16} color="#94A3B8" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search showrooms by name, address, phone, or GSTIN..."
                placeholderTextColor="#94A3B8"
                value={searchShopText}
                onChangeText={setSearchShopText}
                autoCapitalize="none"
              />
              {searchShopText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchShopText('')} hitSlop={8}>
                  <Feather name="x" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {loadingShops ? (
              <ActivityIndicator size="large" color="#7C3AED" style={{ marginTop: 40 }} />
            ) : filteredShops.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons name="storefront-remove" size={40} color="#CBD5E1" />
                <Text style={styles.emptyTitle}>No Showrooms Found</Text>
                <Text style={styles.emptySub}>
                  {searchShopText
                    ? 'No showroom matches your search query.'
                    : 'Click "New Showroom" above to register your first tenant store.'}
                </Text>
              </View>
            ) : (
              filteredShops.map((shop) => {
                const isSelected = activeShop?.id === shop.id;
                return (
                  <TouchableOpacity
                    key={shop.id}
                    style={[styles.shopCard, isSelected && styles.shopCardActiveContext]}
                    onPress={() => handleSelectShowroom(shop)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.shopCardHeader}>
                      <View style={styles.shopIconBox}>
                        <MaterialCommunityIcons name="storefront" size={24} color="#7C3AED" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.shopCardTitleRow}>
                          <Text style={styles.shopCardName}>{shop.name}</Text>
                          {isSelected && (
                            <View style={styles.activePill}>
                              <View style={styles.activePillDot} />
                              <Text style={styles.activePillText}>ACTIVE CONTEXT</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.shopCardSub} numberOfLines={2}>
                          {shop.settings?.address || 'Showroom Location Not Set'}
                          {shop.settings?.phone ? ` • Ph: ${shop.settings.phone}` : ''}
                        </Text>
                      </View>
                    </View>

                    {/* Metadata & Manage Button */}
                    <View style={styles.shopMetaRow}>
                      <View style={styles.shopMetaPillsWrap}>
                        <View style={styles.metaBadge}>
                          <Text style={styles.metaBadgeLabel}>GST</Text>
                          <Text style={styles.metaBadgeVal}>{shop.gst_rate}%</Text>
                        </View>
                        {shop.settings?.gstin ? (
                          <View style={styles.metaBadge}>
                            <Text style={styles.metaBadgeLabel}>GSTIN</Text>
                            <Text style={styles.metaBadgeValMono}>{shop.settings.gstin}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.manageShowroomCTA}>
                        <Text style={styles.manageShowroomCTAText}>Manage Showroom</Text>
                        <Feather name="arrow-right" size={13} color="#7C3AED" />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════ */}
        {/* VIEW 2: SHOWROOM DRILLDOWN DASHBOARD                       */}
        {/* ══════════════════════════════════════════════════════════ */}
        {selectedShowroom && showroomSubTab === 'overview' && (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Showroom Performance Telemetry</Text>
              <Text style={styles.sectionSub}>
                Real-time operational indicators for {selectedShowroom.name}.
              </Text>
            </View>

            {loadingMetrics ? (
              <ActivityIndicator size="large" color="#7C3AED" style={{ marginVertical: 30 }} />
            ) : (
              <View style={styles.telemetryGrid}>
                {/* Total Staff */}
                <View style={styles.telemetryCard}>
                  <View style={[styles.telemetryIconBox, { backgroundColor: '#EEF2FF' }]}>
                    <Feather name="users" size={18} color="#4F46E5" />
                  </View>
                  <Text style={styles.telemetryVal}>{metrics?.totalStaff ?? 0}</Text>
                  <Text style={styles.telemetryLabel}>STORE STAFF</Text>
                </View>

                {/* Total Invoices */}
                <View style={styles.telemetryCard}>
                  <View style={[styles.telemetryIconBox, { backgroundColor: '#ECFDF5' }]}>
                    <Feather name="file-text" size={18} color="#059669" />
                  </View>
                  <Text style={styles.telemetryVal}>{metrics?.totalInvoices ?? 0}</Text>
                  <Text style={styles.telemetryLabel}>BILLS GENERATED</Text>
                </View>

                {/* Gross Revenue */}
                <View style={styles.telemetryCardWide}>
                  <View style={[styles.telemetryIconBox, { backgroundColor: '#FAF5FF' }]}>
                    <MaterialCommunityIcons name="cash-multiple" size={20} color="#7C3AED" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.telemetryValMoney}>
                      {formatCurrency(metrics?.totalRevenue ?? 0, selectedShowroom.currency)}
                    </Text>
                    <Text style={styles.telemetryLabel}>TOTAL GROSS REVENUE</Text>
                  </View>
                </View>

                {/* Catalog Products */}
                <View style={styles.telemetryCard}>
                  <View style={[styles.telemetryIconBox, { backgroundColor: '#FFFBEB' }]}>
                    <Feather name="package" size={18} color="#D97706" />
                  </View>
                  <Text style={styles.telemetryVal}>{metrics?.totalProducts ?? 0}</Text>
                  <Text style={styles.telemetryLabel}>CATALOG PRODUCTS</Text>
                </View>

                {/* Tax Rate Profile */}
                <View style={styles.telemetryCard}>
                  <View style={[styles.telemetryIconBox, { backgroundColor: '#F1F5F9' }]}>
                    <Feather name="percent" size={18} color="#475569" />
                  </View>
                  <Text style={styles.telemetryVal}>{selectedShowroom.gst_rate}%</Text>
                  <Text style={styles.telemetryLabel}>DEFAULT GST</Text>
                </View>
              </View>
            )}

            {/* Showroom Identity Card */}
            <View style={styles.card}>
              <Text style={styles.cardSectionHeading}>Showroom Information</Text>
              <View style={styles.profileDetailRow}>
                <Text style={styles.profileDetailLabel}>REGISTERED NAME</Text>
                <Text style={styles.profileDetailValue}>{selectedShowroom.name}</Text>
              </View>
              <View style={styles.profileDetailRow}>
                <Text style={styles.profileDetailLabel}>LOCATION ADDRESS</Text>
                <Text style={styles.profileDetailValue}>
                  {selectedShowroom.settings?.address || 'Not Configured'}
                </Text>
              </View>
              <View style={styles.profileDetailRow}>
                <Text style={styles.profileDetailLabel}>CONTACT PHONE</Text>
                <Text style={styles.profileDetailValue}>
                  {selectedShowroom.settings?.phone || 'Not Configured'}
                </Text>
              </View>
              <View style={styles.profileDetailRow}>
                <Text style={styles.profileDetailLabel}>GSTIN (TAX ID)</Text>
                <Text style={styles.profileDetailValueMono}>
                  {selectedShowroom.settings?.gstin || 'Not Configured'}
                </Text>
              </View>
              <View style={[styles.profileDetailRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.profileDetailLabel}>CURRENCY POLICY</Text>
                <Text style={styles.profileDetailValue}>{selectedShowroom.currency}</Text>
              </View>
            </View>

            {/* Quick Operational Shortcuts */}
            <View style={styles.quickShortcutsRow}>
              <TouchableOpacity
                style={styles.shortcutBtn}
                onPress={() => {
                  switchShop(selectedShowroom);
                  onTabChange('billing');
                }}
                activeOpacity={0.8}
              >
                <Feather name="file-plus" size={16} color="#7C3AED" />
                <Text style={styles.shortcutBtnText}>Open Billing Screen</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.shortcutBtn}
                onPress={() => {
                  switchShop(selectedShowroom);
                  onTabChange('inventory');
                }}
                activeOpacity={0.8}
              >
                <Feather name="archive" size={16} color="#7C3AED" />
                <Text style={styles.shortcutBtnText}>Open Inventory Catalog</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════ */}
        {/* VIEW 3: STAFF & USERS (Scoped to selectedShowroom)         */}
        {/* ══════════════════════════════════════════════════════════ */}
        {selectedShowroom && showroomSubTab === 'users' && (
          <View style={styles.sectionWrap}>
            <View style={styles.actionsHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  Staff & Users ({showroomUsers.length})
                </Text>
                <Text style={styles.sectionSub}>
                  Manage access, credentials, and roles for {selectedShowroom.name}.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={handleOpenCreateUser}
                activeOpacity={0.8}
              >
                <Feather name="user-plus" size={14} color="#FFFFFF" />
                <Text style={styles.primaryActionBtnText}>Add User</Text>
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.searchBarContainer}>
              <Feather name="search" size={16} color="#94A3B8" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search staff by name or email..."
                placeholderTextColor="#94A3B8"
                value={searchUserText}
                onChangeText={setSearchUserText}
                autoCapitalize="none"
              />
              {searchUserText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchUserText('')} hitSlop={8}>
                  <Feather name="x" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {loadingUsers ? (
              <ActivityIndicator size="large" color="#7C3AED" style={{ marginTop: 30 }} />
            ) : filteredShowroomUsers.length === 0 ? (
              <View style={styles.emptyCard}>
                <Feather name="users" size={36} color="#CBD5E1" />
                <Text style={styles.emptyTitle}>No Staff Members Found</Text>
                <Text style={styles.emptySub}>
                  {searchUserText
                    ? 'No user matches your search.'
                    : `No staff have been assigned to ${selectedShowroom.name} yet. Tap "Add User" to provision the store owner or staff.`}
                </Text>
              </View>
            ) : (
              filteredShowroomUsers.map((user) => {
                const roleBadge = getRoleBadgeStyle(user.role);
                const isCurrentUser = user.id === session.id;
                const isTogglingThis = togglingUserId === user.id;

                return (
                  <View key={user.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      {/* Avatar */}
                      <View style={styles.avatarBox}>
                        <Text style={styles.avatarInitials}>
                          {(user.full_name || user.email || 'U').substring(0, 2).toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.userNameRow}>
                          <Text style={styles.userNameText}>
                            {user.full_name || 'Staff Member'}
                          </Text>
                          {isCurrentUser && (
                            <View style={styles.youBadge}>
                              <Text style={styles.youBadgeText}>YOU</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.userEmailText}>{user.email}</Text>
                      </View>

                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        {/* Role Badge */}
                        <View
                          style={[
                            styles.roleBadge,
                            { backgroundColor: roleBadge.bg },
                          ]}
                        >
                          <Text style={[styles.roleBadgeText, { color: roleBadge.text }]}>
                            {roleBadge.label}
                          </Text>
                        </View>

                        {/* Status Badge */}
                        <View
                          style={[
                            styles.statusBadge,
                            user.is_active ? styles.statusActive : styles.statusSuspended,
                          ]}
                        >
                          <View
                            style={[
                              styles.statusDot,
                              user.is_active ? styles.statusDotActive : styles.statusDotSuspended,
                            ]}
                          />
                          <Text
                            style={[
                              styles.statusText,
                              user.is_active ? styles.statusTextActive : styles.statusTextSuspended,
                            ]}
                          >
                            {user.is_active ? 'ACTIVE' : 'SUSPENDED'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Actions Row */}
                    <View style={styles.userCardActionsRow}>
                      <TouchableOpacity
                        style={styles.actionBtnSmall}
                        onPress={() => handleOpenEditUser(user)}
                        activeOpacity={0.7}
                      >
                        <Feather name="edit-2" size={13} color="#475569" />
                        <Text style={styles.actionBtnSmallText}>Edit</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.actionBtnSmall}
                        onPress={() => handleOpenResetPass(user)}
                        activeOpacity={0.7}
                      >
                        <Feather name="key" size={13} color="#475569" />
                        <Text style={styles.actionBtnSmallText}>Reset Password</Text>
                      </TouchableOpacity>

                      {!isCurrentUser && (
                        <>
                          <TouchableOpacity
                            style={[
                              styles.actionBtnSmall,
                              user.is_active ? styles.actionBtnSuspend : styles.actionBtnActivate,
                            ]}
                            onPress={() => handleToggleUserStatus(user)}
                            disabled={isTogglingThis}
                            activeOpacity={0.7}
                          >
                            {isTogglingThis ? (
                              <ActivityIndicator
                                size="small"
                                color={user.is_active ? '#DC2626' : '#059669'}
                              />
                            ) : (
                              <>
                                <Feather
                                  name={user.is_active ? 'slash' : 'check'}
                                  size={13}
                                  color={user.is_active ? '#DC2626' : '#059669'}
                                />
                                <Text
                                  style={[
                                    styles.actionBtnSmallText,
                                    { color: user.is_active ? '#DC2626' : '#059669' },
                                  ]}
                                >
                                  {user.is_active ? 'Suspend' : 'Activate'}
                                </Text>
                              </>
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionBtnSmall, styles.actionBtnDelete]}
                            onPress={() => handleDeleteUser(user)}
                            activeOpacity={0.7}
                          >
                            <Feather name="trash-2" size={13} color="#DC2626" />
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════ */}
        {/* VIEW 4: SHOWROOM SETTINGS (Scoped to selectedShowroom)     */}
        {/* ══════════════════════════════════════════════════════════ */}
        {selectedShowroom && showroomSubTab === 'settings' && (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Showroom Configuration</Text>
              <Text style={styles.sectionSub}>
                Update tax rates, location address, and store contact parameters.
              </Text>
            </View>

            <View style={styles.card}>
              {shopSettingsSuccess && (
                <View style={styles.successBanner}>
                  <Feather name="check-circle" size={15} color="#059669" />
                  <Text style={styles.successBannerText}>Showroom profile updated successfully!</Text>
                </View>
              )}

              {shopSettingsError && (
                <View style={styles.errorBanner}>
                  <Feather name="alert-circle" size={15} color="#DC2626" />
                  <Text style={styles.errorBannerText}>{shopSettingsError}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>SHOWROOM NAME</Text>
                <TextInput
                  style={styles.textInput}
                  value={editShopName}
                  onChangeText={setEditShopName}
                  placeholder="Showroom Name"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>ADDRESS & LOCATION</Text>
                <TextInput
                  style={styles.textInput}
                  value={editShopAddress}
                  onChangeText={setEditShopAddress}
                  placeholder="Showroom street address"
                />
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>CONTACT PHONE</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editShopPhone}
                    onChangeText={setEditShopPhone}
                    keyboardType="phone-pad"
                    placeholder="+91..."
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>GSTIN (TAX ID)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editShopGstin}
                    onChangeText={(val) => setEditShopGstin(val.toUpperCase())}
                    autoCapitalize="characters"
                    placeholder="29ABCDE1234F1Z5"
                  />
                </View>
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>DEFAULT GST RATE (%)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editShopGstRate}
                    onChangeText={setEditShopGstRate}
                    keyboardType="numeric"
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>CURRENCY</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editShopCurrency}
                    onChangeText={(val) => setEditShopCurrency(val.toUpperCase())}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={styles.submitBtnLarge}
                onPress={handleSaveShopSettings}
                disabled={savingShopSettings}
                activeOpacity={0.8}
              >
                {savingShopSettings ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="check" size={16} color="#FFFFFF" />
                    <Text style={styles.submitBtnLargeText}>Save Showroom Settings</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL: CREATE SHOWROOM                                      */}
      {/* ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isCreateShopModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsCreateShopModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBox}>
                <MaterialCommunityIcons name="storefront-plus" size={20} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Register New Showroom</Text>
                <Text style={styles.modalSubtitle}>Configure tenant store identity & tax rules</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsCreateShopModalOpen(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {createShopError && (
                <View style={styles.errorBanner}>
                  <Feather name="alert-circle" size={15} color="#DC2626" />
                  <Text style={styles.errorBannerText}>{createShopError}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  SHOWROOM NAME <Text style={{ color: '#DC2626' }}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Tilor Downtown Flagship"
                  placeholderTextColor="#94A3B8"
                  value={shopName}
                  onChangeText={setShopName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>ADDRESS & LOCATION</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. 102 Marble Square, MG Road"
                  placeholderTextColor="#94A3B8"
                  value={shopAddress}
                  onChangeText={setShopAddress}
                />
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>PHONE NUMBER</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. +91 98765 43210"
                    placeholderTextColor="#94A3B8"
                    value={shopPhone}
                    onChangeText={setShopPhone}
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>GSTIN (TAX ID)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. 29ABCDE1234F1Z5"
                    placeholderTextColor="#94A3B8"
                    value={shopGstin}
                    onChangeText={(val) => setShopGstin(val.toUpperCase())}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>DEFAULT GST RATE (%)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="18"
                    placeholderTextColor="#94A3B8"
                    value={shopGstRate}
                    onChangeText={setShopGstRate}
                    keyboardType="numeric"
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>CURRENCY CODE</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="INR"
                    placeholderTextColor="#94A3B8"
                    value={shopCurrency}
                    onChangeText={(val) => setShopCurrency(val.toUpperCase())}
                    autoCapitalize="characters"
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsCreateShopModalOpen(false)}
                disabled={createShopSubmitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleCreateShop}
                disabled={createShopSubmitting}
                activeOpacity={0.8}
              >
                {createShopSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="check" size={15} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Create Showroom</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADD USER FOR SELECTED SHOWROOM                       */}
      {/* ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isCreateUserModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsCreateUserModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBox}>
                <Feather name="user-plus" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Add User to {selectedShowroom?.name}</Text>
                <Text style={styles.modalSubtitle}>Create store credentials and assign permissions</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsCreateUserModalOpen(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {createdUserSuccessData ? (
                /* Success View: Display temporary credentials to copy */
                <View style={styles.successCredentialsBox}>
                  <View style={styles.successIconCircle}>
                    <Feather name="check-circle" size={28} color="#059669" />
                  </View>
                  <Text style={styles.successHeading}>User Provisioned Successfully!</Text>
                  <Text style={styles.successSubtext}>
                    Share these temporary credentials with the staff member. They will be required to
                    set their own private password upon first login.
                  </Text>

                  <View style={styles.credentialDetailsCard}>
                    <View style={styles.credentialRow}>
                      <Text style={styles.credLabel}>FULL NAME</Text>
                      <Text style={styles.credVal}>{createdUserSuccessData.fullName}</Text>
                    </View>
                    <View style={styles.credentialRow}>
                      <Text style={styles.credLabel}>EMAIL / LOGIN</Text>
                      <Text style={styles.credVal}>{createdUserSuccessData.email}</Text>
                    </View>
                    <View style={styles.credentialRow}>
                      <Text style={styles.credLabel}>ASSIGNED STORE</Text>
                      <Text style={styles.credVal}>{selectedShowroom?.name}</Text>
                    </View>
                    <View style={styles.credentialRow}>
                      <Text style={styles.credLabel}>ROLE</Text>
                      <Text style={styles.credVal}>{createdUserSuccessData.role}</Text>
                    </View>
                    <View style={[styles.credentialRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.credLabel}>TEMPORARY PASSWORD</Text>
                      <Text style={styles.credValPass}>{createdUserSuccessData.tempPass}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.copyCredentialsBtn}
                    onPress={async () => {
                      hapticFeedback.light();
                      const payload = `Tilor Showroom Credentials:\nStore: ${selectedShowroom?.name}\nEmail: ${createdUserSuccessData.email}\nTemp Password: ${createdUserSuccessData.tempPass}`;
                      const ok = await copyToClipboard(payload);
                      setCopiedPass(true);
                      if (ok) setTimeout(() => setCopiedPass(false), 2500);
                    }}
                  >
                    <Feather
                      name={copiedPass ? 'check' : 'copy'}
                      size={14}
                      color="#7C3AED"
                    />
                    <Text style={styles.copyCredentialsText}>
                      {copiedPass ? 'Copied to Clipboard!' : 'Copy Login Credentials'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* Form View */
                <>
                  {createUserError && (
                    <View style={styles.errorBanner}>
                      <Feather name="alert-circle" size={15} color="#DC2626" />
                      <Text style={styles.errorBannerText}>{createUserError}</Text>
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>
                      FULL NAME <Text style={{ color: '#DC2626' }}>*</Text>
                    </Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. Ramesh Kumar"
                      placeholderTextColor="#94A3B8"
                      value={newUserName}
                      onChangeText={setNewUserName}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>
                      EMAIL ADDRESS <Text style={{ color: '#DC2626' }}>*</Text>
                    </Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. ramesh@tilor.in"
                      placeholderTextColor="#94A3B8"
                      value={newUserEmail}
                      onChangeText={setNewUserEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>

                  {/* Role Selection */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>SELECT ROLE & PERMISSIONS</Text>
                    <View style={styles.roleSelectionRow}>
                      <TouchableOpacity
                        style={[
                          styles.roleOptionCard,
                          newUserRole === 'owner' && styles.roleOptionActive,
                        ]}
                        onPress={() => {
                          hapticFeedback.light();
                          setNewUserRole('owner');
                        }}
                      >
                        <Text
                          style={[
                            styles.roleOptionTitle,
                            newUserRole === 'owner' && styles.roleOptionTitleActive,
                          ]}
                        >
                          Owner
                        </Text>
                        <Text style={styles.roleOptionDesc}>Full store control & billing</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.roleOptionCard,
                          newUserRole === 'admin' && styles.roleOptionActive,
                        ]}
                        onPress={() => {
                          hapticFeedback.light();
                          setNewUserRole('admin');
                        }}
                      >
                        <Text
                          style={[
                            styles.roleOptionTitle,
                            newUserRole === 'admin' && styles.roleOptionTitleActive,
                          ]}
                        >
                          Admin
                        </Text>
                        <Text style={styles.roleOptionDesc}>Stock & staff operations</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.roleOptionCard,
                          newUserRole === 'staff' && styles.roleOptionActive,
                        ]}
                        onPress={() => {
                          hapticFeedback.light();
                          setNewUserRole('staff');
                        }}
                      >
                        <Text
                          style={[
                            styles.roleOptionTitle,
                            newUserRole === 'staff' && styles.roleOptionTitleActive,
                          ]}
                        >
                          Staff
                        </Text>
                        <Text style={styles.roleOptionDesc}>Invoicing & catalog view</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Temporary Password */}
                  <View style={styles.inputGroup}>
                    <View style={styles.labelWithActionRow}>
                      <Text style={styles.inputLabel}>
                        TEMPORARY PASSWORD <Text style={{ color: '#DC2626' }}>*</Text>
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          hapticFeedback.light();
                          setNewUserPassword(generateSecureTempPassword());
                        }}
                        style={styles.generateBtn}
                      >
                        <Feather name="zap" size={12} color="#7C3AED" />
                        <Text style={styles.generateBtnText}>Regenerate</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.passwordInputWrap}>
                      <TextInput
                        style={[styles.textInput, { flex: 1, borderWidth: 0 }]}
                        value={newUserPassword}
                        onChangeText={setNewUserPassword}
                        secureTextEntry={!showNewUserPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        onPress={() => setShowNewUserPassword(!showNewUserPassword)}
                        style={{ padding: 8 }}
                      >
                        <Feather
                          name={showNewUserPassword ? 'eye-off' : 'eye'}
                          size={16}
                          color="#64748B"
                        />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.fieldHint}>
                      User will be required to change this password on their first login.
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              {createdUserSuccessData ? (
                <TouchableOpacity
                  style={[styles.submitBtn, { flex: 1 }]}
                  onPress={() => setIsCreateUserModalOpen(false)}
                >
                  <Text style={styles.submitBtnText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setIsCreateUserModalOpen(false)}
                    disabled={createUserSubmitting}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={handleCreateUser}
                    disabled={createUserSubmitting}
                    activeOpacity={0.8}
                  >
                    {createUserSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Feather name="user-check" size={15} color="#FFFFFF" />
                        <Text style={styles.submitBtnText}>Provision User</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDIT USER (Name & Role)                              */}
      {/* ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isEditUserModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsEditUserModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBox}>
                <Feather name="edit-2" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Edit Staff Account</Text>
                <Text style={styles.modalSubtitle}>{editingTargetUser?.email}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsEditUserModalOpen(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {editUserError && (
                <View style={styles.errorBanner}>
                  <Feather name="alert-circle" size={15} color="#DC2626" />
                  <Text style={styles.errorBannerText}>{editUserError}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>FULL NAME</Text>
                <TextInput
                  style={styles.textInput}
                  value={editUserName}
                  onChangeText={setEditUserName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>ASSIGNED ROLE</Text>
                <View style={styles.roleSelectionRow}>
                  <TouchableOpacity
                    style={[
                      styles.roleOptionCard,
                      editUserRole === 'owner' && styles.roleOptionActive,
                    ]}
                    onPress={() => setEditUserRole('owner')}
                  >
                    <Text style={[styles.roleOptionTitle, editUserRole === 'owner' && styles.roleOptionTitleActive]}>
                      Owner
                    </Text>
                    <Text style={styles.roleOptionDesc}>Full store control</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.roleOptionCard,
                      editUserRole === 'admin' && styles.roleOptionActive,
                    ]}
                    onPress={() => setEditUserRole('admin')}
                  >
                    <Text style={[styles.roleOptionTitle, editUserRole === 'admin' && styles.roleOptionTitleActive]}>
                      Admin
                    </Text>
                    <Text style={styles.roleOptionDesc}>Stock & staff control</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.roleOptionCard,
                      editUserRole === 'staff' && styles.roleOptionActive,
                    ]}
                    onPress={() => setEditUserRole('staff')}
                  >
                    <Text style={[styles.roleOptionTitle, editUserRole === 'staff' && styles.roleOptionTitleActive]}>
                      Staff
                    </Text>
                    <Text style={styles.roleOptionDesc}>Invoicing & catalog</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsEditUserModalOpen(false)}
                disabled={editUserSubmitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSaveEditUser}
                disabled={editUserSubmitting}
                activeOpacity={0.8}
              >
                {editUserSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="check" size={15} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Save Changes</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MODAL: RESET USER PASSWORD                                  */}
      {/* ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isResetPassModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsResetPassModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBox}>
                <Feather name="key" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Reset User Password</Text>
                <Text style={styles.modalSubtitle}>
                  Issue temporary password for {resetTargetUser?.full_name || resetTargetUser?.email}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsResetPassModalOpen(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {resetPassSuccess ? (
                <View style={styles.successCredentialsBox}>
                  <View style={styles.successIconCircle}>
                    <Feather name="check-circle" size={28} color="#059669" />
                  </View>
                  <Text style={styles.successHeading}>Password Reset Successfully!</Text>
                  <Text style={styles.successSubtext}>
                    The new temporary password is shown below. The user will be required to change
                    this password on their next sign-in.
                  </Text>
                  <View style={styles.credentialDetailsCard}>
                    <View style={[styles.credentialRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.credLabel}>NEW TEMPORARY PASSWORD</Text>
                      <Text style={styles.credValPass}>{resetPasswordInput}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.copyCredentialsBtn}
                    onPress={async () => {
                      hapticFeedback.light();
                      await copyToClipboard(
                        `Tilor Temporary Password for ${resetTargetUser?.email}: ${resetPasswordInput}`
                      );
                      setCopiedPass(true);
                      setTimeout(() => setCopiedPass(false), 2500);
                    }}
                  >
                    <Feather name={copiedPass ? 'check' : 'copy'} size={14} color="#7C3AED" />
                    <Text style={styles.copyCredentialsText}>
                      {copiedPass ? 'Copied to Clipboard!' : 'Copy Password'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {resetPassError && (
                    <View style={styles.errorBanner}>
                      <Feather name="alert-circle" size={15} color="#DC2626" />
                      <Text style={styles.errorBannerText}>{resetPassError}</Text>
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <View style={styles.labelWithActionRow}>
                      <Text style={styles.inputLabel}>NEW TEMPORARY PASSWORD</Text>
                      <TouchableOpacity
                        onPress={() => {
                          hapticFeedback.light();
                          setResetPasswordInput(generateSecureTempPassword());
                        }}
                        style={styles.generateBtn}
                      >
                        <Feather name="zap" size={12} color="#7C3AED" />
                        <Text style={styles.generateBtnText}>Regenerate</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.textInput}
                      value={resetPasswordInput}
                      onChangeText={setResetPasswordInput}
                      autoCapitalize="none"
                    />
                    <Text style={styles.fieldHint}>
                      Must be at least 8 characters. The account will be flagged to force password
                      rotation on first sign-in.
                    </Text>
                  </View>
                </>
              )}
            </View>

            <View style={styles.modalFooter}>
              {resetPassSuccess ? (
                <TouchableOpacity
                  style={[styles.submitBtn, { flex: 1 }]}
                  onPress={() => setIsResetPassModalOpen(false)}
                >
                  <Text style={styles.submitBtnText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setIsResetPassModalOpen(false)}
                    disabled={resetPassSubmitting}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={handleResetPassword}
                    disabled={resetPassSubmitting}
                    activeOpacity={0.8}
                  >
                    {resetPassSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Feather name="check" size={15} color="#FFFFFF" />
                        <Text style={styles.submitBtnText}>Apply Reset</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Bottom Nav ────────────────────────────────────────── */}
      <BottomNavBar
        activeTab={activeTab}
        onTabPress={onTabChange}
        isOwner={true}
        isSuperadmin={true}
      />
    </View>
  );
};

// ── Stylesheet ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingBottom: 16,
  },
  safeHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shieldIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#DDD6FE',
    fontWeight: '600',
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    padding: 10,
  },
  metricCardWide: {
    flex: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    padding: 10,
  },
  metricLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#DDD6FE',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  metricVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  metricValStore: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FEF3C7',
  },

  // ── Drilldown Header Styles ──
  drilldownHeaderBar: {
    gap: 10,
  },
  backBreadcrumbBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  backBreadcrumbText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  drilldownTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  drilldownShowroomTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  drilldownShowroomSubtitle: {
    fontSize: 11.5,
    color: '#DDD6FE',
    marginTop: 2,
  },
  activeContextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  activeContextBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.4,
  },
  setContextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  setContextBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Showroom Subtabs ──
  showroomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 8,
  },
  showroomTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
  },
  showroomTabBtnActive: {
    borderBottomColor: '#7C3AED',
  },
  showroomTabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  showroomTabBtnTextActive: {
    color: '#7C3AED',
    fontWeight: '800',
  },

  // ── Scroll Content ──
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionWrap: {
    gap: 14,
  },
  actionsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeader: {
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  primaryActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Search & Filter ──
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
    height: '100%',
  },

  // ── Showroom Cards ──
  shopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  shopCardActiveContext: {
    borderColor: '#A7F3D0',
    backgroundColor: '#FAFCFF',
  },
  shopCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  shopIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  shopCardName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  shopCardSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  activePillDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#059669',
  },
  activePillText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.3,
  },
  shopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    gap: 10,
  },
  shopMetaPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaBadgeLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
  },
  metaBadgeVal: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  metaBadgeValMono: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E293B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  manageShowroomCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  manageShowroomCTAText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#7C3AED',
  },

  // ── Showroom Overview Telemetry Grid ──
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  telemetryCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  telemetryCardWide: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  telemetryIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  telemetryVal: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  telemetryValMoney: {
    fontSize: 22,
    fontWeight: '900',
    color: '#7C3AED',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  telemetryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },

  // ── Generic Card ──
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardSectionHeading: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  profileDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  profileDetailLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  profileDetailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    maxWidth: '65%',
    textAlign: 'right',
  },
  profileDetailValueMono: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1E293B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  quickShortcutsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shortcutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    paddingVertical: 12,
    borderRadius: 12,
  },
  shortcutBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#7C3AED',
  },

  // ── User Cards Inside Showroom ──
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  avatarInitials: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#475569',
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  youBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  youBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#7C3AED',
  },
  userEmailText: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusActive: {
    backgroundColor: '#ECFDF5',
  },
  statusSuspended: {
    backgroundColor: '#FEF2F2',
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusDotActive: {
    backgroundColor: '#059669',
  },
  statusDotSuspended: {
    backgroundColor: '#DC2626',
  },
  statusText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  statusTextActive: {
    color: '#059669',
  },
  statusTextSuspended: {
    color: '#DC2626',
  },
  userCardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  actionBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnSmallText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  actionBtnSuspend: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  actionBtnActivate: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionBtnDelete: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    paddingHorizontal: 8,
  },

  // ── Empty State ──
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#334155',
  },
  emptySub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },

  // ── Modals Common ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalBody: {
    padding: 18,
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  submitBtn: {
    flex: 1.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
  },
  submitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  submitBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7C3AED',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  submitBtnLargeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Form Inputs ──
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 11.5,
    color: '#DC2626',
    fontWeight: '600',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  successBannerText: {
    flex: 1,
    fontSize: 11.5,
    color: '#059669',
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  labelWithActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  generateBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#7C3AED',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingRight: 6,
  },
  fieldHint: {
    fontSize: 10.5,
    color: '#94A3B8',
    marginTop: 4,
  },

  // ── Role Selector Cards ──
  roleSelectionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleOptionCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    gap: 3,
  },
  roleOptionActive: {
    backgroundColor: '#FAF5FF',
    borderColor: '#7C3AED',
  },
  roleOptionTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#334155',
  },
  roleOptionTitleActive: {
    color: '#7C3AED',
  },
  roleOptionDesc: {
    fontSize: 9.5,
    color: '#64748B',
    lineHeight: 13,
  },

  // ── Success Credentials Box ──
  successCredentialsBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  successIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#065F46',
  },
  successSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  credentialDetailsCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
  },
  credentialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  credLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  credVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  credValPass: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7C3AED',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyCredentialsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  copyCredentialsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7C3AED',
  },
});
