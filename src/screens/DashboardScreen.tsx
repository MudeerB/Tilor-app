import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService, UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { dataCache } from '../services/dataCache';
import { hapticFeedback } from '../utils/haptics';
import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { DashboardKpiSkeleton, DashboardActivitySkeleton } from '../components/skeleton';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DashboardScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [greeting, setGreeting] = useState('');
  const [subtitle, setSubtitle] = useState('');

  // Instant 0ms render from in-memory cache if available
  const cachedMetrics = dataCache.getStale<any>(`dashboard_metrics_${session.shop_id}`);

  // Dynamic KPI States
  const [todaySales, setTodaySales] = useState(cachedMetrics?.todaySales ?? 0);
  const [todayBillsCount, setTodayBillsCount] = useState(cachedMetrics?.todayBillsCount ?? 0);
  const [estimatesCount, setEstimatesCount] = useState(0);
  const [khatabookDue, setKhatabookDue] = useState(cachedMetrics?.khatabookDue ?? 0);
  const [customersCount, setCustomersCount] = useState(cachedMetrics?.customersCount ?? 0);
  const [recentActivities, setRecentActivities] = useState<any[]>(cachedMetrics?.recentActivities ?? []);
  const [pendingDispatchCount, setPendingDispatchCount] = useState(cachedMetrics?.pendingDispatchCount ?? 0);
  const [loading, setLoading] = useState(!cachedMetrics);
  const [isHubExpanded, setIsHubExpanded] = useState(false);

  const handleNav = (tab: NavTab) => {
    hapticFeedback.light();
    onTabChange(tab);
  };

  const toggleHub = () => {
    hapticFeedback.light();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsHubExpanded((prev) => !prev);
  };

  const handleSearch = () => {
    hapticFeedback.light();
    handleNav('history');
  };

  const loadDashboardData = useCallback(async () => {
    try {
      if (activeTab !== 'home') return;

      const metrics = await billingService.fetchDashboardMetrics(session.shop_id);
      if (metrics) {
        setCustomersCount(metrics.customersCount);
        setKhatabookDue(metrics.khatabookDue);
        setTodaySales(metrics.todaySales);
        setTodayBillsCount(metrics.todayBillsCount);
        setRecentActivities(metrics.recentActivities);
        if (metrics.pendingDispatchCount !== undefined) {
          setPendingDispatchCount(metrics.pendingDispatchCount);
        }
      }

      // Estimates count from cache & drafts
      let estCount = 0;
      const draft = await AsyncStorage.getItem('tilor_current_draft');
      if (draft) estCount += 1;
      const saved = await AsyncStorage.getItem('tilor_saved_estimate');
      if (saved) estCount += 1;
      setEstimatesCount(estCount);
    } catch (e) {
      console.error('Error loading dashboard metrics', e);
    } finally {
      setLoading(false);
    }
  }, [session.shop_id, activeTab]);

  const isOwner = session.role === 'owner' || session.role === 'admin';

  useEffect(() => {
    loadDashboardData();

    const hours = new Date().getHours();
    const roleTitle = session.role === 'admin' ? 'Admin' : isOwner ? 'Owner' : 'Staff';

    if (hours < 12) {
      setGreeting(`Good Morning, ${roleTitle}!`);
      setSubtitle('SUBHODAYAM');
    } else if (hours < 17) {
      setGreeting(`Good Afternoon, ${roleTitle}!`);
      setSubtitle('STORE OPEN');
    } else {
      setGreeting(`Good Evening, ${roleTitle}!`);
      setSubtitle('CLOSING SUMMARY');
    }
  }, [session, loadDashboardData, isOwner]);

  const handleLogout = () => {
    hapticFeedback.light();
    Alert.alert(
      'Sign Out',
      'Are you sure you want to log out of Tilor?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await StorageService.clearSession();
              onLogout();
            } catch (error) {
              console.error('Error logging out:', error);
            }
          },
        },
      ]
    );
  };

  const todayDateStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const avgTicket = todayBillsCount > 0 ? Math.round(todaySales / todayBillsCount) : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Banner with Royal Violet Palette */}
        <LinearGradient
          colors={['#5B21B6', '#6D28D9', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            {/* Top Navigation App Bar */}
            <View style={styles.appBar}>
              <View style={styles.logoGroup}>
                <View style={styles.logoIcon}>
                  <MaterialCommunityIcons name="ruler" size={17} color="#FFFFFF" />
                </View>
                <Text style={styles.logoText}>
                  Tilor<Text style={styles.logoDot}>.</Text>
                </Text>
              </View>

              <View style={styles.badgeRow}>
                <View style={styles.roleBadge}>
                  <View style={styles.roleIndicator} />
                  <Text style={styles.roleText}>
                    {session.role === 'admin' ? 'ADMIN' : isOwner ? 'OWNER' : 'STAFF'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleSearch}
                  style={styles.headerIconBtn}
                  activeOpacity={0.7}
                  accessibilityLabel="Search invoices and clients"
                >
                  <Feather name="search" size={15} color="#FFFFFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleLogout}
                  style={styles.headerIconBtn}
                  activeOpacity={0.7}
                  accessibilityLabel="Sign out of account"
                >
                  <Feather name="log-out" size={15} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Salutation & Welcome Block */}
            <View style={styles.welcomeBlock}>
              <View style={styles.welcomeTextGroup}>
                <Text style={styles.greetingSub}>{subtitle}</Text>
                <Text style={styles.greetingMain}>{greeting}</Text>
                <Text style={styles.greetingDesc}>
                  Real-time showroom metrics &amp; fast counter operations.
                </Text>
              </View>
              <View style={styles.dateBadge}>
                <Feather name="calendar" size={12} color="#DDD6FE" style={{ marginRight: 5 }} />
                <Text style={styles.dateText}>{todayDateStr}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Main Operational Surface */}
        <View style={styles.innerContent}>
          {/* ── 1. OPERATIONAL ACTION PULSE STRIP (Pending Dispatch) ── */}
          {pendingDispatchCount > 0 && (
            <TouchableOpacity
              style={styles.pulseBanner}
              onPress={() => handleNav('loading_tasks')}
              activeOpacity={0.8}
            >
              <View style={styles.pulseLeft}>
                <View style={styles.pulseIconBox}>
                  <Feather name="truck" size={18} color="#D97706" />
                </View>
                <View style={styles.pulseTextCol}>
                  <View style={styles.pulseTitleRow}>
                    <Text style={styles.pulseTitle}>
                      {pendingDispatchCount} Order{pendingDispatchCount > 1 ? 's' : ''} Awaiting Dispatch
                    </Text>
                    <View style={styles.pulseBadge}>
                      <Text style={styles.pulseBadgeText}>ACTION REQUIRED</Text>
                    </View>
                  </View>
                  <Text style={styles.pulseSub}>
                    Assign vehicles &amp; verify warehouse loading
                  </Text>
                </View>
              </View>
              <View style={styles.pulseActionTag}>
                <Text style={styles.pulseActionText}>View</Text>
                <Feather name="chevron-right" size={15} color="#D97706" />
              </View>
            </TouchableOpacity>
          )}

          {/* ── 2. UNIFIED EXECUTIVE PERFORMANCE CARD ── */}
          {isOwner ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>SHOWROOM PERFORMANCE</Text>
                <View style={styles.sectionPill}>
                  <Text style={styles.sectionPillText}>TODAY</Text>
                </View>
              </View>

              {loading ? (
                <DashboardKpiSkeleton />
              ) : (
                <View style={styles.heroKpiCard}>
                  {/* Revenue Header Row */}
                  <View style={styles.kpiTopRow}>
                    <View style={styles.kpiMainLabelGroup}>
                      <View style={styles.kpiTrendingCircle}>
                        <Feather name="trending-up" size={15} color="#7C3AED" />
                      </View>
                      <Text style={styles.kpiMainLabel}>Today's Gross Revenue</Text>
                    </View>
                    <View style={styles.kpiPillToday}>
                      <Text style={styles.kpiPillTodayText}>TODAY'S RECORD</Text>
                    </View>
                  </View>

                  {/* Primary Revenue Number */}
                  <Text style={styles.kpiPrimaryVal}>
                    ₹{todaySales.toLocaleString('en-IN')}
                  </Text>

                  {/* Performance Meta Tags */}
                  <View style={styles.kpiMetricsMeta}>
                    <View style={styles.metaTagGreen}>
                      <Feather name="arrow-up" size={11} color="#059669" style={{ marginRight: 3 }} />
                      <Text style={styles.metaTagGreenText}>{todayBillsCount} Bills</Text>
                    </View>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.metaSubText}>
                      Avg Ticket: ₹{avgTicket.toLocaleString('en-IN')}
                    </Text>
                  </View>

                  {/* Secondary Financial Signals (Sub-Row Embedded) */}
                  <View style={styles.kpiSubRow}>
                    {/* Khatabook Due Mini Card */}
                    <TouchableOpacity
                      style={styles.kpiMiniCol}
                      onPress={() => handleNav('khatabook')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.miniLabel}>KHATABOOK DUE</Text>
                      <Text style={[styles.miniVal, { color: '#DC2626' }]}>
                        ₹{khatabookDue.toLocaleString('en-IN')}
                      </Text>
                      <Text style={styles.miniSub}>Outstanding credit</Text>
                    </TouchableOpacity>

                    {/* Active Estimates Mini Card */}
                    <TouchableOpacity
                      style={styles.kpiMiniCol}
                      onPress={() => handleNav('estimator')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.miniLabel}>ACTIVE ESTIMATES</Text>
                      <Text style={styles.miniVal}>
                        {estimatesCount} Draft{estimatesCount === 1 ? '' : 's'}
                      </Text>
                      <Text style={styles.miniSub}>Quotes &amp; drafts</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          ) : (
            /* Staff View: Operational status card */
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>TODAY'S OPERATIONS</Text>
                <View style={styles.sectionPill}>
                  <Text style={styles.sectionPillText}>ACTIVE</Text>
                </View>
              </View>

              <View style={styles.heroKpiCard}>
                <View style={styles.kpiTopRow}>
                  <View style={styles.kpiMainLabelGroup}>
                    <View style={[styles.kpiTrendingCircle, { backgroundColor: '#FFFBEB' }]}>
                      <Feather name="truck" size={15} color="#D97706" />
                    </View>
                    <Text style={styles.kpiMainLabel}>Warehouse Loading Operations</Text>
                  </View>
                  <View style={[styles.kpiPillToday, { backgroundColor: '#FFFBEB' }]}>
                    <Text style={[styles.kpiPillTodayText, { color: '#D97706' }]}>ACTIVE SHIFT</Text>
                  </View>
                </View>

                <Text style={[styles.kpiPrimaryVal, { color: '#D97706' }]}>
                  {pendingDispatchCount} Order{pendingDispatchCount > 1 ? 's' : ''}
                </Text>
                <Text style={styles.metaSubText}>Awaiting vehicle assignment and verification</Text>

                <View style={styles.kpiSubRow}>
                  <TouchableOpacity
                    style={styles.kpiMiniCol}
                    onPress={() => handleNav('loading_tasks')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.miniLabel}>DISPATCH QUEUE</Text>
                    <Text style={[styles.miniVal, { color: '#D97706' }]}>{pendingDispatchCount}</Text>
                    <Text style={styles.miniSub}>Tap to view list</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.kpiMiniCol}
                    onPress={() => handleNav('inventory')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.miniLabel}>STOCK LEDGER</Text>
                    <Text style={styles.miniVal}>Inward</Text>
                    <Text style={styles.miniSub}>Warehouse inventory</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {/* ── 3. COUNTER WORKFLOW (High Ergonomic 1-Tap Hero Actions) ── */}
          {isOwner && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>COUNTER WORKFLOW</Text>
                <Text style={styles.fastTapLabel}>Fast 1-Tap</Text>
              </View>

              <View style={styles.actionDockGrid}>
                {/* New Estimate */}
                <TouchableOpacity
                  style={[styles.actionBtnCard, styles.estimateCard]}
                  onPress={() => handleNav('estimator')}
                  activeOpacity={0.75}
                >
                  <Feather name="arrow-up-right" size={17} color="#7C3AED" style={styles.actionArrow} />
                  <View style={[styles.actionIconCircle, { backgroundColor: '#F3E8FF' }]}>
                    <Feather name="grid" size={20} color="#7C3AED" />
                  </View>
                  <View style={styles.actionContentCol}>
                    <Text style={styles.actionTitle}>New Estimate</Text>
                    <Text style={styles.actionDesc}>Room &amp; tile box calc</Text>
                  </View>
                </TouchableOpacity>

                {/* Direct Billing */}
                <TouchableOpacity
                  style={[styles.actionBtnCard, styles.billingCard]}
                  onPress={() => handleNav('billing')}
                  activeOpacity={0.75}
                >
                  <Feather name="arrow-up-right" size={17} color="#059669" style={styles.actionArrow} />
                  <View style={[styles.actionIconCircle, { backgroundColor: '#DCFCE7' }]}>
                    <Feather name="zap" size={20} color="#059669" />
                  </View>
                  <View style={styles.actionContentCol}>
                    <Text style={styles.actionTitle}>Direct Billing</Text>
                    <Text style={styles.actionDesc}>Fast checkout &amp; GST bill</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* ── 4. EXPANDABLE STORE MANAGEMENT HUB ── */}
              <View style={styles.hubContainer}>
                <TouchableOpacity
                  style={styles.hubBar}
                  onPress={toggleHub}
                  activeOpacity={0.8}
                >
                  <View style={styles.hubLeft}>
                    <View style={styles.hubIconCircle}>
                      <Feather name="layers" size={18} color="#7C3AED" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hubTitle}>Store Management Hub</Text>
                      <Text style={styles.hubDesc} numberOfLines={1}>
                        Analytics, Stock Audit, and Operations Audit Trail
                      </Text>
                    </View>
                  </View>
                  <Feather
                    name={isHubExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#7C3AED"
                  />
                </TouchableOpacity>

                {isHubExpanded && (
                  <View style={styles.hubDrawerGrid}>
                    {/* Sales Analytics */}
                    <TouchableOpacity
                      style={styles.hubModuleCard}
                      onPress={() => handleNav('analytics')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.hubModuleIcon, { backgroundColor: '#EFF6FF' }]}>
                        <Feather name="bar-chart-2" size={16} color="#2563EB" />
                      </View>
                      <View style={styles.hubModuleText}>
                        <Text style={styles.hubModuleTitle}>Sales Analytics</Text>
                        <Text style={styles.hubModuleDesc}>Trends &amp; velocity</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Stock Audit */}
                    <TouchableOpacity
                      style={styles.hubModuleCard}
                      onPress={() => handleNav('stock_manager')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.hubModuleIcon, { backgroundColor: '#F1F5F9' }]}>
                        <Feather name="archive" size={16} color="#475569" />
                      </View>
                      <View style={styles.hubModuleText}>
                        <Text style={styles.hubModuleTitle}>Stock Audit</Text>
                        <Text style={styles.hubModuleDesc}>Audit reconciliation</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Security Activity Logs */}
                    <TouchableOpacity
                      style={styles.hubModuleCard}
                      onPress={() => handleNav('activity_logs')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.hubModuleIcon, { backgroundColor: '#FAF5FF' }]}>
                        <Feather name="activity" size={16} color="#9333EA" />
                      </View>
                      <View style={styles.hubModuleText}>
                        <Text style={styles.hubModuleTitle}>Activity Logs</Text>
                        <Text style={styles.hubModuleDesc}>Operations audit trail</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Stock Adjust */}
                    <TouchableOpacity
                      style={styles.hubModuleCard}
                      onPress={() => handleNav('inventory')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.hubModuleIcon, { backgroundColor: '#EEF2FF' }]}>
                        <Feather name="package" size={16} color="#4F46E5" />
                      </View>
                      <View style={styles.hubModuleText}>
                        <Text style={styles.hubModuleTitle}>Stock Adjust</Text>
                        <Text style={styles.hubModuleDesc}>Inward &amp; damage</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Customers CRM */}
                    <TouchableOpacity
                      style={styles.hubModuleCard}
                      onPress={() => handleNav('customers')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.hubModuleIcon, { backgroundColor: '#ECFDF5' }]}>
                        <Feather name="users" size={16} color="#059669" />
                      </View>
                      <View style={styles.hubModuleText}>
                        <Text style={styles.hubModuleTitle}>Registered Clients</Text>
                        <Text style={styles.hubModuleDesc}>{customersCount} accounts</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── 5. TODAY'S TRANSACTIONS (Activity Feed) ── */}
          {isOwner && (
            <>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="clock" size={14} color="#7C3AED" />
                  <Text style={styles.sectionHeader}>TODAY'S TRANSACTIONS</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleNav('history')}
                  style={styles.viewAllBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.viewAllText}>View All</Text>
                  <Feather name="arrow-right" size={12} color="#7C3AED" />
                </TouchableOpacity>
              </View>

              {loading ? (
                <DashboardActivitySkeleton />
              ) : (
                <View style={styles.activityFeed}>
                  {recentActivities.length === 0 ? (
                    <View style={styles.emptyActivityCard}>
                      <Feather name="inbox" size={24} color="#C4B5FD" />
                      <Text style={styles.emptyActivityTitle}>No transactions recorded today</Text>
                      <Text style={styles.emptyActivityDesc}>
                        Invoices and sales recorded at the counter will appear here in real time.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ width: '100%' }}>
                      {recentActivities.slice(0, 4).map((act, idx) => (
                        <TouchableOpacity
                          key={idx}
                          style={[
                            styles.activityRow,
                            idx !== Math.min(recentActivities.length, 4) - 1 && styles.activityRowBorder,
                          ]}
                          onPress={() => handleNav('history')}
                          activeOpacity={0.7}
                        >
                          <View
                            style={[
                              styles.activityIconCircle,
                              act.paymentMethod === 'credit' && { backgroundColor: '#FEF2F2' },
                            ]}
                          >
                            <Feather
                              name={act.paymentMethod === 'credit' ? 'book-open' : 'file-text'}
                              size={15}
                              color={act.paymentMethod === 'credit' ? '#DC2626' : '#7C3AED'}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.activityTitle}>{act.customerName || 'Customer'}</Text>
                            <Text style={styles.activityMeta}>
                              Invoice #{act.invoiceId} · {act.paymentMethod ? act.paymentMethod.toUpperCase() : 'PAID'}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text
                              style={[
                                styles.activityVal,
                                act.paymentMethod === 'credit' && { color: '#DC2626' },
                              ]}
                            >
                              ₹{act.total?.toLocaleString('en-IN')}
                            </Text>
                            <View
                              style={[
                                styles.feedPill,
                                act.paymentMethod === 'credit' ? styles.feedPillCredit : styles.feedPillPaid,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.feedPillText,
                                  act.paymentMethod === 'credit' ? { color: '#DC2626' } : { color: '#059669' },
                                ]}
                              >
                                {act.paymentMethod === 'credit' ? 'CREDIT' : 'PAID'}
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </View>

        {/* Bottom padding for tab clearance */}
        <View style={{ height: 24 }} />
      </ScrollView>

      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} isOwner={isOwner} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F6FF',
  },
  header: {
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingBottom: 20,
  },
  safeHeader: {
    paddingHorizontal: 20,
  },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  logoGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  logoDot: {
    color: '#C084FC',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  roleIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
    marginRight: 6,
  },
  roleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 18,
  },
  welcomeTextGroup: {
    flex: 1,
    paddingRight: 12,
  },
  greetingSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DDD6FE',
    letterSpacing: 1.2,
  },
  greetingMain: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  greetingDesc: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 4,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  dateText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  innerContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },

  /* 1. Operational Action Pulse Banner */
  pulseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 13,
    marginBottom: 14,
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  pulseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  pulseIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 11,
  },
  pulseTextCol: {
    flex: 1,
  },
  pulseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  pulseTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  pulseBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pulseBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pulseSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
  },
  pulseActionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pulseActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D97706',
  },

  /* Section Header Rows */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  sectionHeader: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionPill: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sectionPillText: {
    color: '#6D28D9',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  fastTapLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  viewAllText: {
    color: '#7C3AED',
    fontSize: 11.5,
    fontWeight: '700',
  },

  /* 2. Unified Executive Performance Card */
  heroKpiCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#F1EDFC',
    padding: 18,
    marginBottom: 6,
    shadowColor: '#6D28D9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  kpiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiMainLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kpiTrendingCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FAF5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  kpiMainLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  kpiPillToday: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#F3E8FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kpiPillTodayText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.5,
  },
  kpiPrimaryVal: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 10,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  kpiMetricsMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  metaTagGreen: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  metaTagGreenText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '700',
  },
  metaDot: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  metaSubText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
  },
  kpiSubRow: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
  },
  kpiMiniCol: {
    flex: 1,
    backgroundColor: '#FAF9FE',
    borderWidth: 1,
    borderColor: '#F1EDFC',
    borderRadius: 12,
    padding: 10,
  },
  miniLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  miniVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
  },
  miniSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },

  /* 3. Counter Workflow Hero Actions */
  actionDockGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  actionBtnCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 14,
    minHeight: 110,
    justifyContent: 'space-between',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  estimateCard: {
    borderColor: '#DDD6FE',
    backgroundColor: '#FAF5FF',
  },
  billingCard: {
    borderColor: '#A7F3D0',
    backgroundColor: '#F0FDF4',
  },
  actionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionArrow: {
    position: 'absolute',
    top: 14,
    right: 14,
  },
  actionContentCol: {
    marginTop: 8,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  actionDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },

  /* 4. Store Management Hub Drawer */
  hubContainer: {
    marginBottom: 6,
  },
  hubBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF9FE',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hubLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  hubIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hubTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#5B21B6',
  },
  hubDesc: {
    fontSize: 10.5,
    color: '#7C3AED',
    marginTop: 1,
  },
  hubDrawerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1EDFC',
    padding: 12,
  },
  hubModuleCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9FE',
    borderWidth: 1,
    borderColor: '#F1EDFC',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  hubModuleIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hubModuleText: {
    flex: 1,
  },
  hubModuleTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  hubModuleDesc: {
    fontSize: 9.5,
    color: '#64748B',
    marginTop: 1,
  },

  /* 5. Today's Transactions Feed */
  activityFeed: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F1EDFC',
    paddingVertical: 4,
    paddingHorizontal: 16,
    shadowColor: '#6D28D9',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  emptyActivityCard: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyActivityTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
    marginTop: 4,
  },
  emptyActivityDesc: {
    fontSize: 11.5,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 16,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    width: '100%',
  },
  activityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F8F6FF',
  },
  activityIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FAF5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  activityMeta: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  activityVal: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  feedPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginTop: 3,
  },
  feedPillPaid: {
    backgroundColor: '#ECFDF5',
  },
  feedPillCredit: {
    backgroundColor: '#FEF2F2',
  },
  feedPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
