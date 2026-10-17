import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { UserSession } from '../services/storage';
import { NavTab } from '../components/BottomNavBar';
import { activityLogService, ActivityLog, SecurityAuditLog } from '../services/activityLog';
import { ActivityLogSkeleton } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';

interface ActivityLogScreenProps {
  session: UserSession;
  onTabChange: (tab: NavTab) => void;
}

type FilterType = 'all' | 'invoice' | 'stock' | 'product' | 'security';

export const ActivityLogScreen: React.FC<ActivityLogScreenProps> = ({ session, onTabChange }) => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 200);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 7;

  const loadLogs = async (isRefreshing = false) => {
    if (!isRefreshing) setLoading(true);
    try {
      if (filter === 'security') {
        const fetchedSec = await activityLogService.fetchSecurityAuditLogs(
          session.role === 'admin' ? undefined : session.shop_id,
          50,
          0
        );
        setSecurityLogs(fetchedSec);
      } else {
        const fetchedLogs = await activityLogService.fetchLogs(
          session.role === 'admin' ? undefined : session.shop_id,
          50,
          0,
          filter === 'all' ? undefined : { entityType: filter }
        );
        setLogs(fetchedLogs);
      }
    } catch (err) {
      console.error('Failed to load activity logs:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadLogs();
    setCurrentPage(1);
  }, [filter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch]);

  const getLogIconInfo = (type: string, action: string) => {
    switch (type) {
      case 'invoice':
        return { icon: 'file-text' as const, color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'stock':
        return { icon: 'package' as const, color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' };
      case 'product':
        return { icon: 'grid' as const, color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)' };
      case 'customer':
        return { icon: 'users' as const, color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' };
      default:
        return { icon: 'activity' as const, color: '#A1A1AA', bg: 'rgba(161, 161, 170, 0.15)' };
    }
  };

  const getActionDescription = (log: ActivityLog) => {
    switch (log.action) {
      case 'created':
        return `Created ${log.entity_type} ${log.entity_name || ''}`;
      case 'stock_inward':
        return `Added ${log.details?.boxesAdded || 0} boxes to ${log.entity_name}`;
      case 'stock_outward':
        return `Deducted ${log.details?.boxesRemoved || 0} boxes from ${log.entity_name}`;
      case 'payment_received':
        return `Received payment for ${log.entity_name}`;
      case 'dispatch':
        return `Dispatched ${log.details?.boxesLoaded || 0} boxes for ${log.entity_name}`;
      default:
        return `${log.action} ${log.entity_type} ${log.entity_name || ''}`;
    }
  };

  const getSecurityDescription = (log: SecurityAuditLog) => {
    switch (log.event_type) {
      case 'massive_single_stock_drop':
        return `Massive Stock Drop: -${log.details?.drop_amount || ''} boxes (${log.details?.variant_name || 'Tile Variant'})`;
      case 'rapid_stock_depletion_velocity':
        return `Rapid Depletion Velocity: -${log.details?.cumulative_1hr_drop || ''} boxes in 1hr (${log.details?.variant_name || 'Tile Variant'})`;
      case 'invoice_voided':
        return `Invoice Voided: ${log.details?.invoice_number || 'Invoice'} (₹${log.details?.total_amount || 0})`;
      case 'admin_audit_log_purge':
        return `Admin Maintenance: Purged ${log.details?.deleted_count || 0} logs older than ${log.details?.retention_years || 2} years`;
      case 'tampered_offline_queue_attempt':
        return 'Security Alert: Tampered Offline Queue Movement Rejected';
      default:
        return log.event_type.replace(/_/g, ' ');
    }
  };

  const filteredLogs = useMemo(() => {
    if (!debouncedSearch) return logs;
    const lowerQuery = debouncedSearch.toLowerCase();
    return logs.filter(log => (
      (log.entity_name || '').toLowerCase().includes(lowerQuery) ||
      (log.user_name || '').toLowerCase().includes(lowerQuery) ||
      (log.action || '').toLowerCase().includes(lowerQuery)
    ));
  }, [logs, debouncedSearch]);

  const filteredSecurityLogs = useMemo(() => {
    if (!debouncedSearch) return securityLogs;
    const lowerQuery = debouncedSearch.toLowerCase();
    return securityLogs.filter(log => (
      log.event_type.toLowerCase().includes(lowerQuery) ||
      log.severity.toLowerCase().includes(lowerQuery) ||
      log.shop_id.toLowerCase().includes(lowerQuery) ||
      (log.user_name || '').toLowerCase().includes(lowerQuery) ||
      JSON.stringify(log.details || {}).toLowerCase().includes(lowerQuery)
    ));
  }, [securityLogs, debouncedSearch]);

  const activeItems: (ActivityLog | SecurityAuditLog)[] = filter === 'security' ? filteredSecurityLogs : filteredLogs;
  const totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const currentLogs = activeItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const renderLogItem = ({ item }: { item: ActivityLog | SecurityAuditLog }) => {
    const isSecurity = 'severity' in item;
    const date = new Date(item.created_at);
    const sessionDisplayName = session.full_name || session.username || session.email;

    if (isSecurity) {
      const sec = item as SecurityAuditLog;
      const isCritical = sec.severity === 'CRITICAL';
      const color = isCritical ? '#EF4444' : '#F59E0B';
      const bg = isCritical ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';

      const actorName = sec.user_name || (sec.user_id === session.id ? sessionDisplayName : 'System');
      const isAutomated = !sec.user_id || actorName.toLowerCase().includes('automated');

      return (
        <View style={styles.logCard}>
          <View style={[styles.iconContainer, { backgroundColor: bg }]}>
            <Feather name={isCritical ? 'shield' : 'alert-triangle'} size={20} color={color} />
          </View>
          <View style={styles.logContent}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <View style={[styles.severityBadge, { backgroundColor: bg, borderColor: color }]}>
                <Text style={[styles.severityBadgeText, { color }]}>{sec.severity}</Text>
              </View>
              {session.role === 'admin' && (
                <View style={styles.shopBadge}>
                  <Text style={styles.shopBadgeText}>Shop: {sec.shop_id.slice(0, 8)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.logTitle}>{getSecurityDescription(sec)}</Text>
            <View style={styles.logMeta}>
              <Text style={styles.logUser}>
                <Feather name={isAutomated ? "cpu" : "user"} size={12} /> {actorName}
              </Text>
              <Text style={styles.logDate}>
                {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {date.toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>
      );
    }

    const act = item as ActivityLog;
    const { icon, color, bg } = getLogIconInfo(act.entity_type, act.action);
    const actorName = act.user_name && act.user_name !== 'System'
      ? act.user_name
      : (act.user_id === session.id ? sessionDisplayName : act.user_name || 'System');

    return (
      <View style={styles.logCard}>
        <View style={[styles.iconContainer, { backgroundColor: bg }]}>
          <Feather name={icon} size={20} color={color} />
        </View>
        <View style={styles.logContent}>
          {session.role === 'admin' && (
            <View style={[styles.shopBadge, { marginBottom: 4 }]}>
              <Text style={styles.shopBadgeText}>Shop: {act.shop_id.slice(0, 8)}</Text>
            </View>
          )}
          <Text style={styles.logTitle}>{getActionDescription(act)}</Text>
          <View style={styles.logMeta}>
            <Text style={styles.logUser}>
              <Feather name="user" size={12} /> {actorName}
            </Text>
            <Text style={styles.logDate}>
              {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {date.toLocaleDateString()}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderHeader = () => {
    const availableFilters: FilterType[] = [
      'all',
      'invoice',
      'stock',
      'product',
      ...(session.role === 'owner' || session.role === 'admin' ? (['security'] as const) : []),
    ];

    return (
      <LinearGradient
        colors={['#6D28D9', '#7C3AED', '#A855F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']} style={styles.safeHeader}>
          <View style={styles.appBar}>
            <TouchableOpacity 
              style={styles.backBtn}
              onPress={() => onTabChange('home')}
              activeOpacity={0.7}
            >
              <View style={styles.backIconCircle}>
                <Feather name="arrow-left" size={16} color="#FFF" />
              </View>
              <Text style={styles.backBtnText}>Dashboard</Text>
            </TouchableOpacity>

            <View style={styles.roleBadge}>
              <View style={styles.roleIndicator} />
              <Text style={styles.roleText}>{session.role === 'admin' ? 'ADMIN' : session.role === 'owner' ? 'OWNER' : 'STAFF'}</Text>
            </View>
          </View>

          <View style={styles.pageTitleRow}>
            <View>
              <Text style={styles.pageSubtitle}>OPERATIONS AUDIT TRAIL</Text>
              <Text style={styles.pageTitle}>Activity Logs</Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{activeItems.length} events logged</Text>
            </View>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Feather name="search" size={18} color="#A855F7" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by invoice, name, action, or shop..."
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Feather name="x-circle" size={18} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            )}
          </View>
          
          {/* Filters */}
          <View style={styles.filtersContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 20 }}>
              {availableFilters.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip, filter === f && styles.filterChipActive]}
                  onPress={() => setFilter(f)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                    {f === 'security' ? 'Security Alerts 🛡️' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  };

  const renderFooter = () => {
    if (activeItems.length === 0) return null;
    return (
      <View style={styles.paginationContainer}>
        <TouchableOpacity 
          style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
          onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
          disabled={currentPage === 1}
        >
          <Feather name="chevron-left" size={20} color={currentPage === 1 ? '#D1D5DB' : '#7C3AED'} />
        </TouchableOpacity>
        <Text style={styles.pageText}>
          Page {currentPage} of {totalPages}
        </Text>
        <TouchableOpacity 
          style={[styles.pageButton, currentPage === totalPages && styles.pageButtonDisabled]}
          onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
          disabled={currentPage === totalPages}
        >
          <Feather name="chevron-right" size={20} color={currentPage === totalPages ? '#D1D5DB' : '#7C3AED'} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* List */}
      <View style={styles.innerContent}>
        {loading ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            {renderHeader()}
            <ActivityLogSkeleton />
          </ScrollView>
        ) : (
          <FlatList
            data={currentLogs}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderHeader}
            ListFooterComponent={renderFooter}
            renderItem={renderLogItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadLogs(true);
                }}
                tintColor="#7C3AED"
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <Feather name={filter === 'security' ? 'shield' : 'activity'} size={32} color="#C4B5FD" />
                </View>
                <Text style={styles.emptyText}>
                  {filter === 'security'
                    ? 'No security alerts detected for your shop.'
                    : 'No activity found matching your filters.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F6FF',
  },
  header: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  safeHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  roleIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
    marginRight: 6,
  },
  roleText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  pageTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 12,
    marginBottom: 16,
  },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  countBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  pageSubtitle: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: 'bold',
    letterSpacing: 1.2,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 16,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  searchIcon: {
    marginRight: 10,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  filtersContainer: {
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  filterChipActive: {
    backgroundColor: '#FFF',
    borderColor: '#FFF',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: 'bold',
  },
  filterChipTextActive: {
    color: '#7C3AED',
  },
  innerContent: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 12,
  },
  logCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    boxShadow: '0px 2px 10px rgba(124, 58, 237, 0.04)',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  logContent: {
    flex: 1,
    justifyContent: 'center',
  },
  logTitle: {
    fontSize: 14,
    color: '#1A1A2E',
    fontWeight: 'bold',
    marginBottom: 6,
    lineHeight: 20,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logUser: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: 'bold',
  },
  logDate: {
    fontSize: 10,
    color: '#A0AEC0',
    fontWeight: '500',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: 'bold',
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
  pageButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageButtonDisabled: {
    backgroundColor: '#F3F4F6',
  },
  pageText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: '#4B5563',
    fontWeight: '600',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  severityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  shopBadge: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  shopBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6D28D9',
  },
});
