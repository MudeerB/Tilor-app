/**
 * src/components/SuperadminTopBar.tsx
 *
 * Persistent platform control bar displayed at the very top of the app
 * when authenticated as Superadmin. Provides 1-tap store switching and quick jump
 * to the Superadmin Management Portal from any screen.
 */

import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { HeaderShopSwitcher } from './HeaderShopSwitcher';
import { useShop } from '../context/ShopContext';
import { hapticFeedback } from '../utils/haptics';

interface SuperadminTopBarProps {
  onOpenPortal: () => void;
  isPortalActive?: boolean;
}

export const SuperadminTopBar: React.FC<SuperadminTopBarProps> = ({
  onOpenPortal,
  isPortalActive = false,
}) => {
  const { activeShop } = useShop();

  return (
    <LinearGradient
      colors={['#1E1B4B', '#2E1065', '#3B0764']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.container}
    >
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.contentRow}>
          {/* Left: Superadmin Indicator & Store Switcher */}
          <View style={styles.leftGroup}>
            <View style={styles.badgePill}>
              <View style={styles.badgePulse} />
              <Text style={styles.badgeText}>SUPERADMIN</Text>
            </View>

            <HeaderShopSwitcher onOpenPortal={onOpenPortal} />
          </View>

          {/* Right: Portal Button */}
          <TouchableOpacity
            style={[styles.portalActionBtn, isPortalActive && styles.portalActionBtnActive]}
            onPress={() => {
              hapticFeedback.light();
              onOpenPortal();
            }}
            activeOpacity={0.8}
            accessibilityLabel="Open Superadmin Portal"
          >
            <Feather
              name="shield"
              size={12}
              color={isPortalActive ? '#FFFFFF' : '#DDD6FE'}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.portalActionText,
                isPortalActive && styles.portalActionTextActive,
              ]}
            >
              Portal
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 9999,
  },
  safeArea: {
    paddingBottom: 6,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    gap: 8,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(254, 243, 199, 0.2)',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FEF3C7',
    letterSpacing: 0.6,
  },
  portalActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  portalActionBtnActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#A78BFA',
  },
  portalActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DDD6FE',
  },
  portalActionTextActive: {
    color: '#FFFFFF',
  },
});
