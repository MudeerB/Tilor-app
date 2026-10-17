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
  Share,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { buildSafeWhatsAppUrl, buildSafeTelUrl } from '../utils/urlSecurity';
import { KhatabookSkeleton } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Repayment {
  amount: number;
  date: string;
  mode: string;
  notes?: string;
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
  items: any[];
  subtotal: number;
  gst: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'credit';
  creditDetail: CreditDetail | null;
}

interface Customer {
  name: string;
  phone: string;
  address?: string;
  gstin?: string;
  history?: InvoiceRecord[];
}

type DebtFilter = 'all' | 'pending' | 'clear';

interface KhatabookScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

// ─── Helper Functions for DebtorCard ──────────────────────────────────────────

const isOverdue = (inv: InvoiceRecord): boolean => {
  if (!inv.creditDetail?.dueDate) return false;
  const dueDate = new Date(inv.creditDetail.dueDate);
  return dueDate < new Date();
};

const getDebtAge = (inv: InvoiceRecord): number => {
  const invDate = new Date(inv.date);
  const today = new Date();
  return Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
};

const getLastRepaymentDate = (c: Customer): string | null => {
  const allRepayments = (c.history || [])
    .filter(inv => inv.creditDetail?.repayments)
    .flatMap(inv => inv.creditDetail!.repayments);

  if (allRepayments.length === 0) return null;

  const lastRepayment = allRepayments.sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];

  return lastRepayment.date;
};

// ─── Memoized DebtorCard ──────────────────────────────────────────────────────

interface DebtorCardProps {
  cust: Customer;
  debt: number;
  onRepay: (cust: Customer) => void;
  onCall: (phone: string) => void;
  onWhatsApp: (phone: string) => void;
  onExportLedger: (cust: Customer) => void;
  onOpenLedger: (cust: Customer) => void;
}

const DebtorCard = React.memo<DebtorCardProps>(({
  cust,
  debt,
  onRepay,
  onCall,
  onWhatsApp,
  onExportLedger,
  onOpenLedger,
}) => {
  const oldestDebtInvoice = cust.history?.find(i => i.paymentMethod === 'credit' && i.creditDetail && i.creditDetail.debt > 0);
  const oldestDebtDays = oldestDebtInvoice ? getDebtAge(oldestDebtInvoice) : null;

  return (
    <View style={[styles.debtorCard, debt > 0 && styles.debtorCardOutstanding]}>
      {/* Card Top */}
      <View style={styles.debtorHeaderRow}>
        <View style={[styles.avatarCircle, debt > 0 ? styles.avatarRed : styles.avatarGreen]}>
          <Text style={[styles.avatarText, debt > 0 ? styles.avatarTextRed : styles.avatarTextGreen]}>
            {cust.name[0]?.toUpperCase() || 'C'}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.debtorName}>{cust.name}</Text>
            {debt > 0 && (
              <View style={styles.dueBadge}>
                <Text style={styles.dueBadgeText}>CREDIT DUE</Text>
              </View>
            )}
            {debt > 0 && cust.history?.some(inv => isOverdue(inv) && inv.creditDetail && inv.creditDetail.debt > 0) && (
              <View style={[styles.dueBadge, { backgroundColor: '#B91C1C' }]}>
                <Text style={styles.dueBadgeText}>OVERDUE</Text>
              </View>
            )}
          </View>
          <Text style={styles.debtorPhone}>Phone: +91 {cust.phone}</Text>
          <Text style={styles.debtorPhone}>Last Payment: {getLastRepaymentDate(cust) || 'Never'}</Text>
          {debt > 0 && oldestDebtDays !== null && (
            <Text style={styles.debtorPhone}>Oldest Debt: {oldestDebtDays} days</Text>
          )}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.debtVal, debt > 0 ? styles.textRed : styles.textGreen]}>
            ₹{debt.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.debtSubLabel}>{debt > 0 ? 'Outstanding' : 'Clear Balance'}</Text>
        </View>
      </View>

      {/* Actions Bar */}
      <View style={styles.debtorActionsRow}>
        {debt > 0 && (
          <TouchableOpacity style={styles.actionBtnRepay} onPress={() => onRepay(cust)} activeOpacity={0.8}>
            <Feather name="credit-card" size={13} color="#FFF" />
            <Text style={styles.actionBtnRepayText}>Repay</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.actionBtnReminder} onPress={() => onCall(cust.phone)} activeOpacity={0.8}>
          <Feather name="phone" size={13} color="#25D366" />
          <Text style={styles.actionBtnReminderText}>Call</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtnReminder} onPress={() => onWhatsApp(cust.phone)} activeOpacity={0.8}>
          <MaterialCommunityIcons name="whatsapp" size={15} color="#25D366" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtnAudit} onPress={() => onExportLedger(cust)} activeOpacity={0.8}>
          <Feather name="share" size={13} color="#6D28D9" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnAudit}
          onPress={() => onOpenLedger(cust)}
          activeOpacity={0.8}
        >
          <Feather name="file-text" size={13} color="#6D28D9" />
          <Text style={styles.actionBtnAuditText}>Ledger</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
