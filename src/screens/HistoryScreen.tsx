import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  StatusBar,
  Alert,
  FlatList,
  Platform,
  Share,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { shareOrPrintReceipt } from '../utils/receiptPrint';
import { HistorySkeleton } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SavedEstimate {
  dbId?: string;
  projectName: string;
  rooms: any[];
  wastagePercent?: number;
  totalSqft?: number;
  totalBoxes?: number;
  totalAmount?: number;
  timestamp: string;
  isDraft?: boolean;
  status?: 'draft' | 'completed';
}

interface InvoiceItem {
  name: string;
  variantLabel?: string;
  brand: string;
  size: string;
  boxes: number;
  pricePerBox: number;
  total: number;
}

interface Repayment {
  amount: number;
  date: string;
  mode: string;
  timestamp?: string;
}

interface CreditDetail {
  depositPaid: number;
  debt: number;
  dueDate: string;
  repayments: Repayment[];
}

interface InvoiceRecord {
  dbId?: string;
  invoiceId: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerGst?: string;
  customerAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  discount?: number;
  gst: number;
  gstType?: string;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'credit';
  isVoided?: boolean;
  voidedAt?: string;
  creditDetail: CreditDetail | null;
  txnRef?: string;
  createdByName?: string;
  loadingStatus?: string;
  assignedTo?: string;
  assignedToName?: string;
  totalBoxesBilled?: number;
  totalBoxesLoaded?: number;
}

const DRAFT_KEY = 'tilor_current_draft';

type HistoryActiveTab = 'bills' | 'estimates';
type PaymentFilter = 'all' | 'cash' | 'credit' | 'upi' | 'card';
type DateFilter = 'all' | 'today' | 'week' | 'month';

interface HistoryScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

const getLocalDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const generateReceiptText = (inv: InvoiceRecord): string => {
  if (!inv) return '';
  const itemLines = inv.items
    ? inv.items
        .map(
          (item: InvoiceItem, i: number) =>
            `${i + 1}. ${item.name} (${item.brand || 'Tile'})\n   ${item.boxes} bx × ₹${item.pricePerBox} = ₹${item.total}`
        )
        .join('\n')
    : '';

  return `
🧾 *TILOR STORE RECEIPT*
--------------------------------
Invoice #: ${inv.invoiceId}
Date: ${new Date(inv.date).toLocaleDateString('en-IN')}
Customer: ${inv.customerName}
Phone: ${inv.customerPhone || 'N/A'}
${inv.customerAddress ? `Address: ${inv.customerAddress}\n` : ''}${inv.customerGst ? `GSTIN: ${inv.customerGst}\n` : ''}--------------------------------
*ITEMS PURCHASED:*
${itemLines}

--------------------------------
Subtotal: ₹${inv.subtotal?.toLocaleString('en-IN')}
${inv.discount ? `Discount: ₹${inv.discount?.toLocaleString('en-IN')}\n` : ''}${inv.gst && inv.gst > 0 ? `Tax (${inv.gstType === 'igst' ? '18% IGST' : '9% CGST + 9% SGST'}): ₹${inv.gst?.toLocaleString('en-IN')}\n` : 'Tax: None (Non-GST Bill)\n'}*GRAND TOTAL: ₹${inv.total?.toLocaleString('en-IN')}*
Payment Mode: ${inv.paymentMethod?.toUpperCase()}
${
  inv.paymentMethod === 'credit' && inv.creditDetail
    ? `\n*KHATABOOK LEDGER:*
Deposit Paid: ₹${inv.creditDetail.depositPaid}
Outstanding Debt: ₹${inv.creditDetail.debt}
Due Date: ${inv.creditDetail.dueDate}`
    : ''
}
--------------------------------
Thank you for shopping at Tilor!
`.trim();
};

const handleShareOrPrintInvoice = async (inv: InvoiceRecord | null) => {
  if (!inv) return;
  const receiptText = generateReceiptText(inv);
  await shareOrPrintReceipt(receiptText, inv.invoiceId);
};

// ─── Memoized Timeline Card Components ───────────────────────────────────────

interface EstimateTimelineCardProps {
  estimate: SavedEstimate;
  onEditDraft: (est: SavedEstimate) => void;
  onDeleteDraft: (est: SavedEstimate) => void;
}

