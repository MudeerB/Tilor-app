/**
 * src/services/adminService.ts
 *
 * Superadmin client service layer for managing shops, provisioning users,
 * and executing platform administrative operations via secure RPC functions.
 */

import { supabase } from './supabase';
import {
  ShopRecord,
  CreateShopPayload,
  CreateUserPayload,
  UserProfile,
} from '../types/auth';
import { activityLogService } from './activityLog';

export interface AdminOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

class AdminService {
  /**
   * Fetches all registered tenant shops ordered by name.
   */
  async fetchAllShops(): Promise<AdminOperationResult<ShopRecord[]>> {
    try {
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data: (data as ShopRecord[]) || [] };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to fetch shops.' };
    }
  }

  /**
   * Creates a new shop record using the hardened admin_create_shop RPC.
   */
  async createShop(payload: CreateShopPayload): Promise<AdminOperationResult<ShopRecord>> {
    try {
      const { data, error } = await supabase.rpc('admin_create_shop', {
        p_name: payload.name.trim(),
        p_gst_rate: Number(payload.gstRate) || 18.0,
        p_currency: payload.currency || 'INR',
        p_settings: payload.settings || {},
      });

      if (error) {
        return { success: false, error: error.message };
      }

      const shopData = data as ShopRecord;
      if (shopData?.id) {
        activityLogService.logActivity({
          shopId: shopData.id,
          entityType: 'shop',
          entityId: shopData.id,
          entityName: shopData.name,
          action: 'shop_created',
          details: {
            gstRate: shopData.gst_rate,
            currency: shopData.currency,
          },
        }).catch(() => {});
      }

      return { success: true, data: shopData };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create shop.' };
    }
  }

  /**
   * Updates an existing shop record (e.g. name, tax rate, phone, address).
   */
  async updateShop(
    shopId: string,
    updates: Partial<ShopRecord>
  ): Promise<AdminOperationResult<ShopRecord>> {
    try {
      const { data, error } = await supabase
        .from('shops')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shopId)
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      const updatedShop = data as ShopRecord;
      activityLogService.logActivity({
        shopId,
        entityType: 'shop',
        entityId: shopId,
        entityName: updatedShop.name,
        action: 'shop_updated',
        details: updates,
      }).catch(() => {});

      return { success: true, data: updatedShop };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update shop.' };
    }
  }

  /**
   * Fetches all users across all shops or filtered by a specific shop ID.
   */
  async fetchAllUsers(shopId?: string): Promise<AdminOperationResult<UserProfile[]>> {
    try {
      let query = supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (shopId) {
        query = query.eq('shop_id', shopId);
      }

      const { data, error } = await query;

      if (error) {
        return { success: false, error: error.message };
      }

      const mappedUsers = (data || []).map((row: any) => ({
        id: row.id,
        shop_id: row.shop_id,
        email: row.email,
        full_name: row.full_name,
        role: row.role,
        is_active: row.is_active,
        last_login: row.last_login,
        password_changed_at: row.password_changed_at,
        created_at: row.created_at,
        shop_name: row.role === 'superadmin' ? 'Platform (Superadmin)' : undefined,
      }));

      return { success: true, data: mappedUsers as UserProfile[] };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to fetch users.' };
    }
  }

  /**
   * Provisions a brand new shop owner, admin, or staff user via the secure admin_create_user RPC.
   * Enforces temporary password creation with password_changed_at = null for forced rotation.
   */
  async createUser(payload: CreateUserPayload): Promise<AdminOperationResult<UserProfile>> {
    try {
      const { data, error } = await supabase.rpc('admin_create_user', {
        p_email: payload.email.trim().toLowerCase(),
        p_password: payload.password,
        p_role: payload.role,
        p_shop_id: payload.shopId,
        p_full_name: payload.fullName.trim(),
      });

      if (error) {
        return { success: false, error: error.message };
      }

      const userProfile = data as UserProfile;
      activityLogService.logActivity({
        shopId: payload.shopId,
        entityType: 'user',
        entityId: userProfile?.id,
        entityName: payload.fullName.trim(),
        action: 'user_provisioned',
        details: {
          email: payload.email.trim().toLowerCase(),
          role: payload.role,
        },
      }).catch(() => {});

      return { success: true, data: userProfile };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create user.' };
    }
  }

  /**
   * Toggles a user's active status (instantly revoking or restoring access).
   */
  async toggleUserStatus(
    userId: string,
    isActive: boolean
  ): Promise<AdminOperationResult<UserProfile>> {
    try {
      const { data, error } = await supabase.rpc('admin_toggle_user_status', {
        p_user_id: userId,
        p_is_active: isActive,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      const updatedUser = data as UserProfile;
      if (updatedUser?.shop_id) {
        activityLogService.logActivity({
          shopId: updatedUser.shop_id,
          entityType: 'user',
          entityId: userId,
          entityName: updatedUser.full_name || updatedUser.email,
          action: isActive ? 'user_activated' : 'user_suspended',
          details: { userId, isActive },
        }).catch(() => {});
      }

      return { success: true, data: updatedUser };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to toggle user status.' };
    }
  }

  /**
   * Resets a user's password directly and flags them for password change on next login.
   */
  async resetUserPassword(
    userId: string,
    newPass: string
  ): Promise<AdminOperationResult<boolean>> {
    try {
      const { data, error } = await supabase.rpc('admin_reset_user_password', {
        p_user_id: userId,
        p_new_password: newPass,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Asynchronously log the password reset without blocking response
      (async () => {
        try {
          const { data: u } = await supabase
            .from('users')
            .select('shop_id, email, full_name')
            .eq('id', userId)
            .maybeSingle();

          if (u?.shop_id) {
            await activityLogService.logActivity({
              shopId: u.shop_id,
              entityType: 'user',
              entityId: userId,
              entityName: u.full_name || u.email,
              action: 'password_reset_by_admin',
              details: { userId },
            });
          }
        } catch {}
      })();

      return { success: true, data: Boolean(data) };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to reset user password.' };
    }
  }

  /**
   * Fetches real-time operational metrics for a specific showroom.
   */
  async fetchShopMetrics(shopId: string): Promise<AdminOperationResult<{
    totalStaff: number;
    totalInvoices: number;
    totalRevenue: number;
    totalProducts: number;
  }>> {
    try {
      const { count: staffCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId);

      const { data: invData } = await supabase
        .from('invoices')
        .select('total_amount')
        .eq('shop_id', shopId)
        .eq('is_voided', false);

      const totalInvoices = invData?.length || 0;
      const totalRevenue = (invData || []).reduce((acc, row) => acc + (Number(row.total_amount) || 0), 0);

      const { count: prodCount } = await supabase
        .from('tile_collections')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('is_archived', false);

      return {
        success: true,
        data: {
          totalStaff: staffCount || 0,
          totalInvoices,
          totalRevenue,
          totalProducts: prodCount || 0,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to fetch showroom metrics.' };
    }
  }

  /**
   * Updates an existing user's profile attributes (name, role).
   */
  async updateUser(
    userId: string,
    updates: { full_name?: string; role?: UserProfile['role'] }
  ): Promise<AdminOperationResult<UserProfile>> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      const updatedUser = data as UserProfile;
      if (updatedUser?.shop_id) {
        activityLogService.logActivity({
          shopId: updatedUser.shop_id,
          entityType: 'user',
          entityId: userId,
          entityName: updatedUser.full_name || updatedUser.email,
          action: 'user_profile_updated',
          details: updates,
        }).catch(() => {});
      }

      return { success: true, data: updatedUser };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update user profile.' };
    }
  }

  /**
   * Safely deletes a user if no finalized billing records are linked to their account.
   */
  async deleteUser(userId: string): Promise<AdminOperationResult<boolean>> {
    try {
      const { count: invoiceCount } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (invoiceCount && invoiceCount > 0) {
        return {
          success: false,
          error: `Cannot delete user: ${invoiceCount} finalized invoices are linked to this staff member. Suspend their access instead to maintain financial audit integrity.`,
        };
      }

      const { error: userError } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (userError) {
        return { success: false, error: userError.message };
      }

      return { success: true, data: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete user.' };
    }
  }
}

export const adminService = new AdminService();
