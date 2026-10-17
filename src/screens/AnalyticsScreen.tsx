import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  RefreshControl,
  Share,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { billingService } from '../services/billing';
import { catalogService } from '../services/catalog';
import { TileCollection } from '../types/tiles';
import { AnalyticsSkeleton } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface InvoiceItem {
  name: string;
  variantLabel?: string;
  brand: string;
  size: string;
  boxes: number;
  pricePerBox?: number;
  total: number;
  tileId?: string;
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
  creditDetail: CreditDetail | null;
  txnRef?: string;
  createdByName?: string;
}

interface AnalyticsScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

type AnalyticsCategory = 'sales' | 'products' | 'customers';
type TimeRange = 'all' | 'this_month' | '30d' | '7d';
type ProductInsightFilter = 'all' | 'best_sellers' | 'slow_moving' | 'low_stock' | 'zero_sales';
type CustomerInsightFilter = 'all' | 'vip' | 'frequent' | 'dormant';
type ProductSort = 'revenue' | 'volume' | 'stock';
type CustomerSort = 'spend' | 'orders' | 'recent';

const PAGE_SIZE = 9;

// ─── Memoized Cards ──────────────────────────────────────────────────────────

interface ProductAnalyticsCardProps {
  product: any;
  onPress: (product: any) => void;
}