const EstimateTimelineCard = React.memo<EstimateTimelineCardProps>(({
  estimate: est,
  onEditDraft,
  onDeleteDraft,
}) => {
  const roomNames = est.rooms ? est.rooms.map((r: any) => r.name).join(', ') : '';
  const totalBoxes = est.totalBoxes !== undefined
    ? est.totalBoxes
    : (est.rooms || []).reduce((s: number, r: any) => s + (r.boxes || 0), 0);
  const totalAmount = est.totalAmount !== undefined
    ? est.totalAmount
    : (est.rooms || []).reduce((s: number, r: any) => s + (r.totalAmount || 0), 0);

  const dateStr = new Date(est.timestamp).toLocaleDateString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const isCompleted = est.isDraft === false || est.status === 'completed';

  return (
    <View style={styles.timelineItem}>
      <View style={[styles.timelineNode, !isCompleted ? styles.nodeDraft : styles.nodeSaved]}>
        <Feather name={isCompleted ? "check-circle" : "file"} size={10} color="#FFF" />
      </View>

      <View style={styles.itemContentCard}>
        <View style={styles.itemHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.itemTitle}>{est.projectName}</Text>
              <View style={isCompleted ? [styles.badgeSaved, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }] : styles.badgeDraft}>
                <Text style={isCompleted ? [styles.badgeSavedText, { color: '#166534', fontWeight: '800' }] : styles.badgeDraftText}>
                  {isCompleted ? '✓ Completed (Billed)' : 'Active Draft'}
                </Text>
              </View>
            </View>
            <Text style={styles.itemMetaDate}>{dateStr}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.itemAmountVal}>₹{totalAmount.toLocaleString('en-IN')}</Text>
            <Text style={styles.itemMetaDetail}>{totalBoxes} boxes total</Text>
          </View>
        </View>

        <View style={styles.itemFooterRow}>
          <Text style={styles.roomsText} numberOfLines={1}>
            <Feather name="home" size={10} /> {roomNames || 'No rooms added'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {!isCompleted ? (
              <TouchableOpacity
                style={styles.itemEditBtn}
                onPress={() => onEditDraft(est)}
              >
                <Text style={styles.itemEditBtnText}>Edit Draft</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                <Feather name="lock" size={11} color="#6B7280" />
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280' }}>Billed (Locked)</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.itemDeleteBtn}
              onPress={() => onDeleteDraft(est)}
            >
              <Feather name="trash-2" size={12} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
});
EstimateTimelineCard.displayName = 'EstimateTimelineCard';

interface InvoiceTimelineCardProps {
  invoice: InvoiceRecord;
  onOpenRepayment: (inv: InvoiceRecord) => void;
  onOpenDispatch: (inv: InvoiceRecord) => void;
  onOpenDetails: (inv: InvoiceRecord) => void;
}

const InvoiceTimelineCard = React.memo<InvoiceTimelineCardProps>(({
  invoice: inv,
  onOpenRepayment,
  onOpenDispatch,
  onOpenDetails,
}) => {
  const totalBoxes = inv.items.reduce((s, item) => s + item.boxes, 0);
  const dateStr = new Date(inv.date).toLocaleDateString('en-IN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const isCredit = inv.paymentMethod === 'credit' || Boolean(inv.creditDetail);
  const outstanding = isCredit && inv.creditDetail ? inv.creditDetail.debt : 0;
  
  const isOverdue = isCredit && inv.creditDetail?.dueDate &&
    new Date(inv.creditDetail.dueDate) < new Date() && outstanding > 0;

  const itemSummary = inv.items.slice(0, 2).map(i => i.name).join(', ');
  const moreItemsCount = inv.items.length > 2 ? ` +${inv.items.length - 2} more` : '';

  return (
    <View style={styles.timelineItem}>
      <View style={[
        styles.timelineNode,
        inv.isVoided ? styles.nodeVoided : isCredit ? styles.nodeCredit : styles.nodePaid
      ]}>
        <Feather name={inv.isVoided ? 'slash' : isCredit ? 'book-open' : 'check'} size={10} color="#FFF" />
      </View>

      <View style={[styles.itemContentCard, inv.isVoided && styles.itemCardVoided]}>
        <View style={styles.itemHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={[styles.itemTitle, inv.isVoided && styles.lineThrough]}>
                {inv.customerName}
              </Text>
              {inv.isVoided ? (
                <View style={styles.voidedBadge}>
                  <Text style={styles.voidedBadgeText}>VOIDED</Text>
                </View>
              ) : (
                <View style={[styles.payBadge, (styles as any)[`payBadge_${inv.paymentMethod}`]]}>
                  <Text style={[styles.payBadgeText, (styles as any)[`payBadgeText_${inv.paymentMethod}`]]}>
                    {inv.paymentMethod.toUpperCase()}
                  </Text>
                </View>
              )}
              {inv.loadingStatus && inv.loadingStatus !== 'not_required' && !inv.isVoided ? (
                <View style={[styles.payBadge, { backgroundColor: inv.loadingStatus === 'pending' ? '#FEF08A' : inv.loadingStatus === 'partial' ? '#FED7AA' : '#BBF7D0' }]}>
                  <Text style={[styles.payBadgeText, { color: inv.loadingStatus === 'pending' ? '#854D0E' : inv.loadingStatus === 'partial' ? '#9A3412' : '#166534' }]}>
                    {inv.loadingStatus.toUpperCase() === 'PENDING' ? 'PENDING LOADING' : inv.loadingStatus.toUpperCase() === 'PARTIAL' ? 'PARTIALLY LOADED' : 'FULLY LOADED'}
                  </Text>
                </View>
              ) : null}
              {isOverdue && !inv.isVoided && (
                <View style={styles.overdueBadge}>
                  <Text style={styles.overdueBadgeText}>OVERDUE</Text>
                </View>
              )}
            </View>
            <Text style={styles.itemMetaDate}>{dateStr} · ID: {inv.invoiceId}</Text>
            {Boolean(inv.createdByName) && (
              <Text style={[styles.itemMetaDate, { color: '#8B5CF6', marginTop: 2 }]}>
                Created by: {inv.createdByName}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.itemAmountVal, inv.isVoided && styles.lineThrough]}>
              ₹{inv.total.toLocaleString('en-IN')}
            </Text>
            <Text style={styles.itemMetaDetail}>{totalBoxes} boxes</Text>
          </View>
        </View>

        {/* Item summary line */}
        {itemSummary ? (
          <Text style={styles.itemsSummaryPreview} numberOfLines={1}>
            📦 {itemSummary}{moreItemsCount}
          </Text>
        ) : null}

        {/* Khatabook Outstanding Debt Info Banner */}
        {!inv.isVoided && isCredit && outstanding > 0 && (
          <View style={styles.debtBanner}>
            <View>
              <Text style={styles.debtBannerLabel}>Ledger Balance Outstanding:</Text>
              <Text style={styles.debtBannerVal}>₹{outstanding.toLocaleString('en-IN')}</Text>
            </View>
            <Text style={styles.debtBannerDueDate}>Due: {inv.creditDetail?.dueDate || 'N/A'}</Text>
          </View>
        )}

        {!inv.isVoided && isCredit && outstanding === 0 && (
          <View style={styles.paidBanner}>
            <Feather name="check-circle" size={12} color="#16A34A" />
            <Text style={styles.paidBannerText}>Ledger Balance Fully Paid</Text>
          </View>
        )}

        <View style={styles.itemFooterRow}>
          <Text style={styles.roomsText} numberOfLines={1}>
            Phone: {inv.customerPhone || 'N/A'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {!inv.isVoided && isCredit && outstanding > 0 && (
              <TouchableOpacity
                style={styles.repayBtn}
                onPress={() => onOpenRepayment(inv)}
              >
                <Text style={styles.repayBtnText}>Repay Debt</Text>
              </TouchableOpacity>
            )}
            {!inv.isVoided && inv.loadingStatus && inv.loadingStatus !== 'not_required' && inv.loadingStatus !== 'completed' ? (
              <TouchableOpacity
                style={[styles.viewBillBtn, { backgroundColor: '#F3F4F6' }]}
                onPress={() => onOpenDispatch(inv)}
              >
                <Text style={[styles.viewBillBtnText, { color: '#6D28D9' }]}>Record Loading</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.viewBillBtn}
              onPress={() => onOpenDetails(inv)}
            >
              <Text style={styles.viewBillBtnText}>View Bill</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
});
InvoiceTimelineCard.displayName = 'InvoiceTimelineCard';

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [subTab, setSubTab]                       = useState<HistoryActiveTab>('bills');
  const [search, setSearch]                       = useState('');
  const debouncedSearch                           = useDebouncedValue(search, 200);
  const [paymentFilter, setPaymentFilter]         = useState<PaymentFilter>('all');
  const [dateFilter, setDateFilter]               = useState<DateFilter>('all');
  const [estimates, setEstimates]                 = useState<SavedEstimate[]>([]);
  const [invoices, setInvoices]                   = useState<InvoiceRecord[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [refreshing, setRefreshing]               = useState(false);
  const [visibleCount, setVisibleCount]           = useState(10);

  // Reset pagination window when search, filter or tab changes
  useEffect(() => {
    setVisibleCount(10);
  }, [debouncedSearch, paymentFilter, dateFilter, subTab]);

  // Detailed Invoice View Modal state
  const [selectedInvoice, setSelectedInvoice]     = useState<InvoiceRecord | null>(null);

  // Repayment Modal state
  const [repayModalVisible, setRepayModalVisible] = useState(false);
  const [repayInvoice, setRepayInvoice]           = useState<InvoiceRecord | null>(null);
  const [repayAmount, setRepayAmount]             = useState('');
  const [repayMode, setRepayMode]                 = useState('cash');
  const [repayDate, setRepayDate]                 = useState(getLocalDateString());

  // Dispatch / Loading Modal state
  const [dispatchModalVisible, setDispatchModalVisible] = useState(false);
  const [dispatchInvoice, setDispatchInvoice]           = useState<InvoiceRecord | null>(null);
  const [dispatchItems, setDispatchItems]               = useState<{ variantId: string; name: string; billed: number; loaded: number; loadingNow: string }[]>([]);
  const [vehicleNumber, setVehicleNumber]               = useState('');
  const [dispatchNotes, setDispatchNotes]               = useState('');
  const [isDispatching, setIsDispatching]               = useState(false);

  // Load history data from Supabase & Storage
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Invoices from Supabase
      const fetchedInvoices = await billingService.fetchInvoices(session.shop_id);
      setInvoices(fetchedInvoices);

      // 2. Fetch Estimates from Supabase & Local Storage
      const fetchedEstimates = await billingService.fetchEstimates(session.shop_id);
      setEstimates(fetchedEstimates);
    } catch (e) {
      console.error('Error loading history screen data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.shop_id]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  const onRefresh = () => {
    setRefreshing(true);
    loadHistory();
  };

  // Restore estimate to draft state and navigate to Estimator
  const handleEditDraft = useCallback(async (estimate: SavedEstimate) => {
    if (estimate.isDraft === false || estimate.status === 'completed') {
      Alert.alert('Locked Estimate', 'This estimate has already been converted into a completed invoice and cannot be edited.');
      return;
    }
    hapticFeedback.light();
    try {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(estimate));
      onTabChange('estimator');
    } catch {
      Alert.alert('Error', 'Failed to restore estimate draft.');
    }
  }, [onTabChange]);

  // Delete draft estimate
  const handleDeleteDraft = useCallback((estimate: SavedEstimate) => {
    hapticFeedback.light();
    Alert.alert(
      'Delete Estimate?',
      `Are you sure you want to delete "${estimate.projectName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await billingService.deleteEstimate({
              dbId: estimate.dbId,
              timestamp: estimate.timestamp,
              projectName: estimate.projectName,
            });
            if (success) {
              setEstimates(prev => prev.filter(e => {
                if (estimate.dbId && (e.dbId === estimate.dbId || (e as any).id === estimate.dbId)) return false;
                if (estimate.timestamp && e.timestamp === estimate.timestamp) return false;
                if (estimate.projectName && e.projectName && e.projectName.trim().toLowerCase() === estimate.projectName.trim().toLowerCase()) return false;
                return true;
              }));
              hapticFeedback.success();
            } else {
              hapticFeedback.error();
              Alert.alert('Error', 'Failed to delete estimate.');
            }
          },
        },
      ]
    );
  }, []);

  // Void Invoice Handler
  const handleVoidInvoice = (invoice: InvoiceRecord) => {
    if (!invoice.dbId) return;
    Alert.alert(
      'Void Invoice?',
      `Are you sure you want to void Invoice #${invoice.invoiceId}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void Invoice',
          style: 'destructive',
          onPress: async () => {
            const res = await billingService.voidInvoice(invoice.dbId!, 'Voided by store owner');
            if (res.success) {
              setInvoices(prev =>
                prev.map(inv =>
                  inv.invoiceId === invoice.invoiceId ? { ...inv, isVoided: true } : inv
                )
              );
              if (selectedInvoice && selectedInvoice.invoiceId === invoice.invoiceId) {
                setSelectedInvoice(prev => prev ? { ...prev, isVoided: true } : null);
              }
              const refundNotice = res.depositToRefund && res.depositToRefund > 0
                ? `\n\n⚠️ Cash deposit to refund customer: ₹${res.depositToRefund.toLocaleString('en-IN')}`
                : '';
              Alert.alert('Invoice Voided', `Invoice #${invoice.invoiceId} has been voided. Warehouse stock has been restored.${refundNotice}`);
            } else {
              Alert.alert('Error', res.error || 'Failed to void invoice.');
            }
          },
        },
      ]
    );
  };

  // Open repayment dialog
  const handleOpenRepayment = useCallback((invoice: InvoiceRecord) => {
    hapticFeedback.light();
    setRepayInvoice(invoice);
    setRepayAmount(invoice.creditDetail ? invoice.creditDetail.debt.toString() : '0');
    setRepayMode('cash');
    setRepayDate(getLocalDateString());
    setRepayModalVisible(true);
  }, []);

  const handleOpenDetails = useCallback((invoice: InvoiceRecord) => {
    hapticFeedback.light();
    setSelectedInvoice(invoice);
  }, []);

  // Submit repayment logic
  const handleSubmitRepayment = async () => {
    const amount = parseFloat(repayAmount);
    if (!repayInvoice || isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid', 'Please enter a valid repayment amount.');
      return;
    }

    const currentDebt = repayInvoice.creditDetail?.debt || 0;
    if (amount > currentDebt) {
      Alert.alert('Overpayment', `Repayment cannot exceed the outstanding balance of ₹${currentDebt}.`);
      return;
    }

    if (!repayInvoice.dbId) {
      Alert.alert('Error', 'Cannot record repayment for offline invoice record.');
      return;
    }

    try {
      const res = await billingService.recordRepayment(
        repayInvoice.dbId,
        amount,
        repayMode,
        repayDate
      );

      if (!res.success) {
        Alert.alert('Error', res.error || 'Failed to record repayment.');
        return;
      }

      // Update local invoice list
      const updatedInvoices = invoices.map(inv => {
        if (inv.invoiceId !== repayInvoice.invoiceId) return inv;
        const prevCredit = inv.creditDetail!;
        const updatedCredit = {
          ...prevCredit,
          debt: res.newDebt !== undefined ? res.newDebt : prevCredit.debt - amount,
          repayments: res.repayments || [
            ...(prevCredit.repayments || []),
            { amount, date: repayDate, mode: repayMode, timestamp: new Date().toISOString() },
          ],
        };
        return {
          ...inv,
          creditDetail: updatedCredit,
        };
      });

      setInvoices(updatedInvoices);

      // Instantly update open selectedInvoice modal state if visible
      if (selectedInvoice && selectedInvoice.invoiceId === repayInvoice.invoiceId) {
        const updatedSelected = updatedInvoices.find(i => i.invoiceId === repayInvoice.invoiceId) || null;
        setSelectedInvoice(updatedSelected);
      }

      hapticFeedback.success();
      setRepayModalVisible(false);
      setRepayInvoice(null);
      Alert.alert('Payment Recorded', `Recorded repayment of ₹${amount} successfully.`);
    } catch {
      Alert.alert('Error', 'Failed to submit repayment.');
    }
  };

  // ─── Dispatch & Loading ──────────────────────────────────────────────────
  const handleOpenDispatch = useCallback(async (invoice: InvoiceRecord) => {
    setDispatchInvoice(invoice);
    setDispatchModalVisible(true);
    setIsDispatching(true);
    
    try {
      const logs = await billingService.fetchLoadingLogs(invoice.dbId!);
      const loadedMap = new Map<string, number>();
      
      logs.forEach(log => {
        (log.items_loaded || []).forEach((il: any) => {
          loadedMap.set(il.tile_name, (loadedMap.get(il.tile_name) || 0) + Number(il.boxes_loaded));
        });
      });

      const initialItems = invoice.items.map(item => {
        const alreadyLoaded = loadedMap.get(item.name) || 0;
        const remaining = Math.max(0, item.boxes - alreadyLoaded);
        return {
          variantId: item.name, // using name as id for simplicity
          name: item.name,
          billed: item.boxes,
          loaded: alreadyLoaded,
          loadingNow: remaining > 0 ? remaining.toString() : '0'
        };
      });
      
      setDispatchItems(initialItems);
      setVehicleNumber('');
      setDispatchNotes('');
    } catch (e) {
      console.error(e);
      setDispatchItems([]);
    } finally {
      setIsDispatching(false);
    }
  }, []);

  const handleDispatchQtyChange = (index: number, val: string) => {
    const updated = [...dispatchItems];
    updated[index].loadingNow = val;
    setDispatchItems(updated);
  };

  const handleSaveDispatch = async () => {
    if (!dispatchInvoice || !dispatchInvoice.dbId) return;

    const itemsToLoad = dispatchItems.map(item => ({
      variant_id: item.variantId,
      tile_name: item.name,
      boxes_loaded: parseInt(item.loadingNow) || 0
    })).filter(i => i.boxes_loaded > 0);

    const totalBoxesInBatch = itemsToLoad.reduce((sum, item) => sum + item.boxes_loaded, 0);

    if (totalBoxesInBatch <= 0) {
      Alert.alert('Invalid', 'Please enter at least one box to load.');
      return;
    }

    setIsDispatching(true);
    
    const newTotalLoaded = (dispatchInvoice.totalBoxesLoaded || 0) + totalBoxesInBatch;

    const payload = {
      shopId: session.shop_id,
      invoiceDbId: dispatchInvoice.dbId,
      invoiceNumber: dispatchInvoice.invoiceId,
      loadedBy: 'unknown', // not strictly needed, backend uses name or handles null
      loadedByName: session.username || session.email || 'User',
      vehicleNumber: vehicleNumber.trim(),
      notes: dispatchNotes.trim(),
      itemsLoaded: itemsToLoad,
      totalBoxesInBatch,
      newTotalBoxesLoaded: newTotalLoaded,
      totalBoxesBilled: dispatchInvoice.totalBoxesBilled || dispatchInvoice.items.reduce((s, i) => s + i.boxes, 0),
    };

    const res = await billingService.createLoadingBatch(payload);
    setIsDispatching(false);

    if (res.success) {
      hapticFeedback.success();
      setDispatchModalVisible(false);
      setInvoices(prev => prev.map(inv => {
        if (inv.invoiceId === dispatchInvoice.invoiceId) {
          const loaded = (inv.totalBoxesLoaded || 0) + totalBoxesInBatch;
          const billed = inv.totalBoxesBilled || inv.items.reduce((s, i) => s + i.boxes, 0);
          return {
            ...inv,
            totalBoxesLoaded: loaded,
            loadingStatus: loaded >= billed ? 'completed' : 'partial'
          };
        }
        return inv;
      }));
      Alert.alert('Success', 'Loading dispatch recorded successfully.');
    } else {
      Alert.alert('Error', res.error || 'Failed to record dispatch.');
    }
  };

  // CSV Export Sales History
  const handleExportCSV = async () => {
    if (invoices.length === 0) {
      Alert.alert('No Records', 'There are no sales records to export.');
      return;
    }

    const header = 'Invoice Number,Date,Customer Name,Phone,Subtotal,GST,Total Amount,Payment Mode,Credit Debt,Status\n';
    const rows = invoices.map(inv => {
      const dateStr = new Date(inv.date).toLocaleDateString('en-IN');
      const debt = inv.creditDetail ? inv.creditDetail.debt : 0;
      const status = inv.isVoided ? 'VOIDED' : 'ACTIVE';
      return `"${inv.invoiceId}","${dateStr}","${inv.customerName}","${inv.customerPhone}",${inv.subtotal},${inv.gst},${inv.total},"${inv.paymentMethod.toUpperCase()}",${debt},"${status}"`;
    }).join('\n');

    const csvContent = header + rows;

    try {
      await Share.share({
        message: csvContent,
        title: 'Tilor_Sales_History.csv',
      });
    } catch {
      Alert.alert('Export Error', 'Failed to share sales history.');
    }
  };

  // Metric Totals
  const totalSalesAmount = useMemo(() => {
    return invoices.reduce((sum, inv) => inv.isVoided ? sum : sum + inv.total, 0);
  }, [invoices]);

  const totalCreditDebt = useMemo(() => {
    return invoices.reduce((sum, inv) => {
      if (inv.isVoided || !inv.creditDetail) return sum;
      return sum + inv.creditDetail.debt;
    }, 0);
  }, [invoices]);

  // Filter & Search Logic
  const filteredEstimates = useMemo(() => {
    return estimates.filter(est =>
      !debouncedSearch || est.projectName.toLowerCase().includes(debouncedSearch.toLowerCase())
    );
  }, [estimates, debouncedSearch]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // 1. Text search
      const q = debouncedSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.invoiceId.toLowerCase().includes(q) ||
        inv.customerPhone.includes(q);

      // 2. Payment filter
      const matchesPayment =
        paymentFilter === 'all' || inv.paymentMethod === paymentFilter;

      // 3. Date filter
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const invDate = new Date(inv.date);
        const today = new Date();
        if (dateFilter === 'today') {
          matchesDate = invDate.toDateString() === today.toDateString();
        } else if (dateFilter === 'week') {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchesDate = invDate >= weekAgo;
        } else if (dateFilter === 'month') {
          matchesDate =
            invDate.getMonth() === today.getMonth() &&
            invDate.getFullYear() === today.getFullYear();
        }
      }

      return matchesSearch && matchesPayment && matchesDate;
    }).sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return b.invoiceId.localeCompare(a.invoiceId);
    });
  }, [invoices, debouncedSearch, paymentFilter, dateFilter]);

  const paginatedInvoices = useMemo(() => {
    return filteredInvoices.slice(0, visibleCount);
  }, [filteredInvoices, visibleCount]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#7C3AED']} />}
      >
        {/* Header Banner */}
        <LinearGradient
          colors={['#6D28D9', '#7C3AED', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            {/* Top Bar */}
            <View style={styles.appBar}>
              <View style={styles.logoRow}>
                <View style={styles.logoIcon}>
                  <Feather name="clock" size={16} color="#FFF" />
                </View>
                <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
              </View>

              <View style={styles.appBarRight}>
                <TouchableOpacity style={styles.exportBtn} onPress={handleExportCSV} activeOpacity={0.8}>
                  <Feather name="download" size={12} color="#7C3AED" />
                  <Text style={styles.exportBtnText}>CSV</Text>
                </TouchableOpacity>
                <View style={styles.roleBadge}>
                  <View style={styles.roleIndicator} />
                  <Text style={styles.roleText}>
                    {session.role === 'owner' ? 'OWNER' : 'STAFF'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} activeOpacity={0.7}>
                  <Feather name="log-out" size={15} color="#FFF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Title Area */}
            <View style={styles.pageTitleRow}>
              <View>
                <Text style={styles.pageSubtitle}>HISTORY &amp; LEDGER</Text>
                <Text style={styles.pageTitle}>Sales &amp; Quotes</Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {subTab === 'estimates' ? `${filteredEstimates.length} drafts` : `${filteredInvoices.length} bills`}
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Main Content Area */}
        <View style={styles.innerContent}>
        {/* Glanceable Metric Cards */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>TOTAL SALES</Text>
            <Text style={styles.metricVal}>₹{totalSalesAmount.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>CREDIT DUE</Text>
            <Text style={[styles.metricVal, { color: '#EF4444' }]}>
              ₹{totalCreditDebt.toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>INVOICES</Text>
            <Text style={[styles.metricVal, { color: '#7C3AED' }]}>{invoices.length}</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Feather name="search" size={15} color="#A0AEC0" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              subTab === 'estimates'
                ? "Search by project name..."
                : "Search customer name, bill ID, phone..."
            }
            placeholderTextColor="#A0AEC0"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={14} color="#A0AEC0" />
            </TouchableOpacity>
          )}
        </View>

        {/* Filters Bar (For Bills Tab) */}
        {subTab === 'bills' && (
          <View style={styles.filterChipsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['all', 'cash', 'credit', 'upi', 'card'] as PaymentFilter[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.filterChip, paymentFilter === p && styles.filterChipActive]}
                    onPress={() => {
                      hapticFeedback.light();
                      setPaymentFilter(p);
                    }}
                  >
                    <Text style={[styles.filterChipText, paymentFilter === p && styles.filterChipTextActive]}>
                      {p === 'all' ? 'All Modes' : p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}

                <View style={{ width: 1, backgroundColor: '#E9D5FF', marginHorizontal: 4 }} />

                {(['all', 'today', 'week', 'month'] as DateFilter[]).map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.filterChip, dateFilter === d && styles.filterChipActive]}
                    onPress={() => {
                      hapticFeedback.light();
                      setDateFilter(d);
                    }}
                  >
                    <Text style={[styles.filterChipText, dateFilter === d && styles.filterChipTextActive]}>
                      {d === 'all' ? 'All Time' : d === 'today' ? 'Today' : d === 'week' ? 'This Week' : 'This Month'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Tab Pills Selector */}
        <View style={styles.tabSelector}>
          <TouchableOpacity
            style={[styles.tabPill, subTab === 'bills' && styles.tabPillActive]}
            onPress={() => {
              hapticFeedback.light();
              setSubTab('bills');
            }}
          >
            <Feather name="file-text" size={13} color={subTab === 'bills' ? '#FFF' : '#A0AEC0'} />
            <Text style={[styles.tabPillText, subTab === 'bills' && styles.tabPillTextActive]}>
              Bills &amp; Khatabook ({filteredInvoices.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabPill, subTab === 'estimates' && styles.tabPillActive]}
            onPress={() => {
              hapticFeedback.light();
              setSubTab('estimates');
            }}
          >
            <Feather name="file" size={13} color={subTab === 'estimates' ? '#FFF' : '#A0AEC0'} />
            <Text style={[styles.tabPillText, subTab === 'estimates' && styles.tabPillTextActive]}>
              Saved Estimates ({filteredEstimates.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Timeline Feed Container */}
        {loading ? (
          <HistorySkeleton />
        ) : (
          <View style={styles.timelineCard}>
            <View style={styles.timelineBarDecor} />

            {/* Estimates List Tab */}
            {subTab === 'estimates' && (
              filteredEstimates.length === 0 ? (
                <View style={styles.emptyState}>
                  <Feather name="folder" size={32} color="#C4B5FD" />
                  <Text style={styles.emptyText}>
                    {search ? `No estimates match "${search}"` : 'No saved estimates found'}
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  {filteredEstimates.map((est, idx) => (
                    <EstimateTimelineCard
                      key={est.dbId || est.timestamp || idx}
                      estimate={est}
                      onEditDraft={handleEditDraft}
                      onDeleteDraft={handleDeleteDraft}
                    />
                  ))}
                </View>
              )
            )}

            {/* Invoices & Bills Tab */}
            {subTab === 'bills' && (
              paginatedInvoices.length === 0 ? (
                <View style={styles.emptyState}>
                  <Feather name="file-text" size={32} color="#C4B5FD" />
                  <Text style={styles.emptyText}>
                    {search || paymentFilter !== 'all' || dateFilter !== 'all'
                      ? 'No sales invoices match your filters'
                      : 'No sales invoices logged yet'}
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  {paginatedInvoices.map((inv, idx) => (
                    <InvoiceTimelineCard
                      key={inv.dbId || inv.invoiceId || idx}
                      invoice={inv}
                      onOpenRepayment={handleOpenRepayment}
                      onOpenDispatch={handleOpenDispatch}
                      onOpenDetails={handleOpenDetails}
                    />
                  ))}

                  {/* Pagination Load More Button */}
                  {filteredInvoices.length > visibleCount && (
                    <TouchableOpacity
                      style={styles.loadMoreBtn}
                      onPress={() => {
                        hapticFeedback.light();
                        setVisibleCount(prev => prev + 10);
                      }}
                    >
                      <Text style={styles.loadMoreText}>
                        Load More ({filteredInvoices.length - visibleCount} remaining)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            )}
          </View>
        )}

        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Bottom Nav */}
      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} />

      {/* ── Dispatch Loading Modal ── */}
      <Modal
        visible={dispatchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDispatchModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.repaySheet, { padding: 20 }]}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Record Loading Dispatch</Text>
                <Text style={{ fontSize: 11, color: '#6B7280' }}>Invoice #{dispatchInvoice?.invoiceId}</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseCircle} onPress={() => setDispatchModalVisible(false)}>
                <Feather name="x" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {isDispatching && dispatchItems.length === 0 ? (
              <ActivityIndicator size="small" color="#7C3AED" style={{ marginVertical: 32 }} />
            ) : (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.formLabel}>VEHICLE NUMBER (OPTIONAL)</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. AP 39 AB 1234"
                    value={vehicleNumber}
                    onChangeText={setVehicleNumber}
                  />
                </View>

                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.formLabel}>ITEMS BEING LOADED NOW</Text>
                  {dispatchItems.map((item, idx) => (
                    <View key={item.variantId} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', padding: 12, borderRadius: 8, marginBottom: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: 'bold', color: '#1A1A2E' }}>{item.name}</Text>
                        <Text style={{ fontSize: 11, color: '#6B7280' }}>Billed: {item.billed}  |  Loaded: {item.loaded}</Text>
                      </View>
                      <View style={{ width: 80 }}>
                        <TextInput
                          style={[styles.formInput, { textAlign: 'center', marginBottom: 0, paddingVertical: 8 }]}
                          keyboardType="numeric"
                          value={item.loadingNow}
                          onChangeText={(val) => handleDispatchQtyChange(idx, val)}
                        />
                      </View>
                    </View>
                  ))}
                </View>

                <View style={{ marginBottom: 24 }}>
                  <Text style={styles.formLabel}>NOTES (OPTIONAL)</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. Batch 1 of 2"
                    value={dispatchNotes}
                    onChangeText={setDispatchNotes}
                  />
                </View>
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.sheetSubmitBtn, isDispatching && { opacity: 0.6 }]}
              onPress={handleSaveDispatch}
              disabled={isDispatching}
            >
              <LinearGradient colors={['#7C3AED', '#9333EA']} start={{x:0, y:0}} end={{x:1, y:0}} style={styles.sheetSubmitGrad}>
                {isDispatching ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.sheetSubmitText}>Save &amp; Dispatch</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Detailed Invoice View Modal ── */}
      <Modal
        visible={!!selectedInvoice}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedInvoice(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.invoiceModalBox}>
            <View style={{ alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', marginBottom: 12 }}>
              <View style={styles.invModalIconBox}>
                <Feather name="file-text" size={24} color="#7C3AED" />
              </View>
              <Text style={styles.invModalTitle}>{selectedInvoice?.invoiceId}</Text>
              <Text style={styles.invModalDate}>
                Date: {selectedInvoice ? new Date(selectedInvoice.date).toLocaleDateString('en-IN') : ''}
              </Text>
              {Boolean(selectedInvoice?.isVoided) && (
                <View style={[styles.voidedBadge, { marginTop: 6 }]}>
                  <Text style={styles.voidedBadgeText}>VOIDED / CANCELLED</Text>
                </View>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320, marginBottom: 16 }}>
              {/* Customer Profile info */}
              <Text style={styles.modalSubHeader}>Customer Info</Text>
              <View style={styles.infoSummaryCard}>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Name:</Text><Text style={styles.summaryVal}>{selectedInvoice?.customerName}</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Phone:</Text><Text style={styles.summaryVal}>{selectedInvoice?.customerPhone || 'N/A'}</Text></View>
                {selectedInvoice?.customerAddress ? (
                  <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Address:</Text><Text style={styles.summaryVal}>{selectedInvoice.customerAddress}</Text></View>
                ) : null}
                {selectedInvoice?.customerGst ? (
                  <View style={styles.summaryItem}><Text style={styles.summaryLabel}>GSTIN:</Text><Text style={styles.summaryVal}>{selectedInvoice.customerGst}</Text></View>
                ) : null}
              </View>

              {/* Items list */}
              <Text style={styles.modalSubHeader}>Items Purchased</Text>
              <View style={styles.infoSummaryCard}>
                {selectedInvoice?.items.map((item, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        {Boolean(item.variantLabel) && (
                          <View style={{ backgroundColor: '#EDE9FE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#6D28D9' }}>{item.variantLabel}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.itemBrandSpec}>{[item.brand, item.size].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text style={styles.itemQtyPrice}>{item.boxes} boxes × ₹{item.pricePerBox}</Text>
                    <Text style={styles.itemTotalVal}>₹{(item.total || 0).toLocaleString('en-IN')}</Text>
                  </View>
                ))}
              </View>

              {/* Partial Repayments History */}
              {selectedInvoice?.creditDetail?.repayments && selectedInvoice.creditDetail.repayments.length > 0 && (
                <>
                  <Text style={styles.modalSubHeader}>Debt Repayment Log</Text>
                  <View style={styles.infoSummaryCard}>
                    {selectedInvoice.creditDetail.repayments.map((rep, idx) => (
                      <View key={idx} style={styles.repaymentRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Feather name="check-circle" size={12} color="#16A34A" />
                          <Text style={styles.repaymentText}>₹{rep.amount} via {rep.mode.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.repaymentDate}>{rep.date}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            {/* Totals & Net credit break down */}
            <View style={styles.modalTotalsCard}>
              <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Subtotal:</Text><Text style={styles.summaryVal}>₹{selectedInvoice?.subtotal.toLocaleString('en-IN')}</Text></View>
              {selectedInvoice?.discount ? (
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Discount:</Text><Text style={styles.summaryVal}>-₹{selectedInvoice.discount.toLocaleString('en-IN')}</Text></View>
              ) : null}
              {selectedInvoice?.gst && selectedInvoice.gst > 0 ? (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>
                    Tax ({selectedInvoice.gstType === 'igst' ? '18% IGST' : '9% CGST + 9% SGST'}):
                  </Text>
                  <Text style={styles.summaryVal}>₹{selectedInvoice.gst.toLocaleString('en-IN')}</Text>
                </View>
              ) : (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Tax (GST):</Text>
                  <Text style={styles.summaryVal}>None (0%)</Text>
                </View>
              )}
              <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Payment Method:</Text><Text style={styles.summaryValHighlight}>{selectedInvoice?.paymentMethod?.toUpperCase()}</Text></View>

              {selectedInvoice && selectedInvoice.paymentMethod === 'credit' && selectedInvoice.creditDetail ? (
                <View style={styles.creditDetailPanel}>
                  <View style={styles.summaryItem}><Text style={styles.creditPanelLabel}>Paid Deposit:</Text><Text style={styles.creditPanelVal}>₹{selectedInvoice.creditDetail.depositPaid.toLocaleString('en-IN')}</Text></View>
                  <View style={styles.summaryItem}><Text style={styles.creditPanelLabel}>Ledger Outstanding:</Text><Text style={styles.creditPanelDebtVal}>₹{selectedInvoice.creditDetail.debt.toLocaleString('en-IN')}</Text></View>
                  <View style={styles.summaryItem}><Text style={styles.creditPanelLabel}>Due Date:</Text><Text style={styles.creditPanelVal}>{selectedInvoice.creditDetail.dueDate}</Text></View>
                </View>
              ) : null}

              <View style={styles.grandDivider} />

              <View style={styles.summaryItem}>
                <Text style={styles.grandLabel}>Total Invoice:</Text>
                <Text style={styles.grandVal}>₹{selectedInvoice?.total.toLocaleString('en-IN')}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity
                style={styles.modalShareBtn}
                onPress={() => handleShareOrPrintInvoice(selectedInvoice)}
                activeOpacity={0.8}
              >
                <Feather name="share-2" size={14} color="#7C3AED" />
                <Text style={styles.modalShareBtnText}>Share / Print</Text>
              </TouchableOpacity>

              {selectedInvoice && !selectedInvoice.isVoided && session.role === 'owner' && (
                <TouchableOpacity
                  style={styles.modalVoidBtn}
                  onPress={() => handleVoidInvoice(selectedInvoice)}
                  activeOpacity={0.8}
                >
                  <Feather name="slash" size={14} color="#EF4444" />
                  <Text style={styles.modalVoidBtnText}>Void</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setSelectedInvoice(null)}
              >
                <Text style={styles.modalCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Repayment Modal ── */}
      <Modal
        visible={repayModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRepayModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.repaySheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Record Debt Repayment</Text>
              <TouchableOpacity
                onPress={() => setRepayModalVisible(false)}
                style={styles.modalCloseCircle}
              >
                <Feather name="x" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.outstandingInfo}>
              <Text style={styles.outstandingLabel}>Ledger Balance Outstanding:</Text>
              <Text style={styles.outstandingVal}>
                ₹{repayInvoice?.creditDetail?.debt.toLocaleString('en-IN')}
              </Text>
            </View>

            <Text style={styles.formLabel}>PAYMENT AMOUNT (₹)</Text>
            <TextInput
              style={styles.formInput}
              keyboardType="numeric"
              value={repayAmount}
              onChangeText={setRepayAmount}
            />

            <View style={styles.formGridTwo}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>PAYMENT MODE</Text>
                <View style={styles.modeDropdownWrap}>
                  {['cash', 'upi', 'card'].map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modeDropdownBtn, repayMode === m && styles.modeDropdownBtnActive]}
                      onPress={() => setRepayMode(m)}
                    >
                      <Text style={[styles.modeDropdownText, repayMode === m && styles.modeDropdownTextActive]}>
                        {m.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>PAYMENT DATE</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="YYYY-MM-DD"
                  value={repayDate}
                  onChangeText={setRepayDate}
                />
              </View>
            </View>

            <View style={styles.sheetActionsRow}>
              <TouchableOpacity
                style={styles.sheetCancelBtn}
                onPress={() => setRepayModalVisible(false)}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetSubmitBtn}
                onPress={handleSubmitRepayment}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#7C3AED', '#9333EA']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.sheetSubmitGrad}
                >
                  <Text style={styles.sheetSubmitText}>Submit Payment</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  header: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  safeHeader: { paddingHorizontal: 20, paddingBottom: 20 },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoText: { fontSize: 20, fontWeight: 'bold', color: '#FFF', letterSpacing: -0.5 },
  logoDot: { color: '#C084FC' },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  exportBtnText: { color: '#7C3AED', fontSize: 10, fontWeight: 'bold' },
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
  roleText: { color: '#FFF', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },
  logoutBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 2 },
  countBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  innerContent: { paddingHorizontal: 16, paddingTop: 12 },
  metricsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  metricCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#F3E8FF' },
  metricLabel: { fontSize: 8, color: '#A0AEC0', fontWeight: 'bold', letterSpacing: 0.5 },
  metricVal: { fontSize: 14, fontWeight: '800', color: '#1A1A2E', marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.04)',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },
  filterChipsContainer: { marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E9D5FF' },
  filterChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  filterChipText: { fontSize: 10, fontWeight: 'bold', color: '#6B7280' },
  filterChipTextActive: { color: '#FFF' },
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: '#E9D5FF',
    borderRadius: 16,
    padding: 3,
    marginBottom: 14,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 13,
    gap: 6,
  },
  tabPillActive: { backgroundColor: '#7C3AED' },
  tabPillText: { fontSize: 11, fontWeight: 'bold', color: '#6D28D9' },
  tabPillTextActive: { color: '#FFF' },
  loadingBox: { padding: 40, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 12, color: '#7C3AED', fontWeight: '600' },
  timelineCard: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    padding: 16,
    position: 'relative',
  },
  timelineBarDecor: {
    position: 'absolute',
    left: 28,
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: '#F3E8FF',
  },
  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 12, color: '#A0AEC0' },
  timelineItem: { flexDirection: 'row', gap: 12, position: 'relative' },
  timelineNode: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    marginTop: 2,
  },
  nodeDraft: { backgroundColor: '#F59E0B' },
  nodeSaved: { backgroundColor: '#7C3AED' },
  nodePaid: { backgroundColor: '#16A34A' },
  nodeCredit: { backgroundColor: '#EF4444' },
  nodeVoided: { backgroundColor: '#9CA3AF' },
  itemContentCard: {
    flex: 1,
    backgroundColor: '#F8F6FF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  itemCardVoided: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  lineThrough: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitle: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  itemMetaDate: { fontSize: 9, color: '#A0AEC0', marginTop: 2 },
  itemAmountVal: { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  itemMetaDetail: { fontSize: 9, color: '#A0AEC0', marginTop: 1 },
  badgeDraft: { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeDraftText: { fontSize: 8, fontWeight: 'bold', color: '#D97706' },
  badgeSaved: { backgroundColor: '#EDE9FE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeSavedText: { fontSize: 8, fontWeight: 'bold', color: '#6D28D9' },
  payBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#E0F2FE' },
  payBadgeText: { fontSize: 8, fontWeight: 'bold', color: '#0369A1' },
  payBadge_cash: { backgroundColor: '#DCFCE7' },
  payBadgeText_cash: { color: '#15803D' },
  payBadge_upi: { backgroundColor: '#F3E8FF' },
  payBadgeText_upi: { color: '#7E22CE' },
  payBadge_credit: { backgroundColor: '#FEE2E2' },
  payBadgeText_credit: { color: '#B91C1C' },
  payBadge_card: { backgroundColor: '#FEF08A' },
  payBadgeText_card: { color: '#854D0E' },
  voidedBadge: { backgroundColor: '#E5E7EB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  voidedBadgeText: { fontSize: 8, fontWeight: 'bold', color: '#4B5563' },
  overdueBadge: { backgroundColor: '#DC2626', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  overdueBadgeText: { fontSize: 8, fontWeight: '800', color: '#FFF' },
  itemsSummaryPreview: { fontSize: 10, color: '#6B7280', marginTop: 6, fontStyle: 'italic' },
  debtBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  debtBannerLabel: { fontSize: 9, color: '#991B1B', fontWeight: 'bold' },
  debtBannerVal: { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  debtBannerDueDate: { fontSize: 9, fontWeight: 'bold', color: '#B91C1C' },
  paidBanner: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F0FDF4', padding: 6, borderRadius: 8, marginTop: 8 },
  paidBannerText: { fontSize: 9, fontWeight: 'bold', color: '#16A34A' },
  itemFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E9D5FF' },
  roomsText: { fontSize: 10, color: '#718096', flex: 1, marginRight: 6 },
  itemEditBtn: { backgroundColor: '#7C3AED', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  itemEditBtnText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  itemDeleteBtn: { backgroundColor: '#FEE2E2', width: 26, height: 26, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  repayBtn: { backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  repayBtnText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  viewBillBtn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#C4B5FD', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  viewBillBtnText: { color: '#7C3AED', fontSize: 10, fontWeight: 'bold' },
  loadMoreBtn: { paddingVertical: 12, backgroundColor: '#F8F6FF', borderRadius: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#E9D5FF' },
  loadMoreText: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  invoiceModalBox: { width: '100%', maxWidth: 360, backgroundColor: '#FFF', borderRadius: 24, padding: 20, maxHeight: '90%' },
  invModalIconBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  invModalTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  invModalDate: { fontSize: 10, color: '#A0AEC0', marginTop: 2 },
  modalSubHeader: { fontSize: 9, fontWeight: 'bold', color: '#7C3AED', letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  infoSummaryCard: { backgroundColor: '#F8F6FF', borderRadius: 14, padding: 10, gap: 4, marginBottom: 8 },
  summaryItem: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  summaryLabel: { fontSize: 10, color: '#6B7280' },
  summaryVal: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  summaryValHighlight: { fontSize: 10, fontWeight: 'bold', color: '#7C3AED' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F3E8FF' },
  itemName: { fontSize: 11, fontWeight: 'bold', color: '#1A1A2E' },
  itemBrandSpec: { fontSize: 9, color: '#A0AEC0' },
  itemQtyPrice: { fontSize: 10, color: '#6B7280', marginHorizontal: 6 },
  itemTotalVal: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  repaymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  repaymentText: { fontSize: 10, fontWeight: 'bold', color: '#16A34A' },
  repaymentDate: { fontSize: 9, color: '#A0AEC0' },
  modalTotalsCard: { backgroundColor: '#F8F6FF', borderRadius: 14, padding: 10 },
  creditDetailPanel: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E9D5FF' },
  creditPanelLabel: { fontSize: 10, color: '#6B7280' },
  creditPanelVal: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  creditPanelDebtVal: { fontSize: 10, fontWeight: 'bold', color: '#EF4444' },
  grandDivider: { height: 1, backgroundColor: '#E9D5FF', marginVertical: 6 },
  grandLabel: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  grandVal: { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  modalShareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F3E8FF' },
  modalShareBtnText: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  modalVoidBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#FEE2E2' },
  modalVoidBtnText: { fontSize: 11, fontWeight: 'bold', color: '#EF4444' },
  modalCloseBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtnText: { fontSize: 11, fontWeight: 'bold', color: '#4B5563' },
  repaySheet: { width: '100%', maxWidth: 360, backgroundColor: '#FFF', borderRadius: 24, padding: 20 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 15, fontWeight: 'bold', color: '#1A1A2E' },
  modalCloseCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  outstandingInfo: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 10, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  outstandingLabel: { fontSize: 10, fontWeight: 'bold', color: '#991B1B' },
  outstandingVal: { fontSize: 14, fontWeight: '800', color: '#DC2626' },
  formLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.8, marginBottom: 4 },
  formInput: { backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 10 },
  formGridTwo: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  modeDropdownWrap: { flexDirection: 'row', gap: 4 },
  modeDropdownBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F8F6FF', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  modeDropdownBtnActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  modeDropdownText: { fontSize: 9, fontWeight: 'bold', color: '#6B7280' },
  modeDropdownTextActive: { color: '#FFF' },
  sheetActionsRow: { flexDirection: 'row', gap: 10 },
  sheetCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: '#F3F4F6', alignItems: 'center' },
  sheetCancelText: { fontSize: 12, fontWeight: 'bold', color: '#4B5563' },
  sheetSubmitBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  sheetSubmitGrad: { paddingVertical: 12, alignItems: 'center' },
  sheetSubmitText: { fontSize: 12, fontWeight: 'bold', color: '#FFF' },
});
