import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { NavTab } from '../components/BottomNavBar';
import { LoadingTasksSkeleton } from '../components/skeleton';
import { hapticFeedback } from '../utils/haptics';

interface LoadingTasksScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

export const LoadingTasksScreen: React.FC<LoadingTasksScreenProps> = ({
  session,
  activeTab,
  onTabChange,
}) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const PAGE_SIZE = 7;
  const [currentPage, setCurrentPage] = useState(1);

  // Detail View State
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  
  // Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessState, setShowSuccessState] = useState(false);

  const loadPendingTasks = useCallback(async () => {
    setLoading(true);
    try {
      const invoices = await billingService.fetchInvoices(session.shop_id);
      const pending = invoices.filter(inv => inv.loadingStatus === 'pending' || inv.loadingStatus === 'partial');
      
      // Sort by date ascending (oldest first)
      pending.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      setTasks(pending);
    } catch (error) {
      console.error('Error loading pending tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [session.shop_id]);

  useEffect(() => {
    if (activeTab === 'loading_tasks') {
      loadPendingTasks();
    }
  }, [activeTab, loadPendingTasks]);

  const handleSelectTask = async (task: any) => {
    hapticFeedback.light();
    try {
      const logs = await billingService.fetchLoadingLogs(task.dbId);
      const loadedMap = new Map<string, number>();
      
      logs.forEach(log => {
        (log.items_loaded || []).forEach((il: any) => {
          loadedMap.set(il.tile_name, (loadedMap.get(il.tile_name) || 0) + Number(il.boxes_loaded));
        });
      });

      const initialChecked: Record<string, boolean> = {};
      task.items.forEach((item: any) => {
        const loaded = loadedMap.get(item.name) || 0;
        if (loaded >= item.boxes) {
          initialChecked[item.name] = true;
        } else {
          initialChecked[item.name] = false;
        }
      });
      setCheckedItems(initialChecked);
      setSelectedTask(task);
    } catch (e) {
      console.error(e);
      const fallback: Record<string, boolean> = {};
      task.items.forEach((item: any) => fallback[item.name] = false);
      setCheckedItems(fallback);
      setSelectedTask(task);
    }
  };

  const closeDetail = () => {
    hapticFeedback.light();
    setSelectedTask(null);
    setCheckedItems({});
    setShowConfirmModal(false);
    setShowSuccessState(false);
  };

  const toggleItem = (name: string) => {
    hapticFeedback.selection();
    setCheckedItems(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const submitDispatch = async () => {
    setIsSubmitting(true);
    const previousTasks = tasks;
    
    try {
      const logs = await billingService.fetchLoadingLogs(selectedTask.dbId);
      const loadedMap = new Map<string, number>();
      logs.forEach(log => {
        (log.items_loaded || []).forEach((il: any) => {
          loadedMap.set(il.tile_name, (loadedMap.get(il.tile_name) || 0) + Number(il.boxes_loaded));
        });
      });

      const itemsToLoad = selectedTask.items.map((item: any) => {
        const alreadyLoaded = loadedMap.get(item.name) || 0;
        const remaining = Math.max(0, item.boxes - alreadyLoaded);
        
        if (checkedItems[item.name] && remaining > 0) {
          return {
            variant_id: item.name,
            tile_name: item.name,
            boxes_loaded: remaining
          };
        }
        return null;
      }).filter(Boolean);

      const totalBoxesInBatch = itemsToLoad.reduce((sum: number, item: any) => sum + item.boxes_loaded, 0);
      
      // Calculate true total loaded from the ledger (loadedMap) to fix any RLS desyncs
      const previouslyLoadedSum = Array.from(loadedMap.values()).reduce((sum: number, val: number) => sum + val, 0);
      const newTotalLoaded = previouslyLoadedSum + totalBoxesInBatch;
      const billedBoxes = selectedTask.totalBoxesBilled || selectedTask.items.reduce((s: number, i: any) => s + i.boxes, 0);

      const payload = {
        shopId: session.shop_id,
        invoiceDbId: selectedTask.dbId,
        invoiceNumber: selectedTask.invoiceId,
        loadedBy: session.id, 
        loadedByName: session.username || session.email || 'User',
        vehicleNumber: '',
        notes: 'Dispatched via Loading Tasks screen',
        itemsLoaded: itemsToLoad,
        totalBoxesInBatch,
        newTotalBoxesLoaded: newTotalLoaded,
        totalBoxesBilled: billedBoxes,
      };

      // 1. Optimistic UI update (0ms immediate feedback)
      if (newTotalLoaded >= billedBoxes) {
        setTasks(prev => prev.filter(t => t.dbId !== selectedTask.dbId));
      } else {
        setTasks(prev => prev.map(t => t.dbId === selectedTask.dbId ? { ...t, totalBoxesLoaded: newTotalLoaded, loadingStatus: 'partial' } : t));
      }
      hapticFeedback.success();
      setShowSuccessState(true);

      // 2. Background RPC with rollback on error
      const res = await billingService.createLoadingBatch(payload);
      
      if (res.success) {
        setTimeout(() => {
          closeDetail();
          loadPendingTasks();
        }, 1200);
      } else {
        // Rollback optimistic state
        setTasks(previousTasks);
        setShowSuccessState(false);
        setShowConfirmModal(false);
        hapticFeedback.error();
        alert(res.error || 'Failed to dispatch.');
      }
    } catch (e) {
      console.error(e);
      setTasks(previousTasks);
      setShowSuccessState(false);
      setShowConfirmModal(false);
      hapticFeedback.error();
      alert('An error occurred while submitting.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // DETAIL VIEW RENDER
  // ---------------------------------------------------------------------------
  if (selectedTask) {
    const totalItems = selectedTask.items.length;
    const checkedCount = selectedTask.items.filter((i: any) => checkedItems[i.name]).length;
    const totalBoxes = selectedTask.items.reduce((sum: number, item: any) => sum + item.boxes, 0);
    const progressPercent = totalItems === 0 ? 0 : (checkedCount / totalItems) * 100;
    const isAllChecked = checkedCount === totalItems;

    let statusText = "Pending";
    let statusBg = "#FEF2F2";
    let statusColor = "#EF4444";
    
    if (isAllChecked) {
      statusText = "Ready to Complete";
      statusBg = "#ECFDF5";
      statusColor = "#10B981";
    } else if (checkedCount > 0) {
      statusText = "In Progress";
      statusBg = "#FFFBEB";
      statusColor = "#D97706";
    }

    return (
      <View style={styles.detailContainer}>
        <LinearGradient
          colors={['#6D28D9', '#7C3AED', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            <View style={styles.appBar}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={closeDetail} style={styles.backBtnHeader}>
                  <Feather name="arrow-left" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>Tasks</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
                <Text style={[styles.statusPillText, { color: statusColor }]}>{statusText}</Text>
              </View>
            </View>
            <View style={styles.pageTitleRow}>
              <View>
                <Text style={styles.pageSubtitle}>LOADING DISPATCH</Text>
                <Text style={styles.pageTitle}>Loading Details</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <ScrollView style={styles.detailContent} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          
          {/* Order Card */}
          <View style={styles.orderCard}>
            <Text style={styles.eyebrow}>Loading Task</Text>
            <Text style={styles.invoiceText}>Invoice #{selectedTask.invoiceId}</Text>
            <Text style={styles.customerText}>{selectedTask.customerName}</Text>
            
            <View style={styles.summaryRow}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryBoxLabel}>Total tiles</Text>
                <Text style={styles.summaryBoxVal}>{totalItems} items</Text>
              </View>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryBoxLabel}>Total boxes</Text>
                <Text style={styles.summaryBoxVal}>{totalBoxes} boxes</Text>
              </View>
            </View>
          </View>

          {/* Progress Card */}
          <LinearGradient colors={['#6D28D9', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.progressCard}>
            <View style={styles.progressTop}>
              <Text style={styles.progressLabel}>Loading progress</Text>
              <Text style={styles.progressVal}>{checkedCount} / {totalItems}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${progressPercent}%` }]} />
            </View>
          </LinearGradient>

          {/* Section Head */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionHeadTitle}>Tiles to load</Text>
            <Text style={styles.sectionHeadSub}>Check each item</Text>
          </View>

          {/* Tile List */}
          <View style={styles.tileList}>
            {selectedTask.items.map((item: any, idx: number) => {
              const isChecked = checkedItems[item.name];
              return (
                <TouchableOpacity 
                  key={idx}
                  activeOpacity={0.8}
                  onPress={() => toggleItem(item.name)}
                  style={[styles.tile, isChecked && styles.tileChecked]}
                >
                  <View style={[styles.detailCheckbox, isChecked && styles.detailCheckboxChecked]}>
                    {isChecked && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <View style={styles.tileInfo}>
                    <Text style={styles.tileName}>{item.name}</Text>
                    {!!item.variantLabel && <Text style={styles.tileMeta}>{item.variantLabel}</Text>}
                  </View>
                  <View style={styles.tileQty}>
                    <Text style={styles.qtyVal}>{item.boxes}</Text>
                    <Text style={styles.qtyLabel}>boxes</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

        </ScrollView>

        {/* Bottom Fixed Action */}
        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
          <TouchableOpacity 
            style={[styles.completeBtn, !isAllChecked && styles.completeBtnDisabled]}
            disabled={!isAllChecked}
            onPress={() => setShowConfirmModal(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.completeBtnText, !isAllChecked && styles.completeBtnTextDisabled]}>
              Complete Loading
            </Text>
          </TouchableOpacity>
        </SafeAreaView>

        {/* Custom Confirmation Bottom Sheet */}
        <Modal visible={showConfirmModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.sheet}>
              <View style={styles.handle} />
              
              {!showSuccessState ? (
                <>
                  <View style={styles.warningIconWrap}>
                    <Feather name="alert-circle" size={24} color="#D97706" />
                  </View>
                  <Text style={styles.sheetTitle}>Double-check before completing</Text>
                  <Text style={styles.sheetDesc}>
                    Make sure every tile above has actually been loaded.
                    Once you complete this task, the owner will see loading as completed.
                  </Text>
                  
                  <View style={styles.checkSummaryBox}>
                    <Text style={styles.checkSummaryVal}>{checkedCount} of {totalItems} tile items checked</Text>
                    <Text style={styles.checkSummarySub}>Please physically verify the vehicle before confirming.</Text>
                  </View>

                  <View style={styles.sheetActions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowConfirmModal(false)} disabled={isSubmitting}>
                      <Text style={styles.cancelBtnText}>Go Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.confirmBtn} onPress={submitDispatch} disabled={isSubmitting}>
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.confirmBtnText}>Yes, Complete</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.doneState}>
                  <View style={styles.doneIconWrap}>
                    <Feather name="check" size={32} color="#10B981" />
                  </View>
                  <Text style={styles.doneTitle}>Loading Complete</Text>
                  <Text style={styles.doneDesc}>Invoice #{selectedTask.invoiceId} has been marked as loaded.</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // LIST VIEW RENDER
  // ---------------------------------------------------------------------------
  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={['#6D28D9', '#7C3AED', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            <View style={styles.appBar}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => onTabChange('home')} style={styles.backBtnHeader}>
                  <Feather name="arrow-left" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>Dashboard</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.roleBadgeHeader}>
                <View style={styles.roleIndicator} />
                <Text style={styles.roleText}>{session.role === 'owner' ? 'OWNER' : 'STAFF'}</Text>
              </View>
            </View>
            <View style={styles.pageTitleRow}>
              <View>
                <Text style={styles.pageSubtitle}>DISPATCH & LOGISTICS</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.pageTitle}>Pending Tasks</Text>
                  {!loading && (
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{tasks.length}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {loading ? (
          <LoadingTasksSkeleton />
        ) : (
          <View style={{ padding: 16 }}>
            {tasks.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="check-circle" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>All caught up! No pending tasks.</Text>
              </View>
            ) : (
              <>
                {tasks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(task => {
                  const billedBoxes = task.totalBoxesBilled || task.items.reduce((s: number, i: any) => s + i.boxes, 0);
                  const loadedBoxes = task.totalBoxesLoaded || 0;
                  const isPartial = task.loadingStatus === 'partial';

                  return (
                    <TouchableOpacity 
                      key={task.invoiceId} 
                      style={styles.taskCard}
                      onPress={() => handleSelectTask(task)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.taskHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.taskTitleList}>{task.customerName}</Text>
                          <Text style={styles.taskSubtitleList}>Invoice #{task.invoiceId} • {new Date(task.date).toLocaleDateString('en-IN')}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                          <View style={[styles.badge, isPartial ? styles.badgePartial : styles.badgePending]}>
                            <Text style={isPartial ? styles.badgeTextPartial : styles.badgeTextPending}>
                              {isPartial ? 'PARTIAL' : 'PENDING'}
                            </Text>
                          </View>
                          <Text style={styles.progressText}>{loadedBoxes} / {billedBoxes} Boxes</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <View style={styles.paginationContainer}>
                  <TouchableOpacity 
                    style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                    onPress={() => {
                      hapticFeedback.light();
                      setCurrentPage(prev => Math.max(1, prev - 1));
                    }}
                    disabled={currentPage === 1}
                  >
                    <Feather name="chevron-left" size={20} color={currentPage === 1 ? '#D1D5DB' : '#7C3AED'} />
                  </TouchableOpacity>
                  <Text style={styles.pageText}>
                    Page {currentPage} of {Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))}
                  </Text>
                  <TouchableOpacity 
                    style={[styles.pageButton, currentPage === Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)) && styles.pageButtonDisabled]}
                    onPress={() => {
                      hapticFeedback.light();
                      setCurrentPage(prev => Math.min(Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)), prev + 1));
                    }}
                    disabled={currentPage === Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))}
                  >
                    <Feather name="chevron-right" size={20} color={currentPage === Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)) ? '#D1D5DB' : '#7C3AED'} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

// ---------------------------------------------------------------------------
// STYLES
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Global
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  content: { flex: 1 },
  loaderContainer: { marginTop: 60, alignItems: 'center' },

  // List View
  header: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  safeHeader: { paddingHorizontal: 20, paddingBottom: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  backBtnHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  roleBadgeHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 2 },
  countBadge: { backgroundColor: '#FCD34D', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, marginLeft: 12, marginTop: 4 },
  countText: { fontSize: 12, fontWeight: 'bold', color: '#92400E' },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 14, color: '#6B7280', marginTop: 12, fontWeight: 'bold' },
  taskCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    boxShadow: '0px 2px 12px rgba(124, 58, 237, 0.05)',
  },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskTitleList: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  taskSubtitleList: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 4, alignSelf: 'flex-end' },
  badgePending: { backgroundColor: '#FEF08A' },
  badgeTextPending: { color: '#854D0E', fontSize: 10, fontWeight: 'bold' },
  badgePartial: { backgroundColor: '#FED7AA' },
  badgeTextPartial: { color: '#9A3412', fontSize: 10, fontWeight: 'bold' },
  progressText: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },

  paginationContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16, paddingBottom: 24, gap: 16 },
  pageButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  pageButtonDisabled: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  pageText: { fontSize: 13, fontWeight: 'bold', color: '#6B7280' },

  // Detail View
  detailContainer: { flex: 1, backgroundColor: '#F8F6FF' },
  topbar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(248,246,255,0.94)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(124,58,237,0.1)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backText: { color: '#6B7280', fontSize: 15, fontWeight: '500', marginLeft: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailTitle: { fontSize: 26, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.6 },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99 },
  statusPillText: { fontSize: 12, fontWeight: 'bold' },
  detailContent: { flex: 1 },
  
  orderCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    marginBottom: 14,
    boxShadow: '0px 3px 18px rgba(124, 58, 237, 0.06)',
  },
  eyebrow: { fontSize: 11, fontWeight: 'bold', color: '#8A8D94', textTransform: 'uppercase', letterSpacing: 0.8 },
  invoiceText: { fontSize: 18, fontWeight: '800', color: '#1A1A2E', marginTop: 4 },
  customerText: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  summaryBox: { flex: 1, backgroundColor: '#F8F6FF', borderRadius: 12, padding: 12 },
  summaryBoxLabel: { fontSize: 11, color: '#8A8D94', marginBottom: 4 },
  summaryBoxVal: { fontSize: 15, fontWeight: 'bold', color: '#1A1A2E' },

  progressCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
  },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  progressVal: { fontSize: 17, fontWeight: 'bold', color: '#FFF' },
  track: { height: 7, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 99, marginTop: 14, overflow: 'hidden' },
  bar: { height: '100%', backgroundColor: '#FFF', borderRadius: 99 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, paddingHorizontal: 4 },
  sectionHeadTitle: { fontSize: 17, fontWeight: 'bold', color: '#1A1A2E', letterSpacing: -0.2 },
  sectionHeadSub: { fontSize: 12, color: '#6B7280' },
  
  tileList: { gap: 10 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1.5,
    borderColor: 'transparent',
    boxShadow: '0px 2px 12px rgba(124, 58, 237, 0.04)',
  },
  tileChecked: { backgroundColor: '#F0FDF4', borderColor: '#A7F3D0' },
  detailCheckbox: {
    width: 25,
    height: 25,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  detailCheckboxChecked: { backgroundColor: '#10B981', borderColor: '#10B981' },
  tileInfo: { flex: 1 },
  tileName: { fontSize: 15, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  tileMeta: { fontSize: 12, color: '#6B7280' },
  tileQty: { alignItems: 'flex-end' },
  qtyVal: { fontSize: 16, fontWeight: '800', color: '#1A1A2E' },
  qtyLabel: { fontSize: 11, color: '#8A8D94' },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 16,
  },
  completeBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: 'center',
  },
  completeBtnDisabled: { backgroundColor: '#D1D5DB' },
  completeBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  completeBtnTextDisabled: { color: '#9CA3AF' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(10,11,13,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    paddingBottom: 40,
  },
  handle: { width: 38, height: 4, backgroundColor: '#D1D5DB', borderRadius: 99, alignSelf: 'center', marginBottom: 20 },
  warningIconWrap: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#FEF3C7', justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 21, fontWeight: 'bold', color: '#1A1A2E', letterSpacing: -0.4, marginBottom: 10 },
  sheetDesc: { fontSize: 14, color: '#4B5563', lineHeight: 22, marginBottom: 18 },
  checkSummaryBox: { backgroundColor: '#F8F6FF', borderRadius: 15, padding: 14, marginBottom: 20 },
  checkSummaryVal: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  checkSummarySub: { fontSize: 13, color: '#6B7280' },
  sheetActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: 'bold', color: '#4B5563' },
  confirmBtn: { flex: 1.35, backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, fontWeight: 'bold', color: '#FFF' },

  doneState: { alignItems: 'center', paddingVertical: 20 },
  doneIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  doneTitle: { fontSize: 24, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 8 },
  doneDesc: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
});
