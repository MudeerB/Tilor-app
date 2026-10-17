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
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavTab } from '../components/BottomNavBar';
import { UserSession } from '../services/storage';
import { TileCollection, StockAuditLogItem } from '../types/tiles';
import { SEED_CATALOG } from '../data/seed-catalog';
import { StockManagerSkeleton } from '../components/skeleton';
import { catalogService } from '../services/catalog';
import { supabase } from '../services/supabase';
import { useDebouncedValue } from '../hooks/useDebounce';
import { hapticFeedback } from '../utils/haptics';

const CATALOG_KEY = 'tilor_tile_catalog';
const LOGS_PAGE_SIZE = 9;

interface StockManagerScreenProps {
  session: UserSession;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
}

type TabType = 'products' | 'history_audit';
type LogFilterType = 'all' | 'inward' | 'outward';

/**
 * Formats counts to display max 99 (e.g. 13 -> "13", 104 -> "99+")
 */
const formatMax99 = (num: number): string => {
  return num > 99 ? '99+' : `${num}`;
};

// ─── Memoized Subcomponents ──────────────────────────────────────────────────

interface TileStockCardProps {
  col: TileCollection;
  onEdit: (col: TileCollection) => void;
  onDelete: (col: TileCollection) => void;
}

const TileStockCard = React.memo<TileStockCardProps>(({ col, onEdit, onDelete }) => {
  const totalStock = col.variants.reduce((s, v) => s + v.stock, 0);

  return (
    <View style={styles.productCard}>
      <View style={styles.productTopRow}>
        <View style={[styles.swatchSquare, { backgroundColor: col.variants[0]?.color || '#E5E7EB' }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.productName}>{col.name}</Text>
          <Text style={styles.productBrandSpecs}>
            {col.brand} • {col.size} • {col.sqftPerBox} sqft/bx
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.stockTotalVal}>{totalStock} bx</Text>
          <Text style={styles.stockTotalLabel}>Total Available</Text>
        </View>
      </View>

      {/* Variants Stock Breakdown */}
      <View style={styles.variantsBreakdownBox}>
        {col.variants.map(v => (
          <View key={v.type} style={styles.vBreakdownItem}>
            <Text style={styles.vBreakdownLabel}>
              {v.label} ({v.type})
            </Text>
            <Text style={styles.vBreakdownVal}>
              {v.stock} boxes • ₹{v.pricePerBox}/bx
            </Text>
          </View>
        ))}
      </View>

      {/* Card Actions */}
      <View style={styles.productActionsRow}>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => onEdit(col)}
          activeOpacity={0.8}
        >
          <Feather name="edit-2" size={13} color="#7C3AED" />
          <Text style={styles.editBtnText}>Edit Product &amp; Stock</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => onDelete(col)}
          activeOpacity={0.8}
        >
          <Feather name="trash-2" size={13} color="#EF4444" />
          <Text style={styles.deleteBtnText}>Delete Tile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
TileStockCard.displayName = 'TileStockCard';

interface StockAuditLogRowProps {
  item: StockAuditLogItem;
}

const StockAuditLogRow = React.memo<StockAuditLogRowProps>(({ item }) => {
  const isInward = item.type === 'inward';
  const formattedDate = new Date(item.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const isInvoice = (item.reference || '').toLowerCase().includes('invoice');

  return (
    <View style={styles.logCard}>
      {/* Top Row: Movement Pill + Date */}
      <View style={styles.logTopRow}>
        <View style={[styles.logTypeTag, isInward ? styles.tagInward : styles.tagOutward]}>
          <Feather name={isInward ? 'arrow-down' : 'arrow-up'} size={11} color="#FFF" />
          <Text style={styles.logTypeTagText}>{item.type.toUpperCase()}</Text>
        </View>
        <Text style={styles.logDateText}>{formattedDate}</Text>
      </View>

      {/* Product Name & Variant */}
      <View style={styles.logProductRow}>
        <Text style={styles.logTitleText}>{item.tile_name}</Text>
        <View style={styles.variantBadge}>
          <Text style={styles.variantBadgeText}>{item.variant_label}</Text>
        </View>
      </View>

      {/* Brand & Size Specs */}
      {(item.tile_brand || item.tile_size) ? (
        <Text style={styles.logSpecText}>
          {[item.tile_brand, item.tile_size].filter(Boolean).join(' • ')}
        </Text>
      ) : null}

      {/* Reference Note & Performed By */}
      <View style={styles.logMetaBox}>
        <View style={styles.metaRow}>
          <Feather name={isInvoice ? 'file-text' : 'tag'} size={12} color="#6B7280" />
          <Text style={styles.metaRefText} numberOfLines={1}>
            Ref: <Text style={{ fontWeight: '700', color: isInvoice ? '#6D28D9' : '#374151' }}>{item.reference || 'Stock Adjustment'}</Text>
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Feather name="user" size={12} color="#6B7280" />
          <Text style={styles.metaUserText}>By {item.performed_by_name}</Text>
        </View>
      </View>

      {/* Footer: Box Quantity Delta */}
      <View style={styles.logFooterRow}>
        <View style={styles.verifiedRow}>
          <Feather name="check-circle" size={12} color="#10B981" />
          <Text style={styles.verifiedText}>Verified Movement</Text>
        </View>
        <View style={[styles.qtyBadge, isInward ? styles.qtyBadgeInward : styles.qtyBadgeOutward]}>
          <Text style={[styles.logQtyText, isInward ? styles.textGreen : styles.textRed]}>
            {isInward ? `+${item.boxes} boxes` : `-${item.boxes} boxes`}
          </Text>
        </View>
      </View>
    </View>
  );
});
StockAuditLogRow.displayName = 'StockAuditLogRow';

export const StockManagerScreen: React.FC<StockManagerScreenProps> = ({
  session,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const [catalog, setCatalog]                     = useState<TileCollection[]>([]);
  const [auditLogs, setAuditLogs]                 = useState<StockAuditLogItem[]>([]);
  const [search, setSearch]                       = useState('');
  const debouncedSearch                           = useDebouncedValue(search, 200);
  const [activeTabType, setActiveTabType]         = useState<TabType>('products');
  const [logFilter, setLogFilter]                 = useState<LogFilterType>('all');
  const [currentPage, setCurrentPage]             = useState(1);

  // Edit Stock Item Modal State
  const [editModalVisible, setEditModalVisible]   = useState(false);
  const [editingTile, setEditingTile]             = useState<TileCollection | null>(null);
  const [editName, setEditName]                   = useState('');
  const [editBrand, setEditBrand]                 = useState('');
  const [editSize, setEditSize]                   = useState('');
  const [editSqft, setEditSqft]                   = useState('');
  const [editVariantStocks, setEditVariantStocks] = useState<{ [variantType: string]: { stock: string; price: string } }>({});

  // Delete Confirm Modal State
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [tileToDelete, setTileToDelete]                 = useState<TileCollection | null>(null);

  const [loading, setLoading]                         = useState(true);
  const [refreshing, setRefreshing]                   = useState(false);

  const catalogCacheKey = session?.shop_id ? `tilor_tile_catalog_${session.shop_id}` : CATALOG_KEY;

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [fetchedCatalog, fetchedLogs] = await Promise.all([
        catalogService.fetchCatalog(session?.shop_id),
        catalogService.fetchStockAuditLogs(session?.shop_id, 100, 0),
      ]);
      setCatalog(fetchedCatalog);
      setAuditLogs(fetchedLogs);
    } catch (err) {
      console.warn('[StockManagerScreen] loadData error, falling back to cache:', err);
      try {
        const stored = await AsyncStorage.getItem(catalogCacheKey);
        if (stored) {
          setCatalog(JSON.parse(stored));
        } else {
          setCatalog(SEED_CATALOG);
        }
      } catch {
        setCatalog(SEED_CATALOG);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [catalogCacheKey, session?.shop_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true);
  }, [loadData]);

  // Reset pagination when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [logFilter, debouncedSearch]);

  const saveCatalogLocally = async (updated: TileCollection[]) => {
    await AsyncStorage.setItem(catalogCacheKey, JSON.stringify(updated));
    setCatalog(updated);
  };

  // ─── Actions with Optimistic UI & Rollback ──────────────────────────────────

  const openEditModal = useCallback((col: TileCollection) => {
    setEditingTile(col);
    setEditName(col.name);
    setEditBrand(col.brand);
    setEditSize(col.size);
    setEditSqft(col.sqftPerBox.toString());

    const initialVariants: { [key: string]: { stock: string; price: string } } = {};
    col.variants.forEach(v => {
      initialVariants[v.type] = {
        stock: v.stock.toString(),
        price: v.pricePerBox.toString(),
      };
    });
    setEditVariantStocks(initialVariants);
    setEditModalVisible(true);
  }, []);

  const promptDeleteTile = useCallback((col: TileCollection) => {
    setTileToDelete(col);
    setDeleteConfirmVisible(true);
  }, []);

  const handleSaveProductEdit = async () => {
    if (!editingTile || !editName.trim()) {
      Alert.alert('Required', 'Please enter tile name.');
      return;
    }

    const tileToSave = editingTile;
    const previousCatalog = catalog;
    const newName = editName.trim();
    const newBrand = editBrand.trim() || tileToSave.brand;
    const newSize = editSize.trim() || tileToSave.size;
    const newSqft = parseFloat(editSqft) || tileToSave.sqftPerBox;

    const updatedVariants = tileToSave.variants.map(v => {
      const override = editVariantStocks[v.type];
      if (!override) return v;

      const newStock = Math.max(0, parseInt(override.stock) || 0);
      const newPrice = Math.max(0, parseFloat(override.price) || v.pricePerBox);

      return {
        ...v,
        stock: newStock,
        pricePerBox: newPrice,
      };
    });

    const updatedCatalog = catalog.map(col => {
      if (col.id !== tileToSave.id) return col;
      return {
        ...col,
        name: newName,
        brand: newBrand,
        size: newSize,
        sqftPerBox: newSqft,
        variants: updatedVariants,
      };
    });

    // 1. Optimistic Local Update
    setCatalog(updatedCatalog);
    setEditModalVisible(false);
    setEditingTile(null);
    hapticFeedback.success();

    // 2. Persist in Background with Rollback on Failure
    try {
      if (tileToSave.id) {
        await supabase
          .from('tile_collections')
          .update({
            name: newName,
            brand: newBrand,
            size: newSize,
            sqft_per_box: newSqft,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tileToSave.id);

        for (const v of updatedVariants) {
          if (v.id) {
            await supabase
              .from('tile_variants')
              .update({
                stock: v.stock,
                price_per_box: v.pricePerBox,
                updated_at: new Date().toISOString(),
              })
              .eq('id', v.id);
          }
        }
      }
      await AsyncStorage.setItem(catalogCacheKey, JSON.stringify(updatedCatalog));
    } catch (err: any) {
      // Rollback on error
      setCatalog(previousCatalog);
      hapticFeedback.error();
      Alert.alert('Update Failed', err?.message || 'Failed to update product. Reverted changes.');
    }
  };

  const handleConfirmDeleteTile = async () => {
    if (!tileToDelete) return;
    const tileRemoved = tileToDelete;
    const previousCatalog = catalog;
    const updated = catalog.filter(t => t.id !== tileRemoved.id);

    // 1. Optimistic Local Update
    setCatalog(updated);
    setDeleteConfirmVisible(false);
    setTileToDelete(null);
    hapticFeedback.success();

    // 2. Persist in Background with Rollback on Failure
    try {
      if (tileRemoved.id) {
        await supabase
          .from('tile_collections')
          .update({ is_archived: true })
          .eq('id', tileRemoved.id);
      }
      await AsyncStorage.setItem(catalogCacheKey, JSON.stringify(updated));
    } catch (err: any) {
      // Rollback on error
      setCatalog(previousCatalog);
      hapticFeedback.error();
      Alert.alert('Delete Failed', err?.message || 'Failed to delete product. Reverted changes.');
    }
  };

  // ─── Filtered Data & Pagination (Using Debounced Search) ────────────────────

  const filteredCatalog = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return catalog;
    return catalog.filter(t => (
      t.name.toLowerCase().includes(q) ||
      t.brand.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    ));
  }, [catalog, debouncedSearch]);

  const inwardLogsCount = auditLogs.filter(l => l.type === 'inward').length;
  const outwardLogsCount = auditLogs.filter(l => l.type === 'outward').length;
  const totalInwardBoxes = auditLogs.filter(l => l.type === 'inward').reduce((sum, l) => sum + l.boxes, 0);
  const totalOutwardBoxes = auditLogs.filter(l => l.type === 'outward').reduce((sum, l) => sum + l.boxes, 0);

  const filteredAuditLogs = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return auditLogs.filter(item => {
      const matchesType = logFilter === 'all' || item.type === logFilter;
      const matchesSearch =
        !q ||
        item.tile_name.toLowerCase().includes(q) ||
        item.tile_brand.toLowerCase().includes(q) ||
        item.variant_label.toLowerCase().includes(q) ||
        item.reference.toLowerCase().includes(q) ||
        item.performed_by_name.toLowerCase().includes(q);

      return matchesType && matchesSearch;
    });
  }, [auditLogs, logFilter, debouncedSearch]);

  // Pagination (Max 9 cards per page)
  const totalPages = Math.max(1, Math.ceil(filteredAuditLogs.length / LOGS_PAGE_SIZE));
  const paginatedAuditLogs = filteredAuditLogs.slice(
    (currentPage - 1) * LOGS_PAGE_SIZE,
    currentPage * LOGS_PAGE_SIZE
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#7C3AED']}
            tintColor="#7C3AED"
          />
        }
      >
        {/* Header with Generous Hierarchy and Spacing */}
        <LinearGradient
          colors={['#6D28D9', '#7C3AED', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']} style={styles.safeHeader}>
            {/* Top Bar: Back Button & Role Badge */}
            <View style={styles.appBar}>
              <TouchableOpacity onPress={() => onTabChange('home')} style={styles.backBtn} activeOpacity={0.7}>
                <View style={styles.backIconCircle}>
                  <Feather name="arrow-left" size={16} color="#FFF" />
                </View>
                <Text style={styles.backBtnText}>Dashboard</Text>
              </TouchableOpacity>

              <View style={styles.roleBadge}>
                <View style={styles.roleIndicator} />
                <Text style={styles.roleText}>
                  {session.role === 'admin' ? 'ADMIN' : session.role === 'owner' ? 'OWNER' : 'STOCK AUDITOR'}
                </Text>
              </View>
            </View>

            {/* Page Title & Subtitle with Dedicated Row Spacing */}
            <View style={styles.pageTitleContainer}>
              <View style={styles.pageSubtitleRow}>
                <Text style={styles.pageSubtitle}>INVENTORY &amp; MOVEMENT AUDIT</Text>
                <View style={styles.countBadge}>
                  <Feather name="layers" size={10} color="#EDE9FE" style={{ marginRight: 4 }} />
                  <Text style={styles.countBadgeText}>
                    {formatMax99(catalog.length)} items • {formatMax99(auditLogs.length)} logs
                  </Text>
                </View>
              </View>
              <Text style={styles.pageTitle}>Stock Audit &amp; Manager</Text>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.bodyContent}>
          {/* Mode Tab Switcher with Max 99 Formatting */}
          <View style={styles.tabToggleRow}>
            <TouchableOpacity
              style={[styles.tabToggleBtn, activeTabType === 'products' && styles.tabToggleBtnActive]}
              onPress={() => setActiveTabType('products')}
              activeOpacity={0.7}
            >
              <Feather name="edit-3" size={14} color={activeTabType === 'products' ? '#FFF' : '#A0AEC0'} />
              <Text style={[styles.tabToggleText, activeTabType === 'products' && styles.tabToggleTextActive]}>
                Catalog &amp; Stock ({formatMax99(catalog.length)})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabToggleBtn, activeTabType === 'history_audit' && styles.tabToggleBtnActive]}
              onPress={() => setActiveTabType('history_audit')}
              activeOpacity={0.7}
            >
              <Feather name="clock" size={14} color={activeTabType === 'history_audit' ? '#FFF' : '#A0AEC0'} />
              <Text style={[styles.tabToggleText, activeTabType === 'history_audit' && styles.tabToggleTextActive]}>
                History Audit Log ({formatMax99(auditLogs.length)})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchBar}>
            <Feather name="search" size={15} color="#A0AEC0" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={activeTabType === 'products' ? 'Search tile name or ID...' : 'Search logs, invoices, variants, staff...'}
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

          {/* ── MODE A: Products Stock Editing & Deletion ── */}
          {loading ? (
            <StockManagerSkeleton />
          ) : activeTabType === 'products' ? (
            <View style={styles.productsList}>
              {filteredCatalog.length === 0 ? (
                <View style={styles.emptyCard}>
                  <View style={styles.emptyIconCircle}>
                    <Feather name="archive" size={26} color="#7C3AED" />
                  </View>
                  <Text style={styles.emptyTitle}>No matching catalog products</Text>
                  <Text style={styles.emptyText}>Try searching with a different brand or tile name.</Text>
                </View>
              ) : (
                filteredCatalog.map(col => (
                  <TileStockCard
                    key={col.id}
                    col={col}
                    onEdit={openEditModal}
                    onDelete={promptDeleteTile}
                  />
                ))
              )}
            </View>
          ) : null}

          {/* ── MODE B: History Audit Log Feed ── */}
          {!loading && activeTabType === 'history_audit' && (
            <View>
              {/* Summary Stats Row with Max 99 Formatting */}
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>{formatMax99(auditLogs.length)}</Text>
                  <Text style={styles.statLbl}>TOTAL LOGS</Text>
                </View>
                <View style={[styles.statBox, styles.statBoxInward]}>
                  <Text style={[styles.statVal, { color: '#059669' }]}>+{totalInwardBoxes}</Text>
                  <Text style={[styles.statLbl, { color: '#059669' }]}>INWARD (BX)</Text>
                </View>
                <View style={[styles.statBox, styles.statBoxOutward]}>
                  <Text style={[styles.statVal, { color: '#DC2626' }]}>-{totalOutwardBoxes}</Text>
                  <Text style={[styles.statLbl, { color: '#DC2626' }]}>OUTWARD (BX)</Text>
                </View>
              </View>

              {/* Filter Chips with Max 99 Formatting */}
              <View style={styles.logFilterRow}>
                {(['all', 'inward', 'outward'] as LogFilterType[]).map(f => {
                  const count = f === 'all' ? auditLogs.length : f === 'inward' ? inwardLogsCount : outwardLogsCount;
                  return (
                    <TouchableOpacity
                      key={f}
                      style={[styles.logFilterChip, logFilter === f && styles.logFilterChipActive]}
                      onPress={() => setLogFilter(f)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.logFilterText, logFilter === f && styles.logFilterTextActive]}>
                        {f === 'all'
                          ? `All Logs (${formatMax99(count)})`
                          : f === 'inward'
                          ? `⬇ Inward (${formatMax99(count)})`
                          : `⬆ Outward (${formatMax99(count)})`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Audit Log Cards List (Paginated - max 9 per page) */}
              <View style={styles.logsList}>
                {filteredAuditLogs.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <View style={styles.emptyIconCircle}>
                      <Feather name="clock" size={28} color="#7C3AED" />
                    </View>
                    <Text style={styles.emptyTitle}>No Stock Movement Logs Found</Text>
                    <Text style={styles.emptyText}>
                      {search.trim()
                        ? `No movement records match "${search}". Try clearing search filters.`
                        : 'Stock movements from restocks, opening stock, and checkout invoices will automatically appear here.'}
                    </Text>
                    <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} activeOpacity={0.8}>
                      <Feather name="refresh-cw" size={13} color="#7C3AED" />
                      <Text style={styles.refreshBtnText}>Refresh Audit Trail</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {paginatedAuditLogs.map(item => (
                      <StockAuditLogRow key={item.id} item={item} />
                    ))}

                    {/* Pagination Bar (Max 9 cards per page) */}
                    {totalPages > 1 && (
                      <View style={styles.paginationContainer}>
                        <TouchableOpacity
                          style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                          onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-left" size={18} color={currentPage === 1 ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                        <View style={styles.pageInfoBadge}>
                          <Text style={styles.pageText}>
                            Page <Text style={styles.pageTextBold}>{currentPage}</Text> of <Text style={styles.pageTextBold}>{totalPages}</Text>
                          </Text>
                          <Text style={styles.pageSubText}>
                            ({(currentPage - 1) * LOGS_PAGE_SIZE + 1}–{Math.min(currentPage * LOGS_PAGE_SIZE, filteredAuditLogs.length)} of {filteredAuditLogs.length})
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.pageButton, currentPage === totalPages && styles.pageButtonDisabled]}
                          onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          activeOpacity={0.7}
                        >
                          <Feather name="chevron-right" size={18} color={currentPage === totalPages ? '#D1D5DB' : '#7C3AED'} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}
              </View>
            </View>
          )}

          <View style={{ height: 32 }} />
        </View>
      </ScrollView>

      {/* ── Edit Product Stock Modal ── */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Edit Product &amp; Stock</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} style={styles.modalCloseBtn}>
                <Feather name="x" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.formLabel}>PRODUCT NAME</Text>
              <TextInput style={styles.formInput} value={editName} onChangeText={setEditName} />

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>BRAND</Text>
                  <TextInput style={styles.formInput} value={editBrand} onChangeText={setEditBrand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>SIZE</Text>
                  <TextInput style={styles.formInput} value={editSize} onChangeText={setEditSize} />
                </View>
              </View>

              <Text style={styles.formLabel}>SQFT PER BOX</Text>
              <TextInput style={styles.formInput} keyboardType="numeric" value={editSqft} onChangeText={setEditSqft} />

              {/* Variant Stock Counts Overrides */}
              <Text style={styles.sectionHeaderLabel}>DIRECT VARIANT STOCK &amp; PRICE ADJUSTMENT</Text>
              {editingTile?.variants.map(v => {
                const current = editVariantStocks[v.type] || { stock: v.stock.toString(), price: v.pricePerBox.toString() };
                return (
                  <View key={v.type} style={styles.vEditRow}>
                    <Text style={styles.vEditLabel}>{v.label}:</Text>
                    <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.miniLabel}>Stock (bx)</Text>
                        <TextInput
                          style={styles.formInputMini}
                          keyboardType="numeric"
                          value={current.stock}
                          onChangeText={val =>
                            setEditVariantStocks(prev => ({
                              ...prev,
                              [v.type]: { ...prev[v.type], stock: val },
                            }))
                          }
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.miniLabel}>Price (₹/bx)</Text>
                        <TextInput
                          style={styles.formInputMini}
                          keyboardType="numeric"
                          value={current.price}
                          onChangeText={val =>
                            setEditVariantStocks(prev => ({
                              ...prev,
                              [v.type]: { ...prev[v.type], price: val },
                            }))
                          }
                        />
                      </View>
                    </View>
                  </View>
                );
              })}

              <TouchableOpacity style={styles.submitGradBtn} onPress={handleSaveProductEdit} activeOpacity={0.8}>
                <LinearGradient colors={['#6D28D9', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
                  <Feather name="check-circle" size={16} color="#FFF" />
                  <Text style={styles.submitGradText}>Save Stock Changes</Text>
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Confirm Delete Product Modal ── */}
      <Modal visible={deleteConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteConfirmVisible(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmBox}>
            <View style={styles.deleteIconWrap}>
              <Feather name="alert-triangle" size={24} color="#EF4444" />
            </View>
            <Text style={styles.confirmTitle}>Delete Product?</Text>
            <Text style={styles.confirmSub}>
              Are you sure you want to permanently delete "{tileToDelete?.name}" from your stock inventory?
            </Text>
            <View style={styles.confirmActionsRow}>
              <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setDeleteConfirmVisible(false)}>
                <Text style={styles.cancelModalText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteModalBtn} onPress={handleConfirmDeleteTile}>
                <Text style={styles.deleteModalText}>Delete Product</Text>
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
  safeHeader: { paddingHorizontal: 20, paddingBottom: 22 },
  appBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backIconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  roleIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginRight: 6 },
  roleText: { color: '#FFF', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 },

  // Header Title Section with Structured Spacing
  pageTitleContainer: { marginTop: 4 },
  pageSubtitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pageSubtitle: { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 'bold', letterSpacing: 1.2 },
  countBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  countBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#FFF', letterSpacing: -0.2 },

  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  bodyContent: { padding: 16 },
  tabToggleRow: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: '#E9D5FF' },
  tabToggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12 },
  tabToggleBtnActive: { backgroundColor: '#7C3AED' },
  tabToggleText: { fontSize: 11, fontWeight: 'bold', color: '#6B7280' },
  tabToggleTextActive: { color: '#FFF' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14, borderWidth: 1, borderColor: '#E9D5FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1A2E' },

  // Stats Row
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statBox: { flex: 1, backgroundColor: '#FFF', borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  statBoxInward: { borderColor: '#A7F3D0', backgroundColor: '#F0FDF4' },
  statBoxOutward: { borderColor: '#FECDD3', backgroundColor: '#FFF1F2' },
  statVal: { fontSize: 16, fontWeight: '800', color: '#7C3AED' },
  statLbl: { fontSize: 8, fontWeight: '700', color: '#6B7280', marginTop: 2, letterSpacing: 0.5 },

  // Products Tab
  productsList: { gap: 12 },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 36, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#F3E8FF' },
  emptyIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F5F3FF', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  emptyText: { fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 16, maxWidth: 260 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F3E8FF', borderRadius: 12 },
  refreshBtnText: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },

  productCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.04)' },
  productTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatchSquare: { width: 44, height: 44, borderRadius: 12 },
  productName: { fontSize: 14, fontWeight: 'bold', color: '#1A1A2E' },
  productBrandSpecs: { fontSize: 10, color: '#A0AEC0', marginTop: 2 },
  stockTotalVal: { fontSize: 16, fontWeight: '800', color: '#7C3AED' },
  stockTotalLabel: { fontSize: 8, color: '#A0AEC0', textAlign: 'right' },
  variantsBreakdownBox: { backgroundColor: '#F8F6FF', borderRadius: 12, padding: 10, marginTop: 10, gap: 4 },
  vBreakdownItem: { flexDirection: 'row', justifyContent: 'space-between' },
  vBreakdownLabel: { fontSize: 10, color: '#6B7280', fontWeight: '500' },
  vBreakdownVal: { fontSize: 10, fontWeight: 'bold', color: '#1A1A2E' },
  productActionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F3E8FF', borderRadius: 12, paddingVertical: 10 },
  editBtnText: { fontSize: 11, fontWeight: 'bold', color: '#7C3AED' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#FEF2F2', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  deleteBtnText: { fontSize: 11, fontWeight: 'bold', color: '#EF4444' },

  // History Audit Log Tab
  logFilterRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  logFilterChip: { flex: 1, paddingVertical: 8, borderRadius: 12, backgroundColor: '#FFF', alignItems: 'center', borderWidth: 1, borderColor: '#E9D5FF' },
  logFilterChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  logFilterText: { fontSize: 10, fontWeight: 'bold', color: '#6B7280' },
  logFilterTextActive: { color: '#FFF' },
  logsList: { gap: 12 },
  logCard: { backgroundColor: '#FFF', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#F3E8FF', boxShadow: '0px 2px 8px rgba(0,0,0,0.03)' },
  logTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logTypeTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagInward: { backgroundColor: '#10B981' },
  tagOutward: { backgroundColor: '#EF4444' },
  logTypeTagText: { fontSize: 9, fontWeight: '800', color: '#FFF' },
  logDateText: { fontSize: 9, color: '#9CA3AF', fontWeight: '500' },
  logProductRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  logTitleText: { fontSize: 13, fontWeight: '700', color: '#1A1A2E', flex: 1 },
  variantBadge: { backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  variantBadgeText: { fontSize: 9, fontWeight: '700', color: '#7C3AED' },
  logSpecText: { fontSize: 10, color: '#6B7280', marginBottom: 8 },
  logMetaBox: { backgroundColor: '#F8F6FF', borderRadius: 10, padding: 8, gap: 4, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRefText: { fontSize: 10, color: '#4B5563', flex: 1 },
  metaUserText: { fontSize: 9, color: '#6B7280', fontWeight: '500' },
  logFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { fontSize: 9, color: '#10B981', fontWeight: '600' },
  qtyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  qtyBadgeInward: { backgroundColor: '#ECFDF5' },
  qtyBadgeOutward: { backgroundColor: '#FEF2F2' },
  logQtyText: { fontSize: 12, fontWeight: '800' },
  textGreen: { color: '#059669' },
  textRed: { color: '#DC2626' },

  // Pagination Controls
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

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E' },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  formLabel: { fontSize: 9, fontWeight: 'bold', color: '#A0AEC0', letterSpacing: 0.8, marginTop: 6, marginBottom: 4 },
  formInput: { backgroundColor: '#F8F6FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, color: '#1A1A2E' },
  formInputMini: { backgroundColor: '#F8F6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11, fontWeight: 'bold', color: '#1A1A2E' },
  sectionHeaderLabel: { fontSize: 9, fontWeight: 'bold', color: '#4338CA', letterSpacing: 0.8, marginTop: 14, marginBottom: 8 },
  vEditRow: { backgroundColor: '#FAF5FF', borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#E9D5FF' },
  vEditLabel: { fontSize: 11, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 4 },
  miniLabel: { fontSize: 8, color: '#A0AEC0', marginBottom: 2 },
  submitGradBtn: { borderRadius: 14, overflow: 'hidden', marginTop: 14 },
  submitGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  submitGradText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { width: '100%', maxWidth: 340, backgroundColor: '#FFF', borderRadius: 24, padding: 24, alignItems: 'center' },
  deleteIconWrap: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  confirmTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A1A2E', marginBottom: 6 },
  confirmSub: { fontSize: 12, color: '#718096', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  confirmActionsRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 14 },
  cancelModalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  cancelModalText: { fontSize: 12, fontWeight: '600', color: '#4B5563' },
  deleteModalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center' },
  deleteModalText: { fontSize: 12, fontWeight: 'bold', color: '#FFF' },
});
