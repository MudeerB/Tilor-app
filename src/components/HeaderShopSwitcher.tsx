/**
 * src/components/HeaderShopSwitcher.tsx
 *
 * Superadmin Header Store Switcher Pill & Selection Modal.
 * Designed with UI/UX Pro Max guidelines:
 * - Fluid haptic interaction
 * - Micro-animations and high-contrast status pills
 * - Instant tenant switching across the entire application
 */

import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useShop } from '../context/ShopContext';
import { ShopRecord } from '../types/auth';
import { hapticFeedback } from '../utils/haptics';

interface HeaderShopSwitcherProps {
  onOpenPortal?: () => void;
  style?: any;
}

export const HeaderShopSwitcher: React.FC<HeaderShopSwitcherProps> = ({
  onOpenPortal,
  style,
}) => {
  const { shops, activeShop, loadingShops, switchShop, refreshShops } = useShop();
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredShops = useMemo(() => {
    if (!searchQuery.trim()) return shops;
    const q = searchQuery.toLowerCase().trim();
    return shops.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.settings?.address && s.settings.address.toLowerCase().includes(q)) ||
        (s.settings?.gstin && s.settings.gstin.toLowerCase().includes(q))
    );
  }, [shops, searchQuery]);

  const handleSelectShop = async (shop: ShopRecord) => {
    hapticFeedback.light();
    await switchShop(shop);
    setModalVisible(false);
  };

  const handleOpenModal = () => {
    hapticFeedback.light();
    setSearchQuery('');
    setModalVisible(true);
  };

  return (
    <>
      {/* ── Pill Button ────────────────────────────────────────── */}
      <TouchableOpacity
        style={[styles.pillContainer, style]}
        onPress={handleOpenModal}
        activeOpacity={0.8}
        accessibilityLabel={`Current store: ${activeShop?.name || 'Select Store'}. Tap to switch.`}
      >
        <View style={styles.pillIconBox}>
          <MaterialCommunityIcons name="storefront" size={13} color="#FFFFFF" />
        </View>

        <View style={styles.pillTextGroup}>
          <Text style={styles.pillLabel}>ACTIVE STORE</Text>
          <Text style={styles.pillStoreName} numberOfLines={1}>
            {activeShop?.name || 'Select Store'}
          </Text>
        </View>

        <Feather name="chevron-down" size={13} color="#DDD6FE" style={styles.chevronIcon} />
      </TouchableOpacity>

      {/* ── Store Switcher Modal ──────────────────────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.backdropDismiss}
            activeOpacity={1}
            onPress={() => setModalVisible(false)}
          />

          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View>
                <View style={styles.titleRow}>
                  <Text style={styles.sheetTitle}>Switch Active Showroom</Text>
                  <View style={styles.superadminBadge}>
                    <Text style={styles.superadminBadgeText}>SUPERADMIN</Text>
                  </View>
                </View>
                <Text style={styles.sheetSub}>
                  Select a tenant store to manage its catalog, stock, and bills.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.closeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.searchBar}>
              <Feather name="search" size={16} color="#7C3AED" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search showroom by name or location..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
                  <Feather name="x-circle" size={15} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Stores List */}
            {loadingShops ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text style={styles.loadingText}>Loading showrooms...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredShops}
                keyExtractor={(item) => item.id}
                style={styles.storesList}
                contentContainerStyle={styles.storesListContent}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const isActive = activeShop?.id === item.id;
                  const shopAddress = item.settings?.address || 'Showroom Location';
                  const shopPhone = item.settings?.phone || '';
                  const shopGst = item.settings?.gstin || '';

                  return (
                    <TouchableOpacity
                      style={[styles.storeCard, isActive && styles.storeCardActive]}
                      onPress={() => handleSelectShop(item)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.storeIconBox,
                          isActive && styles.storeIconBoxActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="storefront"
                          size={18}
                          color={isActive ? '#FFFFFF' : '#7C3AED'}
                        />
                      </View>

                      <View style={styles.storeInfo}>
                        <View style={styles.storeNameRow}>
                          <Text
                            style={[
                              styles.storeNameText,
                              isActive && styles.storeNameTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          {isActive && (
                            <View style={styles.activePill}>
                              <Feather name="check" size={11} color="#059669" />
                              <Text style={styles.activePillText}>CURRENT</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.storeMetaText} numberOfLines={1}>
                          {shopAddress}
                          {shopPhone ? ` • Ph: ${shopPhone}` : ''}
                        </Text>

                        {shopGst ? (
                          <Text style={styles.storeGstText} numberOfLines={1}>
                            GSTIN: {shopGst}
                          </Text>
                        ) : null}
                      </View>

                      {!isActive && (
                        <Feather name="chevron-right" size={16} color="#CBD5E1" />
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Feather name="inbox" size={32} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>No showrooms found</Text>
                    <Text style={styles.emptySub}>
                      {searchQuery
                        ? 'Try searching with a different keyword.'
                        : 'No tenant showrooms registered yet.'}
                    </Text>
                  </View>
                }
              />
            )}

            {/* Bottom Actions */}
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={styles.refreshBtn}
                onPress={() => {
                  hapticFeedback.light();
                  refreshShops();
                }}
              >
                <Feather name="refresh-cw" size={13} color="#64748B" />
                <Text style={styles.refreshBtnText}>Refresh</Text>
              </TouchableOpacity>

              {onOpenPortal && (
                <TouchableOpacity
                  style={styles.portalBtn}
                  onPress={() => {
                    setModalVisible(false);
                    onOpenPortal();
                  }}
                >
                  <Text style={styles.portalBtnText}>Open Superadmin Portal</Text>
                  <Feather name="arrow-up-right" size={14} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 7,
    maxWidth: 220,
  },
  pillIconBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillTextGroup: {
    flexShrink: 1,
  },
  pillLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#DDD6FE',
    letterSpacing: 0.5,
  },
  pillStoreName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chevronIcon: {
    marginLeft: 2,
  },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingHorizontal: 20,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  superadminBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  superadminBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  sheetSub: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  searchClearBtn: {
    padding: 4,
  },

  // List
  storesList: {
    maxHeight: 340,
  },
  storesListContent: {
    paddingBottom: 10,
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  storeCardActive: {
    backgroundColor: '#FAF5FF',
    borderColor: '#C4B5FD',
  },
  storeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeIconBoxActive: {
    backgroundColor: '#7C3AED',
  },
  storeInfo: {
    flex: 1,
    gap: 2,
  },
  storeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  storeNameText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  storeNameTextActive: {
    color: '#6D28D9',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  activePillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#059669',
  },
  storeMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  storeGstText: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // Empty & loading
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  emptySub: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
  },

  // Footer
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
    marginTop: 6,
    gap: 10,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  refreshBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  portalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
  },
  portalBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