DebtorCard.displayName = 'DebtorCard';

export const KhatabookScreen: React.FC<KhatabookScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [customers, setCustomers]               = useState<Customer[]>([]);
  const [isLoading, setIsLoading]               = useState(false);
  const [search, setSearch]                     = useState('');
  const debouncedSearch                         = useDebouncedValue(search, 200);
  const [debtFilter, setDebtFilter]             = useState<DebtFilter>('pending');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Repayment Modal
  const [repayModalVisible, setRepayModalVisible] = useState(false);
  const [repayCust, setRepayCust]                 = useState<Customer | null>(null);
  const [repayInvoice, setRepayInvoice]           = useState<InvoiceRecord | null>(null);
  const [repayAmount, setRepayAmount]             = useState('');
  const [repayMode, setRepayMode]                 = useState<'cash' | 'upi' | 'card' | 'cheque'>('cash');
  const [repayDate, setRepayDate]                 = useState(new Date().toISOString().split('T')[0]);
  const [repayNote, setRepayNote]                 = useState('');

  // Audit Log Drawer Modal
  const [ledgerDrawerVisible, setLedgerDrawerVisible] = useState(false);
  const [ledgerCustomer, setLedgerCustomer]           = useState<Customer | null>(null);

  // Add Manual Entry Modal
  const [addEntryVisible, setAddEntryVisible]     = useState(false);
  const [entryName, setEntryName]                 = useState('');
  const [entryPhone, setEntryPhone]               = useState('');
  const [entryAmount, setEntryAmount]             = useState('');
  const [entryNote, setEntryNote]                 = useState('');
  const [entryDueDate, setEntryDueDate]           = useState('');

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    const data = await billingService.fetchDebtors(session.shop_id);
    setCustomers(data);
    setIsLoading(false);
  }, [session.shop_id]);

  useEffect(() => {
    if (activeTab === 'khatabook') {
      loadCustomers();
    }
  }, [activeTab, loadCustomers]);

  // Helper calculations
  const getCustomerDebt = useCallback((c: Customer): number => {
    if (!c.history) return 0;
    return c.history.reduce((sum, inv) => {
      if (inv.paymentMethod === 'credit' && inv.creditDetail) {
        return sum + (inv.creditDetail.debt || 0);
      }
      return sum;
    }, 0);
  }, []);

  const getCustomerTotalCollected = useCallback((c: Customer): number => {
    if (!c.history) return 0;
    return c.history.reduce((sum, inv) => {
      if (inv.paymentMethod === 'credit' && inv.creditDetail) {
        const deposit = inv.creditDetail.depositPaid || 0;
        const repaymentsSum = (inv.creditDetail.repayments || []).reduce((rSum, r) => rSum + r.amount, 0);
        return sum + deposit + repaymentsSum;
      }
      return sum;
    }, 0);
  }, []);

  // Aggregates
  const totalOutstanding = useMemo(() => customers.reduce((sum, c) => sum + getCustomerDebt(c), 0), [customers, getCustomerDebt]);
  const totalCollected   = useMemo(() => customers.reduce((sum, c) => sum + getCustomerTotalCollected(c), 0), [customers, getCustomerTotalCollected]);
  const pendingDebtorsCount = useMemo(() => customers.filter(c => getCustomerDebt(c) > 0).length, [customers, getCustomerDebt]);

  // Filter & Search using debouncedSearch
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const debt = getCustomerDebt(c);
      const q = debouncedSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.gstin && c.gstin.toLowerCase().includes(q)) ||
        (c.history && c.history.some(inv => inv.invoiceId.toLowerCase().includes(q)));

      const matchesFilter =
        debtFilter === 'all'
          ? true
          : debtFilter === 'pending'
          ? debt > 0
          : debt === 0;

      return matchesSearch && matchesFilter;
    });
  }, [customers, debouncedSearch, debtFilter, getCustomerDebt]);

  // Action: Open Repay Modal
  const openRepaymentModal = (cust: Customer) => {
    const creditInvoices = (cust.history || []).filter(
      inv => inv.paymentMethod === 'credit' && inv.creditDetail && inv.creditDetail.debt > 0
    );

    if (creditInvoices.length === 0) {
      Alert.alert('No Debt', `${cust.name} has zero outstanding balance.`);
      return;
    }

    // Default to the oldest invoice with debt
    const firstInvoice = creditInvoices[creditInvoices.length - 1] || creditInvoices[0];
    setRepayCust(cust);
    setRepayInvoice(firstInvoice);
    setRepayAmount(firstInvoice.creditDetail!.debt.toString());
    setRepayDate(new Date().toISOString().split('T')[0]);
    setRepayNote('');
    setRepayModalVisible(true);
  };

  // Submit Repayment with Optimistic UI & Automatic Rollback
  const handleRecordPayment = async () => {
    if (!repayCust || !repayInvoice || !repayInvoice.dbId) return;
    const amount = parseFloat(repayAmount);
    if (isNaN(amount) || amount <= 0) {
      hapticFeedback.error();
      Alert.alert('Invalid Amount', 'Please enter a valid repayment amount.');
      return;
    }

    const currentDebt = repayInvoice.creditDetail?.debt || 0;
    if (amount > currentDebt) {
      hapticFeedback.error();
      Alert.alert('Overpayment', `Amount cannot exceed outstanding balance of ₹${currentDebt}.`);
      return;
    }

    // 1. Snapshot previous state for rollback
    const previousCustomers = customers;
    const targetPhone = repayCust.phone;
    const targetInvoiceId = repayInvoice.dbId;

    // 2. Optimistic local state update
    const updatedCustomers = customers.map(c => {
      if (c.phone !== targetPhone) return c;
      const updatedHistory = (c.history || []).map(inv => {
        if (inv.dbId !== targetInvoiceId || !inv.creditDetail) return inv;
        const newDebt = Math.max(0, inv.creditDetail.debt - amount);
        const newRepayments = [
          ...(inv.creditDetail.repayments || []),
          { amount, date: repayDate, mode: repayMode },
        ];
        return {
          ...inv,
          creditDetail: {
            ...inv.creditDetail,
            debt: newDebt,
            repayments: newRepayments,
          },
        };
      });
      return { ...c, history: updatedHistory };
    });

    setCustomers(updatedCustomers);
    hapticFeedback.success();
    setRepayModalVisible(false);
    setRepayCust(null);
    setRepayInvoice(null);

    // 3. Asynchronously record repayment in background
    try {
      const { success, error } = await billingService.recordRepayment(
        targetInvoiceId,
        amount,
        repayMode,
        repayDate
      );

      if (!success) {
        // Rollback on failure
        setCustomers(previousCustomers);
        hapticFeedback.error();
        Alert.alert('Repayment Sync Failed', error || 'Failed to persist repayment. Reverting local state.');
      }
    } catch (e: any) {
      setCustomers(previousCustomers);
      hapticFeedback.error();
      Alert.alert('Repayment Sync Error', e?.message || 'Network error recording repayment.');
    }
  };

  // Send WhatsApp Reminder
  const handleSendReminder = async (cust: Customer) => {
    const debt = getCustomerDebt(cust);
    if (debt <= 0) {
      Alert.alert('No Debt', `${cust.name} has no outstanding balance.`);
      return;
    }

    const reminderMsg = `
🙏 *TILOR STORE — KHATABOOK REMINDER*
--------------------------------
Hello *${cust.name}*,
This is a gentle payment reminder from Tilor Tile Store.

📌 *Outstanding Balance: ₹${debt.toLocaleString('en-IN')}*
Phone: ${cust.phone}

Please clear your balance at your earliest convenience via Cash, UPI, or Bank Transfer.

Thank you for your business!
`.trim();

    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && (navigator as any).share) {
        try {
          await (navigator as any).share({ title: `Khatabook Reminder for ${cust.name}`, text: reminderMsg });
          return;
        } catch {}
      }
      window.prompt('Copy Payment Reminder Text:', reminderMsg);
    } else {
      try {
        await Share.share({ message: reminderMsg, title: `Payment Reminder for ${cust.name}` });
      } catch {
        Alert.alert('Error', 'Failed to share payment reminder.');
      }
    }
  };

  // Add Manual Entry
  const handleAddManualEntry = async () => {
    if (!entryName.trim() || !entryPhone.trim() || !entryAmount.trim()) {
      Alert.alert('Required Fields', 'Please fill name, phone, and amount.');
      return;
    }

    const cleanPhone = entryPhone.trim();
    if (cleanPhone.length !== 10 || !/^\d{10}$/.test(cleanPhone)) {
      Alert.alert('Invalid Phone', 'Phone number must be exactly 10 digits.');
      return;
    }

    const amt = parseFloat(entryAmount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid credit amount.');
      return;
    }

    setIsLoading(true);
    const { success, error } = await billingService.addManualCreditEntry({
      shopId: session.shop_id,
      customerName: entryName.trim(),
      customerPhone: cleanPhone,
      amount: amt,
      note: entryNote,
      dueDate: entryDueDate,
      createdBy: session.username,
    });

    if (success) {
      await loadCustomers(); // Refresh the list
      setEntryName(''); setEntryPhone(''); setEntryAmount(''); setEntryNote(''); setEntryDueDate('');
      setAddEntryVisible(false);
      Alert.alert('Entry Added', `Logged ₹${amt} credit entry for ${entryName.trim()}.`);
    } else {
      setIsLoading(false);
      Alert.alert('Error', error || 'Failed to add manual entry.');
    }
  };
  // Additional Helpers
  const getLastRepaymentDate = (c: Customer): string | null => {
    const allRepayments = (c.history || [])
      .filter(inv => inv.creditDetail?.repayments)
      .flatMap(inv => inv.creditDetail!.repayments);
    
    if (allRepayments.length === 0) return null;
    
    const lastRepayment = allRepayments.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];
    
    return lastRepayment.date;
  };

  const isOverdue = (inv: InvoiceRecord): boolean => {
    if (!inv.creditDetail?.dueDate) return false;
    const dueDate = new Date(inv.creditDetail.dueDate);
    return dueDate < new Date();
  };

  const getDebtAge = (inv: InvoiceRecord): number => {
    const invDate = new Date(inv.date);
    const today = new Date();
    return Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
  };

  const handleCallCustomer = (phone: string) => {
    const url = buildSafeTelUrl(phone);
    if (!url) {
      Alert.alert('Invalid Phone', 'The phone number provided is not a valid mobile number.');
      return;
    }
    Linking.openURL(url);
  };

  const handleWhatsAppCustomer = (phone: string) => {
    const url = buildSafeWhatsAppUrl(phone);
    if (!url) {
      Alert.alert('Invalid Phone', 'The phone number provided is not a valid mobile number for WhatsApp.');
      return;
    }
    Linking.openURL(url);
  };

  const handleExportLedger = async (cust: Customer) => {
    const ledgerText = (cust.history || []).map(inv => {
      const repayments = inv.creditDetail?.repayments?.map(r => 
        `  - ₹${r.amount} on ${r.date} via ${r.mode}`
      ).join('\n') || '  - No repayments';
      
      return `Invoice: ${inv.invoiceId}\nDate: ${new Date(inv.date).toLocaleDateString('en-IN')}\nTotal: ₹${inv.total}\nDebt: ₹${inv.creditDetail?.debt || 0}\nRepayments:\n${repayments}`;
    }).join('\n\n');
    
    await Share.share({
      message: `LEDGER FOR ${cust.name}\n\n${ledgerText}`,
      title: `Ledger - ${cust.name}`,
    });
  };

  const handleRepay = useCallback((cust: Customer) => {
    openRepaymentModal(cust);
  }, []);

  const handleCall = useCallback((phone: string) => {
    handleCallCustomer(phone);
  }, []);

  const handleWhatsApp = useCallback((phone: string) => {
    handleWhatsAppCustomer(phone);
  }, []);

  const handleExport = useCallback((cust: Customer) => {
    handleExportLedger(cust);
  }, []);

  const handleOpenLedger = useCallback((cust: Customer) => {
    setLedgerCustomer(cust);
    setLedgerDrawerVisible(true);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Main Content */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

            <View style={styles.appBarRight}>
              <TouchableOpacity style={styles.addBtn} onPress={() => setAddEntryVisible(true)} activeOpacity={0.8}>
                <Feather name="plus-circle" size={13} color="#6D28D9" />
                <Text style={styles.addBtnText}>New Debt Entry</Text>
              </TouchableOpacity>
              <View style={styles.roleBadge}>
                <View style={styles.roleIndicator} />
                <Text style={styles.roleText}>{session.role === 'owner' ? 'OWNER' : 'STAFF'}</Text>
              </View>
            </View>
          </View>

          {/* Title Row */}
          <View style={styles.pageTitleRow}>
            <View>
              <Text style={styles.pageSubtitle}>CREDIT LEDGER &amp; KHATA</Text>
              <Text style={styles.pageTitle}>Khatabook</Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{pendingDebtorsCount} pending accounts</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
        {/* KPI Balance Summary */}
        <View style={styles.kpiRow}>
          <LinearGradient colors={['#FEF2F2', '#FFF5F5']} style={styles.kpiCardRed}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Feather name="arrow-up-right" size={14} color="#DC2626" />
              <Text style={styles.kpiLabelRed}>YOU WILL RECEIVE</Text>
            </View>
            <Text style={styles.kpiValRed}>₹{totalOutstanding.toLocaleString('en-IN')}</Text>
            <Text style={styles.kpiSubRed}>{pendingDebtorsCount} customers owe balance</Text>
          </LinearGradient>

          <LinearGradient colors={['#F0FDF4', '#DCFCE7']} style={styles.kpiCardGreen}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Feather name="arrow-down-left" size={14} color="#16A34A" />
              <Text style={styles.kpiLabelGreen}>REPAYMENTS RECEIVED</Text>
            </View>
            <Text style={styles.kpiValGreen}>₹{totalCollected.toLocaleString('en-IN')}</Text>
            <Text style={styles.kpiSubGreen}>Total deposits &amp; repayments</Text>
          </LinearGradient>
        </View>

        {isLoading ? (
          <KhatabookSkeleton />
        ) : (
          <>
            {/* Search Bar */}
        <View style={styles.searchBar}>
          <Feather name="search" size={15} color="#A0AEC0" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search debtor name, phone number, GSTIN..."
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

        {/* Filter Chips */}
        <View style={styles.filterRow}>
          {(['pending', 'all', 'clear'] as DebtFilter[]).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, debtFilter === f && styles.filterChipActive]}
              onPress={() => setDebtFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, debtFilter === f && styles.filterChipTextActive]}>
                {f === 'pending' ? '⚠️ Outstanding Debt' : f === 'all' ? 'All Ledgers' : '✅ Clear Balance'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Debtors List */}
        {filteredCustomers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="check-circle" size={36} color="#4ADE80" />
            <Text style={styles.emptyTitle}>No Pending Credit Accounts</Text>
            <Text style={styles.emptySub}>All customer credit balances are fully clear or match your search query.</Text>
          </View>
        ) : (
          <View style={styles.debtorList}>
            {filteredCustomers.map(cust => (
              <DebtorCard
                key={cust.phone}
                cust={cust}
                debt={getCustomerDebt(cust)}
                onRepay={handleRepay}
                onCall={handleCall}
                onWhatsApp={handleWhatsApp}
                onExportLedger={handleExport}
                onOpenLedger={handleOpenLedger}
              />
            ))}
          </View>
        )}
        </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ── Record Repayment Modal ── */}
      <Modal visible={repayModalVisible} transparent animationType="slide" onRequestClose={() => setRepayModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Record Debt Repayment</Text>
              <TouchableOpacity onPress={() => setRepayModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {repayCust && repayInvoice && (
              <View style={styles.modalBody}>
                <View style={styles.outstandingInfoBox}>
                  <View>
                    <Text style={styles.infoBoxName}>{repayCust.name}</Text>
                    <Text style={styles.infoBoxSub}>Invoice #{repayInvoice.invoiceId}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.infoBoxDebt}>₹{repayInvoice.creditDetail?.debt.toLocaleString('en-IN')}</Text>
                    <Text style={styles.infoBoxDebtLabel}>Current Outstanding</Text>
                  </View>
                </View>

                <Text style={styles.formLabel}>REPAYMENT AMOUNT (₹)</Text>
                <TextInput style={styles.formInput} keyboardType="numeric" value={repayAmount} onChangeText={setRepayAmount} placeholder="Enter amount" placeholderTextColor="#A0AEC0" />
                
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {[25, 50, 75, 100].map(pct => (
                    <TouchableOpacity
                      key={pct}
                      style={{ flex: 1, backgroundColor: '#F3E8FF', paddingVertical: 6, borderRadius: 6, alignItems: 'center' }}
                      onPress={() => {
                        const amt = (repayInvoice.creditDetail?.debt || 0) * (pct / 100);
                        setRepayAmount(amt.toFixed(0));
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#6D28D9' }}>{pct}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.formLabel}>PAYMENT MODE</Text>
                <View style={styles.modeRow}>
                  {(['cash', 'upi', 'card', 'cheque'] as const).map(mode => (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.modePill, repayMode === mode && styles.modePillActive]}
                      onPress={() => setRepayMode(mode)}
                    >
                      <Text style={[styles.modePillText, repayMode === mode && styles.modePillTextActive]}>
                        {mode.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.formLabel}>PAYMENT DATE</Text>
                <TextInput style={styles.formInput} value={repayDate} onChangeText={setRepayDate} placeholder="YYYY-MM-DD" placeholderTextColor="#A0AEC0" />

                <Text style={styles.formLabel}>NOTES / REFERENCE</Text>
                <TextInput style={styles.formInput} value={repayNote} onChangeText={setRepayNote} placeholder="e.g. GPay Txn Ref #84920" placeholderTextColor="#A0AEC0" />

                <TouchableOpacity style={styles.submitGradBtn} onPress={handleRecordPayment} activeOpacity={0.8}>
                  <LinearGradient colors={['#16A34A', '#22C55E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
                    <Feather name="check-circle" size={16} color="#FFF" />
                    <Text style={styles.submitGradText}>Confirm &amp; Log Payment</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Ledger Audit Drawer Modal ── */}
      <Modal visible={ledgerDrawerVisible} transparent animationType="slide" onRequestClose={() => setLedgerDrawerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Credit Ledger History</Text>
                <Text style={styles.sheetSubtitle}>{ledgerCustomer?.name} (+91 {ledgerCustomer?.phone})</Text>
              </View>
              <TouchableOpacity onPress={() => setLedgerDrawerVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {ledgerCustomer?.history && ledgerCustomer.history.length > 0 ? (
                ledgerCustomer.history.map((inv, i) => (
                  <View key={i} style={styles.auditCard}>
                    <View style={styles.auditCardHeader}>
                      <Text style={styles.auditInvId}>{inv.invoiceId}</Text>
                      <Text style={styles.auditDate}>
                        {new Date(inv.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    <View style={styles.auditRow}>
                      <Text style={styles.auditLabel}>Invoice Total:</Text>
                      <Text style={styles.auditVal}>₹{inv.total.toLocaleString('en-IN')}</Text>
                    </View>
                    {inv.paymentMethod === 'credit' && inv.creditDetail && (
                      <>
                        <View style={styles.auditRow}>
                          <Text style={styles.auditLabel}>Deposit Paid:</Text>
                          <Text style={styles.auditValGreen}>₹{inv.creditDetail.depositPaid.toLocaleString('en-IN')}</Text>
                        </View>
                        <View style={styles.auditRow}>
                          <Text style={styles.auditLabel}>Outstanding Debt:</Text>
                          <Text style={styles.auditValRed}>₹{inv.creditDetail.debt.toLocaleString('en-IN')}</Text>
                        </View>

                        {/* Repayments Sub-list */}
                        {inv.creditDetail.repayments && inv.creditDetail.repayments.length > 0 && (
                          <View style={styles.repaySubList}>
                            <Text style={styles.repaySubTitle}>REPAYMENTS LOG:</Text>
                            {inv.creditDetail.repayments.map((r, rIdx) => (
                              <View key={rIdx} style={styles.repaySubItem}>
                                <Feather name="check" size={10} color="#16A34A" />
                                <Text style={styles.repaySubText}>
                                  ₹{r.amount.toLocaleString('en-IN')} via {r.mode.toUpperCase()} ({r.date})
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </>
                    )}
                  </View>
                ))
              ) : (
                <Text style={styles.emptySub}>No transaction records found for this account.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Add Manual Credit Entry Modal ── */}
      <Modal visible={addEntryVisible} transparent animationType="fade" onRequestClose={() => setAddEntryVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.dialogBox}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New Debt Entry</Text>
              <TouchableOpacity onPress={() => setAddEntryVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.formLabel}>CUSTOMER NAME *</Text>
            <TextInput style={styles.formInput} placeholder="e.g. Ramesh Patel" placeholderTextColor="#A0AEC0" value={entryName} onChangeText={setEntryName} />

            <Text style={styles.formLabel}>PHONE NUMBER *</Text>
            <TextInput style={styles.formInput} keyboardType="phone-pad" placeholder="9876543210" placeholderTextColor="#A0AEC0" value={entryPhone} onChangeText={setEntryPhone} />

            <Text style={styles.formLabel}>DEBT AMOUNT (₹) *</Text>
            <TextInput style={styles.formInput} keyboardType="numeric" placeholder="e.g. 4500" placeholderTextColor="#A0AEC0" value={entryAmount} onChangeText={setEntryAmount} />

            <Text style={styles.formLabel}>REFERENCE / NOTE</Text>
            <TextInput style={styles.formInput} placeholder="e.g. 5 boxes kajaria tile credit" placeholderTextColor="#A0AEC0" value={entryNote} onChangeText={setEntryNote} />

            <Text style={styles.formLabel}>DUE DATE (Optional)</Text>
            <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" placeholderTextColor="#A0AEC0" value={entryDueDate} onChangeText={setEntryDueDate} />

            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogCancelBtn} onPress={() => setAddEntryVisible(false)}>
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogSubmitBtn} onPress={handleAddManualEntry} activeOpacity={0.8}>
                <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.dialogSubmitGrad}>
                  <Text style={styles.dialogSubmitText}>Log Debt</Text>
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
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backIconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 4 },
  addBtnText: { color: '#6D28D9', fontSize: 11, fontWeight: 'bold' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 2 },
  countBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  kpiCardRed: { flex: 1, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#FCA5A5' },
  kpiLabelRed: { fontSize: 8, color: '#DC2626', fontWeight: 'bold', letterSpacing: 0.8 },
  kpiValRed: { fontSize: 18, fontWeight: '800', color: '#DC2626', marginTop: 2 },
  kpiSubRed: { fontSize: 9, color: '#991B1B', marginTop: 2 },
  kpiCardGreen: { flex: 1, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#86EFAC' },
  kpiLabelGreen: { fontSize: 8, color: '#16A34A', fontWeight: 'bold', letterSpacing: 0.8 },
  kpiValGreen: { fontSize: 18, fontWeight: '800', color: '#16A34A', marginTop: 2 },
  kpiSubGreen: { fontSize: 9, color: '#166534', marginTop: 2 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterChip: { flex: 1, paddingVertical: 8, borderRadius: 14, backgroundColor: '#FFF', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  filterChipActive: { backgroundColor: '#6D28D9', borderColor: '#6D28D9' },
  filterChipText: { fontSize: 11, fontWeight: 'bold', color: '#6B7280' },
  filterChipTextActive: { color: '#FFF' },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 36, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#F3E8FF' },
  emptyTitle: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E' },
  emptySub: { fontSize: 11, color: '#A0AEC0', textAlign: 'center' },
  debtorList: { gap: 12 },
  debtorCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  debtorCardOutstanding: { backgroundColor: '#FFF5F5', borderColor: '#FECACA', borderLeftWidth: 4, borderLeftColor: '#EF4444' },
  debtorHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarRed: { backgroundColor: '#FEE2E2' },
  avatarGreen: { backgroundColor: '#DCFCE7' },
  avatarText: { fontSize: 16, fontWeight: '800' },
  avatarTextRed: { color: '#DC2626' },
  avatarTextGreen: { color: '#16A34A' },
  debtorName: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E' },
  dueBadge: { backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  dueBadgeText: { color: '#FFF', fontSize: 8, fontWeight: '800' },
  debtorPhone: { fontSize: 10, color: '#A0AEC0', marginTop: 1 },
  debtorAddress: { fontSize: 9, color: '#718096', marginTop: 1 },
  debtVal: { fontSize: 16, fontWeight: '800' },
  debtSubLabel: { fontSize: 9, color: '#A0AEC0', textAlign: 'right' },
  textRed: { color: '#DC2626' },
  textGreen: { color: '#16A34A' },
  debtorActionsRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  actionBtnRepay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#DC2626', borderRadius: 12, paddingVertical: 8 },
  actionBtnRepayText: { fontSize: 11, fontWeight: 'bold', color: '#FFF' },
  actionBtnReminder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#E8F5E9', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#A5D6A7' },
  actionBtnReminderText: { fontSize: 11, fontWeight: 'bold', color: '#1B5E20' },
  actionBtnAudit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F3E8FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  actionBtnAuditText: { fontSize: 11, fontWeight: 'bold', color: '#6D28D9' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  sheetSubtitle: { fontSize: 11, color: '#A0AEC0', marginTop: 1 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  modalBody: { gap: 10 },
  outstandingInfoBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 14, padding: 12, marginBottom: 4 },
  infoBoxName: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  infoBoxSub: { fontSize: 10, color: '#A0AEC0' },
  infoBoxDebt: { fontSize: 16, fontWeight: '800', color: '#DC2626' },
  infoBoxDebtLabel: { fontSize: 9, color: '#991B1B' },
  formLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.8, marginTop: 4 },
  formInput: { backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, color: '#1A1A2E' },
  modeRow: { flexDirection: 'row', gap: 6 },
  modePill: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F8F6FF', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  modePillActive: { backgroundColor: '#6D28D9', borderColor: '#6D28D9' },
  modePillText: { fontSize: 10, fontWeight: 'bold', color: '#6B7280' },
  modePillTextActive: { color: '#FFF' },
  submitGradBtn: { borderRadius: 14, overflow: 'hidden', marginTop: 10 },
  submitGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  submitGradText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  auditCard: { backgroundColor: '#F8F6FF', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E9D5FF' },
  auditCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  auditInvId: { fontSize: 12, fontWeight: 'bold', color: '#6D28D9' },
  auditDate: { fontSize: 10, color: '#A0AEC0' },
  auditRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  auditLabel: { fontSize: 10, color: '#6B7280' },
  auditVal: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  auditValGreen: { fontSize: 10, fontWeight: 'bold', color: '#16A34A' },
  auditValRed: { fontSize: 10, fontWeight: 'bold', color: '#DC2626' },
  repaySubList: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E9D5FF' },
  repaySubTitle: { fontSize: 8, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.5, marginBottom: 4 },
  repaySubItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  repaySubText: { fontSize: 10, color: '#16A34A', fontWeight: '600' },
  dialogBox: { width: '100%', maxWidth: 340, backgroundColor: '#FFF', borderRadius: 24, padding: 20, alignSelf: 'center', marginVertical: 'auto' },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dialogCancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  dialogCancelText: { color: '#6B7280', fontWeight: '600', fontSize: 12 },
  dialogSubmitBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  dialogSubmitGrad: { paddingVertical: 12, alignItems: 'center' },
  dialogSubmitText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },
});
