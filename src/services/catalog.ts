/**
 * src/services/catalog.ts
 *
 * Catalog and Inventory service layer interacting with Supabase DB & RPC procedures.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { activityLogService } from './activityLog';
import { dataCache } from './dataCache';
import { TileCollection, TileVariant, StockLog, VariantType, StockAuditLogItem } from '../types/tiles';
import { SEED_CATALOG } from '../data/seed-catalog';
import { escapeLikeWildcards } from '../utils/sanitize';
import {
  signStockQueuePayload,
  verifyStockQueuePayload,
  getOfflineStockQueueKey,
  StockQueuePayload,
} from '../utils/integrity';

export const LEGACY_OFFLINE_STOCK_QUEUE_KEY = 'tilor_offline_stock_queue';

export interface QueuedStockMovement {
  id: string;
  shopId: string;
  variantId: string;
  type: 'inward' | 'outward';
  boxes: number;
  reference: string;
  userId: string;
  tileName?: string;
  timestamp: string;
  signature: string;
}

// ─── PostgREST Data Transformers ──────────────────────────────────────────────

function dbToTileCollection(dbCollection: any, dbVariants: any[] = []): TileCollection {
  const variants: TileVariant[] = dbVariants.map((v: any) => ({
    id: v.id,
    collection_id: v.collection_id,
    type: v.variant_type as VariantType,
    label: v.label || 'Standard',
    pricePerBox: Number(v.price_per_box) || 0,
    stock: Number(v.stock) || 0,
    color: v.color_hex || '#E5E7EB',
    accent: v.accent_hex || '#9CA3AF',
    history: [],
  }));

  return {
    id: dbCollection.id,
    shop_id: dbCollection.shop_id,
    name: dbCollection.name,
    brand: dbCollection.brand,
    size: dbCollection.size,
    sqftPerBox: Number(dbCollection.sqft_per_box) || 16,
    tilesPerBox: Number(dbCollection.tiles_per_box) || 4,
    is12x18: Boolean(dbCollection.is_12x18),
    is_archived: Boolean(dbCollection.is_archived),
    variants,
  };
}

// ─── Service Methods ──────────────────────────────────────────────────────────

export const catalogService = {
  /**
   * Invalidates memory cache for tile catalog.
   */
  invalidateCache(shopId?: string): void {
    if (shopId) {
      dataCache.invalidate(`catalog_${shopId}`);
    } else {
      dataCache.invalidate('catalog');
    }
  },

  /**
   * Fetches the full tile catalog for the user's shop from Supabase.
   * Employs high-performance in-memory SWR caching (2 min TTL) with background revalidation.
   * If DB is empty, seeds default catalog from SEED_CATALOG.
   */
  async fetchCatalog(shopId?: string, forceRefresh: boolean = false): Promise<TileCollection[]> {
    // Resolve active shopId if not explicitly passed
    let currentShopId = shopId;
    if (!currentShopId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('users')
          .select('shop_id')
          .eq('id', session.user.id)
          .single();
        currentShopId = profile?.shop_id;
      }
    }

    const memoryCacheKey = `catalog_${currentShopId || 'default'}`;

    if (forceRefresh) {
      dataCache.invalidate(memoryCacheKey);
    }

    return dataCache.executeSWR(
      memoryCacheKey,
      async () => {
        return this.fetchCatalogFromNetworkOrStorage(currentShopId);
      },
      120000 // 2 minutes TTL
    );
  },

  async fetchCatalogFromNetworkOrStorage(currentShopId?: string): Promise<TileCollection[]> {
    try {
      // [SECURITY FIX] Isolate offline cache key per shop to prevent cross-store leaks
      const cacheKey = currentShopId ? `tilor_tile_catalog_${currentShopId}` : 'tilor_tile_catalog';

      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        // Return local cache if offline
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && (!currentShopId || parsed.every((c: any) => !c.shop_id || c.shop_id === currentShopId))) {
            return parsed;
          }
        }
        const legacy = await AsyncStorage.getItem('tilor_tile_catalog');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && (!currentShopId || parsed.every((c: any) => !c.shop_id || c.shop_id === currentShopId))) {
            return parsed;
          }
        }
        return SEED_CATALOG;
      }

      // [SECURITY FIX] Query tile_collections with explicit shop_id filter for defense-in-depth
      let query = supabase
        .from('tile_collections')
        .select('*')
        .eq('is_archived', false)
        .order('brand', { ascending: true })
        .order('name', { ascending: true });

      if (currentShopId) {
        query = query.eq('shop_id', currentShopId);
      }

      const { data: collections, error: colError } = await query;

      if (colError || !collections || collections.length === 0) {
        // If DB is empty for this shop, attempt initial seed
        await this.seedInitialCatalog();
        let retryQuery = supabase
          .from('tile_collections')
          .select('*')
          .eq('is_archived', false);

        if (currentShopId) {
          retryQuery = retryQuery.eq('shop_id', currentShopId);
        }

        const { data: retryCols } = await retryQuery;

        if (!retryCols || retryCols.length === 0) {
          return SEED_CATALOG;
        }
        return await this.buildCatalogFromDb(retryCols);
      }

      const catalog = await this.buildCatalogFromDb(collections);
      // Cache locally per shop for offline support
      await AsyncStorage.setItem(cacheKey, JSON.stringify(catalog));
      return catalog;
    } catch (err) {
      console.error('[CatalogService] fetchCatalog error:', err);
      const cacheKey = currentShopId ? `tilor_tile_catalog_${currentShopId}` : 'tilor_tile_catalog';
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && (!currentShopId || parsed.every((c: any) => !c.shop_id || c.shop_id === currentShopId))) {
          return parsed;
        }
      }
      return SEED_CATALOG;
    }
  },

  async buildCatalogFromDb(collections: any[]): Promise<TileCollection[]> {
    const colIds = collections.map(c => c.id);
    const { data: variants } = await supabase
      .from('tile_variants')
      .select('*')
      .in('collection_id', colIds);

    const variantsByCol = new Map<string, any[]>();
    (variants || []).forEach((v: any) => {
      const existing = variantsByCol.get(v.collection_id) || [];
      existing.push(v);
      variantsByCol.set(v.collection_id, existing);
    });

    return collections.map(c => dbToTileCollection(c, variantsByCol.get(c.id) || []));
  },

  /**
   * Atomic Inward Stock Adjustment via add_stock RPC
   */
  async addStock(
    shopId: string,
    variantId: string,
    boxes: number,
    reference: string,
    userId?: string,
    tileName?: string,
    userName?: string,
    userRole?: string
  ): Promise<{ success: boolean; newStock?: number; error?: string }> {
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        await this.queueOfflineAdjustment(shopId, variantId, 'inward', boxes, reference, userId, tileName);
        return { success: true };
      }

      const { data, error } = await supabase.rpc('add_stock', {
        p_variant_id: variantId,
        p_boxes: boxes,
        p_reference: reference,
        p_user_id: userId || null,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Log Activity for Stock Inward
      await activityLogService.logActivity({
        shopId: shopId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        entityType: 'stock',
        entityId: variantId,
        entityName: tileName || 'Tile Variant',
        action: 'stock_inward',
        details: {
          boxesAdded: boxes,
          reference: reference,
          newTotalStock: Number(data),
        }
      });

      dataCache.invalidate(`catalog_${shopId}`);
      dataCache.invalidate(`dashboard_metrics_${shopId}`);

      return { success: true, newStock: Number(data) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to add stock.' };
    }
  },

  /**
   * Atomic Outward Stock Deduction via deduct_stock RPC (with FOR UPDATE locking)
   * Fixes Bug #1 (Race Condition / Negative Stock)
   */
  async deductStock(
    shopId: string,
    variantId: string,
    boxes: number,
    reference: string,
    userId?: string,
    tileName?: string,
    userName?: string,
    userRole?: string
  ): Promise<{ success: boolean; newStock?: number; error?: string }> {
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        await this.queueOfflineAdjustment(shopId, variantId, 'outward', boxes, reference, userId, tileName);
        return { success: true };
      }

      const { data, error } = await supabase.rpc('deduct_stock', {
        p_variant_id: variantId,
        p_boxes: boxes,
        p_reference: reference,
        p_user_id: userId || null,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Log Activity for Stock Outward
      await activityLogService.logActivity({
        shopId: shopId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        entityType: 'stock',
        entityId: variantId,
        entityName: tileName || 'Tile Variant',
        action: 'stock_outward',
        details: {
          boxesRemoved: boxes,
          reference: reference,
          newTotalStock: Number(data),
        }
      });

      dataCache.invalidate(`catalog_${shopId}`);
      dataCache.invalidate(`dashboard_metrics_${shopId}`);

      return { success: true, newStock: Number(data) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to deduct stock.' };
    }
  },

  /**
   * Creates a new tile collection and its variants in Supabase DB.
   * Fixes Bug #11 (Duplicate product prevention).
   */
  async createProduct(
    tileData: {
      name: string;
      brand: string;
      size: string;
      sqftPerBox: number;
      tilesPerBox: number;
      is12x18: boolean;
      variants: Array<{
        type: VariantType;
        label: string;
        pricePerBox: number;
        stock: number;
        color: string;
        accent: string;
      }>;
    },
    shopId: string,
    userId?: string,
    userName?: string,
    userRole?: string
  ): Promise<{ success: boolean; collectionId?: string; error?: string }> {
    try {
      // 1. Check for duplicates within shop
      const { data: existing } = await supabase
        .from('tile_collections')
        .select('id')
        .eq('shop_id', shopId)
        .eq('is_archived', false)
        .ilike('name', escapeLikeWildcards(tileData.name.trim()))
        .ilike('brand', escapeLikeWildcards(tileData.brand.trim()))
        .eq('size', tileData.size.trim())
        .maybeSingle();

      if (existing) {
        return { success: false, error: 'A tile product with this name, brand, and size already exists.' };
      }

      // 2. Insert Collection
      const { data: newCol, error: colError } = await supabase
        .from('tile_collections')
        .insert({
          shop_id: shopId,
          name: tileData.name.trim(),
          brand: tileData.brand.trim(),
          size: tileData.size,
          sqft_per_box: tileData.sqftPerBox,
          tiles_per_box: tileData.tilesPerBox,
          is_12x18: tileData.is12x18,
        })
        .select()
        .single();

      if (colError || !newCol) {
        return { success: false, error: colError?.message || 'Failed to create product collection.' };
      }

      // 3. Insert Variants
      const variantInserts = tileData.variants.map(v => ({
        collection_id: newCol.id,
        variant_type: v.type,
        label: v.label,
        price_per_box: v.pricePerBox,
        stock: v.stock,
        color_hex: v.color,
        accent_hex: v.accent,
      }));

      const { data: insertedVariants, error: varError } = await supabase
        .from('tile_variants')
        .insert(variantInserts)
        .select();

      if (varError) {
        return { success: false, error: varError.message };
      }

      // 4. Log Opening Stock for each inserted variant
      if (insertedVariants) {
        const stockLogInserts = insertedVariants.map((v: any) => ({
          variant_id: v.id,
          log_type: 'inward',
          boxes: v.stock > 0 ? v.stock : 1,
          reference: 'Opening Stock',
          performed_by: userId || null,
        }));

        await supabase.from('stock_logs').insert(stockLogInserts);
      }

      // 5. Log Activity for Product Creation
      await activityLogService.logActivity({
        shopId: shopId,
        userId: userId,
        userName: userName,
        userRole: userRole,
        entityType: 'product',
        entityId: newCol.id,
        entityName: tileData.name.trim(),
        action: 'created',
        details: {
          brand: tileData.brand.trim(),
          size: tileData.size,
          variantsCount: insertedVariants?.length || 0,
        }
      });

      dataCache.invalidate(`catalog_${shopId}`);
      dataCache.invalidate(`dashboard_metrics_${shopId}`);

      return { success: true, collectionId: newCol.id };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to register product.' };
    }
  },

  /**
   * Fetches paginated stock logs for a specific tile variant.
   * Fixes Bug #7 (Stock History Pagination).
   */
  async fetchVariantHistory(
    variantId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<StockLog[]> {
    try {
      const { data, error } = await supabase
        .from('stock_logs')
        .select('*, users(full_name, email)')
        .eq('variant_id', variantId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error || !data) return [];

      return data.map((log: any) => ({
        id: log.id,
        date: log.created_at,
        type: log.log_type,
        boxes: Number(log.boxes),
        reference: log.reference,
        performed_by: log.performed_by,
        performed_by_name: log.users?.full_name || log.users?.email || 'User',
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetches paginated, shop-wide stock audit logs from Supabase public.stock_logs.
   * Resolves tile collection and variant names, user profile info, and provides offline caching.
   */
  async fetchStockAuditLogs(
    shopId?: string,
    limit: number = 50,
    offset: number = 0,
    logType?: 'inward' | 'outward'
  ): Promise<StockAuditLogItem[]> {
    try {
      let currentShopId = shopId;
      if (!currentShopId) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: profile } = await supabase
            .from('users')
            .select('shop_id')
            .eq('id', session.user.id)
            .single();
          currentShopId = profile?.shop_id;
        }
      }

      const cacheLogsKey = currentShopId ? `tilor_stock_logs_${currentShopId}` : 'tilor_stock_logs';

      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        const cached = await AsyncStorage.getItem(cacheLogsKey);
        if (cached) {
          let list: StockAuditLogItem[] = JSON.parse(cached);
          if (logType) list = list.filter(item => item.type === logType);
          return list.slice(offset, offset + limit);
        }
        return [];
      }

      // 1. Load active catalog lookup map to reliably resolve variant & collection metadata
      const catalog = await this.fetchCatalog(currentShopId);
      const variantLookup = new Map<string, {
        variant_id: string;
        variant_label: string;
        variant_type: string;
        tile_id: string;
        tile_name: string;
        tile_brand: string;
        tile_size: string;
      }>();

      catalog.forEach(col => {
        col.variants.forEach(v => {
          if (v.id) {
            variantLookup.set(v.id, {
              variant_id: v.id,
              variant_label: v.label,
              variant_type: v.type,
              tile_id: col.id,
              tile_name: col.name,
              tile_brand: col.brand,
              tile_size: col.size,
            });
          }
        });
      });

      // 2. Query public.stock_logs with user metadata and relations
      let query = supabase
        .from('stock_logs')
        .select(`
          id,
          variant_id,
          log_type,
          boxes,
          reference,
          performed_by,
          created_at,
          users (
            full_name,
            email
          ),
          tile_variants (
            id,
            variant_type,
            label,
            collection_id,
            tile_collections (
              id,
              name,
              brand,
              size,
              shop_id
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (logType) {
        query = query.eq('log_type', logType);
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        console.warn('[CatalogService] fetchStockAuditLogs error:', error.message);
        const cached = await AsyncStorage.getItem(cacheLogsKey);
        if (cached) {
          let list: StockAuditLogItem[] = JSON.parse(cached);
          if (logType) list = list.filter(item => item.type === logType);
          return list.slice(offset, offset + limit);
        }
        return [];
      }

      const mappedLogs: StockAuditLogItem[] = (data || []).map((row: any) => {
        const joinedVariant = row.tile_variants;
        const joinedCol = joinedVariant?.tile_collections;
        const cachedMeta = variantLookup.get(row.variant_id);

        const tileName = joinedCol?.name || cachedMeta?.tile_name || 'Tile Product';
        const tileBrand = joinedCol?.brand || cachedMeta?.tile_brand || '';
        const tileSize = joinedCol?.size || cachedMeta?.tile_size || '';
        const tileId = joinedCol?.id || cachedMeta?.tile_id || '';
        const variantLabel = joinedVariant?.label || cachedMeta?.variant_label || 'Standard';
        const variantType = joinedVariant?.variant_type || cachedMeta?.variant_type || 'default';

        const userName = row.users?.full_name || (row.users?.email ? row.users.email.split('@')[0] : 'System');

        return {
          id: row.id,
          date: row.created_at,
          type: row.log_type as 'inward' | 'outward',
          boxes: Number(row.boxes) || 0,
          reference: row.reference || '',
          performed_by: row.performed_by,
          performed_by_name: userName,
          variant_id: row.variant_id,
          variant_label: variantLabel,
          variant_type: variantType,
          tile_id: tileId,
          tile_name: tileName,
          tile_brand: tileBrand,
          tile_size: tileSize,
        };
      });

      // Save page 0 to offline cache
      if (offset === 0 && !logType) {
        await AsyncStorage.setItem(cacheLogsKey, JSON.stringify(mappedLogs));
      }

      return mappedLogs;
    } catch (err) {
      console.error('[CatalogService] fetchStockAuditLogs exception:', err);
      return [];
    }
  },

  /**
   * Seeds initial catalog from SEED_CATALOG for a newly created shop.
   */
  async seedInitialCatalog(): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let userId = session?.user?.id;
      if (!userId) {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id;
      }
      if (!userId) return;

      const { data: profile } = await supabase
        .from('users')
        .select('shop_id')
        .eq('id', userId)
        .single();

      if (!profile?.shop_id) return;

      for (const seedTile of SEED_CATALOG) {
        await this.createProduct(
          {
            name: seedTile.name,
            brand: seedTile.brand,
            size: seedTile.size,
            sqftPerBox: seedTile.sqftPerBox,
            tilesPerBox: seedTile.tilesPerBox,
            is12x18: seedTile.is12x18,
            variants: seedTile.variants.map(v => ({
              type: v.type,
              label: v.label,
              pricePerBox: v.pricePerBox,
              stock: v.stock,
              color: v.color,
              accent: v.accent,
            })),
          },
          profile.shop_id,
          userId
        );
      }
    } catch (err) {
      console.error('[CatalogService] seedInitialCatalog error:', err);
    }
  },

  // ─── Offline Queue Helpers ─────────────────────────────────────────────────

  async queueOfflineAdjustment(
    shopId: string,
    variantId: string,
    type: 'inward' | 'outward',
    boxes: number,
    reference: string,
    userId?: string,
    tileName?: string
  ): Promise<void> {
    // 1. Validate numerical and field boundaries
    if (!shopId || !variantId || !Number.isInteger(boxes) || boxes <= 0 || boxes > 10000) {
      console.warn('[CatalogService] Invalid stock adjustment parameters, rejecting offline queue:', {
        shopId,
        variantId,
        boxes,
      });
      return;
    }

    // 2. Resolve active user ID
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const { data: { session } } = await supabase.auth.getSession();
      resolvedUserId = session?.user?.id;
    }
    if (!resolvedUserId) {
      console.warn('[CatalogService] Cannot queue offline stock movement without authenticated user.');
      return;
    }

    // 3. Construct canonical payload and compute HMAC-SHA256 signature
    const payload: StockQueuePayload = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      shopId,
      variantId,
      type,
      boxes,
      reference: reference || '',
      userId: resolvedUserId,
      tileName,
      timestamp: new Date().toISOString(),
    };

    const signature = await signStockQueuePayload(payload);
    const queuedItem: QueuedStockMovement = {
      ...payload,
      signature,
    };

    // 4. Save to tenant- and user-scoped storage key
    const queueKey = getOfflineStockQueueKey(shopId, resolvedUserId);
    const stored = await AsyncStorage.getItem(queueKey);
    const queue: QueuedStockMovement[] = stored ? JSON.parse(stored) : [];
    queue.push(queuedItem);
    await AsyncStorage.setItem(queueKey, JSON.stringify(queue));
  },

  async flushOfflineQueue(expectedShopId?: string, expectedUserId?: string): Promise<void> {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) return;

    // 1. Session verification: only flush if an active, authenticated user is present
    const { data: { session } } = await supabase.auth.getSession();
    const activeUserId = session?.user?.id;
    if (!activeUserId) return;

    let activeShopId = expectedShopId;
    if (!activeShopId) {
      const { data: profile } = await supabase
        .from('users')
        .select('shop_id, is_active')
        .eq('id', activeUserId)
        .single();
      if (!profile || !profile.is_active || !profile.shop_id) return;
      activeShopId = profile.shop_id;
    }

    if (!activeShopId) return;

    if (expectedUserId && expectedUserId !== activeUserId) {
      console.warn('[CatalogService] Aborting offline flush: expected user does not match active session.');
      return;
    }

    // 2. Migrate / safely clean up any legacy unscoped queue entries
    try {
      const legacyStored = await AsyncStorage.getItem(LEGACY_OFFLINE_STOCK_QUEUE_KEY);
      if (legacyStored) {
        const legacyQueue: any[] = JSON.parse(legacyStored);
        for (const item of legacyQueue) {
          if (item && item.shopId === activeShopId && (!item.userId || item.userId === activeUserId)) {
            await this.queueOfflineAdjustment(
              item.shopId,
              item.variantId,
              item.type,
              item.boxes,
              item.reference,
              activeUserId,
              item.tileName
            );
          }
        }
        await AsyncStorage.removeItem(LEGACY_OFFLINE_STOCK_QUEUE_KEY);
      }
    } catch {
      // Legacy cleanup failure non-fatal
    }

    // 3. Read scoped queue
    const queueKey = getOfflineStockQueueKey(activeShopId, activeUserId);
    const stored = await AsyncStorage.getItem(queueKey);
    if (!stored) return;

    const queue: QueuedStockMovement[] = JSON.parse(stored);
    if (queue.length === 0) return;

    const remaining: QueuedStockMovement[] = [];
    for (const item of queue) {
      // Ensure item belongs to active user & shop
      if (item.shopId !== activeShopId || item.userId !== activeUserId) {
        remaining.push(item);
        continue;
      }

      // 4. Verify HMAC-SHA256 signature to prevent offline tampering
      const payload: StockQueuePayload = {
        id: item.id,
        shopId: item.shopId,
        variantId: item.variantId,
        type: item.type,
        boxes: item.boxes,
        reference: item.reference,
        userId: item.userId,
        timestamp: item.timestamp,
        tileName: item.tileName,
      };

      const isValid = await verifyStockQueuePayload(payload, item.signature || '');
      if (!isValid) {
        console.error('[CatalogService] TAMPERED QUEUE ITEM DETECTED! Discarding movement:', item.id);
        await activityLogService.logActivity({
          shopId: activeShopId,
          userId: activeUserId,
          entityType: 'stock',
          entityId: item.variantId,
          entityName: item.tileName || 'Tile Variant',
          action: 'tampered_queue_rejected',
          details: {
            itemId: item.id,
            boxes: item.boxes,
            type: item.type,
            reason: 'HMAC signature mismatch: potential offline tampering detected',
          },
        }).catch(() => {});
        continue; // Discard tampered entry
      }

      // 5. Replay verified stock adjustment
      if (item.type === 'inward') {
        const res = await this.addStock(item.shopId, item.variantId, item.boxes, item.reference, item.userId, item.tileName);
        if (!res.success) remaining.push(item);
      } else {
        const res = await this.deductStock(item.shopId, item.variantId, item.boxes, item.reference, item.userId, item.tileName);
        if (!res.success) remaining.push(item);
      }
    }

    await AsyncStorage.setItem(queueKey, JSON.stringify(remaining));
  },
};