const ProductAnalyticsCard = React.memo<ProductAnalyticsCardProps>(({ product: p, onPress }) => {
  const stockColor = p.currentStock === 0 ? '#EF4444' : p.currentStock <= 20 ? '#F59E0B' : '#10B981';
  return (
    <TouchableOpacity
      style={styles.performanceCard}
      onPress={() => onPress(p)}
      activeOpacity={0.7}
    >
      <View style={styles.perfTopRow}>
        <View style={[styles.productSwatchSquare, { backgroundColor: p.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.perfTitle}>{p.name}</Text>
          <Text style={styles.perfSubtitle}>{p.brand} • {p.size}</Text>
        </View>
        <View style={[styles.stockPill, { borderColor: stockColor }]}>
          <Text style={[styles.stockPillText, { color: stockColor }]}>
            {p.currentStock} bx left
          </Text>
        </View>
      </View>

      <View style={styles.perfMetricsRow}>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>BOXES SOLD</Text>
          <Text style={styles.perfMetricVal}>{p.boxesSold} bx</Text>
        </View>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>SALES REVENUE</Text>
          <Text style={[styles.perfMetricVal, { color: '#7C3AED' }]}>₹{p.revenue.toLocaleString('en-IN')}</Text>
        </View>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>AVG PRICE/BX</Text>
          <Text style={styles.perfMetricVal}>₹{p.avgPrice}</Text>
        </View>
      </View>

      <View style={styles.perfFooterRow}>
        <Text style={styles.perfActionText}>Tap to view variant distribution &amp; buyers →</Text>
      </View>
    </TouchableOpacity>
  );
});
ProductAnalyticsCard.displayName = 'ProductAnalyticsCard';

interface CustomerAnalyticsCardProps {
  customer: any;
  timeRange: TimeRange;
  onPress: (customer: any) => void;
}

const CustomerAnalyticsCard = React.memo<CustomerAnalyticsCardProps>(({ customer: c, timeRange, onPress }) => {
  const isVip = c.status === 'VIP';
  const isRepeat = c.status === 'Repeat';
  const spendDisplay = timeRange === 'all' ? c.lifetimeSpend : c.periodSpend;
  const ordersDisplay = timeRange === 'all' ? c.lifetimeOrders : c.periodOrders;

  return (
    <TouchableOpacity
      style={styles.performanceCard}
      onPress={() => onPress(c)}
      activeOpacity={0.7}
    >
      <View style={styles.perfTopRow}>
        <View style={[styles.avatarCircle, isVip ? { backgroundColor: '#FEF3C7' } : {}]}>
          <Text style={[styles.avatarText, isVip ? { color: '#D97706' } : {}]}>
            {c.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.perfTitle}>{c.name}</Text>
          <Text style={styles.perfSubtitle}>{c.phone || 'No Phone'}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          isVip ? styles.badgeVip : isRepeat ? styles.badgeRepeat : styles.badgeNew
        ]}>
          <Text style={[
            styles.statusBadgeText,
            isVip ? { color: '#D97706' } : isRepeat ? { color: '#7C3AED' } : { color: '#059669' }
          ]}>
            {c.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.perfMetricsRow}>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>TOTAL SPENT</Text>
          <Text style={[styles.perfMetricVal, { color: '#7C3AED' }]}>₹{spendDisplay.toLocaleString('en-IN')}</Text>
        </View>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>ORDERS</Text>
          <Text style={styles.perfMetricVal}>{ordersDisplay} orders</Text>
        </View>
        <View style={styles.perfMetricCol}>
          <Text style={styles.perfMetricLbl}>LAST VISIT</Text>
          <Text style={styles.perfMetricVal}>
            {new Date(c.lastDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </View>

      <View style={styles.perfFooterRow}>
        <Text style={styles.perfActionText}>Tap to view complete purchase history &amp; khata →</Text>
      </View>
    </TouchableOpacity>
  );
});
CustomerAnalyticsCard.displayName = 'CustomerAnalyticsCard';

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [catalog, setCatalog] = useState<TileCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active Category & Time Filter
  const [category, setCategory] = useState<AnalyticsCategory>('sales');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  // Search, Filters & Pagination for Products
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebouncedValue(productSearch, 200);
  const [productInsightFilter, setProductInsightFilter] = useState<ProductInsightFilter>('all');
  const [productSort, setProductSort] = useState<ProductSort>('revenue');
  const [productPage, setProductPage] = useState(1);

  // Search, Filters & Pagination for Customers
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 200);
  const [customerInsightFilter, setCustomerInsightFilter] = useState<CustomerInsightFilter>('all');
  const [customerSort, setCustomerSort] = useState<CustomerSort>('spend');
  const [customerPage, setCustomerPage] = useState(1);

  // Drill-down Modals
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Searchable Quick-Picker Modals
  const [productPickerVisible, setProductPickerVisible] = useState(false);
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const debouncedPickerSearch = useDebouncedValue(pickerSearch, 150);

  const handleSelectProduct = useCallback((p: any) => setSelectedProduct(p), []);
  const handleSelectCustomer = useCallback((c: any) => setSelectedCustomer(c), []);

  // Reset pagination when search, filters, or date range changes
  useEffect(() => {
    setProductPage(1);
  }, [productInsightFilter, debouncedProductSearch, productSort, timeRange]);

  useEffect(() => {
    setCustomerPage(1);
  }, [customerInsightFilter, debouncedCustomerSearch, customerSort, timeRange]);

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [fetchedInvoices, fetchedCatalog] = await Promise.all([
        billingService.fetchInvoices(session.shop_id),
        catalogService.fetchCatalog(session.shop_id),
      ]);
      setInvoices(fetchedInvoices);
      setCatalog(fetchedCatalog);
    } catch (err) {
      console.warn('[AnalyticsScreen] Error loading analytics data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.shop_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ─── Time Range Filtering ──────────────────────────────────────────────────

  const filteredInvoices = useMemo(() => {
    const now = new Date();
    let threshold: Date | null = null;

    if (timeRange === '7d') {
      threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === '30d') {
      threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'this_month') {
      threshold = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    return invoices.filter(inv => {
      if (inv.isVoided) return false;
      if (!threshold) return true;
      return new Date(inv.date) >= threshold;
    });
  }, [invoices, timeRange]);

  const allValidInvoices = useMemo(() => invoices.filter(inv => !inv.isVoided), [invoices]);

  // ─── 1. Sales Overview Computations ────────────────────────────────────────

  const salesData = useMemo(() => {
    let revenue = 0;
    let gst = 0;
    let cash = 0;
    let upi = 0;
    let card = 0;
    let credit = 0;
    let totalBoxes = 0;

    filteredInvoices.forEach(inv => {
      revenue += inv.total;
      gst += inv.gst || 0;
      totalBoxes += inv.items.reduce((sum, item) => sum + item.boxes, 0);

      if (inv.paymentMethod === 'cash') cash += inv.total;
      else if (inv.paymentMethod === 'upi') upi += inv.total;
      else if (inv.paymentMethod === 'card') card += inv.total;
      else if (inv.paymentMethod === 'credit') credit += inv.total;
    });

    const aov = filteredInvoices.length > 0 ? revenue / filteredInvoices.length : 0;
    const upt = filteredInvoices.length > 0 ? totalBoxes / filteredInvoices.length : 0;

    return {
      revenue,
      aov,
      upt,
      cash,
      upi,
      card,
      credit,
      gst,
      orderCount: filteredInvoices.length,
      totalBoxes,
    };
  }, [filteredInvoices]);

  // ─── 2. Product Analytics Computations ─────────────────────────────────────

  const productsData = useMemo(() => {
    // Map of sales aggregated per product name / brand
    const salesMap: Record<
      string,
      {
        boxesSold: number;
        revenue: number;
        invoicesCount: number;
        lastSoldDate?: string;
      }
    > = {};

    filteredInvoices.forEach(inv => {
      inv.items.forEach(item => {
        const key = item.name.trim();
        if (!salesMap[key]) {
          salesMap[key] = {
            boxesSold: 0,
            revenue: 0,
            invoicesCount: 0,
            lastSoldDate: inv.date,
          };
        }

        const p = salesMap[key];
        p.boxesSold += item.boxes;
        p.revenue += item.total;
        p.invoicesCount += 1;
      });
    });

    // Build unified product list joining catalog items + any historical invoice items
    const catalogNames = new Set<string>();
    const unifiedList: any[] = [];

    catalog.forEach(col => {
      catalogNames.add(col.name.trim());
      const sales = salesMap[col.name.trim()] || {
        boxesSold: 0,
        revenue: 0,
        invoicesCount: 0,
      };

      const currentStock = col.variants.reduce((s, v) => s + (v.stock || 0), 0);
      const avgPrice = sales.boxesSold > 0 ? Math.round(sales.revenue / sales.boxesSold) : (col.variants[0]?.pricePerBox || 0);

      unifiedList.push({
        id: col.id,
        name: col.name,
        brand: col.brand,
        size: col.size,
        sqftPerBox: col.sqftPerBox,
        color: col.variants[0]?.color || '#93C5FD',
        accent: col.variants[0]?.accent || '#3B82F6',
        currentStock,
        catalogVariants: col.variants,
        boxesSold: sales.boxesSold,
        revenue: sales.revenue,
        avgPrice,
        invoicesCount: sales.invoicesCount,
        isLowStock: currentStock <= 20,
        isZeroStock: currentStock === 0,
        isZeroSales: sales.boxesSold === 0,
      });
    });

    // Also include any invoice products not present in catalog
    Object.keys(salesMap).forEach(pName => {
      if (!catalogNames.has(pName)) {
        const sales = salesMap[pName];
        unifiedList.push({
          id: pName,
          name: pName,
          brand: 'Standard',
          size: '12×18',
          sqftPerBox: 12,
          color: '#E2E8F0',
          accent: '#94A3B8',
          currentStock: 0,
          catalogVariants: [],
          boxesSold: sales.boxesSold,
          revenue: sales.revenue,
          avgPrice: sales.boxesSold > 0 ? Math.round(sales.revenue / sales.boxesSold) : 0,
          invoicesCount: sales.invoicesCount,
          isLowStock: true,
          isZeroStock: true,
          isZeroSales: false,
        });
      }
    });

    // Summary calculations
    const totalProductsSoldBoxes = unifiedList.reduce((sum, p) => sum + p.boxesSold, 0);
    const totalProductsRevenue = unifiedList.reduce((sum, p) => sum + p.revenue, 0);

    const sortedByVolume = [...unifiedList].sort((a, b) => b.boxesSold - a.boxesSold);
    const bestSeller = sortedByVolume[0]?.boxesSold > 0 ? sortedByVolume[0] : null;
    const lowStockCount = unifiedList.filter(p => p.currentStock <= 20).length;

    // Insight groupings
    const bestSellersList = sortedByVolume.filter(p => p.boxesSold > 0).slice(0, 8);
    const slowMovingList = [...unifiedList]
      .filter(p => p.boxesSold > 0 && p.boxesSold <= 15)
      .sort((a, b) => a.boxesSold - b.boxesSold);
    const lowStockList = unifiedList.filter(p => p.currentStock <= 20);
    const zeroSalesList = unifiedList.filter(p => p.boxesSold === 0);

    return {
      allProducts: unifiedList,
      totalProductsSoldBoxes,
      totalProductsRevenue,
      bestSeller,
      lowStockCount,
      bestSellersList,
      slowMovingList,
      lowStockList,
      zeroSalesList,
    };
  }, [catalog, filteredInvoices]);

  // Filtered and Sorted Products List
  const displayedProducts = useMemo(() => {
    let list = [...productsData.allProducts];

    // Insight Filter
    if (productInsightFilter === 'best_sellers') {
      list = list.filter(p => p.boxesSold > 0).sort((a, b) => b.boxesSold - a.boxesSold);
    } else if (productInsightFilter === 'slow_moving') {
      list = list.filter(p => p.boxesSold > 0 && p.boxesSold <= 20).sort((a, b) => a.boxesSold - b.boxesSold);
    } else if (productInsightFilter === 'low_stock') {
      list = list.filter(p => p.currentStock <= 20).sort((a, b) => a.currentStock - b.currentStock);
    } else if (productInsightFilter === 'zero_sales') {
      list = list.filter(p => p.boxesSold === 0);
    }

    // Search
    if (debouncedProductSearch.trim()) {
      const q = debouncedProductSearch.toLowerCase().trim();
      list = list.filter(
        p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.size.toLowerCase().includes(q)
      );
    }

    // Sort
    if (productSort === 'revenue') {
      list.sort((a, b) => b.revenue - a.revenue);
    } else if (productSort === 'volume') {
      list.sort((a, b) => b.boxesSold - a.boxesSold);
    } else if (productSort === 'stock') {
      list.sort((a, b) => a.currentStock - b.currentStock);
    }

    return list;
  }, [productsData.allProducts, productInsightFilter, debouncedProductSearch, productSort]);

  const totalProductPages = Math.max(1, Math.ceil(displayedProducts.length / PAGE_SIZE));
  const paginatedProducts = useMemo(() => {
    const page = Math.min(productPage, totalProductPages);
    const start = (page - 1) * PAGE_SIZE;
    return displayedProducts.slice(start, start + PAGE_SIZE);
  }, [displayedProducts, productPage, totalProductPages]);

  // ─── 3. Customer Analytics Computations ────────────────────────────────────

  const customersData = useMemo(() => {
    // 1. First build lifetime profile for all customers
    const lifetimeMap = new Map<
      string,
      {
        name: string;
        phone: string;
        firstDate: string;
        lastDate: string;
        lifetimeSpend: number;
        lifetimeBoxes: number;
        lifetimeOrders: number;
        totalDebt: number;
      }
    >();

    allValidInvoices.forEach(inv => {
      const phone = inv.customerPhone?.trim() || inv.customerName?.trim() || 'Unknown';
      if (!lifetimeMap.has(phone)) {
        lifetimeMap.set(phone, {
          name: inv.customerName || 'Customer',
          phone: inv.customerPhone || 'N/A',
          firstDate: inv.date,
          lastDate: inv.date,
          lifetimeSpend: 0,
          lifetimeBoxes: 0,
          lifetimeOrders: 0,
          totalDebt: 0,
        });
      }

      const c = lifetimeMap.get(phone)!;
      c.lifetimeSpend += inv.total;
      c.lifetimeOrders += 1;

      const invBoxes = inv.items.reduce((s, it) => s + it.boxes, 0);
      c.lifetimeBoxes += invBoxes;

      if (new Date(inv.date) < new Date(c.firstDate)) c.firstDate = inv.date;
      if (new Date(inv.date) > new Date(c.lastDate)) c.lastDate = inv.date;

      if (inv.creditDetail && inv.paymentMethod === 'credit') {
        c.totalDebt += inv.creditDetail.debt;
      }
    });

    // 2. Compute metrics for the active filtered period
    const activePeriodPhones = new Set<string>();
    const periodSpendMap = new Map<string, { spend: number; orders: number; boxes: number }>();

    filteredInvoices.forEach(inv => {
      const phone = inv.customerPhone?.trim() || inv.customerName?.trim() || 'Unknown';
      activePeriodPhones.add(phone);

      const cur = periodSpendMap.get(phone) || { spend: 0, orders: 0, boxes: 0 };
      cur.spend += inv.total;
      cur.orders += 1;
      cur.boxes += inv.items.reduce((s, it) => s + it.boxes, 0);
      periodSpendMap.set(phone, cur);
    });

    const periodThresholdTime = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === 'this_month' ? 30 : 0;
    const nowTime = new Date().getTime();

    // Assemble customer items
    const customerList: any[] = [];
    let periodNewCount = 0;
    let periodRepeatCount = 0;
    let periodTotalSpend = 0;

    lifetimeMap.forEach((c, phone) => {
      const periodData = periodSpendMap.get(phone);
      const isPeriodActive = Boolean(periodData);

      // Determine New vs Repeat status relative to period
      const firstInvoiceDate = new Date(c.firstDate).getTime();
      const isNewInPeriod = periodThresholdTime > 0
        ? nowTime - firstInvoiceDate <= periodThresholdTime * 24 * 60 * 60 * 1000
        : c.lifetimeOrders === 1;

      const isRepeat = c.lifetimeOrders > 1;

      // Days since last purchase
      const daysSinceLastPurchase = Math.floor((nowTime - new Date(c.lastDate).getTime()) / (1000 * 60 * 60 * 24));
      const isDormant = daysSinceLastPurchase >= 30;

      // Status Tag
      const status: 'VIP' | 'Repeat' | 'New' = c.lifetimeSpend >= 100000 ? 'VIP' : isRepeat ? 'Repeat' : 'New';

      if (isPeriodActive) {
        periodTotalSpend += periodData!.spend;
        if (isNewInPeriod) periodNewCount += 1;
        else periodRepeatCount += 1;
      }

      customerList.push({
        id: phone,
        name: c.name,
        phone: c.phone,
        periodSpend: periodData ? periodData.spend : 0,
        periodOrders: periodData ? periodData.orders : 0,
        periodBoxes: periodData ? periodData.boxes : 0,
        lifetimeSpend: c.lifetimeSpend,
        lifetimeOrders: c.lifetimeOrders,
        lifetimeBoxes: c.lifetimeBoxes,
        totalDebt: c.totalDebt,
        firstDate: c.firstDate,
        lastDate: c.lastDate,
        daysSinceLastPurchase,
        isDormant,
        status,
        isPeriodActive,
      });
    });

    const activeCustomersList = timeRange === 'all'
      ? customerList
      : customerList.filter(c => c.isPeriodActive);

    const totalUniqueCustomers = activeCustomersList.length;
    const avgSpending = totalUniqueCustomers > 0 ? periodTotalSpend / totalUniqueCustomers : 0;

    return {
      allCustomers: customerList,
      activeCustomers: activeCustomersList,
      totalUniqueCustomers,
      periodNewCount,
      periodRepeatCount,
      periodTotalSpend,
      avgSpending,
      vipList: [...customerList].filter(c => c.lifetimeSpend >= 100000).sort((a, b) => b.lifetimeSpend - a.lifetimeSpend),
      frequentList: [...customerList].filter(c => c.lifetimeOrders >= 3).sort((a, b) => b.lifetimeOrders - a.lifetimeOrders),
      dormantList: [...customerList].filter(c => c.isDormant).sort((a, b) => b.daysSinceLastPurchase - a.daysSinceLastPurchase),
    };
  }, [allValidInvoices, filteredInvoices, timeRange]);

  // Filtered and Sorted Customer List
  const displayedCustomers = useMemo(() => {
    let list = timeRange === 'all' ? [...customersData.allCustomers] : [...customersData.activeCustomers];

    // Insight Filter
    if (customerInsightFilter === 'vip') {
      list = list.filter(c => c.status === 'VIP' || c.lifetimeSpend >= 100000);
    } else if (customerInsightFilter === 'frequent') {
      list = list.filter(c => c.lifetimeOrders >= 3);
    } else if (customerInsightFilter === 'dormant') {
      list = list.filter(c => c.isDormant);
    }

    // Search
    if (debouncedCustomerSearch.trim()) {
      const q = debouncedCustomerSearch.toLowerCase().trim();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q));
    }

    // Sort
    if (customerSort === 'spend') {
      list.sort((a, b) => (timeRange === 'all' ? b.lifetimeSpend - a.lifetimeSpend : b.periodSpend - a.periodSpend));
    } else if (customerSort === 'orders') {
      list.sort((a, b) => (timeRange === 'all' ? b.lifetimeOrders - a.lifetimeOrders : b.periodOrders - a.periodOrders));
    } else if (customerSort === 'recent') {
      list.sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());
    }

    return list;
  }, [customersData, customerInsightFilter, debouncedCustomerSearch, customerSort, timeRange]);

  const totalCustomerPages = Math.max(1, Math.ceil(displayedCustomers.length / PAGE_SIZE));
  const paginatedCustomers = useMemo(() => {
    const page = Math.min(customerPage, totalCustomerPages);
    const start = (page - 1) * PAGE_SIZE;
    return displayedCustomers.slice(start, start + PAGE_SIZE);
  }, [displayedCustomers, customerPage, totalCustomerPages]);

  // ─── Lazy Drill-Down Derivations ───────────────────────────────────────────

  const selectedProductDetails = useMemo(() => {
    if (!selectedProduct) return { variantsSold: {} as Record<string, { boxes: number; revenue: number }>, buyers: [] as any[] };

    const targetName = selectedProduct.name.trim().toLowerCase();
    const variantsSold: Record<string, { boxes: number; revenue: number }> = {};
    const buyersMap: Record<string, { name: string; phone: string; boxes: number; spend: number }> = {};

    filteredInvoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.name.trim().toLowerCase() === targetName) {
          const vKey = item.variantLabel || 'Standard';
          if (!variantsSold[vKey]) {
            variantsSold[vKey] = { boxes: 0, revenue: 0 };
          }
          variantsSold[vKey].boxes += item.boxes;
          variantsSold[vKey].revenue += item.total;

          const bKey = inv.customerPhone || inv.customerName || 'Unknown';
          if (!buyersMap[bKey]) {
            buyersMap[bKey] = {
              name: inv.customerName,
              phone: inv.customerPhone,
              boxes: 0,
              spend: 0,
            };
          }
          buyersMap[bKey].boxes += item.boxes;
          buyersMap[bKey].spend += item.total;
        }
      });
    });

    const buyers = Object.values(buyersMap).sort((a, b) => b.boxes - a.boxes);

    return { variantsSold, buyers };
  }, [selectedProduct, filteredInvoices]);

  const selectedCustomerDetails = useMemo(() => {
    if (!selectedCustomer) return { favoriteProducts: [] as any[], allInvoices: [] as InvoiceRecord[] };

    const targetPhone = selectedCustomer.phone?.trim();
    const targetName = selectedCustomer.name?.trim().toLowerCase();

    const custInvoices = allValidInvoices.filter(inv => {
      const invPhone = inv.customerPhone?.trim();
      if (targetPhone && invPhone) {
        return invPhone === targetPhone;
      }
      return inv.customerName?.trim().toLowerCase() === targetName;
    });

    const allInvoices = [...custInvoices].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const productMap: Record<string, number> = {};
    custInvoices.forEach(inv => {
      inv.items.forEach(it => {
        productMap[it.name] = (productMap[it.name] || 0) + it.boxes;
      });
    });

    const favoriteProducts = Object.entries(productMap)
      .map(([name, boxes]) => ({ name, boxes }))
      .sort((a, b) => b.boxes - a.boxes);

    return { favoriteProducts, allInvoices };
  }, [selectedCustomer, allValidInvoices]);

  // ─── CSV Export ────────────────────────────────────────────────────────────

  const handleExportCSV = async () => {
    let header = '';
    let rows = '';
    let filename = '';

    if (category === 'sales') {
      filename = `Tilor_Sales_${timeRange}.csv`;
      header = 'Metric,Value\n';
      rows = [
        `Time Period,${timeRange}`,
        `Total Revenue,${salesData.revenue}`,
        `Order Count,${salesData.orderCount}`,
        `Total Boxes Sold,${salesData.totalBoxes}`,
        `Average Order Value (AOV),${salesData.aov.toFixed(2)}`,
        `Units Per Transaction (UPT),${salesData.upt.toFixed(2)}`,
        `GST Collected,${salesData.gst}`,
        `Cash Sales,${salesData.cash}`,
        `UPI Sales,${salesData.upi}`,
        `Card Sales,${salesData.card}`,
        `Credit Sales,${salesData.credit}`,
      ].join('\n');
    } else if (category === 'products') {
      filename = `Tilor_Products_${timeRange}.csv`;
      header = 'Product Name,Brand,Size,Boxes Sold,Sales Revenue,Avg Price/Box,Current Stock\n';
      rows = productsData.allProducts
        .sort((a, b) => b.revenue - a.revenue)
        .map(p => `"${p.name}","${p.brand}","${p.size}",${p.boxesSold},${p.revenue},${p.avgPrice},${p.currentStock}`)
        .join('\n');
    } else {
      filename = `Tilor_Customers_${timeRange}.csv`;
      header = 'Customer Name,Phone,Period Spend,Lifetime Spend,Total Orders,Last Purchase Date,Status\n';
      rows = customersData.allCustomers
        .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend)
        .map(c => `"${c.name}","${c.phone}",${c.periodSpend},${c.lifetimeSpend},${c.lifetimeOrders},"${c.lastDate}","${c.status}"`)
        .join('\n');
    }

    try {
      await Share.share({
        message: header + rows,
        title: filename,
      });
    } catch {
      Alert.alert('Error', 'Failed to generate CSV export.');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#7C3AED']} tintColor="#7C3AED" />}
      >
        {/* Header Banner */}
        <LinearGradient
          colors={['#6D28D9', '#7C3AED', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            <View style={styles.appBar}>
              <TouchableOpacity style={styles.backBtn} onPress={() => onTabChange('home')} activeOpacity={0.7}>
                <View style={styles.backIconCircle}>
                  <Feather name="arrow-left" size={16} color="#FFF" />
                </View>
                <Text style={styles.backBtnText}>Dashboard</Text>
              </TouchableOpacity>

              <View style={styles.appBarRight}>
                <TouchableOpacity style={styles.exportBtn} onPress={handleExportCSV} activeOpacity={0.8}>
                  <Feather name="download" size={13} color="#7C3AED" />
                  <Text style={styles.exportBtnText}>Export CSV</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.pageTitleContainer}>
              <View style={styles.pageSubtitleRow}>
                <Text style={styles.pageSubtitle}>BUSINESS INTELLIGENCE &amp; REPORTS</Text>
                <View style={styles.countBadge}>
                  <Feather name="activity" size={10} color="#EDE9FE" style={{ marginRight: 4 }} />
                  <Text style={styles.countBadgeText}>{filteredInvoices.length} orders analyzed</Text>
                </View>
              </View>
              <Text style={styles.pageTitle}>Analytics &amp; Reports</Text>
            </View>

            {/* Time Range Filter Bar (Applies globally to Sales, Products, Customers) */}
            <View style={styles.timeRangeBar}>
              {[
                { key: 'all', label: 'All Time' },
                { key: 'this_month', label: 'This Month' },
                { key: '30d', label: 'Last 30 Days' },
                { key: '7d', label: 'Last 7 Days' },
              ].map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.timeChip, timeRange === t.key && styles.timeChipActive]}
                  onPress={() => setTimeRange(t.key as TimeRange)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.timeChipText, timeRange === t.key && styles.timeChipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Main Category Tabs */}
            <View style={styles.tabsContainer}>
              <TouchableOpacity
                style={[styles.tabBtn, category === 'sales' && styles.tabBtnActive]}
                onPress={() => setCategory('sales')}
                activeOpacity={0.8}
              >
                <Feather name="trending-up" size={13} color={category === 'sales' ? '#7C3AED' : 'rgba(255,255,255,0.8)'} />
                <Text style={[styles.tabBtnText, category === 'sales' && styles.tabBtnTextActive]}>Sales</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, category === 'products' && styles.tabBtnActive]}
                onPress={() => setCategory('products')}
                activeOpacity={0.8}
              >
                <Feather name="box" size={13} color={category === 'products' ? '#7C3AED' : 'rgba(255,255,255,0.8)'} />
                <Text style={[styles.tabBtnText, category === 'products' && styles.tabBtnTextActive]}>Products</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, category === 'customers' && styles.tabBtnActive]}
                onPress={() => setCategory('customers')}
                activeOpacity={0.8}
              >
                <Feather name="users" size={13} color={category === 'customers' ? '#7C3AED' : 'rgba(255,255,255,0.8)'} />
                <Text style={[styles.tabBtnText, category === 'customers' && styles.tabBtnTextActive]}>Customers</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.innerContent}>
          {loading ? (
            <AnalyticsSkeleton />
          ) : (
            <View style={{ gap: 16 }}>

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 1. SALES OVERVIEW CATEGORY                                      */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {category === 'sales' && (
                <>
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                      <View style={styles.statIconBox}><Feather name="trending-up" size={14} color="#16A34A" /></View>
                      <Text style={styles.statLabel}>TOTAL REVENUE</Text>
                      <Text style={[styles.statVal, { color: '#16A34A' }]}>₹{salesData.revenue.toLocaleString('en-IN')}</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                      <View style={[styles.statIconBox, { backgroundColor: '#E9D5FF' }]}><Feather name="shopping-cart" size={14} color="#7C3AED" /></View>
                      <Text style={styles.statLabel}>AVG ORDER VALUE</Text>
                      <Text style={[styles.statVal, { color: '#7C3AED' }]}>₹{salesData.aov.toFixed(0).toLocaleString()}</Text>
                    </View>
                  </View>

                  <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                      <Text style={styles.statLabel}>UNITS / TXN (UPT)</Text>
                      <Text style={styles.statVal}>{salesData.upt.toFixed(1)} bx</Text>
                    </View>
                    <View style={styles.statCard}>
                      <Text style={styles.statLabel}>TOTAL GST COLLECTED</Text>
                      <Text style={styles.statVal}>₹{salesData.gst.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>

                  {/* Revenue by Payment Method */}
                  <View style={styles.chartCard}>
                    <Text style={styles.sectionHeader}>PAYMENT METHOD BREAKDOWN</Text>
                    <View style={styles.paymentBreakdown}>
                      <View style={styles.paymentRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.dotPill, { backgroundColor: '#10B981' }]} />
                          <Text style={styles.paymentLabel}>Cash</Text>
                        </View>
                        <Text style={styles.paymentVal}>₹{salesData.cash.toLocaleString('en-IN')}</Text>
                      </View>
                      <View style={styles.paymentRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.dotPill, { backgroundColor: '#3B82F6' }]} />
                          <Text style={styles.paymentLabel}>UPI</Text>
                        </View>
                        <Text style={styles.paymentVal}>₹{salesData.upi.toLocaleString('en-IN')}</Text>
                      </View>
                      <View style={styles.paymentRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.dotPill, { backgroundColor: '#F59E0B' }]} />
                          <Text style={styles.paymentLabel}>Khata / Credit</Text>
                        </View>
                        <Text style={styles.paymentVal}>₹{salesData.credit.toLocaleString('en-IN')}</Text>
                      </View>
                      <View style={[styles.paymentRow, { borderBottomWidth: 0 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.dotPill, { backgroundColor: '#8B5CF6' }]} />
                          <Text style={styles.paymentLabel}>Card</Text>
                        </View>
                        <Text style={styles.paymentVal}>₹{salesData.card.toLocaleString('en-IN')}</Text>
                      </View>
                    </View>
                  </View>
                </>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 2. PRODUCT ANALYTICS CATEGORY                                  */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {category === 'products' && (
                <>
                  {/* A. Product Performance Summary Cards */}
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                      <View style={styles.statIconBox}><Feather name="package" size={14} color="#16A34A" /></View>
                      <Text style={styles.statLabel}>TOTAL PRODUCTS SOLD</Text>
                      <Text style={[styles.statVal, { color: '#16A34A' }]}>{productsData.totalProductsSoldBoxes.toLocaleString('en-IN')} bx</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: '#F3E8FF', borderColor: '#E9D5FF' }]}>
                      <View style={[styles.statIconBox, { backgroundColor: '#E9D5FF' }]}><Feather name="dollar-sign" size={14} color="#7C3AED" /></View>
                      <Text style={styles.statLabel}>SALES REVENUE</Text>
                      <Text style={[styles.statVal, { color: '#7C3AED' }]}>₹{productsData.totalProductsRevenue.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>

                  <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                      <Text style={styles.statLabel}>BEST-SELLING PRODUCT</Text>
                      <Text style={[styles.statVal, { fontSize: 13, color: '#1A1A2E' }]} numberOfLines={1}>
                        {productsData.bestSeller ? productsData.bestSeller.name : 'No sales yet'}
                      </Text>
                      {productsData.bestSeller ? (
                        <Text style={styles.statSubText}>{productsData.bestSeller.boxesSold} boxes sold</Text>
                      ) : null}
                    </View>

                    <View style={[styles.statCard, productsData.lowStockCount > 0 ? { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' } : {}]}>
                      <Text style={styles.statLabel}>LOW-STOCK PRODUCTS</Text>
                      <Text style={[styles.statVal, productsData.lowStockCount > 0 ? { color: '#D97706' } : {}]}>
                        {productsData.lowStockCount} items
                      </Text>
                      <Text style={styles.statSubText}>Need replenishment</Text>
                    </View>
                  </View>

                  {/* Pop-up Inspector Button */}
                  <TouchableOpacity
                    style={styles.inspectorLaunchBtn}
                    onPress={() => {
                      setPickerSearch('');
                      setProductPickerVisible(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.inspectorIconCircle}>
                        <Feather name="search" size={14} color="#7C3AED" />
                      </View>
                      <View>
                        <Text style={styles.inspectorLaunchTitle}>Select &amp; Inspect Specific Product</Text>
                        <Text style={styles.inspectorLaunchSub}>Tap to view variant distribution &amp; customer buyers</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={18} color="#7C3AED" />
                  </TouchableOpacity>

                  {/* C. Product Insights Pill Filters */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.insightFilterScroll}>
                    {[
                      { key: 'all', label: `All (${productsData.allProducts.length})` },
                      { key: 'best_sellers', label: '🏆 Best Sellers' },
                      { key: 'slow_moving', label: '🐢 Slow Moving' },
                      { key: 'low_stock', label: `⚠️ Needs Restock (${productsData.lowStockCount})` },
                      { key: 'zero_sales', label: `⭕ No Sales (${productsData.zeroSalesList.length})` },
                    ].map(f => (
                      <TouchableOpacity
                        key={f.key}
                        style={[styles.insightChip, productInsightFilter === f.key && styles.insightChipActive]}
                        onPress={() => setProductInsightFilter(f.key as ProductInsightFilter)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.insightChipText, productInsightFilter === f.key && styles.insightChipTextActive]}>
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Search & Sort Controls */}
                  <View style={styles.controlsRow}>
                    <View style={styles.searchBox}>
                      <Feather name="search" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search product or brand..."
                        placeholderTextColor="#9CA3AF"
                        value={productSearch}
                        onChangeText={setProductSearch}
                      />
                      {productSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setProductSearch('')}>
                          <Feather name="x" size={14} color="#9CA3AF" />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.sortToggleRow}>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, productSort === 'revenue' && styles.sortMiniBtnActive]}
                        onPress={() => setProductSort('revenue')}
                      >
                        <Text style={[styles.sortMiniText, productSort === 'revenue' && styles.sortMiniTextActive]}>₹</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, productSort === 'volume' && styles.sortMiniBtnActive]}
                        onPress={() => setProductSort('volume')}
                      >
                        <Text style={[styles.sortMiniText, productSort === 'volume' && styles.sortMiniTextActive]}>Bx</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, productSort === 'stock' && styles.sortMiniBtnActive]}
                        onPress={() => setProductSort('stock')}
                      >
                        <Text style={[styles.sortMiniText, productSort === 'stock' && styles.sortMiniTextActive]}>Stk</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* B. Product Performance List */}
                  <View style={{ gap: 10 }}>
                    {displayedProducts.length === 0 ? (
                      <View style={styles.emptyCard}>
                        <Feather name="package" size={32} color="#C4B5FD" />
                        <Text style={styles.emptyCardText}>No products match the selected criteria</Text>
                      </View>
                    ) : (
                      paginatedProducts.map(p => (
                        <ProductAnalyticsCard
                          key={p.id}
                          product={p}
                          onPress={handleSelectProduct}
                        />
                      ))
                    )}

                    {/* Pagination Bar (Max 9 cards per page) */}
                    {totalProductPages > 1 && (
                      <View style={styles.paginationContainer}>
                        <TouchableOpacity
                          style={[styles.pageButton, productPage === 1 && styles.pageButtonDisabled]}
                          onPress={() => setProductPage(prev => Math.max(1, prev - 1))}
                          disabled={productPage === 1}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-left" size={18} color={productPage === 1 ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                        <View style={styles.pageInfoBadge}>
                          <Text style={styles.pageText}>
                            Page <Text style={styles.pageTextBold}>{productPage}</Text> of <Text style={styles.pageTextBold}>{totalProductPages}</Text>
                          </Text>
                          <Text style={styles.pageSubText}>
                            ({(productPage - 1) * PAGE_SIZE + 1}–{Math.min(productPage * PAGE_SIZE, displayedProducts.length)} of {displayedProducts.length})
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.pageButton, productPage === totalProductPages && styles.pageButtonDisabled]}
                          onPress={() => setProductPage(prev => Math.min(totalProductPages, prev + 1))}
                          disabled={productPage === totalProductPages}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-right" size={18} color={productPage === totalProductPages ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 3. CUSTOMER ANALYTICS CATEGORY                                  */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {category === 'customers' && (
                <>
                  {/* A. Customer Summary Cards */}
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                      <View style={[styles.statIconBox, { backgroundColor: '#DBEAFE' }]}><Feather name="users" size={14} color="#2563EB" /></View>
                      <Text style={styles.statLabel}>ACTIVE CUSTOMERS</Text>
                      <Text style={[styles.statVal, { color: '#2563EB' }]}>{customersData.totalUniqueCustomers}</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}>
                      <View style={[styles.statIconBox, { backgroundColor: '#EDE9FE' }]}><Feather name="credit-card" size={14} color="#7C3AED" /></View>
                      <Text style={styles.statLabel}>TOTAL CUSTOMER SALES</Text>
                      <Text style={[styles.statVal, { color: '#7C3AED' }]}>₹{customersData.periodTotalSpend.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>

                  <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                      <Text style={styles.statLabel}>AVG SPEND / CUSTOMER</Text>
                      <Text style={styles.statVal}>₹{customersData.avgSpending.toFixed(0).toLocaleString()}</Text>
                      <Text style={styles.statSubText}>Based on {timeRange.replace('_', ' ')}</Text>
                    </View>

                    <View style={styles.statCard}>
                      <Text style={styles.statLabel}>NEW VS REPEAT RATIO</Text>
                      <Text style={styles.statVal}>{customersData.periodRepeatCount} Repeat</Text>
                      <Text style={styles.statSubText}>{customersData.periodNewCount} New Customers</Text>
                    </View>
                  </View>

                  {/* Pop-up Inspector Button */}
                  <TouchableOpacity
                    style={styles.inspectorLaunchBtn}
                    onPress={() => {
                      setPickerSearch('');
                      setCustomerPickerVisible(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.inspectorIconCircle}>
                        <Feather name="user-check" size={14} color="#7C3AED" />
                      </View>
                      <View>
                        <Text style={styles.inspectorLaunchTitle}>Select &amp; Inspect Specific Customer</Text>
                        <Text style={styles.inspectorLaunchSub}>Tap to view complete invoice history &amp; preferences</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={18} color="#7C3AED" />
                  </TouchableOpacity>

                  {/* C. Customer Insights Pill Filters */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.insightFilterScroll}>
                    {[
                      { key: 'all', label: `All (${customersData.activeCustomers.length})` },
                      { key: 'vip', label: `💎 VIP Spenders (${customersData.vipList.length})` },
                      { key: 'frequent', label: `🔁 Frequent Buyers (${customersData.frequentList.length})` },
                      { key: 'dormant', label: `💤 Inactive / Churn Risk (${customersData.dormantList.length})` },
                    ].map(f => (
                      <TouchableOpacity
                        key={f.key}
                        style={[styles.insightChip, customerInsightFilter === f.key && styles.insightChipActive]}
                        onPress={() => setCustomerInsightFilter(f.key as CustomerInsightFilter)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.insightChipText, customerInsightFilter === f.key && styles.insightChipTextActive]}>
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Search & Sort Controls */}
                  <View style={styles.controlsRow}>
                    <View style={styles.searchBox}>
                      <Feather name="search" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search customer name or phone..."
                        placeholderTextColor="#9CA3AF"
                        value={customerSearch}
                        onChangeText={setCustomerSearch}
                      />
                      {customerSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setCustomerSearch('')}>
                          <Feather name="x" size={14} color="#9CA3AF" />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.sortToggleRow}>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, customerSort === 'spend' && styles.sortMiniBtnActive]}
                        onPress={() => setCustomerSort('spend')}
                      >
                        <Text style={[styles.sortMiniText, customerSort === 'spend' && styles.sortMiniTextActive]}>₹</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, customerSort === 'orders' && styles.sortMiniBtnActive]}
                        onPress={() => setCustomerSort('orders')}
                      >
                        <Text style={[styles.sortMiniText, customerSort === 'orders' && styles.sortMiniTextActive]}>Qty</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.sortMiniBtn, customerSort === 'recent' && styles.sortMiniBtnActive]}
                        onPress={() => setCustomerSort('recent')}
                      >
                        <Text style={[styles.sortMiniText, customerSort === 'recent' && styles.sortMiniTextActive]}>Date</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* B. Customer Performance List */}
                  <View style={{ gap: 10 }}>
                    {displayedCustomers.length === 0 ? (
                      <View style={styles.emptyCard}>
                        <Feather name="users" size={32} color="#C4B5FD" />
                        <Text style={styles.emptyCardText}>No customers match the selected criteria</Text>
                      </View>
                    ) : (
                      paginatedCustomers.map(c => (
                        <CustomerAnalyticsCard
                          key={c.id}
                          customer={c}
                          timeRange={timeRange}
                          onPress={handleSelectCustomer}
                        />
                      ))
                    )}

                    {/* Pagination Bar (Max 9 cards per page) */}
                    {totalCustomerPages > 1 && (
                      <View style={styles.paginationContainer}>
                        <TouchableOpacity
                          style={[styles.pageButton, customerPage === 1 && styles.pageButtonDisabled]}
                          onPress={() => setCustomerPage(prev => Math.max(1, prev - 1))}
                          disabled={customerPage === 1}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-left" size={18} color={customerPage === 1 ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                        <View style={styles.pageInfoBadge}>
                          <Text style={styles.pageText}>
                            Page <Text style={styles.pageTextBold}>{customerPage}</Text> of <Text style={styles.pageTextBold}>{totalCustomerPages}</Text>
                          </Text>
                          <Text style={styles.pageSubText}>
                            ({(customerPage - 1) * PAGE_SIZE + 1}–{Math.min(customerPage * PAGE_SIZE, displayedCustomers.length)} of {displayedCustomers.length})
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.pageButton, customerPage === totalCustomerPages && styles.pageButtonDisabled]}
                          onPress={() => setCustomerPage(prev => Math.min(totalCustomerPages, prev + 1))}
                          disabled={customerPage === totalCustomerPages}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-right" size={18} color={customerPage === totalCustomerPages ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </>
              )}

            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* DRILL-DOWN MODAL: PRODUCT DETAILS & VARIANT DISTRIBUTION               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={Boolean(selectedProduct)} transparent animationType="slide" onRequestClose={() => setSelectedProduct(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetSubtitle}>PRODUCT PERFORMANCE &amp; VARIANTS</Text>
                <Text style={styles.sheetTitle}>{selectedProduct?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedProduct(null)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {selectedProduct && (
              <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                {/* Hero Card */}
                <View style={styles.heroCard}>
                  <View style={[styles.heroSwatch, { backgroundColor: selectedProduct.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTitle}>{selectedProduct.name}</Text>
                    <Text style={styles.heroSub}>{selectedProduct.brand} • {selectedProduct.size} • {selectedProduct.sqftPerBox} sqft/bx</Text>
                  </View>
                  <View style={styles.heroStockBox}>
                    <Text style={styles.heroStockVal}>{selectedProduct.currentStock} bx</Text>
                    <Text style={styles.heroStockLbl}>In Warehouse</Text>
                  </View>
                </View>

                {/* Performance Stats */}
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>BOXES SOLD</Text>
                    <Text style={[styles.statVal, { color: '#16A34A' }]}>{selectedProduct.boxesSold} bx</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>SALES REVENUE</Text>
                    <Text style={[styles.statVal, { color: '#7C3AED' }]}>₹{selectedProduct.revenue.toLocaleString('en-IN')}</Text>
                  </View>
                </View>

                {/* Variant Distribution Breakdown */}
                <View style={styles.modalSectionCard}>
                  <Text style={styles.modalSectionTitle}>VARIANT SALES DISTRIBUTION</Text>
                  {Object.keys(selectedProductDetails.variantsSold).length === 0 ? (
                    <Text style={styles.emptyText}>No variant sales recorded in this period.</Text>
                  ) : (
                    <>
                      {/* Visual Multi-Bar */}
                      <View style={styles.multiBarContainer}>
                        {Object.entries(selectedProductDetails.variantsSold).map(([vName, vData]: any, idx) => {
                          const pct = selectedProduct.boxesSold > 0 ? (vData.boxes / selectedProduct.boxesSold) * 100 : 0;
                          const barColors = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                          return (
                            <View
                              key={vName}
                              style={{
                                width: `${Math.max(2, pct)}%`,
                                height: 10,
                                backgroundColor: barColors[idx % barColors.length],
                              }}
                            />
                          );
                        })}
                      </View>

                      {/* Variant Rows */}
                      <View style={{ gap: 8, marginTop: 10 }}>
                        {Object.entries(selectedProductDetails.variantsSold).map(([vName, vData]: any, idx) => {
                          const pct = selectedProduct.boxesSold > 0 ? Math.round((vData.boxes / selectedProduct.boxesSold) * 100) : 0;
                          const barColors = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];
                          return (
                            <View key={vName} style={styles.variantDetailRow}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                                <View style={[styles.dotPill, { backgroundColor: barColors[idx % barColors.length] }]} />
                                <Text style={styles.variantNameText}>{vName}</Text>
                              </View>
                              <Text style={styles.variantBoxesText}>{vData.boxes} boxes ({pct}%)</Text>
                              <Text style={styles.variantRevenueText}>₹{vData.revenue.toLocaleString('en-IN')}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>

                {/* Top Customer Buyers */}
                <View style={styles.modalSectionCard}>
                  <Text style={styles.modalSectionTitle}>TOP CUSTOMER BUYERS</Text>
                  {selectedProductDetails.buyers.length === 0 ? (
                    <Text style={styles.emptyText}>No buyers recorded for this tile.</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {selectedProductDetails.buyers.slice(0, 5).map((b: any, idx: number) => (
                        <View key={idx} style={styles.buyerItemRow}>
                          <View style={styles.rankCircleMini}><Text style={styles.rankTextMini}>{idx + 1}</Text></View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.buyerNameText}>{b.name || 'Walk-in Customer'}</Text>
                            <Text style={styles.buyerPhoneText}>{b.phone || 'No phone'}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.buyerBoxesText}>{b.boxes} boxes</Text>
                            <Text style={styles.buyerSpendText}>₹{b.spend.toLocaleString('en-IN')}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* DRILL-DOWN MODAL: CUSTOMER PROFILE & PURCHASE HISTORY                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={Boolean(selectedCustomer)} transparent animationType="slide" onRequestClose={() => setSelectedCustomer(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetSubtitle}>CUSTOMER PROFILE &amp; HISTORY</Text>
                <Text style={styles.sheetTitle}>{selectedCustomer?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedCustomer(null)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {selectedCustomer && (
              <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                {/* Hero Card */}
                <View style={styles.heroCard}>
                  <View style={[styles.avatarCircle, { width: 44, height: 44, borderRadius: 22 }]}>
                    <Text style={[styles.avatarText, { fontSize: 18 }]}>{selectedCustomer.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTitle}>{selectedCustomer.name}</Text>
                    <Text style={styles.heroSub}>{selectedCustomer.phone}</Text>
                  </View>
                  <View style={[
                    styles.statusBadge,
                    selectedCustomer.status === 'VIP' ? styles.badgeVip : selectedCustomer.status === 'Repeat' ? styles.badgeRepeat : styles.badgeNew
                  ]}>
                    <Text style={[
                      styles.statusBadgeText,
                      selectedCustomer.status === 'VIP' ? { color: '#D97706' } : selectedCustomer.status === 'Repeat' ? { color: '#7C3AED' } : { color: '#059669' }
                    ]}>
                      {selectedCustomer.status}
                    </Text>
                  </View>
                </View>

                {/* Performance Stats */}
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>LIFETIME SPEND</Text>
                    <Text style={[styles.statVal, { color: '#7C3AED' }]}>₹{selectedCustomer.lifetimeSpend.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>OUTSTANDING DEBT</Text>
                    <Text style={[styles.statVal, selectedCustomer.totalDebt > 0 ? { color: '#DC2626' } : {}]}>
                      ₹{selectedCustomer.totalDebt.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                {/* Favorite Products */}
                <View style={styles.modalSectionCard}>
                  <Text style={styles.modalSectionTitle}>FAVORITE &amp; MOST PURCHASED PRODUCTS</Text>
                  {selectedCustomerDetails.favoriteProducts.length === 0 ? (
                    <Text style={styles.emptyText}>No product history recorded.</Text>
                  ) : (
                    <View style={{ gap: 6 }}>
                      {selectedCustomerDetails.favoriteProducts.slice(0, 4).map((fp: any, idx: number) => (
                        <View key={idx} style={styles.variantDetailRow}>
                          <Text style={[styles.variantNameText, { flex: 1 }]}>{fp.name}</Text>
                          <Text style={styles.variantBoxesText}>{fp.boxes} boxes purchased</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Complete Invoice History */}
                <View style={styles.modalSectionCard}>
                  <Text style={styles.modalSectionTitle}>COMPLETE PURCHASE HISTORY ({selectedCustomerDetails.allInvoices.length} INVOICES)</Text>
                  <View style={{ gap: 8 }}>
                    {selectedCustomerDetails.allInvoices.map((inv: InvoiceRecord) => {
                      const formattedDate = new Date(inv.date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      });
                      const boxesCount = inv.items.reduce((s, it) => s + it.boxes, 0);

                      return (
                        <View key={inv.invoiceId} style={styles.invoiceHistoryRow}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.invoiceNumText}>{inv.invoiceId}</Text>
                              <View style={styles.miniPaymentBadge}>
                                <Text style={styles.miniPaymentText}>{inv.paymentMethod.toUpperCase()}</Text>
                              </View>
                            </View>
                            <Text style={styles.invoiceDateText}>{formattedDate} • {boxesCount} boxes ({inv.items.length} items)</Text>
                          </View>
                          <Text style={styles.invoiceTotalText}>₹{inv.total.toLocaleString('en-IN')}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* QUICK-PICKER MODAL: SELECT PRODUCT                                      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={productPickerVisible} transparent animationType="fade" onRequestClose={() => setProductPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Product to Inspect</Text>
              <TouchableOpacity onPress={() => setProductPickerVisible(false)}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchBox}>
              <Feather name="search" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search catalog products..."
                placeholderTextColor="#9CA3AF"
                value={pickerSearch}
                onChangeText={setPickerSearch}
                autoFocus
              />
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {productsData.allProducts
                .filter(p => !debouncedPickerSearch || p.name.toLowerCase().includes(debouncedPickerSearch.toLowerCase()) || p.brand.toLowerCase().includes(debouncedPickerSearch.toLowerCase()))
                .map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.pickerItemRow}
                    onPress={() => {
                      setProductPickerVisible(false);
                      setSelectedProduct(p);
                    }}
                  >
                    <View style={[styles.productSwatchSquareMini, { backgroundColor: p.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerItemTitle}>{p.name}</Text>
                      <Text style={styles.pickerItemSub}>{p.brand} • {p.size} • {p.currentStock} bx in stock</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#A0AEC0" />
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* QUICK-PICKER MODAL: SELECT CUSTOMER                                     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Modal visible={customerPickerVisible} transparent animationType="fade" onRequestClose={() => setCustomerPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Customer to Inspect</Text>
              <TouchableOpacity onPress={() => setCustomerPickerVisible(false)}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchBox}>
              <Feather name="search" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search customer name or phone..."
                placeholderTextColor="#9CA3AF"
                value={pickerSearch}
                onChangeText={setPickerSearch}
                autoFocus
              />
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {customersData.allCustomers
                .filter(c => !debouncedPickerSearch || c.name.toLowerCase().includes(debouncedPickerSearch.toLowerCase()) || c.phone.toLowerCase().includes(debouncedPickerSearch.toLowerCase()))
                .map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.pickerItemRow}
                    onPress={() => {
                      setCustomerPickerVisible(false);
                      setSelectedCustomer(c);
                    }}
                  >
                    <View style={styles.avatarCircleMini}>
                      <Text style={styles.avatarTextMini}>{c.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerItemTitle}>{c.name}</Text>
                      <Text style={styles.pickerItemSub}>{c.phone} • {c.lifetimeOrders} orders • ₹{c.lifetimeSpend.toLocaleString('en-IN')}</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#A0AEC0" />
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F6FF' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  innerContent: { paddingHorizontal: 16, paddingTop: 14 },

  header: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  safeHeader: { paddingHorizontal: 20, paddingBottom: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backIconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 5 },
  exportBtnText: { color: '#7C3AED', fontSize: 11, fontWeight: 'bold' },

  pageTitleContainer: { marginTop: 4, marginBottom: 12 },
  pageSubtitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', letterSpacing: 1.2 },
  countBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', letterSpacing: -0.2 },

  // Time Range Filter Bar
  timeRangeBar: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 14, padding: 3, marginBottom: 10 },
  timeChip: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 11 },
  timeChipActive: { backgroundColor: '#FFF' },
  timeChipText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  timeChipTextActive: { color: '#7C3AED' },

  // Category Tabs
  tabsContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14, padding: 4 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10 },
  tabBtnActive: { backgroundColor: '#FFF' },
  tabBtnText: { fontSize: 11, fontWeight: 'bold', color: 'rgba(255,255,255,0.85)' },
  tabBtnTextActive: { color: '#7C3AED' },

  // Summary Stat Cards
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.03)' },
  statIconBox: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statLabel: { fontSize: 9, color: '#6B7280', fontWeight: '800', letterSpacing: 0.5 },
  statVal: { fontSize: 17, fontWeight: '900', color: '#1A1A2E', marginTop: 3 },
  statSubText: { fontSize: 9, color: '#9CA3AF', marginTop: 2, fontWeight: '500' },

  // Inspector Launch Button
  inspectorLaunchBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    boxShadow: '0px 2px 8px rgba(124,58,237,0.06)',
  },
  inspectorIconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  inspectorLaunchTitle: { fontSize: 12, fontWeight: '700', color: '#1A1A2E' },
  inspectorLaunchSub: { fontSize: 10, color: '#6B7280', marginTop: 1 },

  // Insight Pill Filter Bar
  insightFilterScroll: { gap: 6, paddingVertical: 2 },
  insightChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E9D5FF' },
  insightChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  insightChipText: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  insightChipTextActive: { color: '#FFF' },

  // Controls Row (Search & Sort)
  controlsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E9D5FF' },
  searchInput: { flex: 1, fontSize: 11, color: '#1A1A2E' },
  sortToggleRow: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 14, padding: 3, borderWidth: 1, borderColor: '#E9D5FF' },
  sortMiniBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 11 },
  sortMiniBtnActive: { backgroundColor: '#7C3AED' },
  sortMiniText: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  sortMiniTextActive: { color: '#FFF' },

  // Performance Cards
  performanceCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.03)' },
  perfTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  productSwatchSquare: { width: 40, height: 40, borderRadius: 10 },
  perfTitle: { fontSize: 13, fontWeight: '700', color: '#1A1A2E' },
  perfSubtitle: { fontSize: 10, color: '#6B7280', marginTop: 1 },
  stockPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  stockPillText: { fontSize: 9, fontWeight: '800' },

  perfMetricsRow: { flexDirection: 'row', backgroundColor: '#F8F6FF', borderRadius: 12, padding: 10, justifyContent: 'space-between' },
  perfMetricCol: { alignItems: 'center' },
  perfMetricLbl: { fontSize: 8, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  perfMetricVal: { fontSize: 12, fontWeight: '800', color: '#1A1A2E', marginTop: 2 },

  perfFooterRow: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F8F6FF' },
  perfActionText: { fontSize: 9, fontWeight: '700', color: '#7C3AED' },

  // Customer List Cards
  avatarCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeVip: { backgroundColor: '#FEF3C7' },
  badgeRepeat: { backgroundColor: '#F3E8FF' },
  badgeNew: { backgroundColor: '#ECFDF5' },
  statusBadgeText: { fontSize: 9, fontWeight: '800' },

  // Sales Category
  chartCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#F3E8FF' },
  sectionHeader: { fontSize: 10, fontWeight: '800', color: '#6B7280', letterSpacing: 1, marginBottom: 12 },
  paymentBreakdown: { gap: 10 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F8F6FF' },
  dotPill: { width: 8, height: 8, borderRadius: 4 },
  paymentLabel: { fontSize: 12, color: '#4A5568', fontWeight: '600' },
  paymentVal: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },

  // Modals & Sheets
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetSubtitle: { fontSize: 9, fontWeight: '800', color: '#7C3AED', letterSpacing: 1 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#1A1A2E' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },

  // Drill Down Modals
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8F6FF', borderRadius: 16, padding: 12, marginBottom: 12 },
  heroSwatch: { width: 48, height: 48, borderRadius: 12 },
  heroTitle: { fontSize: 14, fontWeight: '800', color: '#1A1A2E' },
  heroSub: { fontSize: 10, color: '#6B7280', marginTop: 2 },
  heroStockBox: { alignItems: 'flex-end' },
  heroStockVal: { fontSize: 15, fontWeight: '900', color: '#7C3AED' },
  heroStockLbl: { fontSize: 8, color: '#9CA3AF' },

  modalSectionCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', marginBottom: 10 },
  modalSectionTitle: { fontSize: 10, fontWeight: '800', color: '#6B7280', letterSpacing: 0.8, marginBottom: 10 },
  multiBarContainer: { flexDirection: 'row', width: '100%', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#E5E7EB' },
  variantDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  variantNameText: { fontSize: 11, fontWeight: '600', color: '#1A1A2E' },
  variantBoxesText: { fontSize: 11, color: '#4B5563' },
  variantRevenueText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },

  buyerItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F8F6FF' },
  rankCircleMini: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  rankTextMini: { fontSize: 9, fontWeight: '800', color: '#7C3AED' },
  buyerNameText: { fontSize: 11, fontWeight: '700', color: '#1A1A2E' },
  buyerPhoneText: { fontSize: 9, color: '#9CA3AF' },
  buyerBoxesText: { fontSize: 11, fontWeight: '600', color: '#1A1A2E' },
  buyerSpendText: { fontSize: 10, color: '#7C3AED', fontWeight: '700' },

  invoiceHistoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F8F6FF' },
  invoiceNumText: { fontSize: 11, fontWeight: '700', color: '#1A1A2E' },
  miniPaymentBadge: { backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  miniPaymentText: { fontSize: 8, fontWeight: '800', color: '#7C3AED' },
  invoiceDateText: { fontSize: 9, color: '#9CA3AF', marginTop: 1 },
  invoiceTotalText: { fontSize: 12, fontWeight: '800', color: '#1A1A2E' },

  // Picker Modal
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  pickerCard: { width: '100%', maxWidth: 360, backgroundColor: '#FFF', borderRadius: 24, padding: 18, maxHeight: 480 },
  pickerSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  pickerItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F8F6FF' },
  productSwatchSquareMini: { width: 32, height: 32, borderRadius: 8 },
  avatarCircleMini: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  avatarTextMini: { fontSize: 12, fontWeight: '800', color: '#7C3AED' },
  pickerItemTitle: { fontSize: 12, fontWeight: '700', color: '#1A1A2E' },
  pickerItemSub: { fontSize: 9, color: '#6B7280', marginTop: 1 },

  emptyCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 32, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#F3E8FF' },
  emptyCardText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
  emptyText: { fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', textAlign: 'center', marginVertical: 6 },

  // Pagination
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFF',
    borderRadius: 18,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    boxShadow: '0px 2px 8px rgba(0,0,0,0.03)',
  },
  pageButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageButtonDisabled: {
    backgroundColor: '#F3F4F6',
  },
  pageInfoBadge: {
    marginHorizontal: 16,
    alignItems: 'center',
  },
  pageText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },
  pageTextBold: {
    fontWeight: '800',
    color: '#7C3AED',
  },
  pageSubText: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
    fontWeight: '500',
  },
});
