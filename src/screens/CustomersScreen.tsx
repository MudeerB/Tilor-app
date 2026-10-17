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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { CustomersSkeleton } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

interface CreditDetail {
  depositPaid: number;
  debt: number;
  dueDate: string;
  repayments: Repayment[];
}

interface InvoiceRecord {
  invoiceId: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerGst?: string;
  customerAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  gst: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'credit';
  creditDetail: CreditDetail | null;
}

export interface Customer {
  name: string;
  phone: string;
  address?: string;
  gstin?: string;
  history?: InvoiceRecord[];
}

const CUSTOMERS_KEY = 'tilor_customers';

const SEED_CUSTOMERS: Customer[] = [
  { name: 'Aarav Sharma', phone: '9876543210', address: 'Sector 15, Noida', gstin: '09AAAAA1111A1Z1', history: [] },
  { name: 'Priya Patel',  phone: '9123456789', address: 'Ghatlodia, Ahmedabad', gstin: '', history: [] },
  { name: 'Rajesh Kumar', phone: '9988776655', address: 'Connaught Place, Delhi', gstin: '07BBBBB2222B2Z2', history: [] },
];

type FilterType = 'all' | 'credit' | 'paid';
type SortType = 'credit_desc' | 'credit_asc' | 'spent_desc' | 'name_asc';

interface CustomersScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

// ─── Memoized Customer Card ──────────────────────────────────────────────────

interface CustomerDirectoryCardProps {
  cust: Customer;
  credit: number;
  spent: number;
  billCount: number;
  onPress: (cust: Customer) => void;
}

