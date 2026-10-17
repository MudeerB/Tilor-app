import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { hapticFeedback } from '../utils/haptics';

export type NavTab = 'home' | 'estimator' | 'billing' | 'inventory' | 'khatabook' | 'stock_manager' | 'history' | 'customers' | 'settings' | 'analytics' | 'activity_logs' | 'loading_tasks';

interface NavItem {
  key: NavTab;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home',      label: 'Home',      icon: 'home' },
  { key: 'estimator', label: 'Estimator', icon: 'grid' },
  { key: 'billing',   label: 'Billing',   icon: 'file-text' },
  { key: 'inventory', label: 'Inventory', icon: 'archive' },
  { key: 'settings',  label: 'Settings',  icon: 'settings' },
];

interface BottomNavBarProps {
  activeTab: NavTab;
  onTabPress: (tab: NavTab) => void;
  isOwner?: boolean;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({ activeTab, onTabPress, isOwner = true }) => {
  const visibleItems = NAV_ITEMS.filter(item => {
    if (!isOwner) {
      return item.key === 'home' || item.key === 'inventory' || item.key === 'settings';
    }
    return true;
  });

  return (
    <View style={styles.wrapper}>
      <View style={styles.bar}>
        {visibleItems.map((item) => {
          const isActive = item.key === activeTab;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => {
                hapticFeedback.light();
                onTabPress(item.key);
              }}
              activeOpacity={0.7}
            >
              <Feather
                name={item.icon}
                size={18}
                color={isActive ? '#7C3AED' : '#A0AEC0'}
              />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'space-around',
    alignItems: 'center',
    boxShadow: '0px 4px 24px rgba(0, 0, 0, 0.1)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 16,
    gap: 2,
  },
  tabItemActive: {
    backgroundColor: '#F3E8FF',
  },
  tabLabel: {
    fontSize: 9,
    color: '#A0AEC0',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#7C3AED',
    fontWeight: '700',
  },
});
