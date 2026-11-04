/**
 * src/services/masterCatalog.ts
 *
 * Service for Superadmin-managed Master Categories and Master Tile Sizes.
 * Provides caching, Supabase querying with RLS enforcement, and robust offline fallbacks.
 */

import { supabase } from './supabase';
import { MasterCategory, MasterTileSize } from '../types/tiles';
import { dataCache } from './dataCache';

// ─── Offline Fallback Defaults (Standard Indian Ceramics) ─────────────────────

export const DEFAULT_MASTER_CATEGORIES: MasterCategory[] = [
  { id: 'cat_wall', name: 'Wall Tiles', display_order: 1, is_active: true },
  { id: 'cat_floor', name: 'Floor Vitrified', display_order: 2, is_active: true },
  { id: 'cat_slabs', name: 'Large Slabs', display_order: 3, is_active: true },
  { id: 'cat_parking', name: 'Parking & Pavers', display_order: 4, is_active: true },
  { id: 'cat_subway', name: 'Subway & Elevation', display_order: 5, is_active: true },
];

export const DEFAULT_MASTER_SIZES: MasterTileSize[] = [
  { id: 'sz_12x18', label: '12×18', category_id: 'cat_wall', default_pieces_per_box: 6, default_sqft_per_box: 9.00, has_concept_variants: true, display_order: 1, is_active: true },
  { id: 'sz_10x15', label: '10×15', category_id: 'cat_wall', default_pieces_per_box: 8, default_sqft_per_box: 8.33, has_concept_variants: true, display_order: 2, is_active: true },
  { id: 'sz_12x24', label: '12×24', category_id: 'cat_wall', default_pieces_per_box: 4, default_sqft_per_box: 8.00, has_concept_variants: true, display_order: 3, is_active: true },
  { id: 'sz_8x12',  label: '8×12',  category_id: 'cat_wall', default_pieces_per_box: 10, default_sqft_per_box: 6.67, has_concept_variants: true, display_order: 4, is_active: true },
  { id: 'sz_2x2',   label: '2×2',   category_id: 'cat_floor', default_pieces_per_box: 4, default_sqft_per_box: 16.00, has_concept_variants: false, display_order: 5, is_active: true },
  { id: 'sz_2x4',   label: '2×4',   category_id: 'cat_floor', default_pieces_per_box: 2, default_sqft_per_box: 16.00, has_concept_variants: false, display_order: 6, is_active: true },
  { id: 'sz_16x16', label: '16×16', category_id: 'cat_floor', default_pieces_per_box: 5, default_sqft_per_box: 8.89, has_concept_variants: false, display_order: 7, is_active: true },
  { id: 'sz_1x1',   label: '1×1',   category_id: 'cat_parking', default_pieces_per_box: 8, default_sqft_per_box: 8.00, has_concept_variants: false, display_order: 8, is_active: true },
  { id: 'sz_800x1600', label: '800×1600', category_id: 'cat_slabs', default_pieces_per_box: 2, default_sqft_per_box: 27.56, has_concept_variants: false, display_order: 9, is_active: true },
  { id: 'sz_1200x1800', label: '1200×1800', category_id: 'cat_slabs', default_pieces_per_box: 1, default_sqft_per_box: 23.25, has_concept_variants: false, display_order: 10, is_active: true },
  { id: 'sz_4x12',  label: '4×12',  category_id: 'cat_subway', default_pieces_per_box: 24, default_sqft_per_box: 8.00, has_concept_variants: false, display_order: 11, is_active: true },
];

class MasterCatalogService {
  private CACHE_KEY_CATS = 'master_categories_cache';
  private CACHE_KEY_SIZES = 'master_sizes_cache';

