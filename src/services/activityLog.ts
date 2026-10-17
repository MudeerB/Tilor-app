import { supabase } from './supabase';
import { StorageService } from './storage';

export interface ActivityLogPayload {
  shopId: string;
  userId?: string | null;
  userName?: string;
  userRole?: string;
  entityType: 'invoice' | 'product' | 'stock' | 'customer' | 'estimate';
  entityId?: string;
  entityName?: string;
  action: string;
  details?: Record<string, any>;
}

export interface ActivityLog {
  id: string;
  shop_id: string;
  user_id: string | null;
  user_name: string;
  user_role: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

export interface SecurityAuditLog {
  id: string;
  shop_id: string;
  user_id: string | null;
  user_name?: string;
  user_role?: string;
  event_type: string;
  severity: 'HIGH' | 'CRITICAL';
  details: Record<string, any>;
  created_at: string;
  shop_name?: string;
}

const isValidUUID = (uuid?: string | null): boolean => {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
};

// In-memory cache for user profiles to avoid repeated DB lookups
const userProfileCache = new Map<string, { name: string; role: string }>();

/**
 * Resolves user profile (name, role) by userId from cache, local session, or public.users.
 */
async function resolveUserInfo(userId?: string | null): Promise<{ name: string; role: string } | null> {
  try {
    if (userId && isValidUUID(userId) && userProfileCache.has(userId)) {
      return userProfileCache.get(userId)!;
    }

    // 1. Check local session from StorageService
    const localSession = await StorageService.getSession().catch(() => null);
    if (localSession) {
      const localName = localSession.full_name || localSession.username || (localSession.email ? localSession.email.split('@')[0] : 'User');
      const localInfo = { name: localName, role: localSession.role || 'staff' };
      if (localSession.id) {
        userProfileCache.set(localSession.id, localInfo);
      }
      if (!userId || userId === localSession.id) {
        return localInfo;
      }
    }

    // 2. If specific userId provided, query public.users
    if (userId && isValidUUID(userId)) {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, role')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        const resolvedName = data.full_name || (data.email ? data.email.split('@')[0] : 'User');
        const info = { name: resolvedName, role: data.role || 'staff' };
        userProfileCache.set(userId, info);
        return info;
      }
    }

    // 3. Fallback: check Supabase Auth session
    const { data: authData } = await supabase.auth.getSession();
    const authUser = authData?.session?.user;
    if (authUser && (!userId || authUser.id === userId)) {
      const metaName = authUser.user_metadata?.full_name;
      const emailName = authUser.email ? authUser.email.split('@')[0] : 'User';
      const info = { name: metaName || emailName, role: 'staff' };
      if (authUser.id) userProfileCache.set(authUser.id, info);
      return info;
    }
  } catch (err) {
    console.warn('[ActivityLogService] Could not resolve user info:', err);
  }
  return null;
}

/**
 * Batch populates userProfileCache for an array of user IDs.
 */
async function batchPopulateUserProfiles(userIds: (string | null | undefined)[]): Promise<void> {
  try {
    const localSession = await StorageService.getSession().catch(() => null);
    if (localSession?.id) {
      const localName = localSession.full_name || localSession.username || (localSession.email ? localSession.email.split('@')[0] : 'User');
      userProfileCache.set(localSession.id, { name: localName, role: localSession.role || 'staff' });
    }

    const missingIds = Array.from(new Set(
      userIds.filter((id): id is string => Boolean(id && isValidUUID(id) && !userProfileCache.has(id)))
    ));

    if (missingIds.length === 0) return;

    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role')
      .in('id', missingIds);

    if (!error && data) {
      data.forEach((u: any) => {
        const resolvedName = u.full_name || (u.email ? u.email.split('@')[0] : 'User');
        userProfileCache.set(u.id, { name: resolvedName, role: u.role || 'staff' });
      });
    }
  } catch (err) {
    console.warn('[ActivityLogService] Batch user profile resolution error:', err);
  }
}

