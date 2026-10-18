/**
 * src/screens/BillingScreen.tsx
 *
 * Billing & Checkout Screen — full Supabase backend integration + UI bug fixes.
 *
 * Bug Fixes:
 *  #1  Insufficient Stock Protection (Block sale if qty > stock)
 *  #2  2-Decimal GST Precision Calculation
 *  #3  Unmatched Cart Item Catalog Check
 *  #4  Customer Phone 10-Digit Format Validation
 *  #5  Credit Due Date YYYY-MM-DD Format Validation
 *  #6  Block Credit Deposit > Grand Total
 *  #7  Atomic Invoice Number Sequence Generator (INV-DDMMYY-001)
 *  #8  Customer Name Overwrite Protection
 *  #9  Loading Spinner State During Checkout Submit
 *  #10 Item Discount Field + CGST/SGST vs IGST Tax Split Toggle
 *  #11 GSTIN 15-Character Format Validation Regex
 *  #12 Price Range Display in Search Dropdown (e.g. ₹850-₹1150/box)
 *  #13 Stable Unique CartItem IDs
 *  #14 Direct Billing Cart Draft Auto-Save
 *  #15 Variant Selection Modal for 12x18 Tiles (Light, HL, Dark, Flooring selection)
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { BillingSkeleton } from '../components/skeleton';
import { TileCollection, TileVariant, VariantType } from '../types/tiles';
import { catalogService } from '../services/catalog';
import { billingService } from '../services/billing';
import { fetchShopStaff } from '../services/auth';
import type { UserProfile } from '../types/auth';
import {
  sanitizeReceiptField,
  sanitizeCustomerName,
  sanitizeAddress,
  sanitizeTxnRef,
} from '../utils/sanitize';
import { shareOrPrintReceipt } from '../utils/receiptPrint';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

const PENDING_BILL_KEY = 'tilor_pending_bill';
const CUSTOMERS_KEY = 'tilor_customers';
const DIRECT_BILL_KEY = 'tilor_active_direct_bill';

// ─── Share & Print Receipts ──────────────────────────────────────────────────

const generateReceiptText = (inv: any): string => {
  if (!inv) return '';
  const safeCustomerName = sanitizeReceiptField(inv.customerName);
  const safeCustomerPhone = sanitizeReceiptField(inv.customerPhone, 15);
  const safeCustomerGst = sanitizeReceiptField(inv.customerGst, 20);

  const itemLines = inv.items
    ? inv.items
      .map(
        (item: any, i: number) => {
          const safeName = sanitizeReceiptField(item.name);
          const safeVariant = item.variantLabel ? ` (${sanitizeReceiptField(item.variantLabel, 30)})` : '';
          return `${i + 1}. ${safeName}${safeVariant}\n   ${item.boxes} bx × ₹${item.pricePerBox} = ₹${item.total}`;
        }
      )
      .join('\n')
    : '';

  return `
🧾 *TILOR STORE RECEIPT*
--------------------------------
Invoice #: ${sanitizeReceiptField(inv.invoiceId, 30)}
Date: ${new Date(inv.date).toLocaleDateString('en-IN')}
Customer: ${safeCustomerName}
Phone: ${safeCustomerPhone || 'N/A'}
${safeCustomerGst ? `GSTIN: ${safeCustomerGst}\n` : ''}--------------------------------
*ITEMS PURCHASED:*
${itemLines}

--------------------------------
Subtotal: ₹${inv.subtotal?.toLocaleString('en-IN')}
${inv.discount ? `Discount: -₹${inv.discount?.toLocaleString('en-IN')}\n` : ''}${inv.gst && inv.gst > 0 ? `Tax (${inv.gstType === 'igst' ? '18% IGST' : '9% CGST + 9% SGST'}): ₹${inv.gst?.toLocaleString('en-IN')}\n` : 'Tax: None (Non-GST Bill)\n'}*GRAND TOTAL: ₹${inv.total?.toLocaleString('en-IN')}*
Payment Mode: ${inv.paymentMethod?.toUpperCase()}
${inv.paymentMethod === 'credit' && inv.creditDetail
      ? `\n*KHATABOOK LEDGER:*
Deposit Paid: ₹${inv.creditDetail.depositPaid}
Outstanding Debt: ₹${inv.creditDetail.debt}
Due Date: ${sanitizeReceiptField(inv.creditDetail.dueDate, 20)}`
      : ''
    }
--------------------------------
Thank you for shopping at Tilor!
`.trim();
};

const handleShareOrPrintInvoice = async (inv: any) => {
  if (!inv) return;
  const receiptText = generateReceiptText(inv);
  await shareOrPrintReceipt(receiptText, inv.invoiceId);
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string; // Bug #13: Stable unique ID
  tileId: string;
  variantId?: string;
  variantType?: VariantType;
  variantLabel?: string;
  name: string;
  brand: string;
  size: string;
  sqftPerBox: number;
  pricePerBox: number;
  color: string;
  accent: string;
  boxes: number;
  roomName?: string | null;
}

export interface Customer {
  name: string;
  phone: string;
  address?: string;
  gstin?: string;
  history?: any[];
}

type PaymentMethod = 'cash' | 'card' | 'upi' | 'credit';
type GstType = 'cgst_sgst' | 'igst' | 'none';

interface BillingScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

export const BillingScreen: React.FC<BillingScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [catalog, setCatalog] = useState<TileCollection[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [estimateProjectName, setEstimateProjectName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [sizeFilter, setSizeFilter] = useState('all');

  // Variant Picker Modal State for 12x18 Tiles
  const [variantPickerTile, setVariantPickerTile] = useState<TileCollection | null>(null);

  // Bug #10: Discount & Tax Split States
  const [discount, setDiscount] = useState('');
  const [isGst, setIsGst] = useState(false);
  const [gstType, setGstType] = useState<GstType>('cgst_sgst');

  // Checkout Modal State & Validation
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custGst, setCustGst] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [phoneMatched, setPhoneMatched] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [creditDeposit, setCreditDeposit] = useState('0');
  const [creditDueDate, setCreditDueDate] = useState('');
  const [txnRef, setTxnRef] = useState('');

  // Bug #9: Loading Spinner & Error Banner State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Clear Confirm Modal State
  const [clearCartModalVisible, setClearCartModalVisible] = useState(false);

  // Success Modal State
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);

  // Loading & Fulfillment State
  const [requiresLoading, setRequiresLoading] = useState(true);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [shopStaff, setShopStaff] = useState<UserProfile[]>([]);

  // Catalog pre-fetch & initialization loading state
  const [isInitializing, setIsInitializing] = useState(true);
  const lastLoadedEstimateTimestamp = useRef<string | null>(null);

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async (isInitial: boolean = false) => {
    try {
      if (isInitial && catalog.length === 0) {
        setIsInitializing(true);
      }
      // 1. Fetch Catalog from Supabase (scoped to current shop)
      const loadedCatalog = await catalogService.fetchCatalog(session.shop_id);
      setCatalog(loadedCatalog);

      // 2. Pending Estimate vs Direct Bill Draft (Bug #14)
      const pendingBillStr = await AsyncStorage.getItem(PENDING_BILL_KEY);
      if (pendingBillStr) {
        const parsed = JSON.parse(pendingBillStr);
        // Only reload estimate if it's new/updated or if cart is empty
        if (parsed.timestamp !== lastLoadedEstimateTimestamp.current || cart.length === 0) {
          lastLoadedEstimateTimestamp.current = parsed.timestamp || null;
          setEstimateProjectName(parsed.projectName || 'Estimate');

          if (parsed.rooms && Array.isArray(parsed.rooms)) {
            const items: CartItem[] = [];
            parsed.rooms.forEach((r: any, idx: number) => {
              if (!r.selectedTile || !r.boxes || r.boxes <= 0) return;
              const collection = loadedCatalog.find(t => t.id === r.selectedTile);
              if (!collection) return;
              const variant = collection.variants.find(v => v.type === r.variantType) || collection.variants[0];

              items.push({
                id: `${collection.id}_${variant.type}_${r.id || r.name || 'room'}_${idx}_${Date.now()}`,
                tileId: collection.id,
                variantId: variant.id,
                variantType: variant.type,
                variantLabel: collection.is12x18 ? variant.label : undefined,
                name: collection.name,
                brand: collection.brand,
                size: collection.size,
                sqftPerBox: collection.sqftPerBox,
                pricePerBox: r.pricePerBox || variant.pricePerBox,
                color: variant.color,
                accent: variant.accent,
                boxes: r.boxes,
                roomName: r.name,
              });
            });
            setCart(items);
          }
        }
      } else {
        // Direct bill draft (Bug #14)
        lastLoadedEstimateTimestamp.current = null;
        setEstimateProjectName(null);
        const directStr = await AsyncStorage.getItem(DIRECT_BILL_KEY);
        if (directStr) {
          const parsed = JSON.parse(directStr);
          if (parsed.cart && Array.isArray(parsed.cart)) {
            setCart(parsed.cart);
          }
        }
      }

      // 3. Fetch Staff for Loading Assignment
      const staffList = await fetchShopStaff(session.shop_id);
      setShopStaff(staffList);
    } catch (e) {
      console.error('Error loading billing data', e);
    } finally {
      setIsInitializing(false);
    }
  }, [session.shop_id, catalog.length, cart.length]);

  useEffect(() => {
    if (activeTab === 'billing') {
      loadData(cart.length === 0);
    }
  }, [activeTab, loadData]);

  // Bug #14: Persist direct cart draft automatically when cart updates
  const updateCartState = (newCart: CartItem[]) => {
    setCart(newCart);
    if (!estimateProjectName) {
      AsyncStorage.setItem(DIRECT_BILL_KEY, JSON.stringify({ cart: newCart }));
    }
  };

  // Add tile from catalog search dropdown (Opens Variant Picker if 12x18 tile)
  const handleAddTileToCart = (col: TileCollection, targetVariant?: TileVariant, keepSearchOpen = false) => {
    if (col.is12x18 && !targetVariant) {
      setSearchModalVisible(false);
      setVariantPickerTile(col);
      return;
    }

    const selectedVariant = targetVariant || col.variants[0];
    const existingIdx = cart.findIndex(c => c.tileId === col.id && c.variantType === selectedVariant.type && !c.roomName);

    if (existingIdx >= 0) {
      const updated = [...cart];
      updated[existingIdx].boxes += 1;
      updateCartState(updated);
    } else {
      const newItem: CartItem = {
        id: `${col.id}_${selectedVariant.type}_${Date.now()}_${Math.random()}`,
        tileId: col.id,
        variantId: selectedVariant.id,
        variantType: selectedVariant.type,
        variantLabel: col.is12x18 ? selectedVariant.label : undefined,
        name: col.name,
        brand: col.brand,
        size: col.size,
        sqftPerBox: col.sqftPerBox,
        pricePerBox: selectedVariant.pricePerBox,
        color: selectedVariant.color,
        accent: selectedVariant.accent,
        boxes: 1,
        roomName: null,
      };
      updateCartState([...cart, newItem]);
    }
    hapticFeedback.light();
    if (!keepSearchOpen) {
      setSearchQuery('');
      setSearchFocused(false);
      setVariantPickerTile(null);
    }
  };

  const updateCartQty = (index: number, delta: number) => {
    hapticFeedback.selection();
    const updated = [...cart];
    const newQty = updated[index].boxes + delta;
    if (newQty <= 0) {
      updated.splice(index, 1);
    } else {
      updated[index].boxes = newQty;
    }
    updateCartState(updated);
  };

  const handleSetCartItemBoxes = (index: number, text: string) => {
    const updated = [...cart];
    if (text === '') {
      updated[index].boxes = 0;
      updateCartState(updated);
      return;
    }
    const parsed = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed)) {
      const item = updated[index];
      const col = catalog.find(c => c.id === item.tileId);
      const variant = col?.variants.find(v => v.type === item.variantType) || col?.variants[0];

      if (variant && parsed > variant.stock && variant.stock > 0) {
        Alert.alert(
          'Stock Limit Reached',
          `Only ${variant.stock} boxes available in stock for ${item.name}.`
        );
        updated[index].boxes = variant.stock;
      } else {
        updated[index].boxes = parsed;
      }
      updateCartState(updated);
    }
  };

  const handleBlurCartItemBoxes = (index: number) => {
    const updated = [...cart];
    if (updated[index] && (!updated[index].boxes || updated[index].boxes <= 0)) {
      updated[index].boxes = 1;
      updateCartState(updated);
    }
  };

  const removeCartItem = (index: number) => {
    hapticFeedback.light();
    const updated = [...cart];
    updated.splice(index, 1);
    updateCartState(updated);
  };

  const handleClearCart = () => {
    lastLoadedEstimateTimestamp.current = null;
    updateCartState([]);
    setEstimateProjectName(null);
    AsyncStorage.removeItem(PENDING_BILL_KEY);
    AsyncStorage.removeItem(DIRECT_BILL_KEY);
    setClearCartModalVisible(false);
  };

  // Phone Lookup Logic with Customer Name Overwrite Protection (Bug #8)
  const handlePhoneChange = async (val: string) => {
    const cleaned = val.replace(/\D/g, '').trim();
    setCustPhone(val);

    if (cleaned.length === 10) {
      try {
        const match = await billingService.findCustomerByPhone(session.shop_id, cleaned);
        if (match) {
          if (!custName.trim() || match.name.length >= custName.trim().length) {
            setCustName(match.name);
          }
          setCustAddress(match.address || custAddress);
          setCustGst(match.gstin || custGst);
          setPhoneMatched(true);
          return;
        }
      } catch { }
    }
    setPhoneMatched(false);
  };

  // ─── Calculations (Bug #2 & Bug #10) ────────────────────────────────────────

  const {
    rawSubtotal,
    discountVal,
    subtotal,
    gstTax,
    grandTotal,
    totalBoxesSum,
    depositVal,
    netCreditDebt,
  } = useMemo(() => {
    const rawSubtotal = cart.reduce((sum, item) => sum + item.boxes * item.pricePerBox, 0);
    const discountVal = Math.min(rawSubtotal, parseFloat(discount) || 0);
    const subtotal = Math.max(0, rawSubtotal - discountVal);

    // Bug #2: 2-Decimal GST Calculation Precision (Conditional on isGst checkbox)
    const gstTax = isGst ? Number((subtotal * 0.18).toFixed(2)) : 0;
    const grandTotal = Number((subtotal + gstTax).toFixed(2));
    const totalBoxesSum = cart.reduce((sum, item) => sum + item.boxes, 0);

    const depositVal = parseFloat(creditDeposit) || 0;
    const netCreditDebt = Math.max(0, Number((grandTotal - depositVal).toFixed(2)));

    return {
      rawSubtotal,
      discountVal,
      subtotal,
      gstTax,
      grandTotal,
      totalBoxesSum,
      depositVal,
      netCreditDebt,
    };
  }, [cart, discount, isGst, creditDeposit]);

  // Search Results with Size Filter and Debounced Query
  const searchResults = useMemo(() => {
    const q = debouncedSearchQuery.toLowerCase().trim();
    return catalog.filter(t => {
      const matchesText = !q || (
        t.name.toLowerCase().includes(q) ||
        t.brand.toLowerCase().includes(q) ||
        t.size.toLowerCase().includes(q)
      );
      const normalizedSize = t.size.replace('×', 'x');
      const matchesSize = sizeFilter === 'all' || normalizedSize === sizeFilter;
      return matchesText && matchesSize;
    });
  }, [catalog, debouncedSearchQuery, sizeFilter]);

  // ─── Finalize Invoice ───────────────────────────────────────────────────────

  const handleFinalizeInvoice = async () => {
    setCheckoutError(null);

    if (!custName.trim()) {
      setCheckoutError('Please enter customer name.');
      return;
    }

    const phoneClean = custPhone.replace(/\D/g, '').trim();
    if (phoneClean.length > 0 && phoneClean.length !== 10) {
      setCheckoutError('Phone number must be exactly 10 digits.');
      return;
    }

    if (custGst.trim().length > 0 && !/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/i.test(custGst.trim())) {
      setCheckoutError('Invalid GSTIN format (e.g. 09AAAAA1111A1Z1).');
      return;
    }

    if (paymentMethod === 'credit' && depositVal > grandTotal) {
      setCheckoutError('Credit deposit cannot exceed grand total.');
      return;
    }

    if (paymentMethod === 'credit' && creditDueDate.trim().length > 0) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(creditDueDate.trim())) {
        setCheckoutError('Due date must be in YYYY-MM-DD format.');
        return;
      }
    }

    for (const item of cart) {
      const col = catalog.find(c => c.id === item.tileId || (c.name === item.name && c.brand === item.brand));
      if (!col) {
        setCheckoutError(`Item "${item.name}" is no longer in catalog.`);
        return;
      }

      const variant = col.variants.find(v => v.type === item.variantType) || col.variants[0];
      if (item.boxes > variant.stock) {
        setCheckoutError(`Insufficient stock for ${item.name} (${item.variantLabel || variant.label}). Available: ${variant.stock} boxes, Requested: ${item.boxes} boxes.`);
        return;
      }
    }

    // [BUSINESS LOGIC FIX] Staff discount limit: non-owners capped at 20% (rounded to 2 decimal places)
    const maxAllowedStaffDiscount = Math.round(rawSubtotal * 0.20 * 100) / 100;
    if (session.role !== 'owner' && discountVal > maxAllowedStaffDiscount) {
      setCheckoutError(
        `Staff discount cannot exceed 20% (₹${maxAllowedStaffDiscount.toLocaleString('en-IN')}). Owner authorization required.`
      );
      return;
    }

    const sanitizedName = sanitizeCustomerName(custName);
    const sanitizedAddress = sanitizeAddress(custAddress);
    const sanitizedTxn = sanitizeTxnRef(txnRef);

    if (!sanitizedName) {
      setCheckoutError('Please enter a valid customer name.');
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // [IDEMPOTENCY] Generate unique key per checkout attempt to prevent duplicate billing
    const idempotencyKey = `chk_${session.shop_id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    setIsSubmitting(true);

    try {
      const res = await billingService.createInvoice({
        shopId: session.shop_id,
        createdBy: session.id,
        createdByName: session.full_name || session.username || session.email,
        createdByRole: session.role,
        idempotencyKey,
        customerName: sanitizedName,
        customerPhone: phoneClean,
        customerGst: custGst.trim().toUpperCase(),
        customerAddress: sanitizedAddress,
        items: cart,
        subtotal: rawSubtotal,
        discountAmount: discountVal,
        isGst,
        gstAmount: gstTax,
        gstType: isGst ? gstType : 'none',
        totalAmount: grandTotal,
        paymentMethod,
        isCredit: paymentMethod === 'credit',
        creditDeposit: depositVal,
        creditDebt: netCreditDebt,
        creditDueDate: creditDueDate.trim() || undefined,
        txnRef: sanitizedTxn,
        requiresLoading,
        assignedTo: assignedTo || undefined,
        assignedToName: assignedTo ? shopStaff.find(s => s.id === assignedTo)?.full_name || 'Staff' : undefined,
      });

      isSubmittingRef.current = false;
      setIsSubmitting(false);

      if (!res.success) {
        hapticFeedback.error();
        setCheckoutError(res.error || 'Failed to create invoice.');
        return;
      }

      if (estimateProjectName) {
        try {
          const pendingBillStr = await AsyncStorage.getItem(PENDING_BILL_KEY);
          const pendingData = pendingBillStr ? JSON.parse(pendingBillStr) : null;
          await billingService.saveEstimate(session.shop_id, {
            id: pendingData?.estimateId,
            dbId: pendingData?.dbId,
            projectName: estimateProjectName,
            rooms: pendingData?.rawRooms || pendingData?.rooms || [],
            wastagePercent: pendingData?.wastagePercent || 10,
            totalSqft: pendingData?.totalSqft,
            totalBoxes: pendingData?.totalBoxes,
            totalAmount: pendingData?.totalAmount || res.invoiceRecord?.total,
            timestamp: pendingData?.timestamp || new Date().toISOString(),
            isDraft: false,
            status: 'completed',
          });
          await AsyncStorage.removeItem('tilor_current_draft');
          await AsyncStorage.removeItem('tilor_saved_estimate');
        } catch (e) {
          console.error('Failed to move completed estimate to cloud:', e);
        }
      }

      setCart([]);
      setEstimateProjectName(null);
      lastLoadedEstimateTimestamp.current = null;
      await AsyncStorage.removeItem(PENDING_BILL_KEY);
      await AsyncStorage.removeItem(DIRECT_BILL_KEY);

      hapticFeedback.success();
      setCheckoutVisible(false);
      setLastInvoice(res.invoiceRecord);
      setSuccessModalVisible(true);
    } catch (err: any) {
      hapticFeedback.error();
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setCheckoutError(err?.message || 'An unexpected error occurred during checkout.');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header Banner - Edge-to-Edge */}
        <LinearGradient
          colors={['#5B21B6', '#6D28D9', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            {/* Top Bar */}
            <View style={styles.appBar}>
              <View style={styles.logoRow}>
                <View style={styles.logoIcon}>
                  <Feather name="file-text" size={16} color="#FFF" />
                </View>
                <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
              </View>

              <View style={styles.appBarRight}>
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

            {/* Title Row */}
            <View style={styles.pageTitleRow}>
              {Boolean(estimateProjectName) && (
                <TouchableOpacity
                  style={styles.backLink}
                  onPress={() => onTabChange('estimator')}
                  activeOpacity={0.7}
                >
                  <Feather name="arrow-left" size={13} color="#D8B4FE" />
                  <Text style={styles.backLinkText}>Back to Estimate</Text>
                </TouchableOpacity>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
                <View>
                  <Text style={styles.pageSubtitle}>BILLING & CHECKOUT</Text>
                  <Text style={styles.pageTitle}>
                    {estimateProjectName ? 'Estimate Review' : 'Direct Billing'}
                  </Text>
                  {Boolean(estimateProjectName) && (
                    <Text style={styles.linkedEstimateSub}>
                      Estimate: <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{estimateProjectName}</Text>
                    </Text>
                  )}
                </View>

                <View
                  style={[
                    styles.modeBadge,
                    estimateProjectName ? styles.modeBadgeLinked : styles.modeBadgeAdhoc,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBadgeText,
                      estimateProjectName ? styles.modeBadgeTextLinked : styles.modeBadgeTextAdhoc,
                    ]}
                  >
                    {estimateProjectName ? 'Linked Mode' : 'Ad-hoc Mode'}
                  </Text>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Main Content */}
        {isInitializing ? (
          <BillingSkeleton />
        ) : (
          <View style={styles.innerContent}>
            {/* Mobile-Friendly Search Trigger Card */}
            <TouchableOpacity
              style={styles.searchCard}
              activeOpacity={0.88}
              onPress={() => setSearchModalVisible(true)}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="search" size={14} color="#7C3AED" />
                  <Text style={styles.cardSectionTitle}>Add Tiles to Cart</Text>
                </View>
                <View style={styles.searchPillBadge}>
                  <Text style={styles.searchPillBadgeText}>{catalog.length} Products</Text>
                </View>
              </View>

              <View style={styles.searchInputWrap}>
                <Feather name="search" size={15} color="#A0AEC0" style={{ marginRight: 8 }} />
                <Text style={styles.searchFakeInputText} numberOfLines={1}>
                  {searchQuery.trim() ? searchQuery : "Search tile name, brand, or size..."}
                </Text>
                <View style={styles.searchFilterIconWrap}>
                  <Feather name="sliders" size={12} color="#7C3AED" />
                </View>
              </View>

              {/* Quick Size Filter Pills on Main Screen */}
              <View style={styles.filterChipsRowInline}>
                {['all', '12x18', '2x2', '2x4'].map(sz => (
                  <TouchableOpacity
                    key={sz}
                    style={[styles.sizeChipSmall, sizeFilter === sz && styles.sizeChipSmallActive]}
                    onPress={() => {
                      setSizeFilter(sz);
                      setSearchModalVisible(true);
                    }}
                  >
                    <Text style={[styles.sizeChipTextSmall, sizeFilter === sz && styles.sizeChipTextSmallActive]}>
                      {sz === 'all' ? 'All Sizes' : sz}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>

          {/* Cart Header */}
          <View style={styles.cartHeaderRow}>
            <Text style={styles.cartHeaderTitle}>Cart Items ({cart.length})</Text>
            {cart.length > 0 && (
              <TouchableOpacity onPress={() => setClearCartModalVisible(true)} style={styles.clearCartBtn}>
                <Feather name="trash-2" size={12} color="#EF4444" />
                <Text style={styles.clearCartText}>Clear Cart</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Cart List */}
          {cart.length === 0 ? (
            <View style={styles.emptyCartCard}>
              <View style={styles.emptyCartIconWrap}>
                <Feather name="shopping-bag" size={28} color="#C4B5FD" />
              </View>
              <Text style={styles.emptyCartTitle}>Cart is empty</Text>
              <Text style={styles.emptyCartSub}>
                Use the search bar above or generate an estimate from the Estimator tab.
              </Text>
            </View>
          ) : (
            <View style={styles.cartList}>
              {cart.map((item, idx) => (
                <View key={item.id || idx} style={styles.cartItemCard}>
                  <View style={styles.cartItemTop}>
                    <View style={[styles.cartItemSwatch, { backgroundColor: item.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.cartItemName}>{item.name}</Text>
                        {Boolean(item.variantLabel) && (
                          <View style={{ backgroundColor: '#EDE9FE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#6D28D9' }}>{item.variantLabel}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.cartItemBrand}>
                        {item.brand} · {item.size}
                        {item.roomName ? ` · ${item.roomName}` : ''}
                      </Text>
                      <Text style={styles.cartItemPrice}>₹{item.pricePerBox}/box</Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => removeCartItem(idx)}
                      style={styles.cartItemDeleteBtn}
                    >
                      <Feather name="x" size={16} color="#A0AEC0" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.cartItemBottom}>
                    <View style={styles.qtyCounter}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => updateCartQty(idx, -1)}
                      >
                        <Feather name="minus" size={12} color="#6B7280" />
                      </TouchableOpacity>
                      <View style={styles.qtyInputContainer}>
                        <TextInput
                          style={styles.qtyInput}
                          value={item.boxes === 0 ? '' : item.boxes.toString()}
                          onChangeText={(text) => handleSetCartItemBoxes(idx, text)}
                          onBlur={() => handleBlurCartItemBoxes(idx)}
                          keyboardType="number-pad"
                          selectTextOnFocus
                          maxLength={5}
                        />
                        <Text style={styles.qtyUnitLabel}>bx</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => updateCartQty(idx, 1)}
                      >
                        <Feather name="plus" size={12} color="#6B7280" />
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.cartItemSubtotal}>
                      ₹{(item.boxes * item.pricePerBox).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Calculation Summary */}
          {cart.length > 0 && (
            <View style={styles.calcSummaryCard}>
              <View style={styles.calcSummaryRow}>
                <Text style={styles.calcSummaryLabel}>Subtotal</Text>
                <Text style={styles.calcSummaryVal}>₹{rawSubtotal.toLocaleString('en-IN')}</Text>
              </View>

              {/* Discount Row */}
              <View style={[styles.calcSummaryRow, { alignItems: 'center' }]}>
                <Text style={styles.calcSummaryLabel}>Discount (₹)</Text>
                <TextInput
                  style={styles.discountInput}
                  keyboardType="numeric"
                  placeholder="0"
                  value={discount}
                  onChangeText={setDiscount}
                />
              </View>

              {/* GST Checkbox Toggle */}
              <TouchableOpacity
                style={styles.gstCheckboxRow}
                onPress={() => setIsGst(!isGst)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkboxBox, isGst && styles.checkboxBoxChecked]}>
                  {isGst && <Feather name="check" size={13} color="#FFF" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gstCheckboxLabel}>Apply 18% GST (Tax Invoice)</Text>
                  <Text style={styles.gstCheckboxSub}>Uncheck for Non-GST / Composition estimate bill</Text>
                </View>
              </TouchableOpacity>

              {/* GST Type Split Toggle (Only visible when GST checkbox is checked) */}
              {isGst && (
                <>
                  <View style={styles.gstToggleRow}>
                    <TouchableOpacity
                      style={[styles.gstToggleBtn, gstType === 'cgst_sgst' && styles.gstToggleActive]}
                      onPress={() => setGstType('cgst_sgst')}
                    >
                      <Text style={[styles.gstToggleText, gstType === 'cgst_sgst' && styles.gstToggleTextActive]}>
                        9% CGST + 9% SGST
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.gstToggleBtn, gstType === 'igst' && styles.gstToggleActive]}
                      onPress={() => setGstType('igst')}
                    >
                      <Text style={[styles.gstToggleText, gstType === 'igst' && styles.gstToggleTextActive]}>
                        18% IGST
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.calcSummaryRow}>
                    <Text style={styles.calcSummaryLabel}>
                      Tax ({gstType === 'igst' ? '18% IGST' : '9% CGST + 9% SGST'})
                    </Text>
                    <Text style={styles.calcSummaryVal}>₹{gstTax.toLocaleString('en-IN')}</Text>
                  </View>
                </>
              )}

              <View style={styles.calcSummaryDivider} />

              <View style={styles.calcGrandRow}>
                <View>
                  <Text style={styles.calcGrandLabel}>Grand Total</Text>
                  <Text style={styles.calcGrandSub}>{totalBoxesSum} boxes total</Text>
                </View>
                <Text style={styles.calcGrandVal}>₹{grandTotal.toLocaleString('en-IN')}</Text>
              </View>
            </View>
          )}

          {/* Checkout CTA */}
          {cart.length > 0 && (
            <TouchableOpacity
              style={styles.checkoutBtn}
              onPress={() => {
                setCheckoutError(null);
                setCheckoutVisible(true);
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#7C3AED', '#9333EA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.checkoutGrad}
              >
                <Feather name="file-text" size={18} color="#FFF" />
                <Text style={styles.checkoutText}>Generate &amp; Save Invoice</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

        </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} />

      {/* ── Variant Picker Modal for 12x18 Tiles ── */}
      <Modal
        visible={!!variantPickerTile}
        transparent
        animationType="slide"
        onRequestClose={() => setVariantPickerTile(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.checkoutSheet, { borderRadius: 28, padding: 20 }]}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>Select Variant to Add</Text>
                <Text style={{ fontSize: 11, color: '#A0AEC0', marginTop: 2 }}>
                  {variantPickerTile?.name} ({variantPickerTile?.brand})
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setVariantPickerTile(null)}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 10, marginVertical: 14 }}>
              {variantPickerTile?.variants.map(v => (
                <TouchableOpacity
                  key={v.type}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#F8F6FF',
                    borderRadius: 14,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: '#E9D5FF',
                    gap: 12,
                  }}
                  onPress={() => variantPickerTile && handleAddTileToCart(variantPickerTile, v)}
                  activeOpacity={0.7}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: v.color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' }}>
                      {v.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: v.stock > 0 ? '#10B981' : '#EF4444', fontWeight: 'bold', marginTop: 2 }}>
                      {v.stock > 0 ? `Stock: ${v.stock} boxes` : 'Out of Stock'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#7C3AED' }}>
                    ₹{v.pricePerBox}/bx
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Checkout Modal ── */}
      <Modal
        visible={checkoutVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCheckoutVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.checkoutSheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Checkout Details</Text>
              <TouchableOpacity
                onPress={() => setCheckoutVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              {Boolean(checkoutError) && (
                <View style={styles.checkoutErrorBanner}>
                  <Feather name="alert-triangle" size={14} color="#EF4444" />
                  <Text style={styles.checkoutErrorText}>{checkoutError}</Text>
                </View>
              )}

              {/* Customer Profile Section */}
              <Text style={styles.formSectionHeader}>CUSTOMER PROFILE</Text>
              <View style={styles.formGridTwo}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>NAME *</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Customer Name"
                    placeholderTextColor="#A0AEC0"
                    value={custName}
                    onChangeText={(t) => { setCustName(t); if (checkoutError) setCheckoutError(null); }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>PHONE (10 DIGITS)</Text>
                  <View style={styles.phoneInputWrap}>
                    <TextInput
                      style={styles.phoneInput}
                      keyboardType="phone-pad"
                      placeholder="9876543210"
                      placeholderTextColor="#A0AEC0"
                      maxLength={10}
                      value={custPhone}
                      onChangeText={(t) => { handlePhoneChange(t); if (checkoutError) setCheckoutError(null); }}
                    />
                    {Boolean(phoneMatched) && (
                      <Feather name="check-circle" size={16} color="#22C55E" />
                    )}
                  </View>
                </View>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.formLabel}>ADDRESS / LOCATION</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Sector 15, Noida"
                  placeholderTextColor="#A0AEC0"
                  value={custAddress}
                  onChangeText={setCustAddress}
                />
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.formLabel}>GSTIN (OPTIONAL)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. 09AAAAA1111A1Z1"
                  placeholderTextColor="#A0AEC0"
                  maxLength={15}
                  autoCapitalize="characters"
                  value={custGst}
                  onChangeText={(t) => { setCustGst(t.toUpperCase()); if (checkoutError) setCheckoutError(null); }}
                />
              </View>

              {/* Payment Method */}
              <Text style={styles.formSectionHeader}>PAYMENT METHOD</Text>
              <View style={styles.paymentMethodGrid}>
                {(['cash', 'card', 'upi', 'credit'] as PaymentMethod[]).map(pm => (
                  <TouchableOpacity
                    key={pm}
                    style={[styles.pmPill, paymentMethod === pm && styles.pmPillActive]}
                    onPress={() => setPaymentMethod(pm)}
                  >
                    <Text style={[styles.pmText, paymentMethod === pm && styles.pmTextActive]}>
                      {pm.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Transaction Ref / Credit Details */}
              {(paymentMethod === 'card' || paymentMethod === 'upi') && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.formLabel}>TRANSACTION / UPI REF</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. UPI-10492810"
                    placeholderTextColor="#A0AEC0"
                    value={txnRef}
                    onChangeText={setTxnRef}
                  />
                </View>
              )}

              {paymentMethod === 'credit' && (
                <View style={styles.creditBox}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#6D28D9', marginBottom: 8 }}>
                    KHATABOOK DEBTOR RECORD
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>DEPOSIT PAID (₹)</Text>
                      <TextInput
                        style={styles.formInput}
                        keyboardType="numeric"
                        placeholder="0"
                        value={creditDeposit}
                        onChangeText={(t) => { setCreditDeposit(t); if (checkoutError) setCheckoutError(null); }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>DUE DATE (YYYY-MM-DD)</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="2026-09-30"
                        placeholderTextColor="#A0AEC0"
                        value={creditDueDate}
                        onChangeText={(t) => { setCreditDueDate(t); if (checkoutError) setCheckoutError(null); }}
                      />
                    </View>
                  </View>
                  <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 8 }}>
                    Net Debt Added to Customer Ledger: <Text style={{ fontWeight: 'bold', color: '#EF4444' }}>₹{netCreditDebt.toLocaleString('en-IN')}</Text>
                  </Text>
                </View>
              )}

              {/* Loading & Fulfillment Section */}
              <View style={{ marginTop: 24, padding: 16, backgroundColor: '#F8F6FF', borderRadius: 12, borderWidth: 1, borderColor: '#E9D5FF' }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#6D28D9', marginBottom: 12 }}>LOADING & DISPATCH</Text>

                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: requiresLoading ? 16 : 0 }}
                  onPress={() => setRequiresLoading(!requiresLoading)}
                  activeOpacity={0.7}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: requiresLoading ? '#7C3AED' : '#D1D5DB', backgroundColor: requiresLoading ? '#7C3AED' : 'transparent', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                    {requiresLoading && <Feather name="check" size={14} color="#FFF" />}
                  </View>
                  <Text style={{ fontSize: 14, color: '#1A1A2E', fontWeight: '500' }}>Requires Loading / Dispatch?</Text>
                </TouchableOpacity>

                {requiresLoading && (
                  <View>
                    <Text style={styles.formLabel}>ASSIGN STAFF (OPTIONAL)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <TouchableOpacity
                        style={[styles.pmPill, assignedTo === '' && styles.pmPillActive, { paddingVertical: 8, paddingHorizontal: 12 }]}
                        onPress={() => setAssignedTo('')}
                      >
                        <Text style={[styles.pmText, assignedTo === '' && styles.pmTextActive]}>Unassigned</Text>
                      </TouchableOpacity>
                      {shopStaff.map(staff => (
                        <TouchableOpacity
                          key={staff.id}
                          style={[styles.pmPill, assignedTo === staff.id && styles.pmPillActive, { paddingVertical: 8, paddingHorizontal: 12 }]}
                          onPress={() => setAssignedTo(staff.id)}
                        >
                          <Text style={[styles.pmText, assignedTo === staff.id && styles.pmTextActive]}>
                            {staff.full_name || staff.email?.split('@')[0]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>

            </ScrollView>

            <TouchableOpacity
              style={[styles.checkoutConfirmBtn, isSubmitting && { opacity: 0.6 }]}
              onPress={handleFinalizeInvoice}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#7C3AED', '#9333EA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.checkoutConfirmGrad}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Feather name="check-circle" size={16} color="#FFF" />
                    <Text style={styles.checkoutConfirmText}>
                      Confirm &amp; Generate Invoice (₹{grandTotal.toLocaleString('en-IN')})
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Success Modal ── */}
      <Modal
        visible={successModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.checkoutSheet, { borderRadius: 28, alignItems: 'center', paddingVertical: 32 }]}>
            <View style={styles.successBadgeCircle}>
              <Feather name="check" size={36} color="#FFF" />
            </View>

            <Text style={styles.successModalTitle}>Invoice Generated!</Text>
            <Text style={styles.successModalSub}>
              Invoice #{lastInvoice?.invoiceId} has been created & saved.
            </Text>

            <View style={styles.successModalCard}>
              <Text style={styles.successModalRow}>Customer: <Text style={{ fontWeight: 'bold' }}>{lastInvoice?.customerName}</Text></Text>
              <Text style={styles.successModalRow}>Total Amount: <Text style={{ fontWeight: 'bold', color: '#7C3AED' }}>₹{lastInvoice?.total?.toLocaleString('en-IN')}</Text></Text>
              <Text style={styles.successModalRow}>Payment: <Text style={{ fontWeight: 'bold' }}>{lastInvoice?.paymentMethod?.toUpperCase()}</Text></Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={() => handleShareOrPrintInvoice(lastInvoice)}
              >
                <Feather name="share-2" size={14} color="#7C3AED" />
                <Text style={styles.shareBtnText}>Share Receipt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.doneBtn}
                onPress={() => setSuccessModalVisible(false)}
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Clear Cart Confirmation Modal */}
      <Modal visible={clearCartModalVisible} transparent animationType="fade" onRequestClose={() => setClearCartModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.checkoutSheet, { borderRadius: 24, padding: 20 }]}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Feather name="trash-2" size={24} color="#EF4444" />
              </View>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' }}>Clear Shopping Cart?</Text>
              <Text style={{ fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 4 }}>
                This will remove all items from your current cart.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#F3F4F6', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }} onPress={() => setClearCartModalVisible(false)}>
                <Text style={{ color: '#6B7280', fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#EF4444', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }} onPress={handleClearCart}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Clear Cart</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Mobile-First Product Search Modal ── */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <SafeAreaView style={styles.searchModalContainer} edges={['top', 'bottom']}>
          {/* Pinned Search Header */}
          <View style={styles.searchModalHeader}>
            <TouchableOpacity
              onPress={() => setSearchModalVisible(false)}
              style={styles.searchModalBackBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="arrow-left" size={20} color="#1E293B" />
            </TouchableOpacity>

            <View style={styles.searchModalInputWrap}>
              <Feather name="search" size={16} color="#7C3AED" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchModalInput}
                placeholder="Search tile name, brand, or size..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                  <Feather name="x-circle" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Size Filter Pills Bar */}
          <View style={styles.searchModalFilterBar}>
            <Text style={styles.filterBarLabel}>Filter by Size:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsScroll}>
              {['all', '12x18', '2x2', '2x4'].map(sz => (
                <TouchableOpacity
                  key={sz}
                  style={[styles.sizeChip, sizeFilter === sz && styles.sizeChipActive]}
                  onPress={() => setSizeFilter(sz)}
                >
                  <Text style={[styles.sizeChipText, sizeFilter === sz && styles.sizeChipTextActive]}>
                    {sz === 'all' ? 'All Sizes' : sz}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Search Results FlatList */}
          <FlatList
            data={searchResults}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.searchResultsContainer}
            ListEmptyComponent={
              <View style={styles.searchEmptyContainer}>
                <Feather name="inbox" size={40} color="#CBD5E1" />
                <Text style={styles.searchEmptyTitle}>No matching tiles found</Text>
                <Text style={styles.searchEmptySub}>Try a different keyword or select "All Sizes"</Text>
              </View>
            }
            renderItem={({ item: tile }) => {
              const inCartCount = cart
                .filter(c => c.tileId === tile.id)
                .reduce((sum, c) => sum + c.boxes, 0);

              const prices = tile.variants.map(v => v.pricePerBox);
              const minPrice = Math.min(...prices);
              const maxPrice = Math.max(...prices);
              const priceStr = minPrice === maxPrice ? `₹${minPrice}` : `₹${minPrice} - ₹${maxPrice}`;

              const totalStock = tile.is12x18
                ? tile.variants.reduce((sum, v) => sum + v.stock, 0)
                : tile.variants[0]?.stock || 0;

              return (
                <TouchableOpacity
                  style={[styles.tileCardModal, inCartCount > 0 && styles.tileCardModalInCart]}
                  activeOpacity={0.75}
                  onPress={() => handleAddTileToCart(tile, undefined, true)}
                >
                  <View style={[styles.tileSwatchLarge, { backgroundColor: tile.variants[0]?.color || '#7C3AED' }]} />

                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={styles.tileCardModalName}>{tile.name}</Text>
                      <View style={styles.tileBrandBadge}>
                        <Text style={styles.tileBrandBadgeText}>{tile.brand}</Text>
                      </View>
                    </View>

                    <Text style={styles.tileCardModalSpecs}>
                      {tile.size} · {tile.sqftPerBox} sqft/box
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <Text style={[styles.stockStatusText, totalStock === 0 && { color: '#EF4444' }]}>
                        {totalStock > 0 ? `📦 In Stock: ${totalStock} bx` : '⚠️ Out of Stock'}
                      </Text>
                      {tile.is12x18 && (
                        <View style={styles.multiVariantBadge}>
                          <Text style={styles.multiVariantBadgeText}>3 Variants</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <Text style={styles.tileCardModalPrice}>{priceStr}/bx</Text>

                    {inCartCount > 0 ? (
                      <View style={styles.inCartIndicator}>
                        <Feather name="check" size={11} color="#166534" />
                        <Text style={styles.inCartIndicatorText}>{inCartCount} in cart</Text>
                      </View>
                    ) : (
                      <View style={styles.addBtnModal}>
                        <Feather name="plus" size={13} color="#FFF" />
                        <Text style={styles.addBtnModalText}>Add</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* Sticky Bottom Bar Showing Cart Overview */}
          <View style={styles.searchModalFooter}>
            <View>
              <Text style={styles.footerCartLabel}>Cart Total ({cart.length} items)</Text>
              <Text style={styles.footerCartAmount}>₹{rawSubtotal.toLocaleString('en-IN')}</Text>
            </View>
            <TouchableOpacity
              style={styles.doneSearchBtn}
              onPress={() => setSearchModalVisible(false)}
            >
              <Text style={styles.doneSearchBtnText}>View Cart ({cart.reduce((s, i) => s + i.boxes, 0)} boxes)</Text>
              <Feather name="arrow-right" size={14} color="#FFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  header: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 20 },
  safeHeader: { paddingHorizontal: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  logoText: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  logoDot: { color: '#C084FC' },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  logoutBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  pageTitleRow: { marginTop: 12 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  backLinkText: { fontSize: 11, color: '#D8B4FE', fontWeight: '600' },
  pageSubtitle: { fontSize: 11, color: '#DDD6FE', fontWeight: '700', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 4 },
  linkedEstimateSub: { fontSize: 11, color: '#D8B4FE', marginTop: 2 },
  modeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  modeBadgeLinked: { backgroundColor: 'rgba(255,255,255,0.25)' },
  modeBadgeAdhoc: { backgroundColor: 'rgba(0,0,0,0.2)' },
  modeBadgeText: { fontSize: 10, fontWeight: 'bold' },
  modeBadgeTextLinked: { color: '#FFF' },
  modeBadgeTextAdhoc: { color: '#E9D5FF' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  innerContent: { paddingHorizontal: 16, paddingTop: 14 },
  searchCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', marginBottom: 16, boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  cardSectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  cardSectionSub: { fontSize: 10, color: '#A0AEC0' },
  searchInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, height: 42, marginTop: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },
  searchDropdown: { backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E9D5FF', marginTop: 8, overflow: 'hidden' },
  emptySearch: { padding: 12, alignItems: 'center' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  tileSwatchSmall: { width: 28, height: 28, borderRadius: 6 },
  tileResultName: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  tileResultBrand: { fontSize: 10, color: '#7C3AED', fontWeight: '500' },
  tileResultSpecs: { fontSize: 9, color: '#A0AEC0' },
  tileResultPrice: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  cartHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 4 },
  cartHeaderTitle: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  clearCartBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearCartText: { fontSize: 11, color: '#EF4444', fontWeight: '600' },
  emptyCartCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: '#F3E8FF', marginBottom: 16 },
  emptyCartIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  emptyCartTitle: { fontSize: 15, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  emptyCartSub: { fontSize: 11, color: '#A0AEC0', textAlign: 'center', lineHeight: 16 },
  cartList: { gap: 10, marginBottom: 16 },
  cartItemCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#F3E8FF', gap: 10 },
  cartItemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cartItemSwatch: { width: 36, height: 36, borderRadius: 8 },
  cartItemName: { fontSize: 13, fontWeight: 'bold', color: '#1A1A2E' },
  cartItemBrand: { fontSize: 10, color: '#A0AEC0' },
  cartItemPrice: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED', marginTop: 2 },
  cartItemDeleteBtn: { padding: 4 },
  cartItemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F8F6FF', paddingTop: 8 },
  qtyCounter: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 8, padding: 2, gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  qtyText: { fontSize: 11, fontWeight: 'bold', color: '#1A1A2E', paddingHorizontal: 4 },
  cartItemSubtotal: { fontSize: 14, fontWeight: '800', color: '#1A1A2E' },
  calcSummaryCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#F3E8FF', marginBottom: 16, gap: 10 },
  calcSummaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  calcSummaryLabel: { fontSize: 12, color: '#6B7280' },
  calcSummaryVal: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  discountInput: { backgroundColor: '#F8F6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: 'bold', color: '#7C3AED', width: 80, textAlign: 'right' },
  gstCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8F6FF',
    borderRadius: 12,
    padding: 10,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#A0AEC0',
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  gstCheckboxLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  gstCheckboxSub: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 1,
  },
  gstToggleRow: { flexDirection: 'row', backgroundColor: '#F8F6FF', borderRadius: 10, padding: 2, gap: 4 },
  gstToggleBtn: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 8 },
  gstToggleActive: { backgroundColor: '#7C3AED' },
  gstToggleText: { fontSize: 10, fontWeight: 'bold', color: '#6B7280' },
  gstToggleTextActive: { color: '#FFF' },
  calcSummaryDivider: { height: 1, backgroundColor: '#F3F4F6' },
  calcGrandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calcGrandLabel: { fontSize: 14, fontWeight: '800', color: '#1A1A2E' },
  calcGrandSub: { fontSize: 10, color: '#A0AEC0' },
  calcGrandVal: { fontSize: 20, fontWeight: '800', color: '#7C3AED' },
  checkoutBtn: { borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  checkoutGrad: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, gap: 8 },
  checkoutText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  checkoutSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '88%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  checkoutErrorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderLeftWidth: 3, borderLeftColor: '#EF4444', padding: 10, borderRadius: 8, marginBottom: 12 },
  checkoutErrorText: { fontSize: 12, color: '#DC2626', fontWeight: '600', flex: 1 },
  formSectionHeader: { fontSize: 9, fontWeight: 'bold', color: '#7C3AED', letterSpacing: 1.2, marginTop: 14, marginBottom: 8 },
  formGridTwo: { flexDirection: 'row', gap: 10 },
  formLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', marginBottom: 4 },
  formInput: { backgroundColor: '#F8F6FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: '#1A1A2E', fontWeight: '500' },
  phoneInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 10, paddingRight: 10 },
  phoneInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: '#1A1A2E', fontWeight: '500' },
  paymentMethodGrid: { flexDirection: 'row', gap: 8 },
  pmPill: { flex: 1, paddingVertical: 10, backgroundColor: '#F8F6FF', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  pmPillActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  pmText: { fontSize: 11, fontWeight: 'bold', color: '#6B7280' },
  pmTextActive: { color: '#FFF' },
  creditBox: { backgroundColor: '#FAF5FF', borderRadius: 14, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#E9D5FF' },
  checkoutConfirmBtn: { borderRadius: 14, overflow: 'hidden', marginTop: 16 },
  checkoutConfirmGrad: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, gap: 8 },
  checkoutConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  successBadgeCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  successModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1A1A2E' },
  successModalSub: { fontSize: 12, color: '#6B7280', marginTop: 4, marginBottom: 20 },
  successModalCard: { width: '100%', backgroundColor: '#F8F6FF', borderRadius: 16, padding: 16, gap: 8 },
  successModalRow: { fontSize: 12, color: '#4B5563' },
  shareBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAF5FF', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: '#E9D5FF', gap: 6 },
  shareBtnText: { color: '#7C3AED', fontWeight: 'bold', fontSize: 13 },
  doneBtn: { flex: 1, backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },

  // Mobile-Friendly Search Trigger Bar
  searchFakeInputText: { flex: 1, fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  searchPillBadge: { backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  searchPillBadgeText: { fontSize: 10, fontWeight: '700', color: '#7C3AED' },
  searchFilterIconWrap: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#FAF5FF', alignItems: 'center', justifyContent: 'center' },
  filterChipsRowInline: { flexDirection: 'row', gap: 6, marginTop: 10 },
  sizeChipSmall: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  sizeChipSmallActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  sizeChipTextSmall: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  sizeChipTextSmallActive: { color: '#FFF' },

  // Mobile-First Search Modal
  searchModalContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 10 },
  searchModalBackBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  searchModalInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: '#DDD6FE', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchModalInput: { flex: 1, fontSize: 14, color: '#0F172A', fontWeight: '500', padding: 0 },
  searchModalFilterBar: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  filterBarLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 6 },
  filterChipsScroll: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  sizeChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  sizeChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  sizeChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  sizeChipTextActive: { color: '#FFF' },

  searchResultsContainer: { padding: 16, gap: 12, paddingBottom: 100 },
  searchEmptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8 },
  searchEmptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155' },
  searchEmptySub: { fontSize: 12, color: '#94A3B8', textAlign: 'center', maxWidth: 260 },

  tileCardModal: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  tileCardModalInCart: { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' },
  tileSwatchLarge: { width: 44, height: 44, borderRadius: 10, marginRight: 12 },
  tileCardModalName: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  tileBrandBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4 },
  tileBrandBadgeText: { fontSize: 9, fontWeight: '700', color: '#475569' },
  tileCardModalSpecs: { fontSize: 11, color: '#64748B', marginTop: 2 },
  stockStatusText: { fontSize: 10, fontWeight: '700', color: '#16A34A' },
  multiVariantBadge: { backgroundColor: '#EDE9FE', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  multiVariantBadgeText: { fontSize: 9, fontWeight: '700', color: '#7C3AED' },
  tileCardModalPrice: { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  inCartIndicator: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  inCartIndicatorText: { fontSize: 10, fontWeight: '800', color: '#166534' },
  addBtnModal: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#7C3AED', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, marginTop: 6 },
  addBtnModalText: { fontSize: 11, fontWeight: '700', color: '#FFF' },

  searchModalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 4 },
  footerCartLabel: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  footerCartAmount: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  doneSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7C3AED', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  doneSearchBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  // Direct Quantity Input in Cart
  qtyInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, minWidth: 64, justifyContent: 'center' },
  qtyInput: { fontSize: 13, fontWeight: '800', color: '#0F172A', textAlign: 'center', minWidth: 26, padding: 0 },
  qtyUnitLabel: { fontSize: 11, fontWeight: '600', color: '#64748B', marginLeft: 2 },
});