const CustomerDirectoryCard = React.memo<CustomerDirectoryCardProps>(({
  cust,
  credit,
  spent,
  billCount,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={[
        styles.customerCard,
        credit > 0 && styles.customerCardCreditHighlight,
      ]}
      onPress={() => onPress(cust)}
      activeOpacity={0.75}
    >
      <View style={styles.custHeaderRow}>
        <View style={[styles.avatarCircle, credit > 0 && { backgroundColor: '#FEE2E2' }]}>
          <Text style={[styles.avatarInitial, credit > 0 && { color: '#DC2626' }]}>
            {cust.name[0]?.toUpperCase() || 'C'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.custName}>{cust.name}</Text>
            {credit > 0 && (
              <View style={styles.creditPillTag}>
                <Text style={styles.creditPillTagText}>CREDIT DUE</Text>
              </View>
            )}
          </View>
          <Text style={styles.custPhone}>Phone: {cust.phone}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {credit > 0 ? (
            <View style={styles.creditBadge}>
              <Text style={styles.creditBadgeVal}>⚠️ ₹{credit.toLocaleString('en-IN')} Due</Text>
            </View>
          ) : (
            <View style={styles.paidBadge}>
              <Text style={styles.paidBadgeText}>Clear</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.custFooterRow}>
        <Text style={styles.custMetaText}>
          {billCount} Bills · Total Spent: ₹{spent.toLocaleString('en-IN')}
        </Text>
        <Feather name="chevron-right" size={16} color={credit > 0 ? '#EF4444' : '#CBD5E0'} />
      </View>
    </TouchableOpacity>
  );
});
CustomerDirectoryCard.displayName = 'CustomerDirectoryCard';

export const CustomersScreen: React.FC<CustomersScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [customers, setCustomers]           = useState<Customer[]>([]);
  const [search, setSearch]                 = useState('');
  const debouncedSearch                     = useDebouncedValue(search, 200);
  const [filterType, setFilterType]         = useState<FilterType>('all');
  const [sortType, setSortType]             = useState<SortType>('credit_desc');
  const [visibleCount, setVisibleCount]     = useState(25);

  // Customer Detail Drawer state
  const [selectedCust, setSelectedCust]     = useState<Customer | null>(null);

  // Add Customer Modal state
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [newName, setNewName]               = useState('');
  const [newPhone, setNewPhone]             = useState('');
  const [newAddress, setNewAddress]         = useState('');
  const [newGst, setNewGst]                 = useState('');

  // Repayment Modal state
  const [repayModalVisible, setRepayModalVisible] = useState(false);
  const [repayInvoice, setRepayInvoice]           = useState<InvoiceRecord | null>(null);
  const [repayAmount, setRepayAmount]             = useState('');
  const [repayMode, setRepayMode]                 = useState('cash');
  const [repayDate, setRepayDate]                 = useState('');

  const [isLoading, setIsLoading]                 = useState(true);

  const loadCustomers = useCallback(async () => {
    try {
      if (activeTab !== 'customers') return;
      setIsLoading(true);
      const data = await billingService.fetchAllCustomers(session.shop_id);
      setCustomers(data);
    } catch {
      setCustomers([]);
    } finally {
      setIsLoading(false);
    }
  }, [session.shop_id, activeTab]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const saveCustomers = async (updated: Customer[]) => {
    // Only used for optimistic UI updates now
    setCustomers(updated);
    if (selectedCust) {
      const refreshed = updated.find(c => c.phone === selectedCust.phone) || null;
      setSelectedCust(refreshed);
    }
  };

  // Helper calculations per customer
  const getCustomerCredit = (c: Customer): number => {
    if (!c.history) return 0;
    return c.history.reduce((sum, inv) => {
      if (inv.paymentMethod === 'credit' && inv.creditDetail) {
        return sum + (inv.creditDetail.debt || 0);
      }
      return sum;
    }, 0);
  };

  const getCustomerSpent = (c: Customer): number => {
    if (!c.history) return 0;
    return c.history.reduce((sum, inv) => sum + inv.total, 0);
  };

  // Add new customer
  const handleAddCustomer = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      Alert.alert('Required Fields', 'Please enter customer name and phone number.');
      return;
    }
    const cleanPhone = newPhone.replace(/\D/g, '').trim();
    if (cleanPhone.length !== 10) {
      Alert.alert('Invalid Phone', 'Phone number must be exactly 10 digits.');
      return;
    }
    
    // Check local state first to prevent duplicate API call
    if (customers.some(c => c.phone === cleanPhone)) {
      Alert.alert('Duplicate Phone', 'A customer with this phone number already exists.');
      return;
    }

    const res = await billingService.addCustomer(
      session.shop_id,
      newName.trim(),
      cleanPhone,
      newAddress.trim(),
      newGst.trim().toUpperCase()
    );

    if (res.success) {
      // Reload from backend to get full structure
      loadCustomers();
      setNewName(''); setNewPhone(''); setNewAddress(''); setNewGst('');
      setAddModalVisible(false);
      Alert.alert('Success', `${newName.trim()} added to customer directory.`);
    } else {
      Alert.alert('Error', res.error || 'Failed to add customer.');
    }
  };

  // Repayment submission
  const handleSubmitRepayment = async () => {
    if (!selectedCust || !repayInvoice) return;
    const amount = parseFloat(repayAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid', 'Please enter a valid repayment amount.');
      return;
    }

    const currentDebt = repayInvoice.creditDetail?.debt || 0;
    if (amount > currentDebt) {
      Alert.alert('Overpayment', `Amount cannot exceed outstanding balance of ₹${currentDebt}.`);
      return;
    }

    const updated = customers.map(cust => {
      if (cust.phone !== selectedCust.phone) return cust;
      return {
        ...cust,
        history: cust.history?.map(inv => {
          if (inv.invoiceId !== repayInvoice.invoiceId) return inv;
          const prevCredit = inv.creditDetail!;
          return {
            ...inv,
            creditDetail: {
              ...prevCredit,
              debt: prevCredit.debt - amount,
              repayments: [
                ...(prevCredit.repayments || []),
                { amount, date: repayDate, mode: repayMode },
              ],
            },
          };
        }),
      };
    });

    await saveCustomers(updated);
    setRepayModalVisible(false);
    setRepayInvoice(null);
    Alert.alert('Success', `Logged repayment of ₹${amount}.`);
  };

  // Metrics
  const totalCustomersCount = customers.length;
  const totalCreditDebt = customers.reduce((sum, c) => sum + getCustomerCredit(c), 0);
  const totalRevenue = customers.reduce((sum, c) => sum + getCustomerSpent(c), 0);

  // Filter & Sort logic with debouncedSearch
  const sorted = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const filtered = customers.filter(c => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.gstin && c.gstin.toLowerCase().includes(q));

      const credit = getCustomerCredit(c);
      const matchesFilter =
        filterType === 'all'
          ? true
          : filterType === 'credit'
          ? credit > 0
          : credit === 0;

      return matchesSearch && matchesFilter;
    });

    return [...filtered].sort((a, b) => {
      if (sortType === 'credit_desc') return getCustomerCredit(b) - getCustomerCredit(a);
      if (sortType === 'credit_asc') return getCustomerCredit(a) - getCustomerCredit(b);
      if (sortType === 'spent_desc') return getCustomerSpent(b) - getCustomerSpent(a);
      if (sortType === 'name_asc') return a.name.localeCompare(b.name);
      return 0;
    });
  }, [customers, debouncedSearch, filterType, sortType]);

  const paginatedCustomers = useMemo(() => {
    return sorted.slice(0, visibleCount);
  }, [sorted, visibleCount]);

  useEffect(() => {
    setVisibleCount(25);
  }, [debouncedSearch, filterType, sortType]);

  const handleSelectCust = useCallback((cust: Customer) => {
    hapticFeedback.light();
    setSelectedCust(cust);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
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
                  <Feather name="users" size={16} color="#FFF" />
                </View>
                <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
              </View>

              <View style={styles.appBarRight}>
                <TouchableOpacity
                  style={styles.addCustBtn}
                  onPress={() => setAddModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <Feather name="user-plus" size={13} color="#7C3AED" />
                  <Text style={styles.addCustBtnText}>Add</Text>
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
                <Text style={styles.pageSubtitle}>CRM &amp; KHATABOOK DIRECTORY</Text>
                <Text style={styles.pageTitle}>Customer Accounts</Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{totalCustomersCount} registered</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Main Content */}
        <View style={styles.innerContent}>
        {/* Glanceable Metrics Cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>ACCOUNTS</Text>
            <Text style={styles.statVal}>{totalCustomersCount}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>TOTAL CREDIT DUE</Text>
            <Text style={[styles.statVal, { color: '#EF4444' }]}>
              ₹{totalCreditDebt.toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>LIFETIME REVENUE</Text>
            <Text style={[styles.statVal, { color: '#7C3AED' }]}>
              ₹{totalRevenue.toLocaleString('en-IN')}
            </Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Feather name="search" size={15} color="#A0AEC0" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search customer name, phone, GSTIN..."
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

        {/* Filter & Sort Bar */}
        <View style={styles.controlsRow}>
          {/* Filter Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['all', 'credit', 'paid'] as FilterType[]).map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip, filterType === f && styles.filterChipActive]}
                  onPress={() => {
                    hapticFeedback.light();
                    setFilterType(f);
                  }}
                >
                  <Text style={[styles.filterChipText, filterType === f && styles.filterChipTextActive]}>
                    {f === 'all' ? 'All' : f === 'credit' ? 'With Credit' : 'Fully Paid'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Sort Selector */}
          <View style={styles.sortWrap}>
            <Feather name="sliders" size={12} color="#7C3AED" />
            <TouchableOpacity
              onPress={() => {
                hapticFeedback.light();
                const types: SortType[] = ['credit_desc', 'credit_asc', 'spent_desc', 'name_asc'];
                const nextIdx = (types.indexOf(sortType) + 1) % types.length;
                setSortType(types[nextIdx]);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
            >
              <Text style={styles.sortText}>
                {sortType === 'credit_desc'
                  ? 'Credit ↓'
                  : sortType === 'credit_asc'
                  ? 'Credit ↑'
                  : sortType === 'spent_desc'
                  ? 'Spent ↓'
                  : 'Name A-Z'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Customers List */}
        {isLoading ? (
          <CustomersSkeleton />
        ) : sorted.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="users" size={32} color="#C4B5FD" />
            <Text style={styles.emptyText}>No customer accounts found</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {paginatedCustomers.map(cust => (
              <CustomerDirectoryCard
                key={cust.phone}
                cust={cust}
                credit={getCustomerCredit(cust)}
                spent={getCustomerSpent(cust)}
                billCount={cust.history?.length || 0}
                onPress={handleSelectCust}
              />
            ))}

            {sorted.length > visibleCount && (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                onPress={() => {
                  hapticFeedback.light();
                  setVisibleCount(prev => prev + 25);
                }}
              >
                <Text style={styles.loadMoreText}>
                  Load More ({sorted.length - visibleCount} remaining)
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Bottom Nav */}
      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} />

      {/* ── Customer Details Drawer Modal ── */}
      <Modal
        visible={!!selectedCust}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedCust(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.avatarCircleLarge}>
                  <Text style={styles.avatarInitialLarge}>{selectedCust?.name[0].toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={styles.drawerCustName}>{selectedCust?.name}</Text>
                  <Text style={styles.drawerCustPhone}>+91 {selectedCust?.phone}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setSelectedCust(null)}
                style={styles.modalCloseCircle}
              >
                <Feather name="x" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Profile Overview */}
              <View style={styles.profileBox}>
                <View style={styles.profileRow}>
                  <Text style={styles.profileLabel}>Address:</Text>
                  <Text style={styles.profileVal}>{selectedCust?.address || 'N/A'}</Text>
                </View>
                {selectedCust?.gstin ? (
                  <View style={styles.profileRow}>
                    <Text style={styles.profileLabel}>GSTIN:</Text>
                    <Text style={styles.profileValHighlight}>{selectedCust.gstin}</Text>
                  </View>
                ) : null}
                <View style={styles.profileRow}>
                  <Text style={styles.profileLabel}>Khatabook Balance:</Text>
                  <Text
                    style={[
                      styles.profileVal,
                      { color: selectedCust && getCustomerCredit(selectedCust) > 0 ? '#EF4444' : '#22C55E', fontWeight: 'bold' }
                    ]}
                  >
                    ₹{selectedCust ? getCustomerCredit(selectedCust).toLocaleString('en-IN') : 0}
                  </Text>
                </View>
              </View>

              {/* Invoices Timeline for Customer */}
              <Text style={styles.sectionSubHeader}>PURCHASE HISTORY &amp; INVOICES</Text>
              {!selectedCust?.history || selectedCust.history.length === 0 ? (
                <View style={styles.emptyHistoryBox}>
                  <Text style={{ fontSize: 11, color: '#A0AEC0' }}>No invoice records for this customer</Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {selectedCust.history.map((inv, idx) => {
                    const isCredit = inv.paymentMethod === 'credit';
                    const outstanding = isCredit && inv.creditDetail ? inv.creditDetail.debt : 0;

                    return (
                      <View key={idx} style={styles.historyCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View>
                            <Text style={styles.invCardId}>{inv.invoiceId}</Text>
                            <Text style={styles.invCardDate}>
                              {new Date(inv.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Text>
                          </View>
                          <Text style={styles.invCardTotal}>₹{inv.total.toLocaleString('en-IN')}</Text>
                        </View>

                        {isCredit && outstanding > 0 && (
                          <View style={styles.historyDebtRow}>
                            <Text style={styles.historyDebtLabel}>Debt Outstanding: ₹{outstanding}</Text>
                            <TouchableOpacity
                              style={styles.repayMiniBtn}
                              onPress={() => {
                                setRepayInvoice(inv);
                                setRepayAmount(outstanding.toString());
                                setRepayMode('cash');
                                setRepayDate(new Date().toISOString().split('T')[0]);
                                setRepayModalVisible(true);
                              }}
                            >
                              <Text style={styles.repayMiniText}>Repay</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Add Customer Modal ── */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.addModalBox}>
            <View style={styles.addModalHeader}>
              <Text style={styles.addModalTitle}>Add New Customer</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.modalCloseCircle}>
                <Feather name="x" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.formLabel}>FULL NAME *</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Aarav Sharma"
              placeholderTextColor="#A0AEC0"
              value={newName}
              onChangeText={setNewName}
            />

            <Text style={styles.formLabel}>PHONE NUMBER *</Text>
            <TextInput
              style={styles.formInput}
              keyboardType="phone-pad"
              placeholder="9876543210"
              placeholderTextColor="#A0AEC0"
              value={newPhone}
              onChangeText={setNewPhone}
            />

            <Text style={styles.formLabel}>GSTIN (OPTIONAL)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="09AAAAA1111A1Z1"
              placeholderTextColor="#A0AEC0"
              autoCapitalize="characters"
              value={newGst}
              onChangeText={setNewGst}
            />

            <Text style={styles.formLabel}>ADDRESS</Text>
            <TextInput
              style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]}
              placeholder="Street address, City"
              placeholderTextColor="#A0AEC0"
              multiline
              value={newAddress}
              onChangeText={setNewAddress}
            />

            <View style={styles.addModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.submitBtn} onPress={handleAddCustomer} activeOpacity={0.8}>
                <LinearGradient colors={['#7C3AED', '#9333EA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
                  <Text style={styles.submitText}>Save Customer</Text>
                </LinearGradient>
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
              <Text style={styles.sheetTitle}>Record Repayment</Text>
              <TouchableOpacity onPress={() => setRepayModalVisible(false)} style={styles.modalCloseCircle}>
                <Feather name="x" size={16} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.outstandingInfo}>
              <Text style={styles.outstandingLabel}>Debt Balance Outstanding:</Text>
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

            <View style={styles.addModalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRepayModalVisible(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.submitBtn} onPress={handleSubmitRepayment} activeOpacity={0.8}>
                <LinearGradient colors={['#7C3AED', '#9333EA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
                  <Text style={styles.submitText}>Submit Payment</Text>
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
  addCustBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4 },
  addCustBtnText: { color: '#7C3AED', fontSize: 10, fontWeight: 'bold' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },
  logoutBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 'bold', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 2 },
  countBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  innerContent: { paddingHorizontal: 16, paddingTop: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#F3E8FF' },
  statLabel: { fontSize: 8, color: '#A0AEC0', fontWeight: 'bold', letterSpacing: 0.5 },
  statVal: { fontSize: 14, fontWeight: '800', color: '#1A1A2E', marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    boxShadow: '0px 2px 8px rgba(0,0,0,0.04)',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E9D5FF' },
  filterChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  filterChipText: { fontSize: 10, fontWeight: '600', color: '#6B7280' },
  filterChipTextActive: { color: '#FFF' },
  sortWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#E9D5FF', gap: 4 },
  sortText: { fontSize: 10, fontWeight: 'bold', color: '#7C3AED' },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 36, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#F3E8FF' },
  emptyText: { fontSize: 12, color: '#A0AEC0' },
  listContainer: { gap: 10 },
  customerCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  customerCardCreditHighlight: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FECACA',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  creditPillTag: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  creditPillTagText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  custHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: 16, fontWeight: '800', color: '#7C3AED' },
  custName: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  custPhone: { fontSize: 10, color: '#A0AEC0', marginTop: 1 },
  creditBadge: { backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  creditBadgeVal: { fontSize: 10, fontWeight: 'bold', color: '#EF4444' },
  paidBadge: { backgroundColor: '#F0FDF4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  paidBadgeText: { fontSize: 10, fontWeight: 'bold', color: '#16A34A' },
  custFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F8F6FF' },
  custMetaText: { fontSize: 10, color: '#718096' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  avatarCircleLarge: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  avatarInitialLarge: { fontSize: 20, fontWeight: '800', color: '#7C3AED' },
  drawerCustName: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  drawerCustPhone: { fontSize: 11, color: '#A0AEC0' },
  modalCloseCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  profileBox: { backgroundColor: '#F8F6FF', borderRadius: 16, padding: 12, gap: 6, marginBottom: 14 },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between' },
  profileLabel: { fontSize: 10, color: '#6B7280' },
  profileVal: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  profileValHighlight: { fontSize: 10, fontWeight: 'bold', color: '#7C3AED' },
  sectionSubHeader: { fontSize: 10, fontWeight: 'bold', color: '#7C3AED', letterSpacing: 0.8, marginBottom: 8 },
  emptyHistoryBox: { backgroundColor: '#F8F6FF', borderRadius: 12, padding: 20, alignItems: 'center' },
  historyCard: { backgroundColor: '#F8F6FF', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E9D5FF' },
  invCardId: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  invCardDate: { fontSize: 9, color: '#A0AEC0' },
  invCardTotal: { fontSize: 13, fontWeight: '800', color: '#7C3AED' },
  historyDebtRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#E9D5FF' },
  historyDebtLabel: { fontSize: 10, fontWeight: 'bold', color: '#EF4444' },
  repayMiniBtn: { backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  repayMiniText: { fontSize: 9, fontWeight: 'bold', color: '#EF4444' },
  addModalBox: { width: '100%', maxWidth: 340, backgroundColor: '#FFF', borderRadius: 24, padding: 20, alignSelf: 'center', marginVertical: 'auto' },
  addModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  addModalTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  formLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.8, marginBottom: 4 },
  formInput: { backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: '#1A1A2E', marginBottom: 8 },
  addModalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#6B7280', fontWeight: '600', fontSize: 12 },
  submitBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  submitGrad: { paddingVertical: 12, alignItems: 'center' },
  submitText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },
  repaySheet: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, width: '100%' },
  sheetTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  outstandingInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 14, padding: 12, marginBottom: 14 },
  outstandingLabel: { fontSize: 11, color: '#EF4444', fontWeight: '500' },
  outstandingVal: { fontSize: 14, color: '#EF4444', fontWeight: '800' },
  loadMoreBtn: { backgroundColor: '#F3E8FF', borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#D8B4FE' },
  loadMoreText: { color: '#7C3AED', fontWeight: 'bold', fontSize: 13 },
});
