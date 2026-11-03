/**
 * src/context/ShopContext.tsx
 *
 * Global Multi-Tenant Shop Context for Superadmins and Shop Users.
 * Manages the active shop selection, shop directory cache, and context switching.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShopRecord } from '../types/auth';
import { adminService } from '../services/adminService';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useSession';
import { dataCache } from '../services/dataCache';
import { hapticFeedback } from '../utils/haptics';

interface ShopContextValue {
  shops: ShopRecord[];
  activeShop: ShopRecord | null;
  loadingShops: boolean;
  switchShop: (shop: ShopRecord) => Promise<void>;
  refreshShops: () => Promise<void>;
}

const ShopContext = createContext<ShopContextValue>({
  shops: [],
  activeShop: null,
  loadingShops: false,
  switchShop: async () => {},
  refreshShops: async () => {},
});

const ACTIVE_SHOP_STORAGE_KEY = 'tilor_superadmin_active_shop_id';

export const ShopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userProfile, isSuperadmin } = useAuth();
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [activeShop, setActiveShop] = useState<ShopRecord | null>(null);
  const [loadingShops, setLoadingShops] = useState(false);

  const refreshShops = useCallback(async () => {
    if (!userProfile) {
      setShops([]);
      setActiveShop(null);
      return;
    }

    if (isSuperadmin) {
      setLoadingShops(true);
      try {
        const res = await adminService.fetchAllShops();
        if (res.success && res.data && res.data.length > 0) {
          setShops(res.data);

          // Restore previously selected shop ID from local storage
          const savedShopId = await AsyncStorage.getItem(ACTIVE_SHOP_STORAGE_KEY);
          let targetShop: ShopRecord | undefined;
          if (savedShopId) {
            targetShop = res.data.find(s => s.id === savedShopId);
          }
          if (!targetShop) {
            targetShop = res.data[0];
          }

          setActiveShop(targetShop);
        } else {
          setShops([]);
          setActiveShop(null);
        }
      } catch (err) {
        console.error('[ShopContext] Error fetching shops for superadmin:', err);
      } finally {
        setLoadingShops(false);
      }
    } else if (userProfile.shop_id) {
      // Standard shop owner or staff: load their assigned shop profile
      try {
        const { data, error } = await supabase
          .from('shops')
          .select('*')
          .eq('id', userProfile.shop_id)
          .single();

        if (data && !error) {
          const singleShop = data as ShopRecord;
          setShops([singleShop]);
          setActiveShop(singleShop);
        }
      } catch (err) {
        console.error('[ShopContext] Error loading user shop profile:', err);
      }
    }
  }, [userProfile, isSuperadmin]);

  useEffect(() => {
    refreshShops();
  }, [refreshShops]);

  const switchShop = useCallback(async (shop: ShopRecord) => {
    if (!shop || !shop.id) return;
    hapticFeedback.selection();

    // Clear stale in-memory cached queries for previous shop
    dataCache.clear();

    setActiveShop(shop);
    await AsyncStorage.setItem(ACTIVE_SHOP_STORAGE_KEY, shop.id).catch(() => {});
  }, []);

  return (
    <ShopContext.Provider
      value={{
        shops,
        activeShop,
        loadingShops,
        switchShop,
        refreshShops,
      }}
    >
      {children}
    </ShopContext.Provider>
  );
};

export const useShop = () => useContext(ShopContext);
