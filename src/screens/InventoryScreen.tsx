/**
 * src/screens/InventoryScreen.tsx
 *
 * Inventory Management Screen — Supabase backend integration + UI/UX enhancements.
 *
 * Enhanced Features:
 *  1. Low stock threshold note (≤15 boxes) in KPI stats card.
 *  2. Scroll position preservation on catalog refresh.
 *  3. Touch target expansion & hitSlop for Quick Inward button.
 *  4. High-contrast, 10px legible stock status badges.
 *  5. Inline validation & error banner in Add Product modal (keeps typed data).
 *  6. Shimmer skeleton card loading grid instead of full-screen spinner.
 *  7. Differentiated empty states (Empty Catalog vs No Search Matches + Clear Filters button).
 *  8. Confirmation sheet before destructive Outward deduction.
 *  9. Auto-focus quantity input with keyboard-safe scroll view.
 * 10. Inline validation text (no disruptive Alert.alert for recoverable input errors).
 * 11. Stepper (- / +) controls & "MAX" stock deduction button.
 * 12. Lightweight, auto-dismissing in-app Toast banner for operation feedback.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  StatusBar,
  ActivityIndicator,
  Animated,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

import { BottomNavBar, NavTab } from '../components/BottomNavBar';
import { UserSession, StorageService } from '../services/storage';
import { TileCollection, TileVariant, VariantType, StockLog } from '../types/tiles';
import { catalogService } from '../services/catalog';
import { supabase } from '../services/supabase';
import { SkeletonBox, SkeletonText } from '../components/skeleton';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

// ─── Toast Component ──────────────────────────────────────────────────────────

interface ToastProps {
  visible: boolean;
  message: string;
  type: 'success' | 'error' | 'warning';
  onDismiss: () => void;
}

const Toast: React.FC<ToastProps> = ({ visible, message, type, onDismiss }) => {
  const translateY = useRef(new Animated.Value(-60)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: false }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, { toValue: -60, duration: 200, useNativeDriver: false }),
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: false }),
        ]).start(() => onDismiss());
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible, message, type, translateY, opacity, onDismiss]);

  if (!visible) return null;

  const bgColor = type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#F59E0B';
  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        { backgroundColor: bgColor, transform: [{ translateY }], opacity },
      ]}
    >
      <Feather name={iconName} size={16} color="#FFF" />
      <Text style={styles.toastText} numberOfLines={2}>{message}</Text>
    </Animated.View>
  );
};

// ─── Skeleton Loading Cards ───────────────────────────────────────────────────

const SkeletonCard: React.FC = () => {
  return (
    <View style={styles.tileCard}>
      <SkeletonBox width="100%" height={76} borderRadius={12} style={{ marginBottom: 10 }} />
      <View style={styles.tileInfo}>
        <SkeletonBox width={45} height={14} borderRadius={4} style={{ marginBottom: 4 }} />
        <SkeletonText width="80%" height={14} borderRadius={3} style={{ marginBottom: 8 }} />
        <SkeletonBox width="100%" height={24} borderRadius={20} />
      </View>
    </View>
  );
};

const InventoryStatsSkeleton: React.FC = () => {
  return (
    <View style={styles.statsRow}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.statCard}>
          <SkeletonText width={48} height={8} borderRadius={2} />
          <SkeletonText width={36} height={15} borderRadius={3} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  );
};

// ─── Stock Status Helper ─────────────────────────────────────────────────────

function stockStatus(stock: number): { label: string; dotColor: string; bgColor: string; textColor: string } {
  if (stock === 0) return { label: 'Out of Stock', dotColor: '#EF4444', bgColor: '#FEF2F2', textColor: '#DC2626' };
  if (stock <= 15) return { label: 'Low Stock',    dotColor: '#F97316', bgColor: '#FFF7ED', textColor: '#C2410C' };
  return             { label: 'In Stock',          dotColor: '#10B981', bgColor: '#ECFDF5', textColor: '#047857' };
}

// ─── Tile Card Sub-Component (Memoized) ───────────────────────────────────────

interface TileCardProps {
  tile: TileCollection;
  onPress: (tile: TileCollection) => void;
  onQuickInward: (tile: TileCollection) => void;
}

const TileCard = React.memo<TileCardProps>(({ tile, onPress, onQuickInward }) => {
  const totalStock = tile.variants.reduce((s, v) => s + (v.stock || 0), 0);
  const status = stockStatus(totalStock);
  const defaultVariant = tile.variants[0];

  return (
    <TouchableOpacity style={styles.tileCard} onPress={() => onPress(tile)} activeOpacity={0.75}>
      {/* Swatch */}
      <View style={[styles.swatchArea, { backgroundColor: defaultVariant?.color || '#F5F0E8' }]}>
        <Text style={styles.swatchId}>
          {tile.id.length > 8 ? tile.name.slice(0, 4).toUpperCase() : tile.id.toUpperCase()}
        </Text>

        {/* Feature #3: Expanded Touch Target Quick Inward Button */}
        <TouchableOpacity
          style={styles.quickInwardBtn}
          onPress={(e) => {
            e.stopPropagation();
            onQuickInward(tile);
          }}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="plus" size={11} color="#7C3AED" />
          <Text style={styles.quickInwardText}>Inward</Text>
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.tileInfo}>
        <Text style={styles.tileName} numberOfLines={1}>{tile.name}</Text>
        <Text style={styles.tileBrand}>{tile.brand}</Text>
        <Text style={styles.tileSpecs}>{tile.size} · {tile.sqftPerBox} sqft/box</Text>

        {/* 12×18 Variant Badges */}
        {tile.is12x18 && (
          <View style={styles.variantBadgesRow}>
            {tile.variants.map(v => (
              <View key={v.type} style={styles.vBadge}>
                <Text style={styles.vBadgeText}>
                  {v.type === 'highlighter' ? 'HL' : v.type === 'flooring' ? 'FL' : v.type[0].toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Footer & Feature #4: Enhanced Stock Badge */}
      <View style={styles.tileFooter}>
        <View style={[styles.statusBadge, { backgroundColor: status.bgColor }]}>
          <View style={[styles.statusDot, { backgroundColor: status.dotColor }]} />
          <Text style={[styles.statusLabel, { color: status.textColor }]}>{status.label}</Text>
        </View>
        <Text style={styles.stockCount}>{totalStock} bx</Text>
      </View>
    </TouchableOpacity>
  );
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

interface InventoryScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

type AdjustTab = 'inward' | 'outward' | 'history';

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  session, activeTab, onTabChange, onLogout,
}) => {
  const [catalog, setCatalog]                         = useState<TileCollection[]>([]);
  const [loading, setLoading]                         = useState(true);
  const [search, setSearch]                           = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [activeSize, setActiveSize]                   = useState('all');
  const [currentPage, setCurrentPage]                 = useState(1);
  const PAGE_SIZE = 10;
  const [selectedTile, setSelectedTile]               = useState<TileCollection | null>(null);
  const [selectedVariantType, setSelectedVariantType] = useState<VariantType>('light');
  const [adjustTab, setAdjustTab]                     = useState<AdjustTab>('inward');

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeSize]);

  // Input states & errors
  const [inwardQty, setInwardQty]                     = useState('10');
  const [inwardNote, setInwardNote]                   = useState('');
  const [inwardError, setInwardError]                 = useState<string | null>(null);

  const [outwardQty, setOutwardQty]                   = useState('5');
  const [outwardNote, setOutwardNote]                 = useState('');
  const [outwardError, setOutwardError]               = useState<string | null>(null);

  const [adjustLoading, setAdjustLoading]             = useState(false);

  // Toast State
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error' | 'warning' }>({
    visible: false,
    message: '',
    type: 'success',
  });

  // Outward Confirmation Modal State
  const [confirmOutwardVisible, setConfirmOutwardVisible] = useState(false);
  const [confirmQty, setConfirmQty]                       = useState(0);

  // Feature #7: History Pagination State
  const [historyLogs, setHistoryLogs]                 = useState<StockLog[]>([]);
  const [historyLoading, setHistoryLoading]           = useState(false);
  const [historyHasMore, setHistoryHasMore]           = useState(true);
  const [historyOffset, setHistoryOffset]             = useState(0);

  // Add Product Modal State
  const [addModalVisible, setAddModalVisible]         = useState(false);
  const [addLoading, setAddLoading]                 = useState(false);
  const [addError, setAddError]                     = useState<string | null>(null);
  const [newName, setNewName]                         = useState('');
  const [newBrand, setNewBrand]                       = useState('Kajaria');
  const [newSize, setNewSize]                         = useState('12×18');
  const [newPrice, setNewPrice]                       = useState('');
  const [newStock, setNewStock]                       = useState('50');
  const [lightPrice, setLightPrice]                   = useState('');
  const [hlPrice, setHlPrice]                         = useState('');
  const [darkPrice, setDarkPrice]                     = useState('');
  const [flPrice, setFlPrice]                         = useState('');

  // Scroll View Ref for preserving scroll position
  const mainScrollRef = useRef<ScrollView>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ visible: true, message, type });
  }, []);

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadCatalogData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    await catalogService.flushOfflineQueue();
    const data = await catalogService.fetchCatalog(session.shop_id);
    setCatalog(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData]);

  // Active Variant object for selected tile
  const activeVariant: TileVariant | null = selectedTile
    ? selectedTile.variants.find(v => v.type === selectedVariantType) || selectedTile.variants[0]
    : null;

  // History loader
  const loadVariantHistory = useCallback(async (variantId: string, reset = false) => {
    if (!variantId) return;
    setHistoryLoading(true);
    const newOffset = reset ? 0 : historyOffset;
    const logs = await catalogService.fetchVariantHistory(variantId, 20, newOffset);

    if (reset) {
      setHistoryLogs(logs);
      setHistoryOffset(20);
    } else {
      setHistoryLogs(prev => [...prev, ...logs]);
      setHistoryOffset(prev => prev + 20);
    }
    setHistoryHasMore(logs.length === 20);
    setHistoryLoading(false);
  }, [historyOffset]);

  useEffect(() => {
    if (selectedTile && activeVariant && adjustTab === 'history') {
      if (activeVariant.id) {
        loadVariantHistory(activeVariant.id, true);
      } else {
        setHistoryLogs(activeVariant.history || []);
        setHistoryHasMore(false);
      }
    }
  }, [selectedTile, activeVariant?.id, selectedVariantType, adjustTab]);

  // ─── Derived Computations ──────────────────────────────────────────────────

  const normalizeSize = (s: string) => (s || '').replace(/x/gi, '×').replace(/\*/g, '×').trim();

  const sizes = useMemo(() => {
    const rawSizes = Array.from(new Set(catalog.map(t => normalizeSize(t.size || '')))).filter(Boolean);
    const standardOrder = ['12×18', '2×2', '2×4', '1×4'];
    const sorted = [
      ...standardOrder.filter(s => rawSizes.includes(s)),
      ...rawSizes.filter(s => !standardOrder.includes(s)),
    ];
    const finalSizes = sorted.length > 0 ? sorted : ['12×18', '2×2', '2×4'];
    return ['all', ...finalSizes];
  }, [catalog]);

  const filteredAndSorted = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const list = catalog.filter(t => {
      const norm = normalizeSize(t.size);
      const matchesSize = activeSize === 'all' || norm === normalizeSize(activeSize);
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.brand.toLowerCase().includes(q) ||
        t.size.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.variants.some(v => v.label.toLowerCase().includes(q) || v.type.toLowerCase().includes(q));
      return matchesSize && matchesSearch;
    });

    // Sort by size (12×18 -> 2×2 -> 2×4 -> others), then by name
    const sizePriority: Record<string, number> = {
      '12×18': 1,
      '2×2': 2,
      '2×4': 3,
      '1×4': 4,
    };

    return list.sort((a, b) => {
      const pA = sizePriority[normalizeSize(a.size)] || 99;
      const pB = sizePriority[normalizeSize(b.size)] || 99;
      if (pA !== pB) return pA - pB;
      return a.name.localeCompare(b.name);
    });
  }, [catalog, activeSize, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProducts = useMemo(() => {
    return filteredAndSorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  }, [filteredAndSorted, safePage]);

  const totalBoxes = catalog.reduce(
    (sum, t) => sum + t.variants.reduce((vs, v) => vs + (v.stock || 0), 0),
    0
  );

  const totalStockValue = catalog.reduce((sum, tile) => {
    return sum + tile.variants.reduce((vSum, v) => vSum + ((v.stock || 0) * (v.pricePerBox || 0)), 0);
  }, 0);

  const lowCount = catalog.filter(t => {
    const total = t.variants.reduce((vs, v) => vs + (v.stock || 0), 0);
    return total > 0 && total <= 15;
  }).length;

  const outCount = catalog.filter(t =>
    t.variants.every(v => v.stock === 0)
  ).length;

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleInward = async () => {
    setInwardError(null);
    const qty = parseInt(inwardQty);
    if (!selectedTile || !activeVariant || isNaN(qty) || qty <= 0) {
      setInwardError('Please enter a valid number of boxes (min 1)');
      return;
    }

    const previousCatalog = catalog;
    const previousSelectedTile = selectedTile;
    const targetVariantId = activeVariant.id;
    const noteText = inwardNote.trim() || 'Stock Inward';
    const newTotal = activeVariant.stock + qty;

    // 1. Optimistic UI update (0ms immediate feedback)
    setCatalog(prev => prev.map(col => {
      if (col.id !== selectedTile.id) return col;
      return {
        ...col,
        variants: col.variants.map(v => v.id === targetVariantId ? { ...v, stock: v.stock + qty } : v)
      };
    }));
    setSelectedTile(prev => prev ? {
      ...prev,
      variants: prev.variants.map(v => v.id === targetVariantId ? { ...v, stock: v.stock + qty } : v)
    } : null);

    hapticFeedback.success();
    showToast(`✅ Added ${qty} boxes to ${activeVariant.label} — Total: ${newTotal} bx`, 'success');
    setInwardQty('10');
    setInwardNote('');

    // 2. Background RPC with rollback on error
    try {
      let userId: string | undefined;
      let shopId = '';
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        userId = currentSession?.user?.id;
        const customSession = await StorageService.getSession();
        if (customSession) shopId = customSession.shop_id;
      } catch {}

      if (targetVariantId) {
        const actorName = session.full_name || session.username || session.email;
        const res = await catalogService.addStock(
          shopId,
          targetVariantId,
          qty,
          `${activeVariant.label} - ${noteText}`,
          userId,
          activeVariant.label,
          actorName,
          session.role
        );

        if (!res.success) {
          // Revert optimistic state
          setCatalog(previousCatalog);
          setSelectedTile(previousSelectedTile);
          hapticFeedback.error();
          setInwardError(res.error || 'Failed to update stock on server.');
          showToast('Stock update failed. Reverted changes.', 'error');
        }
      }
    } catch (err: any) {
      setCatalog(previousCatalog);
      setSelectedTile(previousSelectedTile);
      hapticFeedback.error();
      setInwardError(err?.message || 'Network error updating stock.');
      showToast('Network error. Reverted changes.', 'error');
    }
  };

  // Trigger confirmation prompt before outward deduction
  const promptOutwardConfirmation = () => {
    setOutwardError(null);
    const qty = parseInt(outwardQty);
    if (!selectedTile || !activeVariant || isNaN(qty) || qty <= 0) {
      setOutwardError('Please enter a valid number of boxes to deduct');
      return;
    }
    if (qty > activeVariant.stock) {
      setOutwardError(`Only ${activeVariant.stock} boxes available in stock`);
      return;
    }
    setConfirmQty(qty);
    setConfirmOutwardVisible(true);
  };

  const executeOutwardDeduction = async () => {
    setConfirmOutwardVisible(false);
    if (!selectedTile || !activeVariant || confirmQty <= 0) return;

    const previousCatalog = catalog;
    const previousSelectedTile = selectedTile;
    const targetVariantId = activeVariant.id;
    const noteText = outwardNote.trim() || 'Stock Outward';
    const newTotal = Math.max(0, activeVariant.stock - confirmQty);

    // 1. Optimistic UI update (0ms immediate feedback)
    setCatalog(prev => prev.map(col => {
      if (col.id !== selectedTile.id) return col;
      return {
        ...col,
        variants: col.variants.map(v => v.id === targetVariantId ? { ...v, stock: Math.max(0, v.stock - confirmQty) } : v)
      };
    }));
    setSelectedTile(prev => prev ? {
      ...prev,
      variants: prev.variants.map(v => v.id === targetVariantId ? { ...v, stock: Math.max(0, v.stock - confirmQty) } : v)
    } : null);

    hapticFeedback.light();
    showToast(`Deducted ${confirmQty} boxes from ${activeVariant.label} — Total: ${newTotal} bx`, 'error');
    setOutwardQty('5');
    setOutwardNote('');

    // 2. Background RPC with rollback on error
    try {
      let userId: string | undefined;
      let shopId = '';
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        userId = currentSession?.user?.id;
        const customSession = await StorageService.getSession();
        if (customSession) shopId = customSession.shop_id;
      } catch {}

      if (targetVariantId) {
        const actorName = session.full_name || session.username || session.email;
        const res = await catalogService.deductStock(
          shopId,
          targetVariantId,
          confirmQty,
          `${activeVariant.label} - ${noteText}`,
          userId,
          activeVariant.label,
          actorName,
          session.role
        );

        if (!res.success) {
          // Revert optimistic state
          setCatalog(previousCatalog);
          setSelectedTile(previousSelectedTile);
          hapticFeedback.error();
          setOutwardError(res.error || 'Stock deduction failed on server.');
          showToast('Stock deduction failed. Reverted changes.', 'error');
        }
      }
    } catch (err: any) {
      setCatalog(previousCatalog);
      setSelectedTile(previousSelectedTile);
      hapticFeedback.error();
      setOutwardError(err?.message || 'Network error deducting stock.');
      showToast('Network error. Reverted changes.', 'error');
    }
  };

  // Feature #5: Inline Add Product Duplicate Detection (preserves form)
  const handleAddProduct = async () => {
    setAddError(null);
    if (!newName.trim()) {
      setAddError('Please enter the tile product name.');
      return;
    }

    const normalizedSize = newSize.replace(/x/gi, '×').replace(/\*/g, '×');
    const is12x18Tile = normalizedSize.includes('12×18') || (normalizedSize.includes('12') && normalizedSize.includes('18'));
    const basePrice = parseFloat(newPrice) || 850;
    const initialStock = parseInt(newStock) || 50;

    let variantsList: Array<{
      type: VariantType;
      label: string;
      pricePerBox: number;
      stock: number;
      color: string;
      accent: string;
    }> = [];

    if (is12x18Tile) {
      const pLight = parseFloat(lightPrice) || basePrice;
      const pHl = parseFloat(hlPrice) || Math.round(pLight * 1.3);
      const pDark = parseFloat(darkPrice) || Math.round(pLight * 1.05);
      const pFl = parseFloat(flPrice) || Math.round(pLight * 1.1);

      variantsList = [
        { type: 'light', label: 'Light', pricePerBox: pLight, stock: initialStock, color: '#F5F0E8', accent: '#D4C5A9' },
        { type: 'highlighter', label: 'Highlighter', pricePerBox: pHl, stock: Math.round(initialStock / 2), color: '#E8D5B7', accent: '#C4A882' },
        { type: 'dark', label: 'Dark', pricePerBox: pDark, stock: initialStock, color: '#B8A88E', accent: '#8E7A5C' },
        { type: 'flooring', label: 'Flooring', pricePerBox: pFl, stock: initialStock, color: '#D4C8B0', accent: '#A89880' },
      ];
    } else {
      variantsList = [
        { type: 'default', label: 'Standard', pricePerBox: basePrice, stock: initialStock, color: '#E5E7EB', accent: '#9CA3AF' },
      ];
    }

    setAddLoading(true);

    let userId: string | undefined;
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      userId = currentSession?.user?.id;
    } catch {}

    const actorName = session.full_name || session.username || session.email;
    const res = await catalogService.createProduct(
      {
        name: newName.trim(),
        brand: newBrand.trim() || 'Kajaria',
        size: is12x18Tile ? '12×18' : normalizedSize,
        sqftPerBox: is12x18Tile ? 12 : 16,
        tilesPerBox: is12x18Tile ? 8 : 4,
        is12x18: is12x18Tile,
        variants: variantsList,
      },
      session.shop_id,
      userId,
      actorName,
      session.role
    );

    setAddLoading(false);

    if (!res.success) {
      // Keep form intact and show inline error message!
      setAddError(res.error || 'Failed to register product.');
      return;
    }

    await loadCatalogData(true);

    showToast(`✅ Registered product "${newName.trim()}" in catalog!`, 'success');

    setNewName(''); setNewPrice(''); setNewStock('50');
    setLightPrice(''); setHlPrice(''); setDarkPrice(''); setFlPrice('');
    setAddModalVisible(false);
  };

  const handleTilePress = useCallback((tile: TileCollection) => {
    setInwardError(null);
    setOutwardError(null);
    setSelectedTile(tile);
    setSelectedVariantType(tile.is12x18 ? 'light' : 'default');
    setAdjustTab('inward');
  }, []);

  const handleTileQuickInward = useCallback((tile: TileCollection) => {
    setInwardError(null);
    setOutwardError(null);
    setSelectedTile(tile);
    setSelectedVariantType(tile.is12x18 ? 'light' : 'default');
    setAdjustTab('inward');
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Feature #12: Toast Banner */}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast(prev => ({ ...prev, visible: false }))}
      />

      {/* Main Content */}
      <ScrollView
        ref={mainScrollRef}
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
          <View style={styles.appBar}>
            <View style={styles.logoRow}>
              <View style={styles.logoIcon}>
                <Feather name="archive" size={16} color="#FFF" />
              </View>
              <Text style={styles.logoText}>Tilor<Text style={styles.logoDot}>.</Text></Text>
            </View>
            <View style={styles.appBarRight}>
              {session.role === 'owner' && (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => {
                    setAddError(null);
                    setAddModalVisible(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={14} color="#7C3AED" />
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              )}
              <View style={styles.roleBadge}>
                <View style={styles.roleIndicator} />
                <Text style={styles.roleText}>{session.role === 'owner' ? 'OWNER' : 'STAFF'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.pageTitleRow}>
            <View>
              <Text style={styles.pageSubtitle}>INVENTORY MANAGEMENT</Text>
              <Text style={styles.pageTitle}>Stock Ledger</Text>
            </View>
            <View style={styles.countBadge}>
              {loading ? (
                <SkeletonBox width={65} height={12} borderRadius={10} style={{ backgroundColor: 'rgba(255,255,255,0.4)' }} />
              ) : (
                <Text style={styles.countBadgeText}>{catalog.length} products</Text>
              )}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Main Operational Content */}
      <View style={styles.innerContent}>
        {/* Feature #1: KPI Cards with Low Stock Threshold Note */}
        {loading ? (
          <InventoryStatsSkeleton />
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>TOTAL STOCK</Text>
              <Text style={styles.statValue}>{totalBoxes} bx</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>VALUATION</Text>
              <Text style={[styles.statValue, { color: '#7C3AED' }]}>₹{(totalStockValue / 1000).toFixed(1)}k</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>LOW STOCK</Text>
              <Text style={[styles.statValue, { color: '#F97316' }]}>{lowCount} alerts</Text>
              <Text style={styles.statSubNote}>≤15 boxes</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>OUT OF STOCK</Text>
              <Text style={[styles.statValue, { color: '#EF4444' }]}>{outCount}</Text>
            </View>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchBar}>
          <Feather name="search" size={15} color="#A0AEC0" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tile name, brand, variant, or size…"
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

        {/* Size Filter & Sort Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
          {sizes.map(sz => (
            <TouchableOpacity
              key={sz}
              style={[styles.chip, activeSize === sz && styles.chipActive]}
              onPress={() => {
                hapticFeedback.selection();
                setActiveSize(sz);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, activeSize === sz && styles.chipTextActive]}>
                {sz === 'all' ? 'All Sizes' : sz}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Feature #6: Skeleton Shimmer Cards while initial loading */}
        {loading ? (
          <View style={styles.tileGrid}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : filteredAndSorted.length === 0 ? (
          /* Feature #7: Differentiated Empty States */
          <View style={styles.emptyState}>
            <Feather name="archive" size={36} color="#C4B5FD" />
            {catalog.length === 0 ? (
              <>
                <Text style={styles.emptyTitle}>No products in catalog yet</Text>
                <Text style={styles.emptySub}>Tap "+ Add" in the top bar to register your first tile product.</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>No matching tiles found</Text>
                <Text style={styles.emptySub}>
                  No products matched "{search || activeSize}". Clear search or select another size.
                </Text>
                <TouchableOpacity
                  style={styles.clearFilterBtn}
                  onPress={() => {
                    setSearch('');
                    setActiveSize('all');
                  }}
                >
                  <Feather name="refresh-cw" size={12} color="#7C3AED" />
                  <Text style={styles.clearFilterText}>Reset Filters</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <>
            <View style={styles.tileGrid}>
              {paginatedProducts.map(tile => (
                <TileCard
                  key={tile.id}
                  tile={tile}
                  onPress={handleTilePress}
                  onQuickInward={handleTileQuickInward}
                />
              ))}
            </View>

            {/* Feature: Product Pagination (10 per page) */}
            {totalPages > 1 && (
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  style={[styles.pageNavBtn, safePage === 1 && styles.pageNavBtnDisabled]}
                  onPress={() => {
                    hapticFeedback.selection();
                    setCurrentPage(p => Math.max(1, p - 1));
                    mainScrollRef.current?.scrollTo({ y: 0, animated: true });
                  }}
                  disabled={safePage === 1}
                  activeOpacity={0.7}
                >
                  <Feather name="chevron-left" size={18} color={safePage === 1 ? '#CBD5E1' : '#7C3AED'} />
                </TouchableOpacity>

                <View style={styles.pageInfoBadge}>
                  <Text style={styles.pageInfoText}>
                    Page <Text style={styles.pageInfoCurrent}>{safePage}</Text> of {totalPages}
                  </Text>
                  <Text style={styles.pageCountSubText}>
                    Showing {Math.min(filteredAndSorted.length, (safePage - 1) * PAGE_SIZE + 1)}–{Math.min(filteredAndSorted.length, safePage * PAGE_SIZE)} of {filteredAndSorted.length} products
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.pageNavBtn, safePage === totalPages && styles.pageNavBtnDisabled]}
                  onPress={() => {
                    hapticFeedback.selection();
                    setCurrentPage(p => Math.min(totalPages, p + 1));
                    mainScrollRef.current?.scrollTo({ y: 0, animated: true });
                  }}
                  disabled={safePage === totalPages}
                  activeOpacity={0.7}
                >
                  <Feather name="chevron-right" size={18} color={safePage === totalPages ? '#CBD5E1' : '#7C3AED'} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        <View style={{ height: 28 }} />
      </View>
      </ScrollView>

      {/* Bottom Nav */}
      <BottomNavBar activeTab={activeTab} onTabPress={onTabChange} isOwner={session.role === 'owner' || session.role === 'admin'} />

      {/* ── Tile Detail / Adjust Modal ── */}
      <Modal visible={!!selectedTile} transparent animationType="slide" onRequestClose={() => setSelectedTile(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {selectedTile && activeVariant && (
              <>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    Stock Ledger: {selectedTile.name}
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedTile(null)} style={styles.modalCloseBtn}>
                    <Feather name="x" size={18} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {/* 12×18 Variant Selector Tabs */}
                {selectedTile.is12x18 && (
                  <View style={styles.variantSelectTabRow}>
                    {selectedTile.variants.map(v => (
                      <TouchableOpacity
                        key={v.type}
                        style={[
                          styles.variantSelectTab,
                          selectedVariantType === v.type && styles.variantSelectTabActive,
                        ]}
                        onPress={() => {
                          setInwardError(null);
                          setOutwardError(null);
                          setSelectedVariantType(v.type);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.variantSelectTabText,
                            selectedVariantType === v.type && styles.variantSelectTabTextActive,
                          ]}
                        >
                          {v.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Tile Variant Summary Card */}
                <View style={styles.detailSummaryCard}>
                  <View style={[styles.detailSwatch, { backgroundColor: activeVariant.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailName}>
                      {selectedTile.name} {selectedTile.is12x18 ? `(${activeVariant.label})` : ''}
                    </Text>
                    <Text style={styles.detailSpecs}>{selectedTile.size} · {selectedTile.sqftPerBox} sqft/box</Text>
                    <Text style={styles.detailPrice}>₹{activeVariant.pricePerBox.toLocaleString('en-IN')}/box</Text>
                  </View>
                  <View>
                    <Text style={styles.stockCountLarge}>{activeVariant.stock}</Text>
                    <Text style={styles.stockCountUnit}>boxes</Text>
                  </View>
                </View>

                {/* Inward/Outward/History Tabs */}
                <View style={styles.adjustTabRow}>
                  {(['inward', 'outward', 'history'] as AdjustTab[]).map(tab => (
                    <TouchableOpacity
                      key={tab}
                      style={[styles.adjustTab, adjustTab === tab && styles.adjustTabActive]}
                      onPress={() => {
                        setInwardError(null);
                        setOutwardError(null);
                        setAdjustTab(tab);
                      }}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name={tab === 'inward' ? 'arrow-down-circle' : tab === 'outward' ? 'arrow-up-circle' : 'clock'}
                        size={12}
                        color={adjustTab === tab ? '#7C3AED' : '#A0AEC0'}
                      />
                      <Text style={[styles.adjustTabText, adjustTab === tab && styles.adjustTabTextActive]}>
                        {tab === 'inward' ? 'Inward' : tab === 'outward' ? 'Outward' : 'History'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Inward Panel */}
                {adjustTab === 'inward' && (
                  <View style={styles.panelContent}>
                    <Text style={styles.fieldLabel}>INWARD QUANTITY (BOXES)</Text>

                    {/* Feature #11: Quantity Stepper */}
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          const current = parseInt(inwardQty) || 1;
                          setInwardQty(Math.max(1, current - 1).toString());
                        }}
                      >
                        <Feather name="minus" size={16} color="#7C3AED" />
                      </TouchableOpacity>

                      <TextInput
                        style={[styles.fieldInput, { flex: 1, textAlign: 'center', fontWeight: 'bold' }]}
                        keyboardType="numeric"
                        autoFocus
                        value={inwardQty}
                        onChangeText={(text) => {
                          setInwardQty(text);
                          if (inwardError) setInwardError(null);
                        }}
                      />

                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          const current = parseInt(inwardQty) || 0;
                          setInwardQty((current + 1).toString());
                        }}
                      >
                        <Feather name="plus" size={16} color="#7C3AED" />
                      </TouchableOpacity>
                    </View>

                    {/* Feature #10: Inline Validation Error */}
                    {inwardError && (
                      <View style={styles.inlineErrorBox}>
                        <Feather name="alert-circle" size={12} color="#EF4444" />
                        <Text style={styles.inlineErrorText}>{inwardError}</Text>
                      </View>
                    )}

                    <Text style={styles.fieldLabel}>SUPPLIER NOTE / REFERENCE</Text>
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="e.g. Factory shipment batch #9"
                      placeholderTextColor="#A0AEC0"
                      value={inwardNote}
                      onChangeText={setInwardNote}
                    />

                    <TouchableOpacity
                      style={styles.actionBtnGreen}
                      onPress={handleInward}
                      activeOpacity={0.8}
                      disabled={adjustLoading}
                    >
                      {adjustLoading ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Feather name="arrow-down-circle" size={14} color="#FFF" />
                          <Text style={styles.actionBtnText}>Add to {activeVariant.label} Stock</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Outward Panel */}
                {adjustTab === 'outward' && (
                  <View style={styles.panelContent}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.fieldLabel}>OUTWARD QUANTITY (BOXES)</Text>
                      {/* Feature #11: MAX Button */}
                      <TouchableOpacity
                        style={styles.maxBtn}
                        onPress={() => {
                          setOutwardQty(activeVariant.stock.toString());
                          if (outwardError) setOutwardError(null);
                        }}
                      >
                        <Text style={styles.maxBtnText}>MAX ({activeVariant.stock})</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Feature #11: Quantity Stepper */}
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          const current = parseInt(outwardQty) || 1;
                          setOutwardQty(Math.max(1, current - 1).toString());
                        }}
                      >
                        <Feather name="minus" size={16} color="#EF4444" />
                      </TouchableOpacity>

                      <TextInput
                        style={[styles.fieldInput, { flex: 1, textAlign: 'center', fontWeight: 'bold' }]}
                        keyboardType="numeric"
                        autoFocus
                        value={outwardQty}
                        onChangeText={(text) => {
                          setOutwardQty(text);
                          if (outwardError) setOutwardError(null);
                        }}
                      />

                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          const current = parseInt(outwardQty) || 0;
                          setOutwardQty(Math.min(activeVariant.stock, current + 1).toString());
                        }}
                      >
                        <Feather name="plus" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    </View>

                    {/* Feature #10: Inline Validation Error */}
                    {outwardError && (
                      <View style={styles.inlineErrorBox}>
                        <Feather name="alert-circle" size={12} color="#EF4444" />
                        <Text style={styles.inlineErrorText}>{outwardError}</Text>
                      </View>
                    )}

                    <Text style={styles.fieldLabel}>REASON / REFERENCE</Text>
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="e.g. Bill #TX-1042, Damaged in transit, Transfer"
                      placeholderTextColor="#A0AEC0"
                      value={outwardNote}
                      onChangeText={setOutwardNote}
                    />

                    <TouchableOpacity
                      style={styles.actionBtnRed}
                      onPress={promptOutwardConfirmation}
                      activeOpacity={0.8}
                      disabled={adjustLoading}
                    >
                      {adjustLoading ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <>
                          <Feather name="arrow-up-circle" size={14} color="#FFF" />
                          <Text style={styles.actionBtnText}>Deduct from {activeVariant.label} Stock</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* History Panel */}
                {adjustTab === 'history' && (
                  <ScrollView style={styles.historyPanel} showsVerticalScrollIndicator={false}>
                    {historyLoading && historyLogs.length === 0 ? (
                      <ActivityIndicator size="small" color="#7C3AED" style={{ paddingVertical: 20 }} />
                    ) : historyLogs.length > 0 ? (
                      <>
                        {historyLogs.map((log, idx) => (
                          <View key={log.id || idx} style={styles.historyItem}>
                            <View
                              style={[
                                styles.historyDot,
                                { backgroundColor: log.type === 'inward' ? '#10B981' : '#EF4444' },
                              ]}
                            >
                              <Feather name={log.type === 'inward' ? 'arrow-down' : 'arrow-up'} size={8} color="#FFF" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.historyLabel}>
                                {log.type === 'inward' ? `+${log.boxes} boxes` : `-${log.boxes} boxes`}
                              </Text>
                              <Text style={styles.historyRef}>{log.reference}</Text>
                              {log.performed_by_name && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                  <Feather name="user" size={12} color="#8B5CF6" style={{ marginRight: 4 }} />
                                  <Text style={[styles.historyUser, { color: '#8B5CF6', fontSize: 13, fontWeight: '500' }]}>
                                    {log.performed_by_name}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.historyDate}>
                              {new Date(log.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </View>
                        ))}
                        {historyHasMore && (
                          <TouchableOpacity
                            style={styles.loadMoreBtn}
                            onPress={() => activeVariant.id && loadVariantHistory(activeVariant.id)}
                            disabled={historyLoading}
                          >
                            {historyLoading ? (
                              <ActivityIndicator size="small" color="#7C3AED" />
                            ) : (
                              <Text style={styles.loadMoreText}>Load More History</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </>
                    ) : (
                      <Text style={styles.emptyText}>No history logs recorded.</Text>
                    )}
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Feature #8: Confirmation Sheet before Outward Deduction ── */}
      <Modal visible={confirmOutwardVisible} transparent animationType="fade" onRequestClose={() => setConfirmOutwardVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { borderRadius: 24, padding: 20 }]}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Feather name="alert-triangle" size={24} color="#EF4444" />
              </View>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' }}>Confirm Stock Deduction</Text>
              <Text style={{ fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
                Deduct <Text style={{ fontWeight: 'bold', color: '#EF4444' }}>{confirmQty} boxes</Text> of{' '}
                <Text style={{ fontWeight: 'bold', color: '#1A1A2E' }}>{activeVariant?.label}</Text> from{' '}
                {selectedTile?.name}?
              </Text>

              {outwardNote.trim().length > 0 && (
                <View style={{ backgroundColor: '#F8F6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginTop: 8 }}>
                  <Text style={{ fontSize: 11, color: '#7C3AED', fontWeight: '500' }}>Reason: "{outwardNote}"</Text>
                </View>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#F3F4F6', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
                onPress={() => setConfirmOutwardVisible(false)}
              >
                <Text style={{ color: '#6B7280', fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#EF4444', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
                onPress={executeOutwardDeduction}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Deduct Stock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add Product Modal ── */}
      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { borderRadius: 28 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Product</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
              {/* Feature #5: Inline Form Validation Error Banner */}
              {addError && (
                <View style={styles.inlineFormError}>
                  <Feather name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.inlineFormErrorText}>{addError}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>TILE NAME</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Arabescato White"
                placeholderTextColor="#A0AEC0"
                value={newName}
                onChangeText={(t) => { setNewName(t); if (addError) setAddError(null); }}
              />

              <Text style={styles.fieldLabel}>BRAND NAME</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Kajaria, Somany, Nitco"
                placeholderTextColor="#A0AEC0"
                value={newBrand}
                onChangeText={(t) => { setNewBrand(t); if (addError) setAddError(null); }}
              />

              <Text style={styles.fieldLabel}>TILE SIZE</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {['12×18', '2×2', '2×4', '1×4'].map(sz => (
                  <TouchableOpacity
                    key={sz}
                    style={[styles.sizeOptionPill, newSize === sz && styles.sizeOptionPillActive]}
                    onPress={() => setNewSize(sz)}
                  >
                    <Text style={[styles.sizeOptionText, newSize === sz && styles.sizeOptionTextActive]}>{sz}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>BASE PRICE PER BOX (₹)</Text>
              <TextInput style={styles.fieldInput} keyboardType="numeric" placeholder="e.g. 850" placeholderTextColor="#A0AEC0" value={newPrice} onChangeText={setNewPrice} />

              <Text style={styles.fieldLabel}>INITIAL STOCK (BOXES)</Text>
              <TextInput style={styles.fieldInput} keyboardType="numeric" value={newStock} onChangeText={setNewStock} />

              {/* 12×18 Variant Pricing Overrides */}
              {newSize.includes('12') && (
                <View style={{ backgroundColor: '#FAF5FF', borderRadius: 14, padding: 12, marginTop: 4, marginBottom: 10, borderWidth: 1, borderColor: '#E9D5FF', gap: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#7C3AED' }}>12×18 VARIANT PRICES (OPTIONAL OVERRIDES)</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 9, color: '#6B7280', marginBottom: 2 }}>Light (₹)</Text>
                      <TextInput style={styles.fieldInput} keyboardType="numeric" placeholder={newPrice || '850'} placeholderTextColor="#A0AEC0" value={lightPrice} onChangeText={setLightPrice} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 9, color: '#6B7280', marginBottom: 2 }}>HL (₹)</Text>
                      <TextInput style={styles.fieldInput} keyboardType="numeric" placeholder="1150" placeholderTextColor="#A0AEC0" value={hlPrice} onChangeText={setHlPrice} />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 9, color: '#6B7280', marginBottom: 2 }}>Dark (₹)</Text>
                      <TextInput style={styles.fieldInput} keyboardType="numeric" placeholder="890" placeholderTextColor="#A0AEC0" value={darkPrice} onChangeText={setDarkPrice} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 9, color: '#6B7280', marginBottom: 2 }}>Flooring (₹)</Text>
                      <TextInput style={styles.fieldInput} keyboardType="numeric" placeholder="930" placeholderTextColor="#A0AEC0" value={flPrice} onChangeText={setFlPrice} />
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddModalVisible(false)} activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={handleAddProduct} activeOpacity={0.8} disabled={addLoading}>
                <LinearGradient colors={['#7C3AED', '#9333EA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitBtnGrad}>
                  {addLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Register Tile</Text>
                  )}
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
  toastContainer: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 10,
    boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.25)',
  },
  toastText: { color: '#FFF', fontSize: 12, fontWeight: 'bold', flex: 1 },
  header: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 20 },
  safeHeader: { paddingHorizontal: 20 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 9 },
  logoText: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  logoDot: { color: '#C084FC' },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 4 },
  addBtnText: { color: '#7C3AED', fontSize: 11, fontWeight: 'bold' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  pageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 },
  pageSubtitle: { fontSize: 11, color: '#DDD6FE', fontWeight: '700', letterSpacing: 1.2 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', marginTop: 4 },
  countBadge: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  countBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  innerContent: { paddingHorizontal: 16, paddingTop: 14 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#F3E8FF' },
  statLabel: { fontSize: 7, color: '#A0AEC0', fontWeight: 'bold', letterSpacing: 0.5 },
  statValue: { fontSize: 13, fontWeight: '800', color: '#1A1A2E', marginTop: 2 },
  statSubNote: { fontSize: 7, color: '#A0AEC0', marginTop: 2, fontWeight: '500' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },
  chipsRow: { marginBottom: 14 },
  chipsContent: { paddingRight: 4, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E9D5FF' },
  chipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#6B7280' },
  chipTextActive: { color: '#FFF' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E', marginTop: 4 },
  emptySub: { fontSize: 11, color: '#A0AEC0', textAlign: 'center', paddingHorizontal: 20 },
  emptyText: { fontSize: 11, color: '#A0AEC0', textAlign: 'center', marginVertical: 16 },
  clearFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#E9D5FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  clearFilterText: { fontSize: 11, color: '#7C3AED', fontWeight: 'bold' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileCard: { width: '47.5%', backgroundColor: '#FFF', borderRadius: 20, borderWidth: 1, borderColor: '#F3E8FF', padding: 12, boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  swatchArea: { width: '100%', height: 76, borderRadius: 12, marginBottom: 10, justifyContent: 'space-between', alignItems: 'flex-start', padding: 6 },
  swatchId: { backgroundColor: 'rgba(0,0,0,0.4)', color: '#FFF', fontSize: 7, fontWeight: 'bold', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, textTransform: 'uppercase' },
  quickInwardBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 3, alignSelf: 'flex-end', boxShadow: '0px 1px 3px rgba(0,0,0,0.1)' },
  quickInwardText: { fontSize: 9, fontWeight: 'bold', color: '#7C3AED' },
  tileInfo: { gap: 2, marginBottom: 10 },
  tileName: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  tileBrand: { fontSize: 9, color: '#7C3AED', fontWeight: '600', backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  tileSpecs: { fontSize: 9, color: '#A0AEC0', marginTop: 2 },
  variantBadgesRow: { flexDirection: 'row', gap: 3, marginTop: 4 },
  vBadge: { backgroundColor: '#EDE9FE', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  vBadgeText: { fontSize: 8, fontWeight: 'bold', color: '#6D28D9' },
  tileFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F3E8FF', paddingTop: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 9, fontWeight: 'bold' },
  stockCount: { fontSize: 11, fontWeight: '800', color: '#1A1A2E' },
  // Pagination
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 16,
    boxShadow: '0px 2px 8px rgba(124, 58, 237, 0.04)',
  },
  pageNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageNavBtnDisabled: {
    backgroundColor: '#F1F5F9',
  },
  pageInfoBadge: {
    alignItems: 'center',
  },
  pageInfoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  pageInfoCurrent: {
    color: '#7C3AED',
    fontWeight: '800',
  },
  pageCountSubText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '500',
  },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalTitle: { fontSize: 15, fontWeight: 'bold', color: '#1A1A2E' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  variantSelectTabRow: { flexDirection: 'row', backgroundColor: '#F3E8FF', borderRadius: 12, padding: 3, marginBottom: 12, gap: 4 },
  variantSelectTab: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  variantSelectTabActive: { backgroundColor: '#7C3AED' },
  variantSelectTabText: { fontSize: 10, fontWeight: 'bold', color: '#7C3AED' },
  variantSelectTabTextActive: { color: '#FFF' },
  detailSummaryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 16, padding: 14, marginBottom: 16, gap: 12 },
  detailSwatch: { width: 56, height: 56, borderRadius: 12 },
  detailName: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E' },
  detailSpecs: { fontSize: 10, color: '#A0AEC0', marginTop: 2 },
  detailPrice: { fontSize: 12, fontWeight: 'bold', color: '#7C3AED', marginTop: 4 },
  stockCountLarge: { fontSize: 24, fontWeight: '800', color: '#7C3AED', textAlign: 'right' },
  stockCountUnit: { fontSize: 10, color: '#A0AEC0', textAlign: 'right' },
  adjustTabRow: { flexDirection: 'row', backgroundColor: '#F8F6FF', borderRadius: 12, padding: 4, marginBottom: 16, gap: 4 },
  adjustTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 8, gap: 4 },
  adjustTabActive: { backgroundColor: '#FFF', boxShadow: '0px 1px 4px rgba(0,0,0,0.08)' },
  adjustTabText: { fontSize: 10, color: '#A0AEC0', fontWeight: '600' },
  adjustTabTextActive: { color: '#7C3AED' },
  panelContent: { gap: 10 },
  fieldLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.8, marginBottom: 4 },
  fieldInput: { backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: '#1A1A2E', fontWeight: '500' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center' },
  maxBtn: { backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#FCA5A5' },
  maxBtnText: { fontSize: 9, color: '#DC2626', fontWeight: 'bold' },
  inlineErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF2F2', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 2 },
  inlineErrorText: { fontSize: 11, color: '#DC2626', fontWeight: '500', flex: 1 },
  inlineFormError: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderLeftWidth: 3, borderLeftColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginBottom: 12 },
  inlineFormErrorText: { fontSize: 12, color: '#DC2626', fontWeight: '600', flex: 1 },
  actionBtnGreen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 12, gap: 6, marginTop: 4 },
  actionBtnRed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 12, gap: 6, marginTop: 4 },
  actionBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  historyPanel: { maxHeight: 240 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  historyDot: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  historyLabel: { fontSize: 12, fontWeight: 'bold', color: '#1A1A2E' },
  historyRef: { fontSize: 10, color: '#A0AEC0', marginTop: 1 },
  historyUser: { fontSize: 8, color: '#7C3AED', fontWeight: '600', marginTop: 1 },
  historyDate: { fontSize: 9, color: '#A0AEC0', fontWeight: '600' },
  loadMoreBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  loadMoreText: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#6B7280', fontWeight: '600', fontSize: 13 },
  submitBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  submitBtnGrad: { paddingVertical: 14, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  sizeOptionPill: { flex: 1, paddingVertical: 8, backgroundColor: '#F8F6FF', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  sizeOptionPillActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  sizeOptionText: { fontSize: 11, fontWeight: 'bold', color: '#6B7280' },
  sizeOptionTextActive: { color: '#FFF' },
});
