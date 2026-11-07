import React, { useState } from 'react';
import { StyleSheet, ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from './src/hooks/useSession';
import { ShopProvider, useShop } from './src/context/ShopContext';
import { UserSession } from './src/types/auth';
import { dataCache } from './src/services/dataCache';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { EstimatorScreen } from './src/screens/EstimatorScreen';
import { BillingScreen } from './src/screens/BillingScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { KhatabookScreen } from './src/screens/KhatabookScreen';
import { StockManagerScreen } from './src/screens/StockManagerScreen';
import { AnalyticsScreen } from './src/screens/AnalyticsScreen';
import { ActivityLogScreen } from './src/screens/ActivityLogScreen';
import { LoadingTasksScreen } from './src/screens/LoadingTasksScreen';
import { UpdatePasswordScreen } from './src/screens/UpdatePasswordScreen';
import { SuperadminPortalScreen } from './src/screens/SuperadminPortalScreen';
import { SuperadminTopBar } from './src/components/SuperadminTopBar';
import { NavTab } from './src/components/BottomNavBar';

function MainApp() {
  const {
    session,
    userProfile,
    loading,
    signOut,
    recoveryMode,
    setRecoveryMode,
    isPasswordExpired,
    refreshProfile,
    isSuperadmin,
  } = useAuth();
  const { activeShop } = useShop();
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [visitedTabs, setVisitedTabs] = useState<Set<NavTab>>(() => new Set(['home']));

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  if (recoveryMode || isPasswordExpired) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <UpdatePasswordScreen
          onSuccess={() => {
            if (recoveryMode) setRecoveryMode(false);
            if (isPasswordExpired) refreshProfile();
          }}
          onSignOut={signOut}
        />
      </SafeAreaProvider>
    );
  }

  if (!session || !userProfile) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoginScreen
          onLoginSuccess={() => {
            setActiveTab('home');
            setVisitedTabs(new Set(['home']));
          }}
        />
      </SafeAreaProvider>
    );
  }

  // Build backwards-compatible UserSession object for screens
  // When logged in as superadmin, shop_id dynamically reflects the active selected shop
  const userSession: UserSession = {
    id: userProfile.id,
    username: userProfile.full_name || userProfile.email.split('@')[0],
    email: userProfile.email,
    role: userProfile.role,
    shop_id: (userProfile.role === 'superadmin' ? activeShop?.id : userProfile.shop_id) || '',
    full_name: userProfile.full_name,
    time: userProfile.last_login || new Date().toISOString(),
    password_changed_at: userProfile.password_changed_at,
  };

  const handleTabChange = (tab: NavTab) => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    setActiveTab(tab);
  };

  const handleLogout = async () => {
    dataCache.clear();
    setVisitedTabs(new Set(['home']));
    await signOut();
    setActiveTab('home');
  };

  const navProps = {
    session: userSession,
    activeTab,
    onTabChange: handleTabChange,
    onLogout: handleLogout,
  };

  // Route protection
  let currentTab = activeTab;

  // Superadmin Portal is strictly accessible only to superadmin accounts
  if (currentTab === 'superadmin_portal' && userSession.role !== 'superadmin') {
    currentTab = 'home';
  }

  if (
    userSession.role !== 'owner' &&
    userSession.role !== 'admin' &&
    userSession.role !== 'superadmin'
  ) {
    const restrictedTabs = [
      'estimator',
      'billing',
      'khatabook',
      'history',
      'customers',
      'analytics',
      'activity_logs',
      'stock_manager',
      'superadmin_portal',
    ];
    if (restrictedTabs.includes(currentTab)) {
      currentTab = 'home';
    }
  }

  const renderTab = (tab: NavTab, Component: React.ComponentType<any>) => {
    if (!visitedTabs.has(tab)) return null;
    const isVisible = currentTab === tab;
    return (
      <View
        key={tab}
        style={[
          styles.screenContainer,
          { display: isVisible ? 'flex' : 'none' },
        ]}
      >
        <Component {...navProps} />
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {isSuperadmin && (
        <SuperadminTopBar
          onOpenPortal={() => handleTabChange('superadmin_portal')}
          isPortalActive={currentTab === 'superadmin_portal'}
        />
      )}
      {renderTab('home', DashboardScreen)}
      {renderTab('estimator', EstimatorScreen)}
      {renderTab('billing', BillingScreen)}
      {renderTab('inventory', InventoryScreen)}
      {renderTab('khatabook', KhatabookScreen)}
      {renderTab('stock_manager', StockManagerScreen)}
      {renderTab('history', HistoryScreen)}
      {renderTab('customers', CustomersScreen)}
      {renderTab('settings', SettingsScreen)}
      {renderTab('analytics', AnalyticsScreen)}
      {renderTab('activity_logs', ActivityLogScreen)}
      {renderTab('loading_tasks', LoadingTasksScreen)}
      {renderTab('superadmin_portal', SuperadminPortalScreen)}
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ShopProvider>
        <MainApp />
      </ShopProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0F0C20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenContainer: {
    flex: 1,
  },
});