  /**
   * Fetches all active master categories from Supabase (or fallback defaults if table does not exist).
   */
  async fetchMasterCategories(forceRefresh = false): Promise<MasterCategory[]> {
    if (!forceRefresh) {
      const cached = dataCache.get<MasterCategory[]>(this.CACHE_KEY_CATS);
      if (cached && cached.length > 0) return cached;
    }

    try {
      const { data, error } = await supabase
        .from('master_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error || !data || data.length === 0) {
        // Fallback to defaults
        dataCache.set(this.CACHE_KEY_CATS, DEFAULT_MASTER_CATEGORIES, 10 * 60 * 1000);
        return DEFAULT_MASTER_CATEGORIES;
      }

      dataCache.set(this.CACHE_KEY_CATS, data, 10 * 60 * 1000);
      return data;
    } catch {
      return DEFAULT_MASTER_CATEGORIES;
    }
  }

  /**
   * Fetches all active master tile sizes from Supabase (with category names joined).
   */
  async fetchMasterSizes(forceRefresh = false): Promise<MasterTileSize[]> {
    if (!forceRefresh) {
      const cached = dataCache.get<MasterTileSize[]>(this.CACHE_KEY_SIZES);
      if (cached && cached.length > 0) return cached;
    }

    try {
      const { data, error } = await supabase
        .from('master_sizes')
        .select(`
          id,
          label,
          category_id,
          default_pieces_per_box,
          default_sqft_per_box,
          has_concept_variants,
          display_order,
          is_active,
          created_at,
          master_categories ( name )
        `)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error || !data || data.length === 0) {
        dataCache.set(this.CACHE_KEY_SIZES, DEFAULT_MASTER_SIZES, 10 * 60 * 1000);
        return DEFAULT_MASTER_SIZES;
      }

      const formatted: MasterTileSize[] = data.map((item: any) => ({
        id: item.id,
        label: item.label,
        category_id: item.category_id,
        category_name: item.master_categories?.name || undefined,
        default_pieces_per_box: Number(item.default_pieces_per_box) || 6,
        default_sqft_per_box: Number(item.default_sqft_per_box) || 9.00,
        has_concept_variants: Boolean(item.has_concept_variants),
        display_order: Number(item.display_order) || 0,
        is_active: Boolean(item.is_active),
        created_at: item.created_at,
      }));

      dataCache.set(this.CACHE_KEY_SIZES, formatted, 10 * 60 * 1000);
      return formatted;
    } catch {
      return DEFAULT_MASTER_SIZES;
    }
  }

  // ─── Superadmin Mutations ──────────────────────────────────────────────────

  async createCategory(name: string, displayOrder = 0): Promise<{ success: boolean; data?: MasterCategory; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('master_categories')
        .insert({ name: name.trim(), display_order: displayOrder, is_active: true })
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_CATS);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create category' };
    }
  }

  async updateCategory(id: string, updates: Partial<MasterCategory>): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('master_categories')
        .update(updates)
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_CATS);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update category' };
    }
  }

  async deleteCategory(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Soft-delete to prevent breaking linked sizes/products
      const { error } = await supabase
        .from('master_categories')
        .update({ is_active: false })
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_CATS);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete category' };
    }
  }

  async createSize(payload: {
    label: string;
    categoryId?: string;
    defaultPiecesPerBox: number;
    defaultSqftPerBox: number;
    hasConceptVariants?: boolean;
    displayOrder?: number;
  }): Promise<{ success: boolean; data?: MasterTileSize; error?: string }> {
    try {
      const cleanLabel = payload.label.trim().replace(/x/gi, '×').replace(/\*/g, '×');
      const { data, error } = await supabase
        .from('master_sizes')
        .insert({
          label: cleanLabel,
          category_id: payload.categoryId || null,
          default_pieces_per_box: payload.defaultPiecesPerBox,
          default_sqft_per_box: payload.defaultSqftPerBox,
          has_concept_variants: Boolean(payload.hasConceptVariants),
          display_order: payload.displayOrder || 0,
          is_active: true,
        })
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_SIZES);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create size' };
    }
  }

  async updateSize(id: string, updates: Partial<MasterTileSize>): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('master_sizes')
        .update(updates)
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_SIZES);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update size' };
    }
  }

  async deleteSize(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Soft-delete
      const { error } = await supabase
        .from('master_sizes')
        .update({ is_active: false })
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      dataCache.invalidate(this.CACHE_KEY_SIZES);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete size' };
    }
  }
}

export const masterCatalogService = new MasterCatalogService();