export const activityLogService = {
  /**
   * Logs a new activity to the database asynchronously.
   * Automatically resolves and attaches the actor's real account name and role.
   */
  async logActivity(payload: ActivityLogPayload): Promise<void> {
    try {
      let validUserId = isValidUUID(payload.userId) ? payload.userId : null;
      if (!validUserId) {
        const { data: { session } } = await supabase.auth.getSession();
        validUserId = session?.user?.id && isValidUUID(session.user.id) ? session.user.id : null;
      }
      if (!validUserId) {
        const localSession = await StorageService.getSession().catch(() => null);
        if (localSession?.id && isValidUUID(localSession.id)) {
          validUserId = localSession.id;
        }
      }
      const validShopId = isValidUUID(payload.shopId) ? payload.shopId : null;

      if (!validShopId) {
        console.warn('Skipping activity log: Invalid shopId provided', payload.shopId);
        return;
      }

      let resolvedUserName = payload.userName;
      let resolvedUserRole = payload.userRole;

      if (!resolvedUserName || resolvedUserName === 'System') {
        const userInfo = await resolveUserInfo(validUserId);
        if (userInfo) {
          resolvedUserName = userInfo.name;
          if (!resolvedUserRole) {
            resolvedUserRole = userInfo.role;
          }
        }
      }

      const { error } = await supabase.from('activity_logs').insert({
        shop_id: validShopId,
        user_id: validUserId,
        user_name: resolvedUserName || 'System',
        user_role: resolvedUserRole || 'staff',
        entity_type: payload.entityType,
        entity_id: payload.entityId || null,
        entity_name: payload.entityName || null,
        action: payload.action,
        details: payload.details || {},
      });

      if (error) {
        console.warn('Failed to insert activity log:', error.message);
      }
    } catch (err) {
      // Non-blocking: log errors silently without interrupting the user flow
      console.warn('Failed to write activity log:', err);
    }
  },

  /**
   * Logs a high-priority security event via secure RPC.
   */
  async logSecurityAlert(
    shopId: string,
    eventType: string,
    severity: 'HIGH' | 'CRITICAL',
    details: Record<string, any> = {}
  ): Promise<void> {
    try {
      const { error } = await supabase.rpc('log_security_event', {
        p_shop_id: shopId,
        p_event_type: eventType,
        p_severity: severity,
        p_details: details,
      });
      if (error) {
        console.warn('[ActivityLogService] Failed to record security event via RPC:', error.message);
      }
    } catch (err) {
      console.warn('[ActivityLogService] Exception recording security alert:', err);
    }
  },

  /**
   * Fetches paginated activity logs.
   * Automatically resolves legacy or fallback 'System' rows to real account names.
   */
  async fetchLogs(
    shopId?: string,
    limit: number = 50,
    offset: number = 0,
    filters?: {
      userId?: string;
      entityType?: string;
    }
  ): Promise<ActivityLog[]> {
    try {
      let query = supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (shopId && shopId !== 'all' && isValidUUID(shopId)) {
        query = query.eq('shop_id', shopId);
      }
      if (filters?.userId && isValidUUID(filters.userId)) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters?.entityType) {
        query = query.eq('entity_type', filters.entityType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching activity logs:', error);
        return [];
      }

      const rawLogs = data || [];
      await batchPopulateUserProfiles(rawLogs.map((l: any) => l.user_id));

      return rawLogs.map((log: any) => {
        let userName = log.user_name;
        let userRole = log.user_role;

        // If recorded as 'System' (or missing) but user_id is present, resolve to real account name
        if ((!userName || userName === 'System') && log.user_id && userProfileCache.has(log.user_id)) {
          const cached = userProfileCache.get(log.user_id)!;
          userName = cached.name;
          if (!userRole || userRole === 'staff') userRole = cached.role;
        }

        return {
          ...log,
          user_name: userName || 'System',
          user_role: userRole || 'staff',
        };
      }) as ActivityLog[];
    } catch (err) {
      console.error('Failed to fetch activity logs:', err);
      return [];
    }
  },

  /**
   * Fetches security audit logs for Owners (shop-scoped) or Admins (cross-tenant).
   * Resolves the actual account name of the actor responsible for each event.
   */
  async fetchSecurityAuditLogs(
    shopId?: string,
    limit: number = 50,
    offset: number = 0,
    severity?: 'HIGH' | 'CRITICAL'
  ): Promise<SecurityAuditLog[]> {
    try {
      let query = supabase
        .from('security_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (shopId && shopId !== 'all' && isValidUUID(shopId)) {
        query = query.eq('shop_id', shopId);
      }
      if (severity) {
        query = query.eq('severity', severity);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[ActivityLogService] Error fetching security audit logs:', error);
        return [];
      }

      const rawSecLogs = data || [];
      const userIdsToFetch = rawSecLogs.flatMap((l: any) => [
        l.user_id,
        l.details?.executed_by,
        l.details?.voided_by,
        l.details?.user_id,
      ]);
      await batchPopulateUserProfiles(userIdsToFetch);

      return rawSecLogs.map((sec: any) => {
        const actorId = sec.user_id || sec.details?.executed_by || sec.details?.voided_by || sec.details?.user_id;
        let userName: string | undefined;
        let userRole: string | undefined;

        if (actorId && userProfileCache.has(actorId)) {
          const cached = userProfileCache.get(actorId)!;
          userName = cached.name;
          userRole = cached.role;
        } else if (sec.details?.executed_by_name) {
          userName = sec.details.executed_by_name;
        } else if (sec.details?.user_name) {
          userName = sec.details.user_name;
        } else if (!sec.user_id) {
          userName = 'System (Automated)';
        }

        return {
          ...sec,
          user_name: userName,
          user_role: userRole,
        };
      }) as SecurityAuditLog[];
    } catch (err) {
      console.error('[ActivityLogService] Exception fetching security audit logs:', err);
      return [];
    }
  },

  /**
   * Admin-only maintenance action: purge audit logs older than the retention period (default 2 years).
   */
  async adminPurgeOldAuditLogs(
    years: number = 2
  ): Promise<{ success: boolean; deletedCount?: number; cutoffDate?: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('admin_purge_audit_logs', {
        p_older_than_years: years,
      });

      if (error || !data || !data.success) {
        return {
          success: false,
          error: error?.message || data?.error || 'Failed to purge archived audit logs.',
        };
      }

      return {
        success: true,
        deletedCount: data.deletedCount,
        cutoffDate: data.cutoffDate,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Unexpected exception during audit log purge.',
      };
    }
  },
};
